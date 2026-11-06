import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  addRate,
  configureServiceBooking,
  createBooking,
  createResource,
  setWeekSchedule,
  updateBooking,
} from "@/lib/reservas/register";
import { bookingsInWindow, listBookableServices } from "@/lib/reservas/queries";
import {
  bordesLocales,
  cantidad,
  cumpleHorario,
  normalizarRango,
  sumarMinutos,
  tramosPorDia,
  type RangoHoras,
} from "@/lib/reservas/rango";

/**
 * Reservas por horas que cruzan la medianoche: la habitación de 22:00 a
 * 10:00 del día siguiente, o un bloque de 24 horas desde las 09:00.
 *
 * Lo que hay que fijar: que la forma canónica sea una sola (para que lo
 * pedido y lo guardado se comparen como texto), que la cantidad y los bloques
 * se midan a través de días, que el horario se exija CADA día, y que la base
 * guarde y devuelva el mismo rango.
 */

const h = (fecha: string, inicio: string, fin: string, fechaFin?: string): RangoHoras => ({
  unidad: "hora",
  fecha,
  inicio,
  fin,
  ...(fechaFin ? { fechaFin } : {}),
});
const porHora = { unit: "hora" as const, minutes: null };

describe("la forma canónica", () => {
  it("sin fecha de salida si termina el mismo día", () => {
    expect(normalizarRango(h("2030-03-12", "14:00", "16:00", "2030-03-12"))).toEqual(
      h("2030-03-12", "14:00", "16:00"),
    );
  });

  it("las 00:00 de un día son las 24:00 del anterior", () => {
    expect(normalizarRango(h("2030-03-12", "22:00", "00:00", "2030-03-13"))).toEqual(
      h("2030-03-12", "22:00", "24:00"),
    );
    expect(normalizarRango(h("2030-03-12", "09:00", "00:00", "2030-03-14"))).toEqual(
      h("2030-03-12", "09:00", "24:00", "2030-03-13"),
    );
  });

  it("los bordes llevan la fecha de salida", () => {
    expect(bordesLocales(h("2030-03-12", "22:00", "10:00", "2030-03-13"))).toEqual({
      inicio: "2030-03-12T22:00",
      fin: "2030-03-13T10:00",
    });
  });

  it("sumar minutos cruza días y termina en 24:00 en vez de 00:00", () => {
    expect(sumarMinutos("2030-03-12", "14:00", 12 * 60)).toEqual({
      fechaFin: "2030-03-13",
      fin: "02:00",
    });
    expect(sumarMinutos("2030-03-12", "00:00", 24 * 60)).toEqual({
      fechaFin: "2030-03-12",
      fin: "24:00",
    });
    expect(sumarMinutos("2030-03-12", "09:00", 48 * 60)).toEqual({
      fechaFin: "2030-03-14",
      fin: "09:00",
    });
  });
});

describe("cantidad a través de la medianoche", () => {
  it("de 22:00 a 10:00 del día siguiente son 12 horas", () => {
    expect(cantidad(h("2030-03-12", "22:00", "10:00", "2030-03-13"), porHora)).toMatchObject({
      ok: true,
      qty: "12",
    });
  });

  it("un bloque de 24 horas desde las 09:00 es uno", () => {
    const r = cantidad(h("2030-03-12", "09:00", "09:00", "2030-03-13"), {
      unit: "bloque",
      minutes: 24 * 60,
    });
    expect(r).toMatchObject({ ok: true, qty: "1" });
  });

  it("sin fecha de salida, una hora de fin anterior sigue siendo un error", () => {
    expect(cantidad(h("2030-03-12", "22:00", "01:00"), porHora).ok).toBe(false);
  });

  it("la salida no puede ser antes de la entrada, ni pasar de 7 días", () => {
    expect(cantidad(h("2030-03-12", "10:00", "09:00", "2030-03-11"), porHora).ok).toBe(false);
    expect(cantidad(h("2030-03-12", "10:00", "11:00", "2030-03-19"), porHora).ok).toBe(false);
    expect(cantidad(h("2030-03-12", "10:00", "10:00", "2030-03-19"), porHora).ok).toBe(true);
  });
});

describe("el horario se exige cada día", () => {
  // Martes (2) abierto hasta las 24:00; miércoles (3) desde las 06:00.
  const turnos = [
    { id: "a", weekday: 2, start: "08:00", end: "24:00" },
    { id: "b", weekday: 3, start: "06:00", end: "20:00" },
  ];

  it("se parte en tramos de un día", () => {
    expect(tramosPorDia(h("2030-03-12", "22:00", "10:00", "2030-03-13"))).toEqual([
      h("2030-03-12", "22:00", "24:00"),
      h("2030-03-13", "00:00", "10:00"),
    ]);
  });

  it("no cabe si el día de salida abre después", () => {
    expect(cumpleHorario("atencion", turnos, h("2030-03-12", "22:00", "10:00", "2030-03-13"))).toBe(
      false,
    );
  });

  it("cabe si cada día cubre su parte", () => {
    const todoMiercoles = [...turnos.slice(0, 1), { id: "c", weekday: 3, start: "00:00", end: "24:00" }];
    expect(
      cumpleHorario("atencion", todoMiercoles, h("2030-03-12", "22:00", "10:00", "2030-03-13")),
    ).toBe(true);
  });

  it("ningún turno exacto cruza la medianoche", () => {
    expect(cumpleHorario("turnos", turnos, h("2030-03-12", "22:00", "10:00", "2030-03-13"))).toBe(
      false,
    );
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
const hab = uuidv7();
let h302 = "";
let noche12 = "";
let dia24 = "";

describe.skipIf(!hasDb)("cruzar la medianoche en la base", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug, timezone) values (${tenant}, 'Medianoche', ${"mn-" + tenant.slice(-12)}, ${TZ})`;
    await sql`insert into users (id, email) values (${user}, ${`mn-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label) values
      (${catServ}, ${tenant}, 'service_category', 'serv', 'Servicios')`;
    await sql`insert into services (id, tenant_id, name, category_id, price, currency) values
      (${hab}, ${tenant}, 'Hab Luxury', ${catServ}, '10.00', 'USD')`;

    const a = await configureServiceBooking(ctx, { serviceId: hab, unidad: "hora" });
    const r = await createResource(ctx, { serviceId: hab, name: "302", capacity: 2 });
    const n = await addRate(ctx, { serviceId: hab, unit: "bloque", minutes: 720, price: "150", currency: "USD" });
    const d = await addRate(ctx, { serviceId: hab, unit: "bloque", minutes: 1440, price: "200", currency: "USD" });
    if (!a.ok || !r.ok || !n.ok || !d.ok) throw new Error("No se pudo preparar");
    h302 = r.id;
    noche12 = n.id;
    dia24 = d.id;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  async function tarifaHora() {
    const s = (await listBookableServices(tenant)).find((x) => x.id === hab)!;
    return s.tarifas.find((t) => t.unit === "hora")!.id;
  }

  const reservar = (rango: RangoHoras, rateId: string, holderName = "Huésped") =>
    createBooking(ctx, { serviceId: hab, resourceId: h302, rateId, rango, holderName });

  it("de 22:00 a 10:00 del día siguiente, por horas", async () => {
    const r = await reservar(h("2030-04-01", "22:00", "10:00", "2030-04-02"), await tarifaHora());
    expect(r).toMatchObject({ ok: true, qty: "12", total: "120.00" });
  });

  it("se guarda en los instantes de Caracas y se lee igual", async () => {
    const [fila] = await sql<{ desde: string; hasta: string }[]>`
      select to_char(lower(period) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as desde,
             to_char(upper(period) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as hasta
      from bookings where tenant_id = ${tenant} and holder_name = 'Huésped'`;
    // Caracas es UTC-4.
    expect(fila).toEqual({ desde: "2030-04-02 02:00", hasta: "2030-04-02 14:00" });

    const filas = await bookingsInWindow(tenant, TZ, { desde: "2030-04-02", hasta: "2030-04-03" });
    expect(filas.find((b) => b.holderName === "Huésped")).toMatchObject({
      inicio: "2030-04-01T22:00",
      fin: "2030-04-02T10:00",
    });
  });

  it("choca con una que empieza la mañana siguiente antes de la salida", async () => {
    const r = await reservar(h("2030-04-02", "09:00", "11:00"), await tarifaHora(), "Mañana");
    expect(r.ok).toBe(false);
    expect((await reservar(h("2030-04-02", "10:00", "11:00"), await tarifaHora(), "Mañana")).ok).toBe(
      true,
    );
  });

  it("bloques: uno de 12 h desde las 14:00 y uno de 24 h desde las 09:00", async () => {
    const doce = await reservar(h("2030-04-05", "14:00", "02:00", "2030-04-06"), noche12, "Noche");
    expect(doce).toMatchObject({ ok: true, qty: "1", total: "150.00" });
    const dia = await reservar(h("2030-04-08", "09:00", "09:00", "2030-04-09"), dia24, "Día");
    expect(dia).toMatchObject({ ok: true, qty: "1", total: "200.00" });
  });

  it("a la medianoche se guarda y se lee como 24:00 del día anterior", async () => {
    // Pedida como "00:00 del 11": la forma canónica es "24:00 del 10".
    const r = await reservar(h("2030-04-10", "12:00", "00:00", "2030-04-11"), noche12, "Mediodía");
    expect(r.ok).toBe(true);
    const filas = await bookingsInWindow(tenant, TZ, { desde: "2030-04-10", hasta: "2030-04-11" });
    expect(filas.find((b) => b.holderName === "Mediodía")?.fin).toBe("2030-04-10T24:00");
  });

  it("modificar sin tocar las horas no las da por cambiadas, aunque haya horario", async () => {
    const filas = await bookingsInWindow(tenant, TZ, { desde: "2030-04-01", hasta: "2030-04-02" });
    const b = filas.find((x) => x.holderName === "Huésped")!;
    // Con un horario que ya no la admite: el martes cierra de 08:00 a 12:00.
    await setWeekSchedule(ctx, {
      serviceId: hab,
      franjas: [
        { weekday: 1, inicio: "00:00", fin: "24:00" },
        { weekday: 2, inicio: "00:00", fin: "08:00" },
        { weekday: 2, inicio: "12:00", fin: "24:00" },
      ],
    });
    const r = await updateBooking(ctx, {
      id: b.id,
      resourceId: h302,
      rango: h("2030-04-01", "22:00", "10:00", "2030-04-02"),
      holderName: "Huésped Pérez",
    });
    expect(r.ok).toBe(true);
  });

  it("con horario, cada día tiene que cubrir su parte", async () => {
    // 2030-04-15 es lunes (todo el día) y el 16, martes (hasta las 08:00).
    const fuera = await reservar(h("2030-04-15", "22:00", "10:00", "2030-04-16"), await tarifaHora(), "Fuera");
    expect(fuera.ok).toBe(false);
    if (!fuera.ok) expect(fuera.error).toMatch(/martes/);
    const dentro = await reservar(h("2030-04-15", "22:00", "08:00", "2030-04-16"), await tarifaHora(), "Dentro");
    expect(dentro.ok).toBe(true);
  });
});
