import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  registerProduct,
  updateProduct,
  archiveProduct,
  adjustStock,
  registerService,
} from "@/lib/productos/register";
import { listProducts, listServicesCatalog, listSellables } from "@/lib/productos/queries";
import { getStock, listMovements } from "@/lib/inventario/stock";
import { registerTransaction } from "@/lib/finanzas/register";

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const user = uuidv7();
const ctx = { tenantId: tenant, userId: user };
const catProd = uuidv7();
const catServ = uuidv7();
const catIngreso = uuidv7();
const payUsd = uuidv7();

describe.skipIf(!hasDb)("catalogo de productos y servicios", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });
    await sql`insert into tenants (id, name, slug) values (${tenant}, 'Cat', ${"cat-" + tenant.slice(0, 8)})`;
    await sql`insert into users (id, email) values (${user}, ${`cat-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label, currency) values
      (${catProd},    ${tenant}, 'product_category', 'general', 'General', null),
      (${catServ},    ${tenant}, 'service_category', 'general', 'General', null),
      (${catIngreso}, ${tenant}, 'income_category',  'ventas',  'Ventas',  null),
      (${payUsd},     ${tenant}, 'payment_method',   'efec',    'Efectivo USD', 'USD')`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  it("crea un producto y su stock inicial queda como movimiento", async () => {
    const r = await registerProduct(ctx, {
      name: "Monitor",
      sku: "MON-1",
      categoryId: catProd,
      price: "150",
      currency: "USD",
      minStock: "3",
      initialStock: "10",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // El stock inicial NO es una columna: es un movimiento, y eso es lo que
    // permite explicar despues de donde salio cada unidad.
    expect(await getStock(tenant, r.id)).toBe("10.000");
    const movs = await listMovements(tenant, r.id);
    expect(movs.length).toBe(1);
    expect(movs[0].reason).toBe("inicial");

    const [p] = await listProducts(tenant);
    expect(p.price).toBe("150.00"); // normalizado
    expect(p.minStock).toBe("3.000");
    expect(p.categoryLabel).toBe("General");
  });

  it("un producto sin stock inicial aparece en cero, no desaparece", async () => {
    const r = await registerProduct(ctx, {
      name: "Sin stock",
      categoryId: catProd,
      price: "9.99",
      currency: "USD",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const productos = await listProducts(tenant);
    const sinStock = productos.find((p) => p.id === r.id);
    expect(sinStock).toBeDefined();
    expect(sinStock!.stock).toBe("0.000");
    expect(await listMovements(tenant, r.id)).toEqual([]);
  });

  it("rechaza una categoria del catalogo equivocado", async () => {
    const r = await registerProduct(ctx, {
      name: "Mal categorizado",
      categoryId: catServ, // categoria de SERVICIO en un producto
      price: "10",
      currency: "USD",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("categoryId");
  });

  it("rechaza una categoria archivada", async () => {
    await sql`update catalog_items set archived_at = now() where id = ${catProd}`;
    try {
      const r = await registerProduct(ctx, {
        name: "Con categoria archivada",
        categoryId: catProd,
        price: "10",
        currency: "USD",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/archivada/i);
    } finally {
      await sql`update catalog_items set archived_at = null where id = ${catProd}`;
    }
  });

  it("rechaza una moneda que no esta en la lista", async () => {
    const r = await registerProduct(ctx, {
      name: "Moneda rara",
      categoryId: catProd,
      price: "10",
      currency: "XYZ",
    });
    expect(r.ok).toBe(false);
  });

  it("el SKU no se puede repetir entre productos activos", async () => {
    const r = await registerProduct(ctx, {
      name: "Otro monitor",
      sku: "MON-1", // ya usado
      categoryId: catProd,
      price: "10",
      currency: "USD",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/SKU/i);
  });

  it("cambiar el precio no altera las ventas ya registradas", async () => {
    const creado = await registerProduct(ctx, {
      name: "Teclado",
      categoryId: catProd,
      price: "20.00",
      currency: "USD",
      initialStock: "5",
    });
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;

    const venta = await registerTransaction(ctx, {
      type: "ingreso",
      kind: "venta",
      concept: "Venta de teclado",
      occurredOn: "2026-09-11",
      categoryId: catIngreso,
      paymentMethodId: payUsd,
      items: [{ itemType: "product", refId: creado.id, qty: "2" }],
      clientRequestId: uuidv7(),
    });
    expect(venta.ok && venta.amount).toBe("40.00");

    await updateProduct(ctx, creado.id, {
      name: "Teclado",
      categoryId: catProd,
      price: "35.00",
      currency: "USD",
    });

    const [fila] = await sql<{ amount: string }[]>`
      select amount from transactions where id = ${venta.ok ? venta.id : ""}`;
    expect(fila.amount).toBe("40.00");

    // Y el producto si tiene el precio nuevo para las ventas futuras.
    const p = (await listProducts(tenant)).find((x) => x.id === creado.id);
    expect(p!.price).toBe("35.00");
  });

  it("el ajuste de inventario suma la diferencia, no fija un valor", async () => {
    const creado = await registerProduct(ctx, {
      name: "Ajustable",
      categoryId: catProd,
      price: "1.00",
      currency: "USD",
      initialStock: "10",
    });
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;

    await adjustStock(ctx, {
      productId: creado.id,
      delta: "-3",
      reason: "merma",
      note: "Se dañaron",
    });
    expect(await getStock(tenant, creado.id)).toBe("7.000");

    const movs = await listMovements(tenant, creado.id);
    expect(movs[0].reason).toBe("merma");
    expect(movs[0].note).toBe("Se dañaron");
    // El movimiento inicial sigue ahi: el historial explica el 7.
    expect(movs.length).toBe(2);
  });

  it("rechaza un ajuste de cero", async () => {
    const [p] = await listProducts(tenant);
    const r = await adjustStock(ctx, {
      productId: p.id,
      delta: "0",
      reason: "ajuste",
    });
    expect(r.ok).toBe(false);
  });

  it("archivar saca el producto de los selectores pero no lo borra", async () => {
    const creado = await registerProduct(ctx, {
      name: "Descontinuado",
      categoryId: catProd,
      price: "5.00",
      currency: "USD",
    });
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;

    expect((await listSellables(tenant)).some((s) => s.id === creado.id)).toBe(true);

    await archiveProduct(ctx, creado.id, true);

    // Fuera de los selectores de venta...
    expect((await listSellables(tenant)).some((s) => s.id === creado.id)).toBe(false);
    // ...y fuera del listado por defecto...
    expect((await listProducts(tenant)).some((p) => p.id === creado.id)).toBe(false);
    // ...pero sigue existiendo y se puede restaurar.
    const archivados = await listProducts(tenant, { includeArchived: true });
    expect(archivados.find((p) => p.id === creado.id)?.archived).toBe(true);

    await archiveProduct(ctx, creado.id, false);
    expect((await listProducts(tenant)).some((p) => p.id === creado.id)).toBe(true);
  });

  it("un producto inactivo no se puede vender pero sigue en el catalogo", async () => {
    const creado = await registerProduct(ctx, {
      name: "Pausado",
      categoryId: catProd,
      price: "5.00",
      currency: "USD",
      isActive: false,
    });
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;

    expect((await listSellables(tenant)).some((s) => s.id === creado.id)).toBe(false);
    expect((await listProducts(tenant)).some((p) => p.id === creado.id)).toBe(true);
  });

  it("crea servicios, que no llevan inventario", async () => {
    const r = await registerService(ctx, {
      name: "Instalación",
      categoryId: catServ,
      price: "40",
      currency: "USD",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [s] = await listServicesCatalog(tenant);
    expect(s.name).toBe("Instalación");
    expect(s.price).toBe("40.00");

    // Un servicio nunca genera movimientos de stock.
    const movimientos = await sql<{ n: number }[]>`
      select count(*)::int as n from stock_movements
      where tenant_id = ${tenant} and product_id = ${r.id}`;
    expect(movimientos[0].n).toBe(0);
  });

  it("un servicio no acepta categoria de producto", async () => {
    const r = await registerService(ctx, {
      name: "Mal",
      categoryId: catProd,
      price: "10",
      currency: "USD",
    });
    expect(r.ok).toBe(false);
  });

  it("un cliente no ve el catalogo de otro", async () => {
    const otro = uuidv7();
    await sql`insert into tenants (id, name, slug) values (${otro}, 'Otro', ${"otro-" + otro.slice(0, 8)})`;
    try {
      expect(await listProducts(otro)).toEqual([]);
      expect(await listServicesCatalog(otro)).toEqual([]);
      expect(await listSellables(otro)).toEqual([]);
    } finally {
      await sql`delete from tenants where id = ${otro}`;
    }
  });
});
