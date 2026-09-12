import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  listTransactions,
  totalsByCurrency,
  usedCurrencies,
} from "@/lib/finanzas/queries";
import { listStock, getStock, listMovements, stockStatus } from "@/lib/inventario/stock";

/**
 * Consultas de finanzas e inventario contra la base real, pasando por
 * withTenant y RLS como lo hace la app.
 */

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const otro = uuidv7();
const user = uuidv7();
const catIngreso = uuidv7();
const catGasto = uuidv7();
const catProducto = uuidv7();
const payUsd = uuidv7();
const payVes = uuidv7();
const prodA = uuidv7();
const prodB = uuidv7();

describe.skipIf(!hasDb)("consultas de finanzas e inventario", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug) values
      (${tenant}, 'Q', ${"q-" + tenant.slice(0, 8)}),
      (${otro},   'R', ${"r-" + otro.slice(0, 8)})`;
    await sql`insert into users (id, email) values (${user}, ${`q-${user.slice(0, 8)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label, currency) values
      (${catIngreso},  ${tenant}, 'income_category',  'ventas',  'Ventas',  null),
      (${catGasto},    ${tenant}, 'expense_category', 'insumos', 'Insumos', null),
      (${catProducto}, ${tenant}, 'product_category', 'general', 'General', null),
      (${payUsd},      ${tenant}, 'payment_method',   'efec',    'Efectivo USD', 'USD'),
      (${payVes},      ${tenant}, 'payment_method',   'pm',      'Pago móvil',   'VES')`;
    await sql`insert into products (id, tenant_id, name, category_id, price, currency, min_stock) values
      (${prodA}, ${tenant}, 'Producto A', ${catProducto}, '10.00', 'USD', '5'),
      (${prodB}, ${tenant}, 'Producto B', ${catProducto}, '20.00', 'USD', null)`;

    const tx = (over: Record<string, unknown>) => ({
      id: uuidv7(), tenant_id: tenant, type: "ingreso", kind: "operacion",
      concept: "x", occurred_on: "2026-09-01", category_id: catIngreso,
      category_catalog_key: "income_category", payment_method_id: payUsd,
      payment_catalog_key: "payment_method", amount: "100.00", currency: "USD",
      created_by: user, ...over,
    });

    // Tres monedas, dos tipos, una anulada.
    await sql`insert into transactions ${sql(tx({ amount: "100.00", currency: "USD", occurred_on: "2026-09-01" }))}`;
    await sql`insert into transactions ${sql(tx({ amount: "250.50", currency: "USD", occurred_on: "2026-09-05" }))}`;
    await sql`insert into transactions ${sql(tx({ amount: "3650.00", currency: "VES", payment_method_id: payVes, occurred_on: "2026-09-03" }))}`;
    await sql`insert into transactions ${sql({
      ...tx({ amount: "80.00", currency: "USD", occurred_on: "2026-09-04" }),
      type: "gasto", category_id: catGasto, category_catalog_key: "expense_category",
    })}`;
    await sql`insert into transactions ${sql({
      ...tx({ amount: "999.00", currency: "USD", occurred_on: "2026-09-02" }),
      deleted_at: new Date(),
    })}`;

    // Movimientos de stock de A: 10 inicial, -3 venta. B queda en cero.
    await sql`insert into stock_movements (id, tenant_id, product_id, delta, reason, occurred_at, created_by) values
      (${uuidv7()}, ${tenant}, ${prodA}, 10, 'inicial', now(), ${user}),
      (${uuidv7()}, ${tenant}, ${prodA}, -3, 'venta',   now(), ${user})`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id in (${tenant}, ${otro})`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  it("lista con las etiquetas de categoria y metodo de pago resueltas", async () => {
    const { rows, total } = await listTransactions(tenant);
    // La anulada no aparece.
    expect(total).toBe(4);
    expect(rows.every((r) => r.categoryLabel.length > 0)).toBe(true);
    expect(rows.every((r) => r.paymentMethodLabel.length > 0)).toBe(true);

    const enVes = rows.find((r) => r.currency === "VES");
    expect(enVes?.paymentMethodLabel).toBe("Pago móvil");
    expect(enVes?.categoryLabel).toBe("Ventas");
  });

  it("ordena de mas reciente a mas antiguo", async () => {
    const { rows } = await listTransactions(tenant);
    const fechas = rows.map((r) => r.occurredOn);
    expect(fechas).toEqual([...fechas].sort().reverse());
  });

  it("filtra por tipo, moneda y rango de fechas", async () => {
    expect((await listTransactions(tenant, { type: "gasto" })).total).toBe(1);
    expect((await listTransactions(tenant, { currency: "VES" })).total).toBe(1);
    expect(
      (await listTransactions(tenant, { from: "2026-09-03", to: "2026-09-05" })).total,
    ).toBe(3);
  });

  it("pagina en el servidor", async () => {
    const p0 = await listTransactions(tenant, { perPage: 2, page: 0 });
    const p1 = await listTransactions(tenant, { perPage: 2, page: 1 });
    expect(p0.rows.length).toBe(2);
    expect(p1.rows.length).toBe(2);
    expect(p0.total).toBe(4);
    // Sin solapamiento.
    const ids = new Set([...p0.rows, ...p1.rows].map((r) => r.id));
    expect(ids.size).toBe(4);
  });

  it("los totales van SEPARADOS por moneda, nunca sumados entre si", async () => {
    const totales = await totalsByCurrency(tenant, { type: "ingreso" });
    const porMoneda = Object.fromEntries(totales.map((t) => [t.currency, t.total]));

    // 100.00 + 250.50 en USD; 3650.00 en VES. La anulada (999) no cuenta.
    expect(porMoneda.USD).toBe("350.50");
    expect(porMoneda.VES).toBe("3650.00");
    expect(totales.length).toBe(2);
  });

  it("las anuladas no cuentan en los totales", async () => {
    const totales = await totalsByCurrency(tenant, { type: "ingreso", currency: "USD" });
    expect(totales[0].total).toBe("350.50"); // no 1349.50
  });

  it("lista las monedas en las que el cliente opero", async () => {
    expect(await usedCurrencies(tenant)).toEqual(["USD", "VES"]);
  });

  it("el stock sale de la suma de movimientos", async () => {
    // Escala consistente siempre: Postgres devuelve "7.000" con movimientos y
    // "0" sin ellos, y esa diferencia se veria en pantalla.
    expect(await getStock(tenant, prodA)).toBe("7.000");
    // Un producto sin ningun movimiento es cero, no null.
    expect(await getStock(tenant, prodB)).toBe("0.000");
  });

  it("lista el stock de todos los productos con su estado", async () => {
    const stock = await listStock(tenant);
    expect(stock.length).toBe(2);

    const a = stock.find((s) => s.productId === prodA)!;
    const b = stock.find((s) => s.productId === prodB)!;
    expect(Number(a.stock)).toBe(7);
    expect(a.status).toBe("ok"); // 7 > min 5
    expect(Number(b.stock)).toBe(0);
    expect(b.status).toBe("sin_stock");
  });

  it("clasifica el estado del stock", () => {
    expect(stockStatus("0", "5")).toBe("sin_stock");
    expect(stockStatus("-2", "5")).toBe("sin_stock");
    expect(stockStatus("5", "5")).toBe("bajo"); // en el minimo ya es bajo
    expect(stockStatus("3", "5")).toBe("bajo");
    expect(stockStatus("9", "5")).toBe("ok");
    expect(stockStatus("1", null)).toBe("ok"); // sin minimo definido
  });

  it("el historial de movimientos explica el stock actual", async () => {
    const movs = await listMovements(tenant, prodA);
    expect(movs.length).toBe(2);
    const suma = movs.reduce((acc, m) => acc + Number(m.delta), 0);
    expect(suma).toBe(7);
    expect(movs.map((m) => m.reason).sort()).toEqual(["inicial", "venta"]);
  });

  it("un cliente no ve las transacciones ni el stock de otro", async () => {
    expect((await listTransactions(otro)).total).toBe(0);
    expect(await totalsByCurrency(otro)).toEqual([]);
    expect(await listStock(otro)).toEqual([]);
  });
});
