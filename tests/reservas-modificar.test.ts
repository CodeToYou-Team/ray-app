import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { tarifasDeSiempre } from "./tarifas-fixture";
import { uuidv7 } from "uuidv7";
import {
  cancelBooking,
  checkIn,
  createBooking,
  registerPayment,
  updateBooking,
  type UpdateBookingInput,
} from "@/lib/reservas/register";
import { hoyEn, sumarDias } from "@/lib/reservas/rango";

/**
 * Modificar una reserva.
 *
 * Lo que hay que fijar: que al mover una reserva la doble reserva y los cupos
 * se sigan garantizando (sin chocar consigo misma), que el precio quede
 * congelado, que una en curso no mueva su entrada, y que el total no pueda
 * quedar por debajo de lo ya cobrado.
 */

const hasDb = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL);
const TZ = "America/Caracas";

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const user = uuidv7();
const ctx = { tenantId: tenant, userId: user };

const catServ = uuidv7();
const catIngreso = uuidv7();
const payUsd = uuidv7();
const doble = uuidv7();
const suite = uuidv7();
const clase = uuidv7();
const h601 = uuidv7();
const h602 = uuidv7();
const s701 = uuidv7();
const sala = uuidv7();

const noches = (desde: string, hasta: string) => ({ unidad: "noche" as const, desde, hasta });

async function reservar(resourceId: string, desde: string, hasta: string, personas = 1) {
  const r = await createBooking(ctx, {
    serviceId: doble,
    resourceId,
    rango: noches(desde, hasta),
    personas,
    holderName: "Pérez",
  });
  if (!r.ok) throw new Error(`No se pudo preparar la reserva: ${r.error}`);
  return r.id;
}

/** Lo mínimo para modificar: cambia solo lo que se pase. */
function cambio(
  id: string,
  resourceId: string,
  desde: string,
  hasta: string,
  extra: Partial<UpdateBookingInput> = {},
): UpdateBookingInput {
  return {
    id,
    resourceId,
    rango: noches(desde, hasta),
    holderName: "Pérez",
    ...extra,
  };
}

describe.skipIf(!hasDb)("modificar una reserva", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug, timezone) values (${tenant}, 'Mod', ${"mod-" + tenant.slice(-12)}, ${TZ})`;
    await sql`insert into users (id, email) values (${user}, ${`mod-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label, currency) values
      (${catServ},    ${tenant}, 'service_category', 'serv', 'Servicios', null),
      (${catIngreso}, ${tenant}, 'income_category',  'ing',  'Ingresos',  null),
      (${payUsd},     ${tenant}, 'payment_method',   'efec', 'Efectivo',  'USD')`;
    await sql`insert into services (id, tenant_id, name, category_id, price, currency, booking_unit, booking_shared, booking_per_person) values
      (${doble}, ${tenant}, 'Doble', ${catServ}, '40.00', 'USD', 'noche', false, false),
      (${suite}, ${tenant}, 'Suite', ${catServ}, '90.00', 'USD', 'noche', false, false),
      (${clase}, ${tenant}, 'Clase', ${catServ}, '10.00', 'USD', 'hora',  true,  true)`;
    await tarifasDeSiempre(sql, tenant);
    await sql`insert into resources (id, tenant_id, service_id, name, capacity) values
      (${h601}, ${tenant}, ${doble}, '601', 2),
      (${h602}, ${tenant}, ${doble}, '602', 2),
      (${s701}, ${tenant}, ${suite}, '701', 4),
      (${sala}, ${tenant}, ${clase}, 'Sala', 5)`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  // -------------------------------------------------------------------------
  // Fechas y precio
  // -------------------------------------------------------------------------

  it("extender una estadía recalcula el total con el precio congelado", async () => {
    const id = await reservar(h601, "2028-01-10", "2028-01-12");

    // La tarifa sube DESPUÉS de reservar.
    await sql`update services set price = '55.00' where id = ${doble}`;
    try {
      const r = await updateBooking(ctx, cambio(id, h601, "2028-01-10", "2028-01-13"));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // 3 noches × 40, no × 55: extender no revalúa la estadía.
      expect(r.total).toBe("120.00");
    } finally {
      await sql`update services set price = '40.00' where id = ${doble}`;
    }

    const [fila] = await sql`
      select to_char(upper(period) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as hasta
      from bookings where id = ${id}`;
    // La nueva salida, en la medianoche de Caracas.
    expect(fila.hasta).toBe("2028-01-13 04:00");
  });

  it("correrse una noche no choca consigo misma", async () => {
    const id = await reservar(h601, "2028-02-10", "2028-02-13");
    // Del 10-13 al 11-14: se solapa con su propio rango viejo. El EXCLUDE no
    // compara una fila consigo misma.
    expect((await updateBooking(ctx, cambio(id, h601, "2028-02-11", "2028-02-14"))).ok).toBe(true);
  });

  it("no se puede mover encima de otra reserva", async () => {
    await reservar(h602, "2028-03-10", "2028-03-12");
    const id = await reservar(h602, "2028-03-20", "2028-03-22");

    const r = await updateBooking(ctx, cambio(id, h602, "2028-03-11", "2028-03-13"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/otra reserva que se cruza/i);
  });

  it("cambiar de habitación: a una libre sí, a una ocupada no", async () => {
    await reservar(h602, "2028-04-10", "2028-04-12");
    const id = await reservar(h601, "2028-04-10", "2028-04-12");

    // 602 está ocupada esas noches.
    expect((await updateBooking(ctx, cambio(id, h602, "2028-04-10", "2028-04-12"))).ok).toBe(false);
    // Otras noches, libre.
    expect((await updateBooking(ctx, cambio(id, h602, "2028-04-20", "2028-04-22"))).ok).toBe(true);

    const [fila] = await sql`select resource_id from bookings where id = ${id}`;
    expect(fila.resource_id).toBe(h602);
  });

  it("no se cambia a un recurso de otro servicio", async () => {
    const id = await reservar(h601, "2028-05-10", "2028-05-11");
    const r = await updateBooking(ctx, cambio(id, s701, "2028-05-10", "2028-05-11"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/mismo servicio/i);
  });

  it("no pasa de la capacidad del recurso", async () => {
    const id = await reservar(h601, "2028-06-10", "2028-06-11");
    const r = await updateBooking(ctx, cambio(id, h601, "2028-06-10", "2028-06-11", { personas: 3 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/hasta 2 personas/i);
  });

  // -------------------------------------------------------------------------
  // Compartidos
  // -------------------------------------------------------------------------

  const clase18 = (fecha: string, personas: number) =>
    createBooking(ctx, {
      serviceId: clase,
      resourceId: sala,
      rango: { unidad: "hora", fecha, inicio: "18:00", fin: "19:00" },
      personas,
      holderName: "Alumno",
    });

  it("en una clase llena, la propia reserva se puede editar sin contarse dos veces", async () => {
    const a = await clase18("2028-07-04", 3);
    expect((await clase18("2028-07-04", 2)).ok).toBe(true); // 5/5
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    // Cambiar solo el nombre: el trigger no se compara consigo misma.
    const r = await updateBooking(ctx, {
      id: a.id,
      resourceId: sala,
      rango: { unidad: "hora", fecha: "2028-07-04", inicio: "18:00", fin: "19:00" },
      personas: 3,
      holderName: "Alumno corregido",
    });
    expect(r.ok).toBe(true);

    // Bajar de 3 a 2 libera un cupo...
    expect(
      (await updateBooking(ctx, {
        id: a.id,
        resourceId: sala,
        rango: { unidad: "hora", fecha: "2028-07-04", inicio: "18:00", fin: "19:00" },
        personas: 2,
        holderName: "Alumno corregido",
      })).ok,
    ).toBe(true);
    expect((await clase18("2028-07-04", 1)).ok).toBe(true);

    // ...y volver a 3 ya no cabe.
    const lleno = await updateBooking(ctx, {
      id: a.id,
      resourceId: sala,
      rango: { unidad: "hora", fecha: "2028-07-04", inicio: "18:00", fin: "19:00" },
      personas: 3,
      holderName: "Alumno corregido",
    });
    expect(lleno.ok).toBe(false);
    if (lleno.ok) return;
    expect(lleno.error).toMatch(/no quedan cupos/i);
  });

  // -------------------------------------------------------------------------
  // Estados y cobros
  // -------------------------------------------------------------------------

  it("en curso: la entrada no se mueve, la salida sí", async () => {
    const hoy = hoyEn(TZ);
    const id = await reservar(h601, sumarDias(hoy, -1), sumarDias(hoy, 1));
    expect((await checkIn(ctx, { id })).ok).toBe(true);

    const mover = await updateBooking(ctx, cambio(id, h601, hoy, sumarDias(hoy, 1)));
    expect(mover.ok).toBe(false);
    if (mover.ok) return;
    expect(mover.error).toMatch(/ya llegó/i);

    // Se queda una noche más.
    expect((await updateBooking(ctx, cambio(id, h601, sumarDias(hoy, -1), sumarDias(hoy, 2)))).ok).toBe(true);
  });

  it("una cancelada no se modifica", async () => {
    const id = await reservar(h601, "2028-08-10", "2028-08-11");
    expect((await cancelBooking(ctx, { id })).ok).toBe(true);
    const r = await updateBooking(ctx, cambio(id, h601, "2028-08-10", "2028-08-12"));
    expect(r.ok).toBe(false);
  });

  it("el total no puede quedar por debajo de lo cobrado", async () => {
    const id = await reservar(h601, "2028-09-10", "2028-09-14"); // 4 × 40 = 160
    const pago = await registerPayment(ctx, {
      bookingId: id,
      monto: "120.00",
      paymentMethodId: payUsd,
      categoryId: catIngreso,
      clientRequestId: uuidv7(),
    });
    expect(pago.ok).toBe(true);

    // Acortar a 2 noches (80) dejaría 120 cobrados de más: es una devolución
    // y se decide anulando un cobro, no en silencio.
    const corta = await updateBooking(ctx, cambio(id, h601, "2028-09-10", "2028-09-12"));
    expect(corta.ok).toBe(false);
    if (corta.ok) return;
    expect(corta.error).toMatch(/ya se cobraron 120.00/i);

    // A 3 noches (120) queda saldada justo.
    const justa = await updateBooking(ctx, cambio(id, h601, "2028-09-10", "2028-09-13"));
    expect(justa.ok).toBe(true);
    if (!justa.ok) return;
    expect(justa.saldo).toBe("0.00");
  });

  it("deja en la bitácora solo lo que cambió", async () => {
    const id = await reservar(h601, "2028-10-10", "2028-10-11");
    expect(
      (await updateBooking(ctx, cambio(id, h601, "2028-10-10", "2028-10-12", { holderPhone: "0414-0000000" }))).ok,
    ).toBe(true);

    const [evento] = await sql`select diff from audit_log
      where entity_id = ${id} and action = 'update' order by at desc limit 1`;
    expect(Object.keys(evento.diff).sort()).toEqual(["rango", "telefono", "total"]);
    expect(evento.diff.total).toEqual({ from: "40.00", to: "80.00" });
  });

  it("dos reservas moviéndose a la misma noche libre: pasa una", async () => {
    const a = await reservar(h601, "2028-11-01", "2028-11-02");
    const b = await reservar(h601, "2028-11-05", "2028-11-06");

    // Las dos intentan pasar a la 602 la noche del 20, a la vez.
    const resultados = await Promise.all([
      updateBooking(ctx, cambio(a, h602, "2028-11-20", "2028-11-21")),
      updateBooking(ctx, cambio(b, h602, "2028-11-20", "2028-11-21")),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
  });
});
