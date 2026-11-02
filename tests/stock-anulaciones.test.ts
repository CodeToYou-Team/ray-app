import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  editTransaction,
  registerTransaction,
  restoreTransaction,
  revertTransaction,
} from "@/lib/finanzas/register";
import { adjustStock } from "@/lib/productos/register";
import { getStock, listMovements } from "@/lib/inventario/stock";
import { balanceByCurrency, listTransactions, totalsByCurrency } from "@/lib/finanzas/queries";
import { alcanceDeLectura } from "@/lib/finanzas/alcance";
import type { TenantContext } from "@/lib/authz/session";

/**
 * Tres huecos cerrados juntos porque tocan el mismo camino:
 *
 *   - El stock no puede quedar negativo (trigger de drizzle/0023), por
 *     ninguna de las puertas que lo mueven.
 *   - Una anulación se puede deshacer, y deshacerla vuelve a mover el stock.
 *   - El Personal (`transaction:read_own`) solo ve lo que registró.
 */

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const dueno = uuidv7();
const cajero = uuidv7();
const ctx = { tenantId: tenant, userId: dueno };
const ctxCajero = { tenantId: tenant, userId: cajero };

const catIngreso = uuidv7();
const catGasto = uuidv7();
const catProd = uuidv7();
const payUsd = uuidv7();

const base = {
  concept: "Prueba",
  occurredOn: "2026-10-15",
  paymentMethodId: payUsd,
};

/** Un producto nuevo con `inicial` unidades, para que cada test no pise a otro. */
async function producto(inicial: number): Promise<string> {
  const id = uuidv7();
  await sql`insert into products (id, tenant_id, name, category_id, price, currency)
            values (${id}, ${tenant}, ${"Prod " + id.slice(-6)}, ${catProd}, '10.00', 'USD')`;
  if (inicial > 0) {
    await sql`insert into stock_movements (id, tenant_id, product_id, delta, reason, occurred_at, created_by)
              values (${uuidv7()}, ${tenant}, ${id}, ${inicial}, 'inicial', now(), ${dueno})`;
  }
  return id;
}

function vender(productId: string, qty: string, actor = ctx) {
  return registerTransaction(actor, {
    ...base,
    type: "ingreso",
    kind: "venta",
    categoryId: catIngreso,
    items: [{ itemType: "product", refId: productId, qty }],
    clientRequestId: uuidv7(),
  });
}

function comprar(productId: string, qty: string) {
  return registerTransaction(ctx, {
    ...base,
    type: "gasto",
    kind: "compra",
    categoryId: catGasto,
    items: [{ itemType: "product", refId: productId, qty, unitPrice: "4.00" }],
    clientRequestId: uuidv7(),
  });
}

describe.skipIf(!hasDb)("stock, anulaciones y alcance de lectura", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug) values (${tenant}, 'Stock', ${"stk-" + tenant.slice(-12)})`;
    await sql`insert into users (id, email) values
      (${dueno},  ${`stk-d-${dueno.slice(-12)}@test.local`}),
      (${cajero}, ${`stk-c-${cajero.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label, currency) values
      (${catIngreso}, ${tenant}, 'income_category',  'ventas',  'Ventas',  null),
      (${catGasto},   ${tenant}, 'expense_category', 'insumos', 'Insumos', null),
      (${catProd},    ${tenant}, 'product_category', 'general', 'General', null),
      (${payUsd},     ${tenant}, 'payment_method',   'efec',    'Efectivo USD', 'USD')`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id in (${dueno}, ${cajero})`;
    await sql.end();
  });

  // -------------------------------------------------------------------------
  // Stock que no alcanza
  // -------------------------------------------------------------------------

  it("no deja vender más de lo que hay, y lo dice con el nombre y lo que queda", async () => {
    const p = await producto(3);

    const r = await vender(p, "5");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/No hay suficiente stock de "Prod .+": quedan 3\./);

    // Nada a medias: ni transacción ni movimiento.
    expect(await getStock(tenant, p)).toBe("3.000");
    const [{ n }] = await sql`
      select count(*)::int as n from transaction_items where product_id = ${p}`;
    expect(n).toBe(0);
  });

  it("vender exactamente lo que queda sí se puede", async () => {
    const p = await producto(2);
    expect((await vender(p, "2")).ok).toBe(true);
    expect(await getStock(tenant, p)).toBe("0.000");
  });

  it("dos renglones del mismo producto se miden juntos, no uno por uno", async () => {
    const p = await producto(3);
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [
        { itemType: "product", refId: p, qty: "2" },
        { itemType: "product", refId: p, qty: "2" },
      ],
      clientRequestId: uuidv7(),
    });
    expect(r.ok).toBe(false);
    expect(await getStock(tenant, p)).toBe("3.000");
  });

  it("dos cajas vendiendo la última unidad a la vez: solo una la vende", async () => {
    const p = await producto(1);

    const resultados = await Promise.all([vender(p, "1"), vender(p, "1")]);

    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(await getStock(tenant, p)).toBe("0.000");
  });

  it("corregir una venta hacia arriba respeta el stock, contando lo que ella ya sacó", async () => {
    const p = await producto(5);
    const r = await vender(p, "3");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const corregir = (qty: string) =>
      editTransaction(ctx, {
        id: r.id,
        concept: "Prueba",
        occurredOn: base.occurredOn,
        categoryId: catIngreso,
        paymentMethodId: payUsd,
        items: [{ itemType: "product", refId: p, qty }],
      });

    // Quedan 2; la venta tenía 3, así que hasta 5 alcanza.
    const demasiado = await corregir("6");
    expect(demasiado.ok).toBe(false);
    if (!demasiado.ok) expect(demasiado.error).toMatch(/quedan 2/);
    expect(await getStock(tenant, p)).toBe("2.000");

    expect((await corregir("5")).ok).toBe(true);
    expect(await getStock(tenant, p)).toBe("0.000");
  });

  it("no deja anular una compra de la que ya se vendió", async () => {
    const p = await producto(0);
    const compra = await comprar(p, "10");
    expect(compra.ok).toBe(true);
    if (!compra.ok) return;
    expect((await vender(p, "7")).ok).toBe(true);

    const r = await revertTransaction(ctx, { id: compra.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/No se puede anular esta compra.*quedan 3/);

    // La compra sigue vigente y el stock intacto.
    expect(await getStock(tenant, p)).toBe("3.000");
    const [fila] = await sql`select deleted_at from transactions where id = ${compra.id}`;
    expect(fila.deleted_at).toBeNull();
  });

  it("una merma mayor que el stock se rechaza", async () => {
    const p = await producto(2);
    const r = await adjustStock(ctx, { productId: p, delta: "-3", reason: "merma" });
    expect(r).toMatchObject({ ok: false, field: "delta" });
    if (!r.ok) expect(r.error).toMatch(/quedan 2/);
    expect(await getStock(tenant, p)).toBe("2.000");
  });

  it("lo que entra nunca se rechaza, aunque el producto esté en cero", async () => {
    const p = await producto(0);
    expect((await comprar(p, "4")).ok).toBe(true);
    expect((await adjustStock(ctx, { productId: p, delta: "1", reason: "ajuste" })).ok).toBe(true);
    expect(await getStock(tenant, p)).toBe("5.000");
  });

  // -------------------------------------------------------------------------
  // Anular y restaurar
  // -------------------------------------------------------------------------

  it("restaurar una venta anulada la devuelve a los totales y vuelve a sacar el stock", async () => {
    const p = await producto(10);
    const r = await vender(p, "4");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect((await revertTransaction(ctx, { id: r.id, reason: "error de caja" })).ok).toBe(true);
    expect(await getStock(tenant, p)).toBe("10.000");

    const anuladas = await listTransactions(tenant, { anuladas: true, perPage: 100 });
    expect(anuladas.rows.map((x) => x.id)).toContain(r.id);
    expect(anuladas.rows.find((x) => x.id === r.id)?.voidedAt).toBeInstanceOf(Date);

    expect((await restoreTransaction(ctx, { id: r.id })).ok).toBe(true);
    expect(await getStock(tenant, p)).toBe("6.000");

    const vigentes = await listTransactions(tenant, { perPage: 100 });
    expect(vigentes.rows.map((x) => x.id)).toContain(r.id);

    // El historial cuenta las tres cosas, sin borrar ninguna.
    // (El "inicial" se filtra: tiene fecha de hoy y la venta, de octubre.)
    const motivos = (await listMovements(tenant, p))
      .map((m) => m.reason)
      .filter((m) => m !== "inicial");
    expect(motivos).toEqual(["restauracion", "anulacion", "venta"]);

    const [audit] = await sql`
      select action from audit_log
      where entity_id = ${r.id} order by at desc, id desc limit 1`;
    expect(audit.action).toBe("restore");
  });

  it("no restaura una venta si entretanto se vendió lo que ella había repuesto", async () => {
    const p = await producto(3);
    const r = await vender(p, "3");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await revertTransaction(ctx, { id: r.id })).ok).toBe(true);
    expect((await vender(p, "2")).ok).toBe(true);

    const restaurar = await restoreTransaction(ctx, { id: r.id });
    expect(restaurar.ok).toBe(false);
    if (!restaurar.ok) expect(restaurar.error).toMatch(/No se puede restaurar.*quedan 1/);

    const [fila] = await sql`select deleted_at from transactions where id = ${r.id}`;
    expect(fila.deleted_at).not.toBeNull();
  });

  it("restaurar algo que no está anulado es un error, no un segundo descuento", async () => {
    const p = await producto(5);
    const r = await vender(p, "1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(await restoreTransaction(ctx, { id: r.id })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no está anulada/),
    });
    expect(await getStock(tenant, p)).toBe("4.000");
  });

  it("dos anulaciones simultáneas reponen el stock una sola vez", async () => {
    const p = await producto(5);
    const r = await vender(p, "2");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const resultados = await Promise.all([
      revertTransaction(ctx, { id: r.id }),
      revertTransaction(ctx, { id: r.id }),
    ]);

    expect(resultados.filter((x) => x.ok)).toHaveLength(1);
    expect(await getStock(tenant, p)).toBe("5.000");
  });

  // -------------------------------------------------------------------------
  // Alcance de lectura
  // -------------------------------------------------------------------------

  it("el Personal solo ve lo que registró, también en los totales", async () => {
    const delDueno = await registerTransaction(ctx, {
      ...base,
      concept: "alcance-dueno",
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "100",
      clientRequestId: uuidv7(),
    });
    const delCajero = await registerTransaction(ctxCajero, {
      ...base,
      concept: "alcance-cajero",
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "7",
      clientRequestId: uuidv7(),
    });
    expect(delDueno.ok && delCajero.ok).toBe(true);

    const comoCajero = alcanceDeLectura({
      role: "staff",
      user: { id: cajero } as TenantContext["user"],
    });
    const comoEncargado = alcanceDeLectura({
      role: "manager",
      user: { id: dueno } as TenantContext["user"],
    });
    expect(comoCajero).toEqual({ createdBy: cajero });
    expect(comoEncargado).toEqual({});

    const filtro = { q: "alcance-", ...comoCajero };
    const lista = await listTransactions(tenant, filtro);
    expect(lista.rows.map((r) => r.concept)).toEqual(["alcance-cajero"]);
    expect(await totalsByCurrency(tenant, filtro)).toEqual([
      { currency: "USD", total: "7.00", count: 1 },
    ]);
    const [balance] = await balanceByCurrency(tenant, filtro);
    expect(balance.ingresos).toBe("7.00");

    const todo = await listTransactions(tenant, { q: "alcance-", ...comoEncargado });
    expect(todo.total).toBe(2);
  });
});
