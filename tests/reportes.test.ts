import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  byCategory,
  byPaymentMethod,
  monthlySeries,
  topProducts,
  periodSummary,
} from "@/lib/finanzas/reports";
import { registerTransaction, revertTransaction } from "@/lib/finanzas/register";
import { registerProduct } from "@/lib/productos/register";

/**
 * Reportes contra la base real.
 *
 * Son agregaciones: un error aca no rompe nada visiblemente, solo da un numero
 * equivocado que nadie detecta hasta que no cuadra con la caja. Por eso todos
 * los casos comparan contra totales calculados a mano.
 */

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const user = uuidv7();
const ctx = { tenantId: tenant, userId: user };

const catVentas = uuidv7();
const catServicios = uuidv7();
const catNomina = uuidv7();
const catProd = uuidv7();
const payEfectivo = uuidv7();
const payZelle = uuidv7();
const payMovil = uuidv7();

let monitor = "";
let teclado = "";

describe.skipIf(!hasDb)("reportes", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug) values (${tenant}, 'Rep', ${"rep-" + tenant.slice(0, 8)})`;
    await sql`insert into users (id, email) values (${user}, ${`rep-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label, currency) values
      (${catVentas},    ${tenant}, 'income_category',  'ventas',   'Ventas',    null),
      (${catServicios}, ${tenant}, 'income_category',  'servicios','Servicios', null),
      (${catNomina},    ${tenant}, 'expense_category', 'nomina',   'Nómina',    null),
      (${catProd},      ${tenant}, 'product_category', 'general',  'General',   null),
      (${payEfectivo},  ${tenant}, 'payment_method',   'efec',     'Efectivo USD', 'USD'),
      (${payZelle},     ${tenant}, 'payment_method',   'zelle',    'Zelle',        'USD'),
      (${payMovil},     ${tenant}, 'payment_method',   'pm',       'Pago móvil',   'VES')`;

    const p1 = await registerProduct(ctx, {
      name: "Monitor", categoryId: catProd, price: "100.00", currency: "USD", initialStock: "50",
    });
    const p2 = await registerProduct(ctx, {
      name: "Teclado", categoryId: catProd, price: "20.00", currency: "USD", initialStock: "50",
    });
    if (p1.ok) monitor = p1.id;
    if (p2.ok) teclado = p2.id;

    const base = { type: "ingreso" as const, kind: "operacion" as const, concept: "x" };

    // --- USD, enero ---
    await registerTransaction(ctx, { ...base, occurredOn: "2026-01-10", categoryId: catVentas,    paymentMethodId: payEfectivo, amount: "100.00", clientRequestId: uuidv7() });
    await registerTransaction(ctx, { ...base, occurredOn: "2026-01-20", categoryId: catVentas,    paymentMethodId: payZelle,    amount: "250.00", clientRequestId: uuidv7() });
    await registerTransaction(ctx, { ...base, occurredOn: "2026-01-25", categoryId: catServicios, paymentMethodId: payZelle,    amount: "50.00",  clientRequestId: uuidv7() });
    await registerTransaction(ctx, { type: "gasto", kind: "operacion", concept: "x", occurredOn: "2026-01-31", categoryId: catNomina, paymentMethodId: payEfectivo, amount: "80.00", clientRequestId: uuidv7() });

    // --- USD, febrero ---
    await registerTransaction(ctx, { ...base, occurredOn: "2026-02-05", categoryId: catVentas, paymentMethodId: payEfectivo, amount: "300.00", clientRequestId: uuidv7() });

    // --- VES, enero: NO debe mezclarse con lo de USD ---
    await registerTransaction(ctx, { ...base, occurredOn: "2026-01-15", categoryId: catVentas, paymentMethodId: payMovil, amount: "5000.00", clientRequestId: uuidv7() });

    // --- Ventas con renglones, para top productos ---
    await registerTransaction(ctx, {
      type: "ingreso", kind: "venta", concept: "Venta 1", occurredOn: "2026-01-12",
      categoryId: catVentas, paymentMethodId: payEfectivo,
      items: [
        { itemType: "product", refId: monitor, qty: "3" }, // 300.00
        { itemType: "product", refId: teclado, qty: "2" }, // 40.00
      ],
      clientRequestId: uuidv7(),
    });
    await registerTransaction(ctx, {
      type: "ingreso", kind: "venta", concept: "Venta 2", occurredOn: "2026-01-18",
      categoryId: catVentas, paymentMethodId: payEfectivo,
      items: [{ itemType: "product", refId: teclado, qty: "5" }], // 100.00
      clientRequestId: uuidv7(),
    });

    // --- Una anulada: no debe contar en ningun reporte ---
    const anulada = await registerTransaction(ctx, {
      ...base, occurredOn: "2026-01-28", categoryId: catVentas,
      paymentMethodId: payEfectivo, amount: "9999.00", clientRequestId: uuidv7(),
    });
    if (anulada.ok) await revertTransaction(ctx, { id: anulada.id });
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  const enero = { currency: "USD", from: "2026-01-01", to: "2026-01-31" };

  it("agrupa ingresos por categoria", async () => {
    const filas = await byCategory(tenant, "ingreso", enero);
    const porEtiqueta = Object.fromEntries(filas.map((f) => [f.label, f.total]));

    // Ventas: 100 + 250 sueltas + 340 y 100 de las dos ventas con renglones.
    expect(porEtiqueta["Ventas"]).toBe("790.00");
    expect(porEtiqueta["Servicios"]).toBe("50.00");
  });

  it("ordena de mayor a menor", async () => {
    const filas = await byCategory(tenant, "ingreso", enero);
    const totales = filas.map((f) => Number(f.total));
    expect(totales).toEqual([...totales].sort((a, b) => b - a));
  });

  it("NO mezcla monedas", async () => {
    const enUsd = await byCategory(tenant, "ingreso", enero);
    const enVes = await byCategory(tenant, "ingreso", { ...enero, currency: "VES" });

    // Los 5000 Bs no aparecen por ningun lado en el reporte de USD.
    expect(enUsd.every((f) => Number(f.total) < 5000)).toBe(true);
    expect(enVes.length).toBe(1);
    expect(enVes[0].total).toBe("5000.00");
  });

  it("agrupa por metodo de pago", async () => {
    const filas = await byPaymentMethod(tenant, "ingreso", enero);
    const porEtiqueta = Object.fromEntries(filas.map((f) => [f.label, f.total]));

    // Efectivo: 100 suelta + 340 + 100 de las ventas.
    expect(porEtiqueta["Efectivo USD"]).toBe("540.00");
    // Zelle: 250 + 50.
    expect(porEtiqueta["Zelle"]).toBe("300.00");
    // Pago movil es en VES: no aparece en un reporte de USD.
    expect(porEtiqueta["Pago móvil"]).toBeUndefined();
  });

  it("las anuladas no cuentan en ningun reporte", async () => {
    const filas = await byCategory(tenant, "ingreso", enero);
    const ventas = filas.find((f) => f.label === "Ventas")!;
    // Si contara, seria 790 + 9999.
    expect(Number(ventas.total)).toBeLessThan(1000);
  });

  it("arma la serie mensual con su balance", async () => {
    const serie = await monthlySeries(tenant, { currency: "USD" });
    const porMes = Object.fromEntries(serie.map((p) => [p.month, p]));

    expect(porMes["2026-01"].ingresos).toBe("840.00"); // 790 + 50
    expect(porMes["2026-01"].gastos).toBe("80.00");
    expect(porMes["2026-01"].balance).toBe("760.00");

    expect(porMes["2026-02"].ingresos).toBe("300.00");
    expect(porMes["2026-02"].gastos).toBe("0.00");
    expect(porMes["2026-02"].balance).toBe("300.00");
  });

  it("la serie viene ordenada cronologicamente", async () => {
    const serie = await monthlySeries(tenant, { currency: "USD" });
    const meses = serie.map((p) => p.month);
    expect(meses).toEqual([...meses].sort());
  });

  it("calcula los mas vendidos desde los renglones", async () => {
    const top = await topProducts(tenant, enero);

    // Monitor: 3 x 100 = 300. Teclado: 7 x 20 = 140.
    expect(top[0].name).toBe("Monitor");
    expect(top[0].total).toBe("300.00");
    expect(Number(top[0].qty)).toBe(3);

    expect(top[1].name).toBe("Teclado");
    expect(top[1].total).toBe("140.00");
    // Suma las dos ventas: 2 + 5.
    expect(Number(top[1].qty)).toBe(7);
  });

  it("los mas vendidos ignoran las compras de insumos", async () => {
    const antes = await topProducts(tenant, enero);
    const monitorAntes = antes.find((p) => p.name === "Monitor")!.total;

    await registerTransaction(ctx, {
      type: "gasto", kind: "compra", concept: "Reposición", occurredOn: "2026-01-20",
      categoryId: catNomina, paymentMethodId: payEfectivo,
      items: [
        { itemType: "product", refId: monitor, qty: "10", unitPrice: "110.00" },
      ],
      clientRequestId: uuidv7(),
    });

    const despues = await topProducts(tenant, enero);
    // Comprar 10 monitores no dice nada sobre que se vende mas.
    expect(despues.find((p) => p.name === "Monitor")!.total).toBe(monitorAntes);
  });

  it("resume el periodo", async () => {
    const resumen = await periodSummary(tenant, enero);
    expect(resumen.ingresos).toBe("840.00");
    expect(resumen.balance).toBe(
      String(840 - Number(resumen.gastos)) + ".00",
    );
    expect(resumen.operaciones).toBeGreaterThan(0);
  });

  it("un periodo sin datos devuelve ceros, no falla", async () => {
    const vacio = await periodSummary(tenant, {
      currency: "USD",
      from: "2020-01-01",
      to: "2020-12-31",
    });
    expect(vacio.ingresos).toBe("0.00");
    expect(vacio.gastos).toBe("0.00");
    expect(vacio.balance).toBe("0.00");
    expect(vacio.operaciones).toBe(0);
  });

  it("un cliente no ve los reportes de otro", async () => {
    const otro = uuidv7();
    await sql`insert into tenants (id, name, slug) values (${otro}, 'Otro', ${"o-" + otro.slice(0, 8)})`;
    try {
      expect(await byCategory(otro, "ingreso", enero)).toEqual([]);
      expect(await topProducts(otro, enero)).toEqual([]);
      expect((await periodSummary(otro, enero)).operaciones).toBe(0);
    } finally {
      await sql`delete from tenants where id = ${otro}`;
    }
  });
});
