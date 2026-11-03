import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  addRate,
  archiveRate,
  configureServiceBooking,
  createBooking,
  createResource,
  updateBooking,
  updateRate,
} from "@/lib/reservas/register";
import { listBookableServices, listBookings } from "@/lib/reservas/queries";
import { cantidad, describirCantidad, sumarMeses } from "@/lib/reservas/rango";

/**
 * Tarifas por servicio.
 *
 * Lo que hay que fijar: que cada unidad cuente bien (semanas y meses exactos,
 * días incluidos, bloques completos), que la reserva congele su tarifa y su
 * cantidad, que una semana y una noche del mismo recurso choquen igual que
 * dos noches, y que un servicio reservable nunca se quede sin tarifas.
 */

// ---------------------------------------------------------------------------
// Aritmética pura
// ---------------------------------------------------------------------------

const fechas = (desde: string, hasta: string) => ({ unidad: "noche" as const, desde, hasta });
const horas = (fecha: string, inicio: string, fin: string) => ({
  unidad: "hora" as const,
  fecha,
  inicio,
  fin,
});

describe("cuánto se cobra según la tarifa", () => {
  it("por semana: semanas completas", () => {
    const semana = { unit: "semana" as const, minutes: null };
    expect(cantidad(fechas("2030-03-01", "2030-03-15"), semana)).toMatchObject({
      qty: "2",
      descripcion: "2 semanas",
    });
    expect(cantidad(fechas("2030-03-01", "2030-03-11"), semana).ok).toBe(false);
  });

  it("por mes: del mismo día al mismo día, y fin de mes cae en el último", () => {
    const mes = { unit: "mes" as const, minutes: null };
    expect(cantidad(fechas("2030-01-10", "2030-03-10"), mes)).toMatchObject({ qty: "2" });
    // 31 de enero + 1 mes = 28 de febrero, como `+ interval '1 month'`.
    expect(sumarMeses("2027-01-31", 1)).toBe("2027-02-28");
    expect(sumarMeses("2028-01-31", 1)).toBe("2028-02-29");
    expect(sumarMeses("2027-11-30", 3)).toBe("2028-02-29");
    expect(cantidad(fechas("2027-01-31", "2027-02-28"), mes)).toMatchObject({ qty: "1" });
    expect(cantidad(fechas("2030-01-10", "2030-02-11"), mes).ok).toBe(false);
  });

  it("por día: la salida exclusiva que arma el formulario cuenta los días incluidos", () => {
    // "Del 10 al 12" llega como [10, 13): tres días.
    expect(cantidad(fechas("2030-03-10", "2030-03-13"), { unit: "dia", minutes: null })).toMatchObject({
      qty: "3",
      descripcion: "3 días",
    });
  });

  it("por bloque: bloques completos", () => {
    const tanda = { unit: "bloque" as const, minutes: 240 };
    expect(cantidad(horas("2030-03-10", "08:00", "16:00"), tanda)).toMatchObject({
      qty: "2",
      descripcion: "2 bloques de 4 h",
    });
    expect(cantidad(horas("2030-03-10", "08:00", "14:00"), tanda).ok).toBe(false);
  });

  it("una tarifa de otro grano no sirve", () => {
    expect(cantidad(fechas("2030-03-10", "2030-03-12"), { unit: "hora", minutes: null }).ok).toBe(false);
    expect(cantidad(horas("2030-03-10", "08:00", "09:00"), { unit: "noche", minutes: null }).ok).toBe(false);
  });

  it("sin tarifa cuenta como siempre: noches u horas", () => {
    expect(cantidad(fechas("2030-03-10", "2030-03-12"))).toMatchObject({ qty: "2" });
    expect(cantidad(horas("2030-03-10", "08:00", "09:30"))).toMatchObject({ qty: "1.5" });
  });

  it("describe una cantidad guardada como la devuelve la base", () => {
    expect(describirCantidad("2.000", { unit: "semana", minutes: null })).toBe("2 semanas");
    expect(describirCantidad("1.500", { unit: "hora", minutes: null })).toBe("1,5 horas");
    expect(describirCantidad("1.000", { unit: "mes", minutes: null })).toBe("1 mes");
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
const cabana = uuidv7();
const cancha = uuidv7();
let cabana1 = "";
let cancha1 = "";
let porNoche = "";
let porSemana = "";
let porMes = "";
let porHora = "";
let tanda = "";

async function nuevaTarifa(input: Parameters<typeof addRate>[1]): Promise<string> {
  const r = await addRate(ctx, input);
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

async function filaDe(id: string) {
  const [b] = await sql<{ rate_unit: string; qty: string; unit_price: string; currency: string }[]>`
    select rate_unit, qty, unit_price, currency from bookings where id = ${id}`;
  return b;
}

describe.skipIf(!hasDb)("tarifas por servicio", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug, timezone) values (${tenant}, 'Tarifas', ${"rt-" + tenant.slice(-12)}, ${TZ})`;
    await sql`insert into users (id, email) values (${user}, ${`rt-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label) values
      (${catServ}, ${tenant}, 'service_category', 'serv', 'Servicios')`;
    // Sin booking_unit: se vuelven reservables por la acción, como en la pantalla.
    await sql`insert into services (id, tenant_id, name, category_id, price, currency) values
      (${cabana}, ${tenant}, 'Cabaña', ${catServ}, '40.00', 'USD'),
      (${cancha}, ${tenant}, 'Cancha', ${catServ}, '10.00', 'USD')`;

    for (const [serviceId, unidad] of [
      [cabana, "noche"],
      [cancha, "hora"],
    ] as const) {
      const r = await configureServiceBooking(ctx, { serviceId, unidad });
      if (!r.ok) throw new Error(r.error);
    }
    const c1 = await createResource(ctx, { serviceId: cabana, name: "Cabaña 1" });
    const k1 = await createResource(ctx, { serviceId: cancha, name: "Cancha 1" });
    if (!c1.ok || !k1.ok) throw new Error("No se pudieron crear los recursos");
    cabana1 = c1.id;
    cancha1 = k1.id;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  it("al volverse reservable, el servicio recibe su tarifa de siempre con su precio", async () => {
    const servicios = await listBookableServices(tenant);
    const deCabana = servicios.find((s) => s.id === cabana)!.tarifas;
    const deCancha = servicios.find((s) => s.id === cancha)!.tarifas;
    expect(deCabana).toMatchObject([{ unit: "noche", price: "40.00", currency: "USD" }]);
    expect(deCancha).toMatchObject([{ unit: "hora", price: "10.00", currency: "USD" }]);
    porNoche = deCabana[0].id;
    porHora = deCancha[0].id;
  });

  it("con una sola tarifa no hace falta elegirla", async () => {
    const r = await createBooking(ctx, {
      serviceId: cabana,
      resourceId: cabana1,
      rango: fechas("2030-01-05", "2030-01-07"),
      holderName: "Sin elegir",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.total).toBe("80.00");
    expect(await filaDe(r.id)).toMatchObject({ rate_unit: "noche", qty: "2.000" });
  });

  it("agrega tarifas de su grano, y rechaza las de otro", async () => {
    porSemana = await nuevaTarifa({ serviceId: cabana, unit: "semana", price: "230", currency: "USD" });
    porMes = await nuevaTarifa({ serviceId: cabana, unit: "mes", price: "800", currency: "USD" });
    tanda = await nuevaTarifa({
      serviceId: cancha,
      unit: "bloque",
      minutes: 240,
      label: "Tanda",
      price: "35",
      currency: "USD",
    });

    const otraGrano = await addRate(ctx, { serviceId: cabana, unit: "hora", price: "5", currency: "USD" });
    expect(otraGrano.ok).toBe(false);
    // Un bloque de 45 minutos no existe: todo va en tramos de 30.
    const raro = await addRate(ctx, { serviceId: cancha, unit: "bloque", minutes: 45, price: "5", currency: "USD" });
    expect(raro.ok).toBe(false);
  });

  it("con varias tarifas hay que elegir una", async () => {
    const r = await createBooking(ctx, {
      serviceId: cabana,
      resourceId: cabana1,
      rango: fechas("2030-02-01", "2030-02-02"),
      holderName: "Sin elegir",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/elige una tarifa/i);
  });

  it("por semana y por mes: precio y cantidad de la tarifa, congelados en la reserva", async () => {
    const semanas = await createBooking(ctx, {
      serviceId: cabana,
      resourceId: cabana1,
      rateId: porSemana,
      rango: fechas("2030-03-01", "2030-03-15"),
      holderName: "Dos semanas",
    });
    expect(semanas.ok).toBe(true);
    if (!semanas.ok) return;
    expect(semanas.total).toBe("460.00");
    expect(await filaDe(semanas.id)).toMatchObject({ rate_unit: "semana", qty: "2.000", unit_price: "230.00" });

    const mes = await createBooking(ctx, {
      serviceId: cabana,
      resourceId: cabana1,
      rateId: porMes,
      rango: fechas("2030-04-10", "2030-05-10"),
      holderName: "Un mes",
    });
    expect(mes.ok).toBe(true);
    if (!mes.ok) return;
    expect(mes.total).toBe("800.00");

    // Medio mes por la tarifa mensual no se puede.
    const medio = await createBooking(ctx, {
      serviceId: cabana,
      resourceId: cabana1,
      rateId: porMes,
      rango: fechas("2030-06-01", "2030-06-15"),
      holderName: "Medio mes",
    });
    expect(medio.ok).toBe(false);
  });

  it("una noche dentro de una semana ya reservada choca, como dos noches", async () => {
    const r = await createBooking(ctx, {
      serviceId: cabana,
      resourceId: cabana1,
      rateId: porNoche,
      rango: fechas("2030-03-05", "2030-03-06"),
      holderName: "Choca",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/se cruza/i);
  });

  it("el listado calcula el mismo total con la cantidad guardada", async () => {
    const { rows } = await listBookings(tenant, TZ, { q: "Un mes" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      qty: "1",
      descripcion: "1 mes",
      total: "800.00",
      saldo: "800.00",
      tarifa: { unit: "mes" },
    });
    // El filtro "debe" corre en SQL sobre la misma cantidad.
    const conSaldo = await listBookings(tenant, TZ, { q: "Un mes", conSaldo: true });
    expect(conSaldo.rows).toHaveLength(1);
  });

  it("subir el precio de una tarifa no toca las reservas hechas", async () => {
    expect((await updateRate(ctx, { id: porSemana, price: "260", currency: "USD" })).ok).toBe(true);
    const { rows } = await listBookings(tenant, TZ, { q: "Dos semanas" });
    expect(rows[0].total).toBe("460.00");
  });

  it("modificar recalcula la cantidad con la tarifa congelada", async () => {
    const { rows } = await listBookings(tenant, TZ, { q: "Dos semanas" });
    const id = rows[0].id;

    const tres = await updateBooking(ctx, {
      id,
      resourceId: cabana1,
      rango: fechas("2030-03-01", "2030-03-22"),
      holderName: "Dos semanas",
    });
    expect(tres.ok).toBe(true);
    if (!tres.ok) return;
    // 3 × 230: el precio de cuando se reservó, no los 260 de hoy.
    expect(tres.total).toBe("690.00");
    expect(await filaDe(id)).toMatchObject({ qty: "3.000" });

    // 17 días no son semanas completas.
    const raro = await updateBooking(ctx, {
      id,
      resourceId: cabana1,
      rango: fechas("2030-03-01", "2030-03-18"),
      holderName: "Dos semanas",
    });
    expect(raro.ok).toBe(false);
  });

  it("por bloques: bloques completos, al precio del bloque", async () => {
    const r = await createBooking(ctx, {
      serviceId: cancha,
      resourceId: cancha1,
      rateId: tanda,
      rango: horas("2030-03-10", "08:00", "16:00"),
      holderName: "Dos tandas",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.total).toBe("70.00");
    expect(await filaDe(r.id)).toMatchObject({ rate_unit: "bloque", qty: "2.000" });

    const corta = await createBooking(ctx, {
      serviceId: cancha,
      resourceId: cancha1,
      rateId: tanda,
      rango: horas("2030-03-11", "08:00", "10:00"),
      holderName: "Media tanda",
    });
    expect(corta.ok).toBe(false);

    // Por hora sigue cobrando la fracción.
    const hora = await createBooking(ctx, {
      serviceId: cancha,
      resourceId: cancha1,
      rateId: porHora,
      rango: horas("2030-03-11", "08:00", "09:30"),
      holderName: "Hora y media",
    });
    expect(hora.ok).toBe(true);
    if (!hora.ok) return;
    expect(hora.total).toBe("15.00");
  });

  it("cada tarifa con su moneda: la reserva copia la de su tarifa", async () => {
    const enEuros = await nuevaTarifa({
      serviceId: cancha,
      unit: "hora",
      label: "Turistas",
      price: "12",
      currency: "EUR",
    });
    const r = await createBooking(ctx, {
      serviceId: cancha,
      resourceId: cancha1,
      rateId: enEuros,
      rango: horas("2030-03-12", "10:00", "11:00"),
      holderName: "Turista",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.currency).toBe("EUR");
    expect(await filaDe(r.id)).toMatchObject({ currency: "EUR", unit_price: "12.00" });
  });

  it("una tarifa archivada ya no se ofrece, y las reservas que la usaron siguen igual", async () => {
    expect((await archiveRate(ctx, { id: porMes })).ok).toBe(true);

    const servicios = await listBookableServices(tenant);
    expect(servicios.find((s) => s.id === cabana)!.tarifas.map((t) => t.id)).not.toContain(porMes);

    const r = await createBooking(ctx, {
      serviceId: cabana,
      resourceId: cabana1,
      rateId: porMes,
      rango: fechas("2031-01-10", "2031-02-10"),
      holderName: "Tarde",
    });
    expect(r.ok).toBe(false);

    const { rows } = await listBookings(tenant, TZ, { q: "Un mes" });
    expect(rows[0]).toMatchObject({ total: "800.00", descripcion: "1 mes" });
  });

  it("un servicio reservable no se queda sin tarifas", async () => {
    expect((await archiveRate(ctx, { id: porSemana })).ok).toBe(true);
    const ultima = await archiveRate(ctx, { id: porNoche });
    expect(ultima.ok).toBe(false);
    if (ultima.ok) return;
    expect(ultima.error).toMatch(/única tarifa/i);
  });

  it("cambiar el grano de un servicio sin reservas deja una tarifa del grano nuevo", async () => {
    const salon = uuidv7();
    await sql`insert into services (id, tenant_id, name, category_id, price, currency) values
      (${salon}, ${tenant}, 'Salón', ${catServ}, '25.00', 'USD')`;
    expect((await configureServiceBooking(ctx, { serviceId: salon, unidad: "hora" })).ok).toBe(true);
    expect((await configureServiceBooking(ctx, { serviceId: salon, unidad: "noche" })).ok).toBe(true);

    const activas = await sql<{ unit: string; price: string }[]>`
      select unit, price from service_rates
      where service_id = ${salon} and archived_at is null`;
    expect(activas).toEqual([{ unit: "noche", price: "25.00" }]);
  });
});
