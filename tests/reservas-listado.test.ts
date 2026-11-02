import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { cancelBooking, createBooking, registerPayment } from "@/lib/reservas/register";
import { LISTADO_POR_PAGINA, listBookings } from "@/lib/reservas/queries";
import { revertTransaction } from "@/lib/finanzas/register";
import { sumMoney } from "@/lib/money";

/**
 * Listado y búsqueda de reservas.
 *
 * Lo que hay que fijar: que el filtro "con saldo" (que calcula el total en
 * SQL para poder paginar) diga EXACTAMENTE lo mismo que el detalle (que lo
 * calcula en TypeScript), incluido el redondeo; y que la búsqueda trate los
 * comodines de LIKE como texto.
 */

const hasDb = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL);
const TZ = "America/Caracas";

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const otro = uuidv7();
const user = uuidv7();
const ctx = { tenantId: tenant, userId: user };

const catServ = uuidv7();
const catIngreso = uuidv7();
const payUsd = uuidv7();
const doble = uuidv7();
const suiteVes = uuidv7();
const taller = uuidv7();
const box = uuidv7();
const h101 = uuidv7();
const h102 = uuidv7();
const s201 = uuidv7();
const sala = uuidv7();
const box1 = uuidv7();

/** Los ids, para preguntar por ellos sin depender del orden. */
const ids: Record<string, string> = {};

async function reservar(
  clave: string,
  datos: {
    serviceId: string;
    resourceId: string;
    rango:
      | { unidad: "noche"; desde: string; hasta: string }
      | { unidad: "hora"; fecha: string; inicio: string; fin: string };
    holderName: string;
    holderDocument?: string;
    holderPhone?: string;
    personas?: number;
  },
) {
  const r = await createBooking(ctx, datos);
  if (!r.ok) throw new Error(`No se pudo preparar ${clave}: ${r.error}`);
  ids[clave] = r.id;
  return r;
}

const cobrar = (bookingId: string, monto: string) =>
  registerPayment(ctx, {
    bookingId,
    monto,
    paymentMethodId: payUsd,
    categoryId: catIngreso,
    clientRequestId: uuidv7(),
  });

describe.skipIf(!hasDb)("listado de reservas", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug, timezone) values
      (${tenant}, 'Lista', ${"lista-" + tenant.slice(-12)}, ${TZ}),
      (${otro},   'Otro',  ${"otro3-" + otro.slice(-12)},   ${TZ})`;
    await sql`insert into users (id, email) values (${user}, ${`lis-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label, currency) values
      (${catServ},    ${tenant}, 'service_category', 'serv', 'Servicios', null),
      (${catIngreso}, ${tenant}, 'income_category',  'ing',  'Ingresos',  null),
      (${payUsd},     ${tenant}, 'payment_method',   'efec', 'Efectivo',  'USD')`;
    await sql`insert into services (id, tenant_id, name, category_id, price, currency, booking_unit, booking_shared, booking_per_person) values
      (${doble},    ${tenant}, 'Doble',     ${catServ}, '40.00',   'USD', 'noche', false, false),
      (${suiteVes}, ${tenant}, 'Suite Bs',  ${catServ}, '2000.00', 'VES', 'noche', false, false),
      (${taller},   ${tenant}, 'Taller',    ${catServ}, '3.33',    'USD', 'hora',  true,  true),
      (${box},      ${tenant}, 'Box',       ${catServ}, '5.00',    'USD', 'hora',  false, false)`;
    await sql`insert into resources (id, tenant_id, service_id, name, capacity) values
      (${h101},  ${tenant}, ${doble},    '101',   2),
      (${h102},  ${tenant}, ${doble},    '102',   2),
      (${s201},  ${tenant}, ${suiteVes}, '201',   2),
      (${sala},  ${tenant}, ${taller},   'Sala',  20),
      (${box1},  ${tenant}, ${box},      'Box 1', 1)`;

    // A: debe 50 (80 − 30).
    await reservar("A", {
      serviceId: doble, resourceId: h101,
      rango: { unidad: "noche", desde: "2029-01-10", hasta: "2029-01-12" },
      holderName: "María Pérez", holderDocument: "V-12345678", holderPhone: "0414-1112233",
    });
    await cobrar(ids.A, "30.00");

    // B: pagada completa (3 × 40 = 120).
    await reservar("B", {
      serviceId: doble, resourceId: h102,
      rango: { unidad: "noche", desde: "2029-01-11", hasta: "2029-01-14" },
      holderName: "José García",
    });
    await cobrar(ids.B, "120.00");

    // C y D: el redondeo al límite. 1,5 h × 3 personas × 3,33 = 14,985 → 14,99.
    await reservar("C", {
      serviceId: taller, resourceId: sala,
      rango: { unidad: "hora", fecha: "2029-01-15", inicio: "18:00", fin: "19:30" },
      holderName: "Taller saldado", personas: 3,
    });
    await cobrar(ids.C, "14.99"); // saldo 0,00
    await reservar("D", {
      serviceId: taller, resourceId: sala,
      rango: { unidad: "hora", fecha: "2029-01-15", inicio: "18:00", fin: "19:30" },
      holderName: "Taller debe un centavo", personas: 3,
    });
    await cobrar(ids.D, "14.98"); // saldo 0,01

    // E: en bolívares, debe 2000.
    await reservar("E", {
      serviceId: suiteVes, resourceId: s201,
      rango: { unidad: "noche", desde: "2029-01-20", hasta: "2029-01-21" },
      holderName: "Cliente Bs",
    });

    // F: cancelada sin pagar. No "debe": su total ya no se cobra.
    await reservar("F", {
      serviceId: doble, resourceId: h101,
      rango: { unidad: "noche", desde: "2029-02-01", hasta: "2029-02-03" },
      holderName: "Descuento 100% aplicado",
    });
    await cancelBooking(ctx, { id: ids.F });

    // G: tiene "100" en el nombre, para que el % de la búsqueda signifique algo.
    await reservar("G", {
      serviceId: doble, resourceId: h102,
      rango: { unidad: "noche", desde: "2029-02-10", hasta: "2029-02-11" },
      holderName: "Grupo 1000",
    });
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id in (${tenant}, ${otro})`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  const encontradas = async (f: Parameters<typeof listBookings>[2]) =>
    (await listBookings(tenant, TZ, f)).rows.map((r) => r.holderName).sort();

  // -------------------------------------------------------------------------
  // Búsqueda
  // -------------------------------------------------------------------------

  it("busca por titular sin importar mayúsculas", async () => {
    expect(await encontradas({ q: "pérez" })).toEqual(["María Pérez"]);
  });

  it("busca por documento y por teléfono", async () => {
    expect(await encontradas({ q: "12345678" })).toEqual(["María Pérez"]);
    expect(await encontradas({ q: "1112233" })).toEqual(["María Pérez"]);
  });

  it("el % de la búsqueda es un carácter, no un comodín", async () => {
    // Sin escapar, "100%" traería también "Grupo 1000".
    expect(await encontradas({ q: "100%" })).toEqual(["Descuento 100% aplicado"]);
  });

  // -------------------------------------------------------------------------
  // Filtros
  // -------------------------------------------------------------------------

  it("filtra por estado", async () => {
    expect(await encontradas({ estado: "cancelada" })).toEqual(["Descuento 100% aplicado"]);
    const pendientes = await encontradas({ estado: "pendientes" });
    expect(pendientes).not.toContain("Descuento 100% aplicado");
    expect(pendientes).toContain("María Pérez");
  });

  it("filtra por servicio", async () => {
    expect(await encontradas({ serviceId: suiteVes })).toEqual(["Cliente Bs"]);
  });

  it("las fechas filtran lo que toca el periodo, con la salida como borde abierto", async () => {
    // A sale el 12 (no ocupa la noche del 12); B ocupa del 11 al 13.
    expect(await encontradas({ desde: "2029-01-12", hasta: "2029-01-12" })).toEqual(["José García"]);
    expect(await encontradas({ desde: "2029-01-11", hasta: "2029-01-11" })).toEqual([
      "José García",
      "María Pérez",
    ]);
  });

  // -------------------------------------------------------------------------
  // Saldo: el SQL tiene que decir lo mismo que TypeScript
  // -------------------------------------------------------------------------

  it("'con saldo' trae exactamente las que deben, al centavo", async () => {
    const con = await encontradas({ conSaldo: true });
    // A debe 50, D debe 0,01, E debe 2000, G debe 40. B y C están saldadas.
    // F está cancelada: no debe aunque no haya pagado.
    expect(con).toEqual(["Cliente Bs", "Grupo 1000", "María Pérez", "Taller debe un centavo"]);
  });

  it("el total en SQL coincide con el de TypeScript en cada reserva", async () => {
    // Si las dos cuentas se separaran, el listado mostraría como "debe" una
    // reserva que su detalle muestra saldada, o al revés.
    const { rows: todas } = await listBookings(tenant, TZ, {});
    const { rows: conSaldo } = await listBookings(tenant, TZ, { conSaldo: true });
    const enSql = new Set(conSaldo.map((r) => r.id));

    for (const r of todas) {
      const debeSegunTs =
        ["reservada", "en_curso", "finalizada"].includes(r.status) && Number(r.saldo) > 0;
      expect(enSql.has(r.id), `${r.holderName}: saldo TS ${r.saldo}`).toBe(debeSegunTs);
    }

    // El caso al límite, explícito.
    const c = todas.find((r) => r.id === ids.C)!;
    const d = todas.find((r) => r.id === ids.D)!;
    expect(c.total).toBe("14.99");
    expect(c.saldo).toBe("0.00");
    expect(d.saldo).toBe("0.01");
  });

  it("suma lo que se debe por moneda, sin mezclarlas", async () => {
    const { saldos, rows } = await listBookings(tenant, TZ, { conSaldo: true });
    // Mismo resultado que sumar los saldos que calcula TypeScript.
    const usd = sumMoney(rows.filter((r) => r.currency === "USD").map((r) => r.saldo));
    expect(saldos).toEqual([
      { currency: "USD", saldo: usd, count: 3 },
      { currency: "VES", saldo: "2000.00", count: 1 },
    ]);
    expect(usd).toBe("90.01"); // 50 + 0,01 + 40
  });

  it("anular un cobro hace que la reserva vuelva a deber", async () => {
    const [pago] = await sql`
      select bp.transaction_id from booking_payments bp where bp.booking_id = ${ids.B}`;
    expect((await revertTransaction(ctx, { id: pago.transaction_id })).ok).toBe(true);
    expect(await encontradas({ conSaldo: true })).toContain("José García");
  });

  // -------------------------------------------------------------------------
  // Paginación y aislamiento
  // -------------------------------------------------------------------------

  it("pagina en el servidor", async () => {
    // 22 turnos de Box, directo en la base: más de una página.
    for (let i = 0; i < 22; i++) {
      const dia = String(1 + i).padStart(2, "0");
      await sql`insert into bookings (id, tenant_id, service_id, resource_id, period, unit_price, currency, holder_name, created_by)
        values (${uuidv7()}, ${tenant}, ${box}, ${box1},
                tstzrange(${`2030-03-${dia} 14:00-04`}, ${`2030-03-${dia} 15:00-04`}),
                '5.00', 'USD', ${`Turno ${i}`}, ${user})`;
    }

    const p0 = await listBookings(tenant, TZ, { serviceId: box, page: 0 });
    const p1 = await listBookings(tenant, TZ, { serviceId: box, page: 1 });
    expect(p0.total).toBe(22);
    expect(p0.rows).toHaveLength(LISTADO_POR_PAGINA);
    expect(p1.rows).toHaveLength(22 - LISTADO_POR_PAGINA);
    // Sin repetidos entre páginas.
    const vistos = new Set([...p0.rows, ...p1.rows].map((r) => r.id));
    expect(vistos.size).toBe(22);
    // Lo más reciente primero.
    expect(p0.rows[0].inicio > p0.rows[1].inicio).toBe(true);
  });

  it("trae los nombres del servicio y del recurso", async () => {
    const { rows } = await listBookings(tenant, TZ, { q: "pérez" });
    expect(rows[0]).toMatchObject({ serviceName: "Doble", resourceName: "101" });
  });

  it("un cliente no ve las reservas de otro", async () => {
    const r = await listBookings(otro, TZ, {});
    expect(r.total).toBe(0);
    expect(r.saldos).toEqual([]);
  });
});
