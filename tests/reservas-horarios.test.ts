import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { tarifasDeSiempre } from "./tarifas-fixture";
import { uuidv7 } from "uuidv7";
import {
  addSchedule,
  configureServiceBooking,
  createBooking,
  removeSchedule,
  updateBooking,
} from "@/lib/reservas/register";
import { listBookableServices } from "@/lib/reservas/queries";
import { diaSemanaIso, encajaEnTurno, losDias, turnosDelDia } from "@/lib/reservas/rango";

/**
 * Horarios fijos.
 *
 * Lo que hay que fijar: que con turnos publicados solo se reserve en ellos,
 * que el día de la semana salga de la fecha LOCAL (no de UTC), y que cambiar
 * el horario no invalide lo ya reservado.
 */

// ---------------------------------------------------------------------------
// Puras
// ---------------------------------------------------------------------------

describe("día de la semana y turnos", () => {
  it("calcula el día ISO de una fecha escrita", () => {
    expect(diaSemanaIso("2029-01-01")).toBe(1); // lunes
    expect(diaSemanaIso("2029-01-02")).toBe(2); // martes
    expect(diaSemanaIso("2029-01-07")).toBe(7); // domingo
  });

  it("dice los días en plural como se dicen", () => {
    expect(losDias(1)).toBe("los lunes");
    expect(losDias(6)).toBe("los sábados");
    expect(losDias(7)).toBe("los domingos");
  });

  const turnos = [
    { id: "a", weekday: 2, start: "19:00", end: "20:00" },
    { id: "b", weekday: 2, start: "18:00", end: "19:00" },
    { id: "c", weekday: 4, start: "18:00", end: "19:00" },
  ];

  it("lista los turnos de un día, en orden", () => {
    expect(turnosDelDia(turnos, "2029-01-02").map((t) => t.start)).toEqual(["18:00", "19:00"]);
    expect(turnosDelDia(turnos, "2029-01-03")).toEqual([]);
  });

  it("un tramo encaja solo si es exactamente un turno", () => {
    const tramo = (fecha: string, inicio: string, fin: string) => ({
      unidad: "hora" as const,
      fecha,
      inicio,
      fin,
    });
    expect(encajaEnTurno(turnos, tramo("2029-01-02", "18:00", "19:00"))).toBe(true);
    // Mismo horario, otro día sin ese turno.
    expect(encajaEnTurno(turnos, tramo("2029-01-03", "18:00", "19:00"))).toBe(false);
    // Dentro del turno, pero no el turno.
    expect(encajaEnTurno(turnos, tramo("2029-01-02", "18:00", "18:30"))).toBe(false);
    // Dos turnos seguidos no son un turno.
    expect(encajaEnTurno(turnos, tramo("2029-01-02", "18:00", "20:00"))).toBe(false);
    // Sin turnos, todo vale.
    expect(encajaEnTurno([], tramo("2029-01-03", "07:30", "09:00"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Contra la base
// ---------------------------------------------------------------------------

const hasDb = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL);
const TZ = "America/Caracas";

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const otro = uuidv7();
const user = uuidv7();
const ctx = { tenantId: tenant, userId: user };

const catServ = uuidv7();
const yoga = uuidv7();
const libre = uuidv7();
const noche = uuidv7();
const sala = uuidv7();
const box = uuidv7();
const hab = uuidv7();

// 2029-01-01 es lunes.
const MARTES = "2029-01-02";
const MIERCOLES = "2029-01-03";
const JUEVES = "2029-01-04";

const reservarYoga = (fecha: string, inicio: string, fin: string, holderName = "Ana") =>
  createBooking(ctx, {
    serviceId: yoga,
    resourceId: sala,
    rango: { unidad: "hora", fecha, inicio, fin },
    holderName,
  });

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

describe.skipIf(!hasDb)("horarios fijos en la base", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug, timezone) values
      (${tenant}, 'Horarios', ${"hor-" + tenant.slice(-12)}, ${TZ}),
      (${otro},   'Otro',     ${"hor2-" + otro.slice(-12)},  ${TZ})`;
    await sql`insert into users (id, email) values (${user}, ${`hor-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label) values
      (${catServ}, ${tenant}, 'service_category', 'serv', 'Servicios')`;
    await sql`insert into services (id, tenant_id, name, category_id, price, currency, booking_unit, booking_shared, booking_per_person) values
      (${yoga},  ${tenant}, 'Clase de yoga', ${catServ}, '10.00', 'USD', 'hora',  true,  true),
      (${libre}, ${tenant}, 'Box libre',     ${catServ}, '5.00',  'USD', 'hora',  false, false),
      (${noche}, ${tenant}, 'Habitación',    ${catServ}, '40.00', 'USD', 'noche', false, false)`;
    await tarifasDeSiempre(sql, tenant);
    await sql`insert into resources (id, tenant_id, service_id, name, capacity) values
      (${sala}, ${tenant}, ${yoga},  'Sala',  15),
      (${box},  ${tenant}, ${libre}, 'Box 1', 1),
      (${hab},  ${tenant}, ${noche}, '101',   2)`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id in (${tenant}, ${otro})`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  // -------------------------------------------------------------------------
  // Publicar turnos
  // -------------------------------------------------------------------------

  it("publica un turno en varios días a la vez", async () => {
    const r = await addSchedule(ctx, { serviceId: yoga, dias: [2, 4], inicio: "18:00", fin: "19:00" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.creados).toBe(2);

    const [servicio] = (await listBookableServices(tenant)).filter((s) => s.id === yoga);
    expect(servicio.turnos.map((t) => [t.weekday, t.start, t.end])).toEqual([
      [2, "18:00", "19:00"],
      [4, "18:00", "19:00"],
    ]);
  });

  it("dos turnos del mismo día no se pisan, pero sí se tocan", async () => {
    const pisa = await addSchedule(ctx, { serviceId: yoga, dias: [2], inicio: "18:30", fin: "19:30" });
    expect(pisa.ok).toBe(false);
    if (pisa.ok) return;
    expect(pisa.error).toMatch(/se cruza con otro/i);

    expect((await addSchedule(ctx, { serviceId: yoga, dias: [2], inicio: "19:00", fin: "20:00" })).ok).toBe(true);
  });

  it("todo o nada: si un día choca, no se crea ninguno", async () => {
    // El jueves 18:30 choca con 18:00–19:00; el miércoles estaría libre.
    const r = await addSchedule(ctx, { serviceId: yoga, dias: [3, 4], inicio: "18:30", fin: "19:30" });
    expect(r.ok).toBe(false);
    const [{ n }] = await sql`select count(*)::int as n from service_schedules where service_id = ${yoga} and weekday = 3`;
    expect(n).toBe(0);
  });

  it("solo para servicios por hora, en punto o y media", async () => {
    expect((await addSchedule(ctx, { serviceId: noche, dias: [1], inicio: "15:00", fin: "16:00" })).ok).toBe(false);
    expect((await addSchedule(ctx, { serviceId: yoga, dias: [1], inicio: "18:15", fin: "19:15" })).ok).toBe(false);
    expect((await addSchedule(ctx, { serviceId: yoga, dias: [1], inicio: "19:00", fin: "18:00" })).ok).toBe(false);
    expect((await addSchedule(ctx, { serviceId: yoga, dias: [], inicio: "18:00", fin: "19:00" })).ok).toBe(false);
  });

  it("la base también rechaza un turno fuera de la media hora", async () => {
    const code = await pgErrorCode(() => sql`
      insert into service_schedules (id, tenant_id, service_id, weekday, start_time, end_time)
      values (${uuidv7()}, ${tenant}, ${yoga}, 5, '18:15', '19:15')`);
    expect(code).toBe("23514");
  });

  // -------------------------------------------------------------------------
  // Reservar con turnos
  // -------------------------------------------------------------------------

  it("se reserva en un turno publicado", async () => {
    expect((await reservarYoga(MARTES, "18:00", "19:00")).ok).toBe(true);
    expect((await reservarYoga(JUEVES, "18:00", "19:00")).ok).toBe(true);
  });

  it("fuera de los turnos, se rechaza y dice cuáles hay ese día", async () => {
    const r = await reservarYoga(MARTES, "17:00", "18:00");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/el martes hay: 18:00–19:00, 19:00–20:00/i);
  });

  it("un día sin turnos lo dice", async () => {
    const r = await reservarYoga(MIERCOLES, "18:00", "19:00");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no tiene turnos los miércoles/i);
  });

  it("el día sale de la fecha local, no de UTC", async () => {
    // Martes 21:00–22:00 en Caracas es miércoles 01:00–02:00 en UTC. Si el
    // día se calculara desde el instante en el servidor, se rechazaría.
    expect((await addSchedule(ctx, { serviceId: yoga, dias: [2], inicio: "21:00", fin: "22:00" })).ok).toBe(true);
    expect((await reservarYoga(MARTES, "21:00", "22:00")).ok).toBe(true);
  });

  it("un servicio sin turnos se sigue reservando libre", async () => {
    const r = await createBooking(ctx, {
      serviceId: libre,
      resourceId: box,
      rango: { unidad: "hora", fecha: MIERCOLES, inicio: "07:30", fin: "09:00" },
      holderName: "Libre",
    });
    expect(r.ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Cambiar el horario no invalida lo reservado
  // -------------------------------------------------------------------------

  it("quitar un turno no toca las reservas hechas, y deja de ofrecerlo", async () => {
    const antes = await reservarYoga("2029-01-09", "19:00", "20:00", "Reservó antes");
    expect(antes.ok).toBe(true);
    if (!antes.ok) return;

    const [turno] = await sql`select id from service_schedules
      where service_id = ${yoga} and weekday = 2 and start_time = '19:00'`;
    expect((await removeSchedule(ctx, { id: turno.id })).ok).toBe(true);

    // La reserva sigue ahí.
    const [fila] = await sql`select status from bookings where id = ${antes.id}`;
    expect(fila.status).toBe("reservada");

    // Pero ese turno ya no se ofrece.
    expect((await reservarYoga("2029-01-16", "19:00", "20:00")).ok).toBe(false);

    // Y la reserva vieja se puede corregir sin mover las horas, aunque su
    // turno ya no exista.
    const corregir = await updateBooking(ctx, {
      id: antes.id,
      resourceId: sala,
      rango: { unidad: "hora", fecha: "2029-01-09", inicio: "19:00", fin: "20:00" },
      holderName: "Reservó antes",
      holderPhone: "0414-1234567",
    });
    expect(corregir.ok).toBe(true);
  });

  it("modificar las horas sí exige un turno", async () => {
    const r = await reservarYoga("2029-01-23", "18:00", "19:00", "Se mueve");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // A una hora sin turno, no.
    const mal = await updateBooking(ctx, {
      id: r.id,
      resourceId: sala,
      rango: { unidad: "hora", fecha: "2029-01-23", inicio: "17:00", fin: "18:00" },
      holderName: "Se mueve",
    });
    expect(mal.ok).toBe(false);

    // Al turno del jueves, sí.
    const bien = await updateBooking(ctx, {
      id: r.id,
      resourceId: sala,
      rango: { unidad: "hora", fecha: "2029-01-25", inicio: "18:00", fin: "19:00" },
      holderName: "Se mueve",
    });
    expect(bien.ok).toBe(true);
  });

  it("sin turnos que queden, el servicio vuelve a reservarse libre", async () => {
    const turnos = await sql`select id from service_schedules where service_id = ${yoga}`;
    for (const t of turnos) {
      expect((await removeSchedule(ctx, { id: t.id })).ok).toBe(true);
    }
    expect((await reservarYoga(MIERCOLES, "06:00", "07:00")).ok).toBe(true);
  });

  it("no se pasa a 'por noche' un servicio con turnos", async () => {
    expect((await addSchedule(ctx, { serviceId: libre, dias: [1], inicio: "08:00", fin: "09:00" })).ok).toBe(true);
    // Tiene reservas, así que tampoco podría por eso; se prueba con uno nuevo.
    const nuevo = uuidv7();
    await sql`insert into services (id, tenant_id, name, category_id, price, currency, booking_unit) values
      (${nuevo}, ${tenant}, 'Sin reservas', ${catServ}, '5.00', 'USD', 'hora')`;
    await tarifasDeSiempre(sql, tenant);
    expect((await addSchedule(ctx, { serviceId: nuevo, dias: [1], inicio: "08:00", fin: "09:00" })).ok).toBe(true);

    const r = await configureServiceBooking(ctx, { serviceId: nuevo, unidad: "noche" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/horarios fijos/i);
  });

  it("otro cliente no ve ni toca los turnos", async () => {
    const [turno] = await sql`select id from service_schedules where service_id = ${libre} limit 1`;
    const r = await removeSchedule({ tenantId: otro, userId: user }, { id: turno.id });
    expect(r.ok).toBe(false);
    expect(await listBookableServices(otro)).toEqual([]);
  });
});
