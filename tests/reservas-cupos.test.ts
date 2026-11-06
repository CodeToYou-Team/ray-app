import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { tarifasDeSiempre } from "./tarifas-fixture";
import { uuidv7 } from "uuidv7";
import {
  configureServiceBooking,
  createBooking,
  cancelBooking,
  picoDeOcupacion,
  registerPayment,
  updateResourceCapacity,
} from "@/lib/reservas/register";
import { bookingsInWindow } from "@/lib/reservas/queries";
import { ocupacionMaxima, totalReserva } from "@/lib/reservas/rango";
import { multiplyQuantity } from "@/lib/money";

/**
 * Capacidad, recursos compartidos y cobro por persona.
 *
 * Lo que hay que fijar: que en un compartido la SUMA de personas nunca pase
 * de la capacidad (tampoco con inscripciones simultáneas), que se mida el
 * PICO y no la suma de todo lo que toca el rango, y que el exclusivo siga
 * funcionando como antes.
 */

// ---------------------------------------------------------------------------
// Aritmética pura
// ---------------------------------------------------------------------------

describe("total por reserva y por persona", () => {
  it("por reserva no importa cuántos vayan", () => {
    expect(totalReserva({ qty: "2", partySize: 3, perPerson: false, unitPrice: "40.00" })).toBe("80.00");
  });

  it("por persona multiplica", () => {
    expect(totalReserva({ qty: "1", partySize: 3, perPerson: true, unitPrice: "15.00" })).toBe("45.00");
    // Hora y media × 3 personas × 10 = 45, con un solo redondeo.
    expect(totalReserva({ qty: "1.5", partySize: 3, perPerson: true, unitPrice: "10.00" })).toBe("45.00");
    expect(totalReserva({ qty: "1.5", partySize: 3, perPerson: true, unitPrice: "3.33" })).toBe("14.99");
  });

  it("multiplica cantidades por enteros, y solo por enteros", () => {
    expect(multiplyQuantity("1.5", 3)).toBe("4.500");
    expect(multiplyQuantity("2", 1)).toBe("2.000");
    expect(() => multiplyQuantity("1", 2.5)).toThrow(/entero/);
  });
});

describe("pico de ocupación", () => {
  const r = (inicio: string, fin: string, partySize: number) => ({ inicio, fin, partySize });

  it("mide el pico, no la suma de todo lo que toca el rango", () => {
    // Noche 10: 3 personas. Noche 11: otras 3. Un rango que cubre las dos
    // nunca tiene más de 3 a la vez, aunque la suma dé 6.
    const reservas = [r("2026-01-10T00:00", "2026-01-11T00:00", 3), r("2026-01-11T00:00", "2026-01-12T00:00", 3)];
    expect(ocupacionMaxima({ inicio: "2026-01-10T00:00", fin: "2026-01-12T00:00" }, reservas)).toBe(3);
  });

  it("suma lo que de verdad coincide", () => {
    const reservas = [r("2026-01-10T00:00", "2026-01-13T00:00", 2), r("2026-01-11T00:00", "2026-01-14T00:00", 2)];
    expect(ocupacionMaxima({ inicio: "2026-01-10T00:00", fin: "2026-01-14T00:00" }, reservas)).toBe(4);
    // Desde el 13 la primera ya terminó: solo queda la segunda.
    expect(ocupacionMaxima({ inicio: "2026-01-13T00:00", fin: "2026-01-14T00:00" }, reservas)).toBe(2);
  });

  it("lo que solo se toca en el borde no cuenta", () => {
    const reservas = [r("2026-01-10T18:00", "2026-01-10T19:00", 5)];
    expect(ocupacionMaxima({ inicio: "2026-01-10T19:00", fin: "2026-01-10T20:00" }, reservas)).toBe(0);
  });

  it("el servidor mide igual", () => {
    // picoDeOcupacion (servidor, por instantes) y ocupacionMaxima (cliente,
    // por texto) tienen que coincidir, o el formulario ofrecería cupos que el
    // servidor rechaza.
    expect(
      picoDeOcupacion([
        { desde: 0, hasta: 3, personas: 2 },
        { desde: 1, hasta: 4, personas: 2 },
        { desde: 3, hasta: 5, personas: 1 },
      ]),
    ).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Contra la base
// ---------------------------------------------------------------------------

const hasDb = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL);
const TZ = "America/Caracas";

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const user = uuidv7();
const ctx = { tenantId: tenant, userId: user };

const catServ = uuidv7();
const catIngreso = uuidv7();
const payUsd = uuidv7();
const habitacion = uuidv7();
const yoga = uuidv7();
const dorm = uuidv7();
const h301 = uuidv7();
const sala = uuidv7();
const dormA = uuidv7();
const sala2 = uuidv7();

async function pgErrorCode(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    let current: unknown = error;
    while (current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string") return code;
      current = (current as { cause?: unknown }).cause;
    }
    return undefined;
  }
}

const yogaEn = (fecha: string, inicio: string, fin: string, personas: number, holderName = "Ana", resourceId = sala) =>
  createBooking(ctx, {
    serviceId: yoga,
    resourceId,
    rango: { unidad: "hora", fecha, inicio, fin },
    personas,
    holderName,
  });

const dormEn = (desde: string, hasta: string, personas: number) =>
  createBooking(ctx, {
    serviceId: dorm,
    resourceId: dormA,
    rango: { unidad: "noche", desde, hasta },
    personas,
    holderName: "Mochilero",
  });

describe.skipIf(!hasDb)("cupos en la base", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug, timezone) values (${tenant}, 'Cupos', ${"cupos-" + tenant.slice(-12)}, ${TZ})`;
    await sql`insert into users (id, email) values (${user}, ${`cup-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label, currency) values
      (${catServ},    ${tenant}, 'service_category', 'serv', 'Servicios', null),
      (${catIngreso}, ${tenant}, 'income_category',  'ing',  'Ingresos',  null),
      (${payUsd},     ${tenant}, 'payment_method',   'efec', 'Efectivo',  'USD')`;
    await sql`insert into services (id, tenant_id, name, category_id, price, currency, booking_unit, booking_shared, booking_per_person) values
      (${habitacion}, ${tenant}, 'Habitación triple', ${catServ}, '40.00', 'USD', 'noche', false, false),
      (${yoga},       ${tenant}, 'Clase de yoga',     ${catServ}, '10.00', 'USD', 'hora',  true,  true),
      (${dorm},       ${tenant}, 'Cama en dormitorio', ${catServ}, '15.00', 'USD', 'noche', true,  true)`;
    await tarifasDeSiempre(sql, tenant);
    await sql`insert into resources (id, tenant_id, service_id, name, capacity) values
      (${h301},  ${tenant}, ${habitacion}, '301',    3),
      (${sala},  ${tenant}, ${yoga},       'Sala',   5),
      (${sala2}, ${tenant}, ${yoga},       'Sala 2', 5),
      (${dormA}, ${tenant}, ${dorm},       'Dorm A', 4)`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  // -------------------------------------------------------------------------
  // Exclusivo con personas
  // -------------------------------------------------------------------------

  it("una habitación para 3 acepta 3 personas y cobra por habitación", async () => {
    const r = await createBooking(ctx, {
      serviceId: habitacion,
      resourceId: h301,
      rango: { unidad: "noche", desde: "2027-01-10", hasta: "2027-01-12" },
      personas: 3,
      holderName: "Familia",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 2 noches × 40, vayan 1 o 3.
    expect(r.total).toBe("80.00");
  });

  it("no acepta 4 personas en una habitación para 3", async () => {
    const r = await createBooking(ctx, {
      serviceId: habitacion,
      resourceId: h301,
      rango: { unidad: "noche", desde: "2027-02-10", hasta: "2027-02-11" },
      personas: 4,
      holderName: "Grupo",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/hasta 3 personas/i);
  });

  it("la base tampoco acepta un grupo que no cabe", async () => {
    const code = await pgErrorCode(() => sql`
      insert into bookings (id, tenant_id, service_id, resource_id, period, party_size, unit_price, currency, holder_name, created_by, rate_id, rate_unit, qty)
      values (${uuidv7()}, ${tenant}, ${habitacion}, ${h301},
              tstzrange('2030-01-01', '2030-01-02'), 4, '40.00', 'USD', 'X', ${user}, (select id from service_rates where service_id = ${habitacion} and archived_at is null limit 1), 'noche', 1)`);
    expect(code).toBe("RS002");
  });

  it("el exclusivo sigue sin admitir dos reservas a la vez, aunque sean de 1", async () => {
    const r = await createBooking(ctx, {
      serviceId: habitacion,
      resourceId: h301,
      rango: { unidad: "noche", desde: "2027-01-11", hasta: "2027-01-12" },
      personas: 1,
      holderName: "Solo",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/se cruza/i);
  });

  // -------------------------------------------------------------------------
  // Compartido
  // -------------------------------------------------------------------------

  it("una clase se llena hasta su capacidad, y ni una más", async () => {
    expect((await yogaEn("2027-03-02", "18:00", "19:00", 2, "Ana")).ok).toBe(true);
    expect((await yogaEn("2027-03-02", "18:00", "19:00", 2, "Beto")).ok).toBe(true);

    // 4 de 5: un grupo de 2 ya no cabe...
    const grande = await yogaEn("2027-03-02", "18:00", "19:00", 2, "Caro");
    expect(grande.ok).toBe(false);
    if (grande.ok) return;
    expect(grande.error).toMatch(/no quedan cupos/i);

    // ...pero 1 sí, y con eso se llena.
    expect((await yogaEn("2027-03-02", "18:00", "19:00", 1, "Dani")).ok).toBe(true);
    expect((await yogaEn("2027-03-02", "18:00", "19:00", 1, "Eli")).ok).toBe(false);
  });

  it("cobra por persona", async () => {
    const r = await yogaEn("2027-03-09", "18:00", "19:00", 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 1 hora × 3 personas × 10.
    expect(r.total).toBe("30.00");
  });

  it("el turno de al lado no compite; uno que se pisa con el lleno, sí", async () => {
    // 18-19 del 2 de marzo está lleno (5/5).
    expect((await yogaEn("2027-03-02", "19:00", "20:00", 5)).ok).toBe(true);
    expect((await yogaEn("2027-03-02", "18:30", "19:30", 1)).ok).toBe(false);
  });

  it("mide el pico: una cama dos noches cabe aunque la suma pase de la capacidad", async () => {
    // Dorm A, 4 camas. Noche del 10: 3. Noche del 11: otras 3.
    expect((await dormEn("2027-04-10", "2027-04-11", 3)).ok).toBe(true);
    expect((await dormEn("2027-04-11", "2027-04-12", 3)).ok).toBe(true);

    // Una persona las dos noches: nunca hay más de 4 a la vez. Sumar todo lo
    // que toca el rango (3 + 3 + 1 = 7) la rechazaría por error.
    expect((await dormEn("2027-04-10", "2027-04-12", 1)).ok).toBe(true);

    // Y ahora sí está lleno las dos noches.
    expect((await dormEn("2027-04-11", "2027-04-12", 1)).ok).toBe(false);
  });

  it("mide el pico dentro del rango, no solo en su inicio", async () => {
    // Del 20 al 23: 2 personas. Del 21 al 24: otras 2. El 21 y el 22 hay 4.
    expect((await dormEn("2027-04-20", "2027-04-23", 2)).ok).toBe(true);
    expect((await dormEn("2027-04-21", "2027-04-24", 2)).ok).toBe(true);

    // Empieza el 20, cuando solo hay 2: mirar únicamente el inicio diría que
    // cabe. Pero el 21 serían 5.
    expect((await dormEn("2027-04-20", "2027-04-22", 1)).ok).toBe(false);

    // Desde el 23 la primera ya salió: hay 2, y caben 2 más.
    expect((await dormEn("2027-04-23", "2027-04-24", 2)).ok).toBe(true);
  });

  it("inscripciones simultáneas a los últimos cupos: no se sobrevende", async () => {
    // 5 cupos, cinco grupos de 2 a la vez: caben exactamente dos grupos.
    // Sin el FOR UPDATE del trigger, varias contarían "quedan 5" a la vez.
    const resultados = await Promise.all(
      Array.from({ length: 5 }, (_, i) => yogaEn("2027-05-04", "18:00", "19:00", 2, `Grupo ${i}`, sala2)),
    );
    expect(resultados.filter((r) => r.ok)).toHaveLength(2);

    const [{ ocupado }] = await sql`
      select coalesce(sum(party_size), 0)::int as ocupado from bookings
      where resource_id = ${sala2} and status = 'reservada'
        and period && tstzrange('2027-05-04 22:00+00', '2027-05-04 23:00+00')`;
    expect(ocupado).toBe(4);
  });

  it("cancelar devuelve los cupos", async () => {
    const r = await yogaEn("2027-05-11", "18:00", "19:00", 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await yogaEn("2027-05-11", "18:00", "19:00", 1)).ok).toBe(false);

    expect((await cancelBooking(ctx, { id: r.id })).ok).toBe(true);
    expect((await yogaEn("2027-05-11", "18:00", "19:00", 5)).ok).toBe(true);
  });

  it("cambiar el estado no vuelve a medir la capacidad", async () => {
    // Si alguien baja la capacidad por SQL (la app no lo deja), registrar la
    // llegada de una reserva que ya existía no puede fallar por eso.
    const r = await yogaEn("2027-05-18", "18:00", "19:00", 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await sql`update resources set capacity = 1 where id = ${sala}`;
    try {
      const code = await pgErrorCode(
        () => sql`update bookings set status = 'en_curso', checked_in_at = now() where id = ${r.id}`,
      );
      expect(code).toBeUndefined();
    } finally {
      await sql`update resources set capacity = 5 where id = ${sala}`;
    }
  });

  // -------------------------------------------------------------------------
  // Capacidad de un recurso
  // -------------------------------------------------------------------------

  it("no se baja la capacidad por debajo de lo comprometido", async () => {
    // En Sala ya hay turnos llenos (5/5) en fechas futuras.
    const r = await updateResourceCapacity(ctx, { id: sala, capacity: 4 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/5 cupos ocupados/i);

    expect((await updateResourceCapacity(ctx, { id: sala, capacity: 8 })).ok).toBe(true);
    expect((await updateResourceCapacity(ctx, { id: sala, capacity: 5 })).ok).toBe(true);
  });

  it("en un exclusivo, no se baja por debajo del grupo más grande", async () => {
    const r = await updateResourceCapacity(ctx, { id: h301, capacity: 2 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/para 3 personas/i);
  });

  it("la capacidad tiene que ser un entero positivo", async () => {
    expect((await updateResourceCapacity(ctx, { id: h301, capacity: 0 })).ok).toBe(false);
    expect((await updateResourceCapacity(ctx, { id: h301, capacity: 2.5 })).ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Configuración y snapshots
  // -------------------------------------------------------------------------

  it("con reservas pendientes, no se cambia de exclusivo a compartido", async () => {
    // Una propia, lejos: las de arriba dejan de estar pendientes cuando pasan.
    const pendiente = await createBooking(ctx, {
      serviceId: habitacion,
      resourceId: h301,
      rango: { unidad: "noche", desde: "2035-01-10", hasta: "2035-01-12" },
      holderName: "Pendiente",
    });
    expect(pendiente.ok).toBe(true);
    const r = await configureServiceBooking(ctx, {
      serviceId: habitacion,
      unidad: "noche",
      compartido: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/reservas? pendientes?/i);
  });

  it("el cobro por persona sí cambia, y solo afecta a las reservas nuevas", async () => {
    const antes = await createBooking(ctx, {
      serviceId: habitacion,
      resourceId: h301,
      rango: { unidad: "noche", desde: "2027-06-01", hasta: "2027-06-02" },
      personas: 2,
      holderName: "Antes",
    });
    expect(antes.ok && antes.total).toBe("40.00");

    expect(
      (await configureServiceBooking(ctx, { serviceId: habitacion, unidad: "noche", porPersona: true })).ok,
    ).toBe(true);

    try {
      const despues = await createBooking(ctx, {
        serviceId: habitacion,
        resourceId: h301,
        rango: { unidad: "noche", desde: "2027-06-05", hasta: "2027-06-06" },
        personas: 2,
        holderName: "Después",
      });
      expect(despues.ok && despues.total).toBe("80.00");

      // La de antes conserva cómo se calculó.
      const [vieja] = (
        await bookingsInWindow(tenant, TZ, { desde: "2027-06-01", hasta: "2027-06-02" })
      ).filter((b) => b.resourceId === h301);
      expect(vieja.perPerson).toBe(false);
      expect(vieja.total).toBe("40.00");
    } finally {
      await configureServiceBooking(ctx, { serviceId: habitacion, unidad: "noche", porPersona: false });
    }
  });

  it("el saldo de un cobro por persona sale del total con las personas", async () => {
    const r = await yogaEn("2027-07-06", "18:00", "19:00", 2, "Paga");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.total).toBe("20.00");

    const pago = await registerPayment(ctx, {
      bookingId: r.id,
      monto: "20.00",
      paymentMethodId: payUsd,
      categoryId: catIngreso,
      clientRequestId: uuidv7(),
    });
    expect(pago.ok).toBe(true);
    if (!pago.ok) return;
    expect(pago.saldo).toBe("0.00");
  });

  it("la cuadrícula recibe personas, modo y total", async () => {
    const reservas = await bookingsInWindow(tenant, TZ, { desde: "2027-03-09", hasta: "2027-03-10" });
    const r = reservas.find((b) => b.resourceId === sala);
    expect(r).toMatchObject({ partySize: 3, shared: true, perPerson: true, total: "30.00" });
  });
});
