import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  cancelBooking,
  configureServiceBooking,
  createBooking,
  createResource,
  setWeekSchedule,
  updateBooking,
  updateResource,
} from "@/lib/reservas/register";
import {
  bookingsInWindow,
  listBookableServices,
  listServicesForSetup,
} from "@/lib/reservas/queries";
import {
  cantidad,
  cumpleHorario,
  esTodoElDia,
  franjasTexto,
  horasEnTramos,
} from "@/lib/reservas/rango";

/**
 * Lo que la página de cada servicio necesita del servidor:
 * - reservar y abrir hasta las 24:00 ("todo el día");
 * - guardar la semana entera de una vez (`setWeekSchedule`);
 * - editar un recurso entero (`updateResource`), todo o nada.
 */

const tramo = (fecha: string, inicio: string, fin: string) => ({
  unidad: "hora" as const,
  fecha,
  inicio,
  fin,
});

describe("hasta las 24:00", () => {
  it("24:00 vale como fin, no como inicio", () => {
    const r = cantidad(tramo("2030-03-12", "23:00", "24:00"), { unit: "hora", minutes: null });
    expect(r.ok && r.qty).toBe("1");
    expect(cantidad(tramo("2030-03-12", "24:00", "24:00"), { unit: "hora", minutes: null }).ok).toBe(
      false,
    );
    expect(cantidad(tramo("2030-03-12", "23:00", "24:30"), { unit: "hora", minutes: null }).ok).toBe(
      false,
    );
  });

  it("todo el día es una franja de 00:00 a 24:00, y cabe cualquier tramo", () => {
    const dia = [{ id: "x", weekday: 2, start: "00:00", end: "24:00" }];
    expect(esTodoElDia(dia)).toBe(true);
    expect(franjasTexto(dia)).toBe("todo el día");
    expect(cumpleHorario("atencion", dia, tramo("2030-03-12", "22:30", "24:00"))).toBe(true);
  });

  it("las horas para elegir van de media en media y llegan a 24:00", () => {
    expect(horasEnTramos(23 * 60)).toEqual(["23:00", "23:30", "24:00"]);
    expect(horasEnTramos(0, 60)).toEqual(["00:00", "00:30", "01:00"]);
    // Desde una hora que no es en punto, empieza en el siguiente tramo.
    expect(horasEnTramos(14 * 60 + 15, 15 * 60)).toEqual(["14:30", "15:00"]);
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
const cancha = uuidv7();
const clase = uuidv7();
const sala = uuidv7();
let cancha1 = "";
let salon = "";
let salaA = "";

describe.skipIf(!hasDb)("la página del servicio en la base", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug, timezone) values (${tenant}, 'Página', ${"sp-" + tenant.slice(-12)}, ${TZ})`;
    await sql`insert into users (id, email) values (${user}, ${`sp-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label) values
      (${catServ}, ${tenant}, 'service_category', 'serv', 'Servicios')`;
    await sql`insert into services (id, tenant_id, name, category_id, price, currency) values
      (${cancha}, ${tenant}, 'Cancha', ${catServ}, '10.00', 'USD'),
      (${clase}, ${tenant}, 'Clase', ${catServ}, '5.00', 'USD'),
      (${sala}, ${tenant}, 'Sala', ${catServ}, '30.00', 'USD')`;

    const a = await configureServiceBooking(ctx, { serviceId: cancha, unidad: "hora" });
    const b = await configureServiceBooking(ctx, {
      serviceId: clase,
      unidad: "hora",
      compartido: true,
    });
    const k1 = await createResource(ctx, { serviceId: cancha, name: "Cancha 1" });
    const s1 = await createResource(ctx, { serviceId: clase, name: "Salón", capacity: 10 });
    const c = await configureServiceBooking(ctx, { serviceId: sala, unidad: "noche" });
    const sa = await createResource(ctx, { serviceId: sala, name: "Sala A", capacity: 20 });
    if (!a.ok || !b.ok || !c.ok || !k1.ok || !s1.ok || !sa.ok) throw new Error("No se pudo preparar");
    cancha1 = k1.id;
    salon = s1.id;
    salaA = sa.id;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  async function tarifaHora(serviceId: string) {
    const s = (await listBookableServices(tenant)).find((x) => x.id === serviceId)!;
    return s.tarifas.find((t) => t.unit === "hora")!.id;
  }

  async function reservar(fecha: string, inicio: string, fin: string, holderName = "Ana") {
    return createBooking(ctx, {
      serviceId: cancha,
      resourceId: cancha1,
      rateId: await tarifaHora(cancha),
      rango: tramo(fecha, inicio, fin),
      holderName,
    });
  }

  async function semana(serviceId: string) {
    const [s] = await listServicesForSetup(tenant, { serviceId });
    return s.turnos.map((t) => `${t.weekday} ${t.start}-${t.end}`).sort();
  }

  it("guarda la semana entera, con un día todo el día", async () => {
    const r = await setWeekSchedule(ctx, {
      serviceId: cancha,
      franjas: [
        { weekday: 1, inicio: "08:00", fin: "12:00" },
        { weekday: 1, inicio: "14:00", fin: "20:00" },
        { weekday: 6, inicio: "00:00", fin: "24:00" },
      ],
    });
    expect(r).toEqual({ ok: true });
    expect(await semana(cancha)).toEqual(["1 08:00-12:00", "1 14:00-20:00", "6 00:00-24:00"]);
  });

  it("guardar otra vez reemplaza, no suma", async () => {
    const r = await setWeekSchedule(ctx, {
      serviceId: cancha,
      franjas: [
        { weekday: 1, inicio: "00:00", fin: "24:00" },
        { weekday: 6, inicio: "00:00", fin: "24:00" },
      ],
    });
    expect(r.ok).toBe(true);
    expect(await semana(cancha)).toEqual(["1 00:00-24:00", "6 00:00-24:00"]);
  });

  it("rechaza franjas que se cruzan, y no toca lo guardado", async () => {
    const r = await setWeekSchedule(ctx, {
      serviceId: cancha,
      franjas: [
        { weekday: 2, inicio: "08:00", fin: "12:00" },
        { weekday: 2, inicio: "11:00", fin: "13:00" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("se cruzan");
    expect(await semana(cancha)).toEqual(["1 00:00-24:00", "6 00:00-24:00"]);
  });

  it("un sábado todo el día se reserva hasta la medianoche", async () => {
    // 2030-03-16 es sábado.
    const r = await reservar("2030-03-16", "23:00", "24:00");
    expect(r.ok).toBe(true);
    // Choca con otra que pisa la última media hora: es el mismo instante.
    expect((await reservar("2030-03-16", "23:30", "24:00")).ok).toBe(false);
    // El domingo no tiene horario: ni a primera hora se reserva.
    const domingo = await reservar("2030-03-17", "00:00", "01:00");
    expect(domingo.ok).toBe(false);
  });

  it("se lee de vuelta como 24:00 del mismo día, no 00:00 del siguiente", async () => {
    const filas = await bookingsInWindow(tenant, TZ, { desde: "2030-03-16", hasta: "2030-03-18" });
    const b = filas.find((x) => x.serviceId === cancha && x.inicio === "2030-03-16T23:00");
    expect(b?.fin).toBe("2030-03-16T24:00");
  });

  it("modificar sin tocar las horas no las da por cambiadas", async () => {
    const filas = await bookingsInWindow(tenant, TZ, { desde: "2030-03-16", hasta: "2030-03-17" });
    const b = filas.find((x) => x.serviceId === cancha)!;
    // Sin horario el sábado, cambiar las horas se rechazaría; el nombre no.
    await setWeekSchedule(ctx, {
      serviceId: cancha,
      franjas: [{ weekday: 1, inicio: "08:00", fin: "12:00" }],
    });
    const r = await updateBooking(ctx, {
      id: b.id,
      resourceId: cancha1,
      rango: tramo("2030-03-16", "23:00", "24:00"),
      holderName: "Ana María",
    });
    expect(r.ok).toBe(true);
  });

  it("vaciar la semana vuelve a 'sin horario'", async () => {
    expect((await setWeekSchedule(ctx, { serviceId: cancha, franjas: [] })).ok).toBe(true);
    expect(await semana(cancha)).toEqual([]);
  });

  it("un recurso se renombra y se le ponen notas", async () => {
    const r = await updateResource(ctx, {
      id: cancha1,
      name: "Cancha techada",
      notes: "Con luz",
      capacity: 4,
    });
    expect(r.ok).toBe(true);
    const [s] = await listServicesForSetup(tenant, { serviceId: cancha });
    expect(s.resources[0]).toMatchObject({ name: "Cancha techada", notes: "Con luz", capacity: 4 });
  });

  it("si la capacidad no se puede bajar, tampoco cambia el nombre", async () => {
    const r1 = await createBooking(ctx, {
      serviceId: clase,
      resourceId: salon,
      rateId: await tarifaHora(clase),
      rango: tramo("2030-04-02", "18:00", "19:00"),
      personas: 6,
      holderName: "Grupo",
    });
    expect(r1.ok).toBe(true);

    const r = await updateResource(ctx, { id: salon, name: "Salón grande", notes: "", capacity: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("6 cupos");

    const [s] = await listServicesForSetup(tenant, { serviceId: clase });
    expect(s.resources[0]).toMatchObject({ name: "Salón", capacity: 10 });
  });

  // -------------------------------------------------------------------------
  // Cambiar cómo se reserva con reservas viejas
  // -------------------------------------------------------------------------

  const enSala = (desde: string, hasta: string, holderName: string, personas = 1) =>
    createBooking(ctx, {
      serviceId: sala,
      resourceId: salaA,
      rango: { unidad: "noche", desde, hasta },
      personas,
      holderName,
    });

  async function pendientesDeSala() {
    const [s] = await listServicesForSetup(tenant, { serviceId: sala });
    return s.pendientes;
  }

  it("con reservas canceladas o ya pasadas, sí se cambia el modo", async () => {
    // Una que ya pasó (nadie la cerró) y una futura que se canceló.
    expect((await enSala("2020-01-01", "2020-01-03", "Pasada")).ok).toBe(true);
    const futura = await enSala("2034-05-01", "2034-05-03", "Cancelada");
    expect(futura.ok).toBe(true);
    if (!futura.ok) return;
    expect(await pendientesDeSala()).toBe(1);
    expect((await cancelBooking(ctx, { id: futura.id })).ok).toBe(true);
    expect(await pendientesDeSala()).toBe(0);

    const r = await configureServiceBooking(ctx, { serviceId: sala, unidad: "noche", compartido: true });
    expect(r).toEqual({ ok: true });
  });

  it("una reserva del modo nuevo no puede caer encima de una vieja del otro", async () => {
    // La de 2020 es exclusiva: ni el EXCLUDE ni el trigger de cupos la ven.
    const r = await enSala("2020-01-02", "2020-01-04", "Encima", 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("de cuando el servicio era exclusivo");
    // Al lado, sí.
    expect((await enSala("2020-01-03", "2020-01-05", "Al lado", 2)).ok).toBe(true);
  });

  it("moverla encima de una del otro modo tampoco", async () => {
    const filas = await bookingsInWindow(tenant, TZ, { desde: "2020-01-03", hasta: "2020-01-04" });
    const alLado = filas.find((b) => b.holderName === "Al lado")!;
    const r = await updateBooking(ctx, {
      id: alLado.id,
      resourceId: salaA,
      rango: { unidad: "noche", desde: "2020-01-02", hasta: "2020-01-05" },
      holderName: "Al lado",
    });
    expect(r.ok).toBe(false);
  });

  it("al pasar de noches a horas, las reservas viejas se siguen leyendo como noches", async () => {
    const r = await configureServiceBooking(ctx, { serviceId: sala, unidad: "hora", compartido: true });
    expect(r).toEqual({ ok: true });

    const filas = await bookingsInWindow(tenant, TZ, { desde: "2020-01-01", hasta: "2020-01-02" });
    const pasada = filas.find((b) => b.holderName === "Pasada")!;
    expect(pasada).toMatchObject({
      unidad: "noche",
      inicio: "2020-01-01T00:00",
      fin: "2020-01-03T00:00",
      descripcion: "2 noches",
    });
  });

  it("con una reserva pendiente, no se cambia", async () => {
    const [s] = await listServicesForSetup(tenant, { serviceId: sala });
    const hora = s.tarifas.find((t) => t.unit === "hora")!;
    const pendiente = await createBooking(ctx, {
      serviceId: sala,
      resourceId: salaA,
      rateId: hora.id,
      rango: tramo("2034-06-01", "10:00", "12:00"),
      holderName: "Pendiente",
    });
    expect(pendiente.ok).toBe(true);
    expect(await pendientesDeSala()).toBe(1);

    const r = await configureServiceBooking(ctx, { serviceId: sala, unidad: "noche" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1 reserva pendiente/);
    // El cobro sí.
    expect(
      (await configureServiceBooking(ctx, { serviceId: sala, unidad: "hora", compartido: true, porPersona: true })).ok,
    ).toBe(true);
  });
});
