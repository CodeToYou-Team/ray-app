import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  balanceByCurrency,
  lastExchangeRates,
  ratePairKey,
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
    await sql`insert into users (id, email) values (${user}, ${`q-${user.slice(-12)}@test.local`})`;
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


/**
 * Buscador por concepto y rango de fechas.
 *
 * Va en su propio tenant: agregarle conceptos distintos a los de arriba
 * cambiaria los totales que esas pruebas dan por sentados.
 */
const tBuscar = uuidv7();
const uBuscar = uuidv7();
const catB = uuidv7();
const payB = uuidv7();

describe.skipIf(!hasDb)("buscador de transacciones", () => {
  let db: ReturnType<typeof postgres>;

  beforeAll(async () => {
    db = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await db`insert into tenants (id, name, slug) values (${tBuscar}, 'B', ${"b-" + tBuscar.slice(-12)})`;
    await db`insert into users (id, email) values (${uBuscar}, ${`b-${uBuscar.slice(-12)}@test.local`})`;
    await db`insert into catalog_items (id, tenant_id, catalog_key, code, label, currency) values
      (${catB}, ${tBuscar}, 'income_category', 'ventas', 'Ventas', null),
      (${payB}, ${tBuscar}, 'payment_method',  'efec',   'Efectivo', 'USD')`;

    const tx = (concept: string, occurredOn: string, amount: string) => ({
      id: uuidv7(), tenant_id: tBuscar, type: "ingreso", kind: "operacion",
      concept, occurred_on: occurredOn, category_id: catB,
      category_catalog_key: "income_category", payment_method_id: payB,
      payment_catalog_key: "payment_method", amount, currency: "USD",
      created_by: uBuscar,
    });

    await db`insert into transactions ${db(tx("Alquiler del local", "2026-01-10", "500.00"))}`;
    await db`insert into transactions ${db(tx("ALQUILER del depósito", "2026-02-10", "300.00"))}`;
    await db`insert into transactions ${db(tx("Venta del día", "2026-03-10", "120.00"))}`;
    // Conceptos con comodines de LIKE adentro.
    await db`insert into transactions ${db(tx("Descuento 100% aplicado", "2026-04-10", "7.00"))}`;
    await db`insert into transactions ${db(tx("Caja a_b", "2026-05-10", "8.00"))}`;
    await db`insert into transactions ${db(tx("Caja axb", "2026-06-10", "9.00"))}`;
    // Existe para que la prueba del % signifique algo: con el comodin sin
    // escapar, buscar "100%" tambien traeria esta.
    await db`insert into transactions ${db(tx("Abono 1000 inicial", "2026-07-10", "11.00"))}`;
  });

  afterAll(async () => {
    if (!db) return;
    await db`delete from tenants where id = ${tBuscar}`;
    await db`delete from users where id = ${uBuscar}`;
    await db.end();
  });

  it("busca por una parte del concepto, sin importar las mayúsculas", async () => {
    const { rows, total } = await listTransactions(tBuscar, { q: "alquiler" });
    expect(total).toBe(2);
    expect(rows.every((r) => /alquiler/i.test(r.concept))).toBe(true);
  });

  it("el espacio sobrante no cambia el resultado", async () => {
    expect((await listTransactions(tBuscar, { q: "  alquiler  " })).total).toBe(2);
  });

  it("un buscador vacío no filtra nada", async () => {
    expect((await listTransactions(tBuscar, { q: "   " })).total).toBe(7);
  });

  it("el % que escribe el usuario es un carácter, no un comodín", async () => {
    // Sin escapar, "100%" seria "todo lo que empiece por 100" y ademas traeria
    // de vuelta cualquier cosa: el buscador devolveria lo que nadie pidio.
    const { rows, total } = await listTransactions(tBuscar, { q: "100%" });
    expect(total).toBe(1);
    expect(rows[0].concept).toBe("Descuento 100% aplicado");
  });

  it("el _ que escribe el usuario tampoco es un comodín", async () => {
    const { rows, total } = await listTransactions(tBuscar, { q: "a_b" });
    expect(total).toBe(1);
    // "Caja axb" NO entra: con el _ sin escapar habria entrado.
    expect(rows[0].concept).toBe("Caja a_b");
  });

  it("filtra por rango de fechas, con los extremos incluidos", async () => {
    const { total } = await listTransactions(tBuscar, {
      from: "2026-02-10",
      to: "2026-04-10",
    });
    expect(total).toBe(3);
  });

  it("combina el texto con el rango de fechas", async () => {
    const { rows, total } = await listTransactions(tBuscar, {
      q: "alquiler",
      from: "2026-02-01",
    });
    expect(total).toBe(1);
    expect(rows[0].concept).toContain("depósito");
  });

  it("los totales respetan el mismo filtro que la lista", async () => {
    // Lo que no puede pasar: dos filas en la tabla y arriba el total del año.
    const totales = await totalsByCurrency(tBuscar, { q: "alquiler" });
    expect(totales).toHaveLength(1);
    expect(totales[0].total).toBe("800.00");
    expect(totales[0].count).toBe(2);
  });

  it("el balance tambien respeta el filtro", async () => {
    const balance = await balanceByCurrency(tBuscar, { q: "alquiler" });
    expect(balance).toHaveLength(1);
    expect(balance[0].ingresos).toBe("800.00");
    expect(balance[0].balance).toBe("800.00");
  });

  it("una busqueda sin resultados devuelve vacio, no todo", async () => {
    const { rows, total } = await listTransactions(tBuscar, { q: "notengoidea" });
    expect(total).toBe(0);
    expect(rows).toHaveLength(0);
    expect(await totalsByCurrency(tBuscar, { q: "notengoidea" })).toEqual([]);
  });
});


/**
 * Sugerencia de tasa de cambio.
 *
 * Va en su propio tenant: las tasas se derivan de TODAS las operaciones del
 * cliente, así que compartir fixtures con otra prueba la haría depender del
 * orden en que corren.
 */
const tTasa = uuidv7();
const uTasa = uuidv7();
const catT = uuidv7();
const payVesT = uuidv7();
const payCopT = uuidv7();
const payUsdT = uuidv7();

describe.skipIf(!hasDb)("última tasa de cambio usada", () => {
  let db: ReturnType<typeof postgres>;

  const tx = (over: Record<string, unknown>) => ({
    id: uuidv7(), tenant_id: tTasa, type: "ingreso", kind: "venta",
    concept: "Venta", occurred_on: "2026-01-01", category_id: catT,
    category_catalog_key: "income_category", payment_method_id: payVesT,
    payment_catalog_key: "payment_method", amount: "100.00", currency: "VES",
    created_by: uTasa, ...over,
  });

  beforeAll(async () => {
    db = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await db`insert into tenants (id, name, slug) values (${tTasa}, 'T', ${"t-" + tTasa.slice(-12)})`;
    await db`insert into users (id, email) values (${uTasa}, ${`t-${uTasa.slice(-12)}@test.local`})`;
    await db`insert into catalog_items (id, tenant_id, catalog_key, code, label, currency) values
      (${catT},     ${tTasa}, 'income_category', 'ventas', 'Ventas', null),
      (${payVesT},  ${tTasa}, 'payment_method',  'pm',     'Pago móvil', 'VES'),
      (${payCopT},  ${tTasa}, 'payment_method',  'cop',    'Transferencia COP', 'COP'),
      (${payUsdT},  ${tTasa}, 'payment_method',  'efec',   'Efectivo', 'USD')`;

    // USD>VES: la de marzo es la más reciente, aunque se cargue de primera.
    await db`insert into transactions ${db(tx({ occurred_on: "2026-03-10", exchange_rate: "41.500000", base_currency: "USD" }))}`;
    await db`insert into transactions ${db(tx({ occurred_on: "2026-01-10", exchange_rate: "38.000000", base_currency: "USD" }))}`;
    // Otro par distinto, que no se puede confundir con el anterior.
    await db`insert into transactions ${db(tx({ occurred_on: "2026-02-10", currency: "COP", payment_method_id: payCopT, exchange_rate: "4100.000000", base_currency: "USD" }))}`;
    // Sin conversión: no aporta ninguna tasa.
    await db`insert into transactions ${db(tx({ occurred_on: "2026-04-10", currency: "USD", payment_method_id: payUsdT }))}`;
  });

  afterAll(async () => {
    if (!db) return;
    await db`delete from tenants where id = ${tTasa}`;
    await db`delete from users where id = ${uTasa}`;
    await db.end();
  });

  it("devuelve la más reciente por par, no la última cargada", async () => {
    const tasas = await lastExchangeRates(tTasa);
    const usdVes = tasas[ratePairKey("USD", "VES")];
    expect(usdVes.rate).toBe("41.500000");
    expect(usdVes.occurredOn).toBe("2026-03-10");
  });

  it("cada par va por su lado", async () => {
    const tasas = await lastExchangeRates(tTasa);
    // Que exista USD>VES no puede contaminar USD>COP: son monedas distintas y
    // proponer 41.5 pesos por dólar sería un disparate.
    expect(tasas[ratePairKey("USD", "COP")].rate).toBe("4100.000000");
    expect(tasas[ratePairKey("VES", "USD")]).toBeUndefined();
  });

  it("una operación sin conversión no aporta tasa", async () => {
    const tasas = await lastExchangeRates(tTasa);
    expect(tasas[ratePairKey("USD", "USD")]).toBeUndefined();
    expect(Object.keys(tasas).sort()).toEqual(["USD>COP", "USD>VES"]);
  });

  it("una operación anulada deja de ser la referencia", async () => {
    const anulada = uuidv7();
    await db`insert into transactions ${db(tx({ id: anulada, occurred_on: "2026-06-01", exchange_rate: "99.000000", base_currency: "USD" }))}`;
    expect((await lastExchangeRates(tTasa))[ratePairKey("USD", "VES")].rate).toBe(
      "99.000000",
    );

    await db`update transactions set deleted_at = now() where id = ${anulada}`;

    // Si no, una tasa tecleada mal y anulada seguiría precargando la siguiente
    // venta, que es justo lo contrario de corregirla.
    expect((await lastExchangeRates(tTasa))[ratePairKey("USD", "VES")].rate).toBe(
      "41.500000",
    );
  });

  it("un cliente sin conversiones no tiene sugerencias", async () => {
    expect(await lastExchangeRates(otro)).toEqual({});
  });
});
