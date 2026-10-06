import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { registerTransaction, revertTransaction } from "@/lib/finanzas/register";
import { getStock, listMovements } from "@/lib/inventario/stock";
import { totalsByCurrency, listTransactions } from "@/lib/finanzas/queries";

/**
 * Registro de operaciones de punta a punta, contra la base real.
 *
 * Es la prueba que mas importa de la fase: verifica que el monto lo calcule el
 * servidor, que los precios se congelen, que el inventario se mueva en la misma
 * transaccion y que anular reponga sin borrar.
 */

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const user = uuidv7();
const ctx = { tenantId: tenant, userId: user };

const catIngreso = uuidv7();
const catGasto = uuidv7();
const catProd = uuidv7();
const catServ = uuidv7();
const payUsd = uuidv7();
const payVes = uuidv7();
const monitor = uuidv7();
const teclado = uuidv7();
const instalacion = uuidv7();
const productoEnBs = uuidv7();

const base = {
  concept: "Prueba",
  occurredOn: "2026-09-11",
  paymentMethodId: payUsd,
};

describe.skipIf(!hasDb)("registro de operaciones", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug) values (${tenant}, 'Reg', ${"reg-" + tenant.slice(0, 8)})`;
    await sql`insert into users (id, email) values (${user}, ${`reg-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label, currency) values
      (${catIngreso}, ${tenant}, 'income_category',  'ventas',  'Ventas',  null),
      (${catGasto},   ${tenant}, 'expense_category', 'insumos', 'Insumos', null),
      (${catProd},    ${tenant}, 'product_category', 'general', 'General', null),
      (${catServ},    ${tenant}, 'service_category', 'general', 'General', null),
      (${payUsd},     ${tenant}, 'payment_method',   'efec',    'Efectivo USD', 'USD'),
      (${payVes},     ${tenant}, 'payment_method',   'pm',      'Pago móvil',   'VES')`;
    await sql`insert into products (id, tenant_id, name, category_id, price, currency) values
      (${monitor},        ${tenant}, 'Monitor', ${catProd}, '150.00', 'USD'),
      (${teclado},        ${tenant}, 'Teclado', ${catProd}, '25.50',  'USD'),
      (${productoEnBs},   ${tenant}, 'Cable',   ${catProd}, '90.00',  'VES')`;
    await sql`insert into services (id, tenant_id, name, category_id, price, currency) values
      (${instalacion}, ${tenant}, 'Instalación', ${catServ}, '40.00', 'USD')`;
    // Stock inicial del monitor.
    await sql`insert into stock_movements (id, tenant_id, product_id, delta, reason, occurred_at, created_by)
              values (${uuidv7()}, ${tenant}, ${monitor}, 20, 'inicial', now(), ${user})`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  // -------------------------------------------------------------------------
  // Operacion suelta
  // -------------------------------------------------------------------------

  it("registra una operacion suelta con el monto tecleado", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "125.5",
      clientRequestId: uuidv7(),
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Normalizado a dos decimales.
    expect(r.amount).toBe("125.50");
    expect(r.currency).toBe("USD");
  });

  it("la moneda sale del metodo de pago, no del formulario", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      paymentMethodId: payVes,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "3650.00",
      clientRequestId: uuidv7(),
    });

    expect(r.ok && r.currency).toBe("VES");
  });

  it("rechaza una operacion suelta con renglones", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "10.00",
      items: [{ itemType: "product", refId: monitor, qty: "1" }],
      clientRequestId: uuidv7(),
    });

    expect(r.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Venta
  // -------------------------------------------------------------------------

  it("calcula el monto de una venta en el servidor y descuenta inventario", async () => {
    const antes = Number(await getStock(tenant, monitor));

    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [
        { itemType: "product", refId: monitor, qty: "2" }, // 300.00
        { itemType: "product", refId: teclado, qty: "3" }, // 76.50
        { itemType: "service", refId: instalacion, qty: "1" }, // 40.00
      ],
      clientRequestId: uuidv7(),
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amount).toBe("416.50");

    // El servicio no mueve inventario; el monitor si.
    expect(Number(await getStock(tenant, monitor))).toBe(antes - 2);
  });

  it("ignora el monto que mande el cliente en una venta", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      // Un cliente malicioso podria mandar cualquier cosa aca.
      amount: "1.00",
      items: [{ itemType: "product", refId: monitor, qty: "1" }],
      clientRequestId: uuidv7(),
    });

    expect(r.ok && r.amount).toBe("150.00");
  });

  it("congela el precio: cambiarlo despues no altera la venta anterior", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [{ itemType: "product", refId: teclado, qty: "2" }],
      clientRequestId: uuidv7(),
    });
    expect(r.ok && r.amount).toBe("51.00");
    if (!r.ok) return;

    await sql`update products set price = '999.00' where id = ${teclado}`;
    try {
      const [fila] = await sql<{ amount: string; unit_price: string }[]>`
        select t.amount, i.unit_price
        from transactions t join transaction_items i on i.transaction_id = t.id
        where t.id = ${r.id}`;
      expect(fila.amount).toBe("51.00");
      expect(fila.unit_price).toBe("25.50");
    } finally {
      await sql`update products set price = '25.50' where id = ${teclado}`;
    }
  });

  it("rechaza mezclar monedas entre el pago y los renglones", async () => {
    // Sumar un producto en Bs dentro de una venta cobrada en USD daria un
    // numero que no es dinero, porque no se convierte nada.
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [{ itemType: "product", refId: productoEnBs, qty: "1" }],
      clientRequestId: uuidv7(),
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no se convierten|VES|USD/i);
  });

  it("rechaza una venta sin renglones", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [],
      clientRequestId: uuidv7(),
    });
    expect(r.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Compra
  // -------------------------------------------------------------------------

  it("una compra suma al inventario", async () => {
    const antes = Number(await getStock(tenant, monitor));

    const r = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      items: [{ itemType: "product", refId: monitor, qty: "5" }],
      clientRequestId: uuidv7(),
    });

    expect(r.ok && r.amount).toBe("750.00");
    expect(Number(await getStock(tenant, monitor))).toBe(antes + 5);
  });

  it("una compra no admite servicios", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      items: [{ itemType: "service", refId: instalacion, qty: "1" }],
      clientRequestId: uuidv7(),
    });
    expect(r.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Coherencia y validaciones
  // -------------------------------------------------------------------------

  it("rechaza una categoria que no corresponde al tipo", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "operacion",
      categoryId: catIngreso, // categoria de INGRESO en un gasto
      amount: "10.00",
      clientRequestId: uuidv7(),
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza usar un metodo de pago archivado", async () => {
    await sql`update catalog_items set archived_at = now() where id = ${payVes}`;
    try {
      const r = await registerTransaction(ctx, {
        ...base,
        paymentMethodId: payVes,
        type: "ingreso",
        kind: "operacion",
        categoryId: catIngreso,
        amount: "10.00",
        clientRequestId: uuidv7(),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/archivado/i);
    } finally {
      await sql`update catalog_items set archived_at = null where id = ${payVes}`;
    }
  });

  // -------------------------------------------------------------------------
  // Idempotencia
  // -------------------------------------------------------------------------

  it("el doble tap devuelve la misma operacion, no un error ni un duplicado", async () => {
    const clave = uuidv7();
    const input = {
      ...base,
      type: "ingreso" as const,
      kind: "venta" as const,
      categoryId: catIngreso,
      items: [{ itemType: "product" as const, refId: monitor, qty: "1" }],
      clientRequestId: clave,
    };

    const stockAntes = Number(await getStock(tenant, monitor));
    const primera = await registerTransaction(ctx, input);
    const segunda = await registerTransaction(ctx, input);

    expect(primera.ok).toBe(true);
    expect(segunda.ok).toBe(true);
    if (!primera.ok || !segunda.ok) return;

    // Misma transaccion, marcada como duplicada.
    expect(segunda.id).toBe(primera.id);
    expect(segunda.duplicate).toBe(true);
    // Y el inventario se movio UNA sola vez.
    expect(Number(await getStock(tenant, monitor))).toBe(stockAntes - 1);
  });

  // -------------------------------------------------------------------------
  // Anulacion
  // -------------------------------------------------------------------------

  it("anular repone el inventario sin borrar los movimientos originales", async () => {
    const stockInicial = Number(await getStock(tenant, monitor));

    const venta = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [{ itemType: "product", refId: monitor, qty: "4" }],
      clientRequestId: uuidv7(),
    });
    expect(venta.ok).toBe(true);
    if (!venta.ok) return;
    expect(Number(await getStock(tenant, monitor))).toBe(stockInicial - 4);

    const movimientosAntes = (await listMovements(tenant, monitor)).length;

    const anulada = await revertTransaction(ctx, {
      id: venta.id,
      reason: "Cliente devolvió",
    });
    expect(anulada.ok).toBe(true);

    // Stock repuesto...
    expect(Number(await getStock(tenant, monitor))).toBe(stockInicial);
    // ...con un movimiento NUEVO, no borrando el viejo.
    const movimientos = await listMovements(tenant, monitor);
    expect(movimientos.length).toBe(movimientosAntes + 1);
    expect(movimientos[0].reason).toBe("anulacion");
    expect(movimientos[0].note).toBe("Cliente devolvió");
  });

  it("una operacion anulada no cuenta en los totales ni en el listado", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "5000.00",
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    const conLaOperacion = await totalsByCurrency(tenant, {
      type: "ingreso",
      currency: "USD",
    });
    await revertTransaction(ctx, { id: tx.id });
    const sinLaOperacion = await totalsByCurrency(tenant, {
      type: "ingreso",
      currency: "USD",
    });

    expect(Number(conLaOperacion[0].total) - Number(sinLaOperacion[0].total)).toBe(
      5000,
    );

    const { rows } = await listTransactions(tenant, { perPage: 100 });
    expect(rows.map((r) => r.id)).not.toContain(tx.id);
  });

  it("no se puede anular dos veces", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "10.00",
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    expect((await revertTransaction(ctx, { id: tx.id })).ok).toBe(true);
    const segunda = await revertTransaction(ctx, { id: tx.id });
    expect(segunda.ok).toBe(false);
    expect(segunda.error).toMatch(/ya está anulada/i);
  });

  // -------------------------------------------------------------------------
  // Auditoria
  // -------------------------------------------------------------------------

  it("cada operacion deja su rastro en el log de auditoria", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "77.00",
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    const [evento] = await sql<{ action: string; diff: Record<string, unknown>; actor_id: string }[]>`
      select action, diff, actor_id from audit_log
      where entity = 'transactions' and entity_id = ${tx.id}`;

    expect(evento.action).toBe("create");
    expect(evento.actor_id).toBe(user);
    expect(evento.diff.amount).toBe("77.00");
  });
});
