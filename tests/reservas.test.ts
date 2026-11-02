import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  archiveResource,
  cancelBooking,
  createBooking,
  createResource,
  configureServiceBooking,
} from "@/lib/reservas/register";
import { bookingsInWindow, listBookableServices } from "@/lib/reservas/queries";
import { cantidad, seCruzan, sumarDias } from "@/lib/reservas/rango";

/**
 * Reservas, fase 1.
 *
 * Lo que de verdad hay que fijar: que la doble reserva sea IMPOSIBLE (incluso
 * con dos reservas simultáneas), que los bordes se calculen en la zona del
 * negocio y no en UTC, y que el precio quede congelado.
 */

// ---------------------------------------------------------------------------
// Aritmética de rangos: pura, corre siempre.
// ---------------------------------------------------------------------------

describe("cuántas unidades se cobran", () => {
  it("cuenta noches, sin cobrar la de salida", () => {
    expect(cantidad({ unidad: "noche", desde: "2026-11-10", hasta: "2026-11-12" })).toMatchObject({
      ok: true,
      qty: "2",
      descripcion: "2 noches",
    });
    expect(cantidad({ unidad: "noche", desde: "2026-11-10", hasta: "2026-11-11" })).toMatchObject({
      qty: "1",
      descripcion: "1 noche",
    });
  });

  it("cruza meses, años y bisiestos sin pasar por ninguna zona horaria", () => {
    expect(cantidad({ unidad: "noche", desde: "2026-12-30", hasta: "2027-01-02" })).toMatchObject({ qty: "3" });
    expect(cantidad({ unidad: "noche", desde: "2028-02-28", hasta: "2028-03-01" })).toMatchObject({ qty: "2" });
    expect(cantidad({ unidad: "noche", desde: "2027-02-28", hasta: "2027-03-01" })).toMatchObject({ qty: "1" });
  });

  it("rechaza rangos que no describen una estadía", () => {
    expect(cantidad({ unidad: "noche", desde: "2026-11-10", hasta: "2026-11-10" }).ok).toBe(false);
    expect(cantidad({ unidad: "noche", desde: "2026-11-12", hasta: "2026-11-10" }).ok).toBe(false);
    // Tiene la forma de una fecha, pero no existe.
    expect(cantidad({ unidad: "noche", desde: "2026-02-30", hasta: "2026-03-02" }).ok).toBe(false);
    expect(cantidad({ unidad: "noche", desde: "2026-01-01", hasta: "2027-06-01" }).ok).toBe(false);
  });

  it("cuenta horas en tramos de 30 minutos", () => {
    expect(cantidad({ unidad: "hora", fecha: "2026-11-10", inicio: "14:00", fin: "15:30" })).toMatchObject({
      ok: true,
      qty: "1.5",
      descripcion: "1,5 horas",
    });
    expect(cantidad({ unidad: "hora", fecha: "2026-11-10", inicio: "09:00", fin: "10:00" })).toMatchObject({
      qty: "1",
      descripcion: "1 hora",
    });
  });

  it("rechaza tramos sueltos, al revés o cruzando la medianoche", () => {
    expect(cantidad({ unidad: "hora", fecha: "2026-11-10", inicio: "14:00", fin: "14:20" }).ok).toBe(false);
    expect(cantidad({ unidad: "hora", fecha: "2026-11-10", inicio: "15:00", fin: "14:00" }).ok).toBe(false);
    expect(cantidad({ unidad: "hora", fecha: "2026-11-10", inicio: "22:00", fin: "01:00" }).ok).toBe(false);
    expect(cantidad({ unidad: "hora", fecha: "2026-11-10", inicio: "9:00", fin: "10:00" }).ok).toBe(false);
  });

  it("dos rangos que se tocan en el borde no se cruzan", () => {
    const a = { inicio: "2026-11-10T00:00", fin: "2026-11-12T00:00" };
    expect(seCruzan(a, { inicio: "2026-11-12T00:00", fin: "2026-11-14T00:00" })).toBe(false);
    expect(seCruzan(a, { inicio: "2026-11-11T00:00", fin: "2026-11-13T00:00" })).toBe(true);
    expect(seCruzan(a, { inicio: "2026-11-10T12:00", fin: "2026-11-10T14:00" })).toBe(true);
  });

  it("suma días cruzando meses", () => {
    expect(sumarDias("2026-11-30", 1)).toBe("2026-12-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
  });
});

// ---------------------------------------------------------------------------
// Contra la base.
// ---------------------------------------------------------------------------

const hasDb = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL);

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const otro = uuidv7();
const user = uuidv7();
const ctx = { tenantId: tenant, userId: user };

const catServ = uuidv7();
const doble = uuidv7();
const cancha = uuidv7();
const instalacion = uuidv7();
const h101 = uuidv7();
const h102 = uuidv7();
const cancha1 = uuidv7();

const noches = (desde: string, hasta: string) => ({ unidad: "noche" as const, desde, hasta });
const horas = (fecha: string, inicio: string, fin: string) => ({
  unidad: "hora" as const,
  fecha,
  inicio,
  fin,
});

/** El código de Postgres, buscándolo en la cadena de causas que envuelve Drizzle. */
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

describe.skipIf(!hasDb)("reservas", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug, timezone) values
      (${tenant}, 'Hotel', ${"hotel-" + tenant.slice(-12)}, 'America/Caracas'),
      (${otro},   'Otro',  ${"otro-" + otro.slice(-12)},   'America/Caracas')`;
    await sql`insert into users (id, email) values (${user}, ${`res-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label) values
      (${catServ}, ${tenant}, 'service_category', 'aloj', 'Alojamiento')`;
    await sql`insert into services (id, tenant_id, name, category_id, price, currency, booking_unit) values
      (${doble},       ${tenant}, 'Habitación doble', ${catServ}, '40.00', 'USD', 'noche'),
      (${cancha},      ${tenant}, 'Cancha de pádel',  ${catServ}, '25.00', 'USD', 'hora'),
      (${instalacion}, ${tenant}, 'Instalación',      ${catServ}, '15.00', 'USD', null)`;
    await sql`insert into resources (id, tenant_id, service_id, name) values
      (${h101},    ${tenant}, ${doble},  '101'),
      (${h102},    ${tenant}, ${doble},  '102'),
      (${cancha1}, ${tenant}, ${cancha}, 'Cancha 1')`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id in (${tenant}, ${otro})`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  const reservar = (resourceId: string, rango: ReturnType<typeof noches> | ReturnType<typeof horas>, holderName = "Pérez") =>
    createBooking(ctx, {
      serviceId: rango.unidad === "noche" ? doble : cancha,
      resourceId,
      rango,
      holderName,
    });

  // -------------------------------------------------------------------------
  // Por noche
  // -------------------------------------------------------------------------

  let primera = "";

  it("reserva dos noches con el precio del servicio", async () => {
    const r = await reservar(h101, noches("2026-11-10", "2026-11-12"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    primera = r.id;
    expect(r).toMatchObject({ qty: "2", unitPrice: "40.00", total: "80.00", currency: "USD" });
  });

  it("los bordes son la medianoche de Caracas, no la de UTC", async () => {
    // LA prueba de la zona horaria. "La noche del 10" en Caracas (UTC-4)
    // empieza a las 04:00 UTC. Si el rango se armara en JavaScript, que corre
    // en UTC, saldría 00:00 y todas las reservas estarían corridas 4 horas.
    const [fila] = await sql`
      select to_char(lower(period) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as desde,
             to_char(upper(period) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as hasta
      from bookings where id = ${primera}`;
    expect(fila.desde).toBe("2026-11-10 04:00");
    expect(fila.hasta).toBe("2026-11-12 04:00");
  });

  it("no deja reservar dos veces la misma noche", async () => {
    const r = await reservar(h101, noches("2026-11-11", "2026-11-13"), "Gómez");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/se cruza/i);
  });

  it("salir el 12 y entrar el 12 no choca", async () => {
    const r = await reservar(h101, noches("2026-11-12", "2026-11-14"), "Gómez");
    expect(r.ok).toBe(true);
  });

  it("otra habitación las mismas noches sí se puede", async () => {
    const r = await reservar(h102, noches("2026-11-10", "2026-11-12"), "Rojas");
    expect(r.ok).toBe(true);
  });

  it("dos reservas simultáneas de la misma habitación: gana exactamente una", async () => {
    // Lo que una verificación en la app NO puede garantizar: entre "¿está
    // libre?" y el INSERT, otra recepcionista puede tomar la habitación. El
    // EXCLUDE no tiene ese hueco.
    const resultados = await Promise.all([
      reservar(h102, noches("2026-12-01", "2026-12-04"), "Recepción A"),
      reservar(h102, noches("2026-12-02", "2026-12-05"), "Recepción B"),
      reservar(h102, noches("2026-12-03", "2026-12-06"), "Recepción C"),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);

    const [{ n }] = await sql`
      select count(*)::int as n from bookings
      where resource_id = ${h102} and status = 'reservada'
        and period && tstzrange('2026-12-01', '2026-12-06')`;
    expect(n).toBe(1);
  });

  it("el doble clic no duplica: la segunda se solapa con la primera", async () => {
    const rango = noches("2027-01-10", "2027-01-12");
    const a = await reservar(h101, rango, "Doble clic");
    const b = await reservar(h101, rango, "Doble clic");
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
  });

  it("cancelar libera la habitación", async () => {
    expect((await cancelBooking(ctx, { id: primera, reason: "Llamó" })).ok).toBe(true);

    const [fila] = await sql`select status, cancelled_at, cancel_reason from bookings where id = ${primera}`;
    expect(fila.status).toBe("cancelada");
    expect(fila.cancelled_at).not.toBeNull();
    expect(fila.cancel_reason).toBe("Llamó");

    // Las mismas noches, ya libres.
    expect((await reservar(h101, noches("2026-11-10", "2026-11-12"), "Otra")).ok).toBe(true);
  });

  it("no se cancela dos veces", async () => {
    const r = await cancelBooking(ctx, { id: primera });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/ya está cancelada/i);
  });

  it("un no-show también libera el recurso", async () => {
    const r = await reservar(h102, noches("2027-02-01", "2027-02-03"), "No vino");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await sql`update bookings set status = 'no_show' where id = ${r.id}`;
    expect((await reservar(h102, noches("2027-02-01", "2027-02-03"), "Sí vino")).ok).toBe(true);
  });

  it("el precio queda congelado al reservar", async () => {
    const r = await reservar(h101, noches("2027-03-01", "2027-03-04"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    await sql`update services set price = '55.00' where id = ${doble}`;
    try {
      const [reserva] = (
        await bookingsInWindow(tenant, "America/Caracas", { desde: "2027-03-01", hasta: "2027-03-05" })
      ).filter((b) => b.id === r.id);
      expect(reserva.unitPrice).toBe("40.00");
      expect(reserva.total).toBe("120.00");
    } finally {
      await sql`update services set price = '40.00' where id = ${doble}`;
    }
  });

  // -------------------------------------------------------------------------
  // Por hora
  // -------------------------------------------------------------------------

  it("reserva hora y media de cancha", async () => {
    const r = await reservar(cancha1, horas("2026-11-10", "14:00", "15:30"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ qty: "1.5", total: "37.50" });
  });

  it("los tramos que se tocan no chocan; los que se pisan, sí", async () => {
    expect((await reservar(cancha1, horas("2026-11-10", "15:30", "17:00"))).ok).toBe(true);
    expect((await reservar(cancha1, horas("2026-11-10", "15:00", "16:00"))).ok).toBe(false);
  });

  it("una hora local de Caracas se guarda como el instante correcto", async () => {
    const [fila] = await sql`
      select to_char(lower(period) at time zone 'UTC', 'HH24:MI') as desde
      from bookings where resource_id = ${cancha1} order by lower(period) limit 1`;
    // 14:00 en Caracas = 18:00 UTC.
    expect(fila.desde).toBe("18:00");
  });

  // -------------------------------------------------------------------------
  // Lo que no se puede reservar
  // -------------------------------------------------------------------------

  it("no se reserva por noche algo que va por hora", async () => {
    const r = await createBooking(ctx, {
      serviceId: cancha,
      resourceId: cancha1,
      rango: noches("2026-11-20", "2026-11-21"),
      holderName: "X",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/por hora/i);
  });

  it("un servicio que no se reserva no acepta reservas", async () => {
    const r = await createBooking(ctx, {
      serviceId: instalacion,
      resourceId: h101,
      rango: noches("2026-11-20", "2026-11-21"),
      holderName: "X",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no se reserva/i);
  });

  it("el recurso tiene que ser de ese servicio", async () => {
    const r = await createBooking(ctx, {
      serviceId: doble,
      resourceId: cancha1,
      rango: noches("2026-11-20", "2026-11-21"),
      holderName: "X",
    });
    expect(r.ok).toBe(false);
  });

  it("la base tampoco acepta un recurso de otro servicio", async () => {
    // La FK compuesta (tenant, servicio, recurso), por si algo se salta la app.
    const code = await pgErrorCode(() => sql`
      insert into bookings (id, tenant_id, service_id, resource_id, period, unit_price, currency, holder_name, created_by)
      values (${uuidv7()}, ${tenant}, ${doble}, ${cancha1},
              tstzrange('2030-01-01', '2030-01-02'), '40.00', 'USD', 'X', ${user})`);
    expect(code).toBe("23503");
  });

  it("la base rechaza un periodo vacío", async () => {
    const code = await pgErrorCode(() => sql`
      insert into bookings (id, tenant_id, service_id, resource_id, period, unit_price, currency, holder_name, created_by)
      values (${uuidv7()}, ${tenant}, ${doble}, ${h101},
              tstzrange('2030-01-01', '2030-01-01'), '40.00', 'USD', 'X', ${user})`);
    expect(code).toBe("23514");
  });

  it("la base rechaza una cancelada sin fecha de cancelación", async () => {
    const code = await pgErrorCode(() => sql`
      insert into bookings (id, tenant_id, service_id, resource_id, period, status, unit_price, currency, holder_name, created_by)
      values (${uuidv7()}, ${tenant}, ${doble}, ${h101},
              tstzrange('2031-01-01', '2031-01-02'), 'cancelada', '40.00', 'USD', 'X', ${user})`);
    expect(code).toBe("23514");
  });

  // -------------------------------------------------------------------------
  // Recursos y servicios
  // -------------------------------------------------------------------------

  it("no se archiva un recurso con reservas pendientes", async () => {
    const r = await archiveResource(ctx, { id: h101 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/pendientes/i);
  });

  it("sí se archiva uno cuyas reservas ya terminaron", async () => {
    // En la fase 1 no hay check-out: toda estadía pasada se queda en
    // `reservada` para siempre. Contar solo el estado haría imposible
    // archivar cualquier habitación que se haya usado alguna vez.
    const creado = await createResource(ctx, { serviceId: doble, name: "103" });
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;
    await sql`insert into bookings (id, tenant_id, service_id, resource_id, period, unit_price, currency, holder_name, created_by)
              values (${uuidv7()}, ${tenant}, ${doble}, ${creado.id},
                      tstzrange('2020-01-01', '2020-01-03'), '40.00', 'USD', 'Antiguo', ${user})`;

    expect((await archiveResource(ctx, { id: creado.id })).ok).toBe(true);

    // Y archivado ya no se reserva.
    const r = await reservar(creado.id, noches("2027-05-01", "2027-05-02"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/archivado/i);
  });

  it("archivar libera el nombre para otro recurso", async () => {
    // El índice único es solo entre los activos.
    expect((await createResource(ctx, { serviceId: doble, name: "103" })).ok).toBe(true);
  });

  it("no hay dos recursos activos con el mismo nombre, sin importar mayúsculas", async () => {
    const r = await createResource(ctx, { serviceId: cancha, name: "cancha 1" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/ya hay/i);
  });

  it("no se agregan recursos a un servicio que no se reserva", async () => {
    const r = await createResource(ctx, { serviceId: instalacion, name: "X" });
    expect(r.ok).toBe(false);
  });

  it("no se cambia la forma de reservar un servicio que ya tiene reservas", async () => {
    const r = await configureServiceBooking(ctx, { serviceId: doble, unidad: "hora" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/ya tiene reservas/i);
  });

  it("sí se activa uno que nunca se reservó", async () => {
    expect((await configureServiceBooking(ctx, { serviceId: instalacion, unidad: "hora" })).ok).toBe(true);
    expect((await configureServiceBooking(ctx, { serviceId: instalacion, unidad: null })).ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  it("la cuadrícula recibe los bordes en hora local, listos para comparar", async () => {
    const reservas = await bookingsInWindow(tenant, "America/Caracas", {
      desde: "2026-11-10",
      hasta: "2026-11-11",
    });
    const noche = reservas.find((r) => r.resourceId === h102 && r.unidad === "noche");
    expect(noche).toMatchObject({
      inicio: "2026-11-10T00:00",
      fin: "2026-11-12T00:00",
      qty: "2",
      descripcion: "2 noches",
    });
    const hora = reservas.find((r) => r.resourceId === cancha1);
    expect(hora?.inicio).toBe("2026-11-10T14:00");
  });

  it("la cuadrícula no muestra las canceladas", async () => {
    const reservas = await bookingsInWindow(tenant, "America/Caracas", {
      desde: "2026-11-01",
      hasta: "2026-12-31",
    });
    expect(reservas.find((r) => r.id === primera)).toBeUndefined();
  });

  it("lista solo servicios reservables, con sus recursos activos", async () => {
    const servicios = await listBookableServices(tenant);
    expect(servicios.map((s) => s.name).sort()).toEqual(["Cancha de pádel", "Habitación doble"]);
    const hab = servicios.find((s) => s.id === doble)!;
    // 101, 102 y la 103 nueva; la 103 archivada no.
    expect(hab.resources.map((r) => r.name)).toEqual(["101", "102", "103"]);
  });

  it("deja rastro en la bitácora", async () => {
    const [{ n }] = await sql`
      select count(*)::int as n from audit_log
      where tenant_id = ${tenant} and entity = 'bookings'`;
    expect(n).toBeGreaterThan(0);
  });

  it("un cliente no ve las reservas ni los recursos de otro", async () => {
    expect(await listBookableServices(otro)).toEqual([]);
    expect(
      await bookingsInWindow(otro, "America/Caracas", { desde: "2020-01-01", hasta: "2032-01-01" }),
    ).toEqual([]);
    // Ni puede reservar un recurso ajeno usando sus ids.
    const r = await createBooking(
      { tenantId: otro, userId: user },
      { serviceId: doble, resourceId: h101, rango: noches("2028-01-01", "2028-01-02"), holderName: "X" },
    );
    expect(r.ok).toBe(false);
  });
});
