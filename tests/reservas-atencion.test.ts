import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  addRate,
  addSchedule,
  configureServiceBooking,
  createBooking,
  createResource,
  setScheduleMode,
} from "@/lib/reservas/register";
import { listBookableServices } from "@/lib/reservas/queries";
import { cumpleHorario, franjasTexto } from "@/lib/reservas/rango";

/**
 * Horario de atención.
 *
 * Lo que hay que fijar: que con franjas publicadas se reserve cualquier tramo
 * que quepa ENTERO en una (no entre dos), que un día sin franjas no se
 * atienda, que los bloques de la tarifa se midan dentro de la franja, y que
 * el mismo horario pase a leerse como turnos exactos al cambiar el modo.
 */

const tramo = (fecha: string, inicio: string, fin: string) => ({
  unidad: "hora" as const,
  fecha,
  inicio,
  fin,
});

// Martes (ISO 2): mañana y tarde.
const franjas = [
  { id: "a", weekday: 2, start: "14:00", end: "20:00" },
  { id: "b", weekday: 2, start: "08:00", end: "12:00" },
];

describe("cabe en el horario de atención", () => {
  it("vale cualquier tramo dentro de una franja", () => {
    expect(cumpleHorario("atencion", franjas, tramo("2030-03-12", "09:00", "11:30"))).toBe(true);
    expect(cumpleHorario("atencion", franjas, tramo("2030-03-12", "14:00", "20:00"))).toBe(true);
  });

  it("no vale entre dos franjas, ni pasarse del cierre", () => {
    expect(cumpleHorario("atencion", franjas, tramo("2030-03-12", "11:00", "15:00"))).toBe(false);
    expect(cumpleHorario("atencion", franjas, tramo("2030-03-12", "19:00", "21:00"))).toBe(false);
  });

  it("un día sin franjas no se atiende; sin horario, todo vale", () => {
    expect(cumpleHorario("atencion", franjas, tramo("2030-03-11", "09:00", "10:00"))).toBe(false);
    expect(cumpleHorario("atencion", [], tramo("2030-03-11", "06:00", "07:00"))).toBe(true);
  });

  it("las mismas filas como turnos exactos solo aceptan el tramo entero", () => {
    expect(cumpleHorario("turnos", franjas, tramo("2030-03-12", "08:00", "12:00"))).toBe(true);
    expect(cumpleHorario("turnos", franjas, tramo("2030-03-12", "09:00", "11:30"))).toBe(false);
  });

  it("dice las franjas de un día como se leen", () => {
    expect(franjasTexto([franjas[1], franjas[0]])).toBe("de 08:00 a 12:00 y de 14:00 a 20:00");
    expect(franjasTexto([franjas[1]])).toBe("de 08:00 a 12:00");
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
let cancha1 = "";
let tanda = "";

describe.skipIf(!hasDb)("horario de atención en la base", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug, timezone) values (${tenant}, 'Atención', ${"at-" + tenant.slice(-12)}, ${TZ})`;
    await sql`insert into users (id, email) values (${user}, ${`at-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label) values
      (${catServ}, ${tenant}, 'service_category', 'serv', 'Servicios')`;
    await sql`insert into services (id, tenant_id, name, category_id, price, currency) values
      (${cancha}, ${tenant}, 'Cancha', ${catServ}, '10.00', 'USD')`;

    const r = await configureServiceBooking(ctx, { serviceId: cancha, unidad: "hora" });
    const k1 = await createResource(ctx, { serviceId: cancha, name: "Cancha 1" });
    const t = await addRate(ctx, { serviceId: cancha, unit: "bloque", minutes: 240, price: "35", currency: "USD" });
    // Lunes a viernes, mañana y tarde.
    const m = await addSchedule(ctx, { serviceId: cancha, dias: [1, 2, 3, 4, 5], inicio: "08:00", fin: "12:00" });
    const tarde = await addSchedule(ctx, { serviceId: cancha, dias: [1, 2, 3, 4, 5], inicio: "14:00", fin: "22:00" });
    if (!r.ok || !k1.ok || !t.ok || !m.ok || !tarde.ok) throw new Error("No se pudo preparar la cancha");
    cancha1 = k1.id;
    tanda = t.id;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  async function reservar(fecha: string, inicio: string, fin: string, rateId?: string) {
    const servicio = (await listBookableServices(tenant)).find((s) => s.id === cancha)!;
    return createBooking(ctx, {
      serviceId: cancha,
      resourceId: cancha1,
      rateId: rateId ?? servicio.tarifas.find((x) => x.unit === "hora")!.id,
      rango: tramo(fecha, inicio, fin),
      holderName: `${fecha} ${inicio}`,
    });
  }

  it("un servicio nuevo lee sus horarios como franjas de atención", async () => {
    const servicio = (await listBookableServices(tenant)).find((s) => s.id === cancha)!;
    expect(servicio.horario).toBe("atencion");
  });

  it("se reserva cualquier tramo dentro de una franja, sin publicar cada combinación", async () => {
    expect((await reservar("2030-03-12", "09:00", "10:30")).ok).toBe(true);
    expect((await reservar("2030-03-12", "15:30", "18:00")).ok).toBe(true);
  });

  it("fuera de la franja se rechaza y dice el horario de ese día", async () => {
    const r = await reservar("2030-03-12", "21:00", "23:00");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("de 08:00 a 12:00 y de 14:00 a 22:00");
  });

  it("entre la mañana y la tarde no cabe", async () => {
    expect((await reservar("2030-03-13", "11:00", "15:00")).ok).toBe(false);
  });

  it("un día sin franjas no se atiende", async () => {
    const r = await reservar("2030-03-16", "09:00", "10:00");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no atiende los sábados/);
  });

  it("los bloques de la tarifa se miden dentro de la franja", async () => {
    // Dos tandas de 4 horas en la tarde de 8.
    expect((await reservar("2030-03-14", "14:00", "22:00", tanda)).ok).toBe(true);
    // Una tanda de 10 a 14 cruza el mediodía cerrado.
    expect((await reservar("2030-03-15", "10:00", "14:00", tanda)).ok).toBe(false);
  });

  it("como turnos exactos, el mismo horario solo acepta las franjas enteras", async () => {
    expect((await setScheduleMode(ctx, { serviceId: cancha, modo: "turnos" })).ok).toBe(true);
    try {
      expect((await reservar("2030-03-18", "09:00", "10:00")).ok).toBe(false);
      expect((await reservar("2030-03-18", "08:00", "12:00")).ok).toBe(true);
    } finally {
      await setScheduleMode(ctx, { serviceId: cancha, modo: "atencion" });
    }
  });
});
