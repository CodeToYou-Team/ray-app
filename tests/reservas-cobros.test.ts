import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { tarifasDeSiempre } from "./tarifas-fixture";
import { uuidv7 } from "uuidv7";
import {
  cancelBooking,
  checkIn,
  checkOut,
  createBooking,
  markNoShow,
  registerPayment,
} from "@/lib/reservas/register";
import { bookingsInWindow } from "@/lib/reservas/queries";
import { hoyEn, sumarDias } from "@/lib/reservas/rango";
import { editTransaction, revertTransaction } from "@/lib/finanzas/register";
import { totalsByCurrency } from "@/lib/finanzas/queries";

/**
 * Reservas, fase 2: check-in, check-out y cobros.
 *
 * Lo que hay que fijar: que el cobro sea el ingreso y nada más (el anticipo no
 * se cuenta dos veces), que dos cobros simultáneos no se pasen del saldo, y
 * que el monto de un cobro no se pueda cambiar por el costado desde Finanzas.
 */

const hasDb = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL);
const TZ = "America/Caracas";

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const otro = uuidv7();
const user = uuidv7();
const ctx = { tenantId: tenant, userId: user };

const catIngreso = uuidv7();
const catServ = uuidv7();
const payUsd = uuidv7();
const payVes = uuidv7();
const doble = uuidv7();
const r201 = uuidv7();
const r202 = uuidv7();
const r203 = uuidv7();
const r204 = uuidv7();

/** Hoy en la zona del negocio; las reservas se arman relativas a esto. */
const hoy = hoyEn(TZ);
const dia = (n: number) => sumarDias(hoy, n);

async function reservar(resourceId: string, desde: number, hasta: number, holderName = "Pérez") {
  const r = await createBooking(ctx, {
    serviceId: doble,
    resourceId,
    rango: { unidad: "noche", desde: dia(desde), hasta: dia(hasta) },
    holderName,
  });
  if (!r.ok) throw new Error(`No se pudo preparar la reserva: ${r.error}`);
  return r.id;
}

const cobrar = (
  bookingId: string,
  monto: string,
  extra: { paymentMethodId?: string; exchangeRate?: string; clientRequestId?: string } = {},
) =>
  registerPayment(ctx, {
    bookingId,
    monto,
    paymentMethodId: extra.paymentMethodId ?? payUsd,
    categoryId: catIngreso,
    exchangeRate: extra.exchangeRate,
    clientRequestId: extra.clientRequestId ?? uuidv7(),
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

describe.skipIf(!hasDb)("reservas: check-in, check-out y cobros", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug, timezone) values
      (${tenant}, 'Posada', ${"posada-" + tenant.slice(-12)}, ${TZ}),
      (${otro},   'Otro',   ${"otro2-" + otro.slice(-12)},    ${TZ})`;
    await sql`insert into users (id, email) values (${user}, ${`cob-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label, currency) values
      (${catIngreso}, ${tenant}, 'income_category',  'hosp', 'Hospedaje',    null),
      (${catServ},    ${tenant}, 'service_category', 'aloj', 'Alojamiento',  null),
      (${payUsd},     ${tenant}, 'payment_method',   'efec', 'Efectivo USD', 'USD'),
      (${payVes},     ${tenant}, 'payment_method',   'pm',   'Pago móvil',   'VES')`;
    await sql`insert into services (id, tenant_id, name, category_id, price, currency, booking_unit) values
      (${doble}, ${tenant}, 'Doble', ${catServ}, '40.00', 'USD', 'noche')`;
    await tarifasDeSiempre(sql, tenant);
    await sql`insert into resources (id, tenant_id, service_id, name) values
      (${r201}, ${tenant}, ${doble}, '201'),
      (${r202}, ${tenant}, ${doble}, '202'),
      (${r203}, ${tenant}, ${doble}, '203'),
      (${r204}, ${tenant}, ${doble}, '204')`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id in (${tenant}, ${otro})`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  // -------------------------------------------------------------------------
  // Check-in y no-show
  // -------------------------------------------------------------------------

  it("no se hace check-in antes del día de llegada", async () => {
    const id = await reservar(r201, 5, 7);
    const r = await checkIn(ctx, { id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/todavía no/i);
  });

  let estadia = "";

  it("check-in de una estadía en curso", async () => {
    // Empezó ayer, termina pasado mañana: 3 noches × 40 = 120.
    estadia = await reservar(r202, -1, 2);
    expect((await checkIn(ctx, { id: estadia })).ok).toBe(true);

    const [fila] = await sql`select status, checked_in_at from bookings where id = ${estadia}`;
    expect(fila.status).toBe("en_curso");
    expect(fila.checked_in_at).not.toBeNull();
  });

  it("no se hace check-in dos veces", async () => {
    const r = await checkIn(ctx, { id: estadia });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/ya se hizo/i);
  });

  it("no se hace check-in de una reserva que ya terminó", async () => {
    const id = await reservar(r203, -5, -2);
    const r = await checkIn(ctx, { id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/ya terminó/i);
  });

  it("no se marca no-show antes del día de llegada", async () => {
    const id = await reservar(r203, 10, 12);
    expect((await markNoShow(ctx, { id })).ok).toBe(false);
  });

  it("no-show libera la habitación y conserva el anticipo", async () => {
    const id = await reservar(r204, 0, 2, "No vino");
    expect((await cobrar(id, "40.00")).ok).toBe(true);
    expect((await markNoShow(ctx, { id })).ok).toBe(true);

    // La misma habitación, las mismas noches, ya libre.
    expect((await createBooking(ctx, {
      serviceId: doble,
      resourceId: r204,
      rango: { unidad: "noche", desde: dia(0), hasta: dia(2) },
      holderName: "Sí vino",
    })).ok).toBe(true);

    // El anticipo sigue siendo ingreso: quedárselo es para lo que se cobra.
    const [{ n }] = await sql`
      select count(*)::int as n from booking_payments bp
      join transactions t on t.id = bp.transaction_id
      where bp.booking_id = ${id} and t.deleted_at is null`;
    expect(n).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Cobros
  // -------------------------------------------------------------------------

  it("un cobro en la moneda de la reserva baja el saldo", async () => {
    const r = await cobrar(estadia, "50.00");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ amount: "50.00", currency: "USD", saldo: "70.00" });

    // Es un ingreso normal, del día de hoy en la zona del negocio.
    const [t] = await sql`select type, kind, concept, occurred_on, exchange_rate
                          from transactions where id = ${r.transactionId}`;
    expect(t.type).toBe("ingreso");
    expect(t.kind).toBe("operacion");
    expect(t.concept).toBe("Reserva 202 · Pérez");
    expect(t.occurred_on.toISOString().slice(0, 10)).toBe(hoy);
    expect(t.exchange_rate).toBeNull();
  });

  it("un cobro en otra moneda se convierte con la tasa", async () => {
    // Abona 20 USD, pagados por pago móvil a 40 Bs por dólar.
    const r = await cobrar(estadia, "20.00", { paymentMethodId: payVes, exchangeRate: "40" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ amount: "800.00", currency: "VES", saldo: "50.00" });

    const [t] = await sql`select exchange_rate, base_currency from transactions where id = ${r.transactionId}`;
    expect(t.exchange_rate).toBe("40.000000");
    expect(t.base_currency).toBe("USD");

    // Lo abonado se guarda en USD, no se deriva dividiendo los Bs.
    const [bp] = await sql`select applied_amount from booking_payments where transaction_id = ${r.transactionId}`;
    expect(bp.applied_amount).toBe("20.00");
  });

  it("en otra moneda sin tasa no se cobra", async () => {
    const r = await cobrar(estadia, "10.00", { paymentMethodId: payVes });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/tasa/i);
  });

  it("no se cobra más que el saldo", async () => {
    const r = await cobrar(estadia, "50.01");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/pasa del saldo/i);
  });

  it("cobros simultáneos del saldo completo: pasa exactamente uno", async () => {
    // Sin bloquear la fila de la reserva, todos leerían "faltan 50" y
    // cobrarían de más. Con FOR UPDATE cada uno espera al anterior y ve el
    // saldo nuevo.
    //
    // Son CINCO a propósito. Se comprobó quitando el FOR UPDATE: con dos, la
    // carrera a veces no se da y la prueba pasa en verde con el bug adentro.
    // Con cinco, casi siempre al menos dos se cruzan.
    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => cobrar(estadia, "50.00")),
    );
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);

    const [{ pagado }] = await sql`
      select coalesce(sum(bp.applied_amount), 0)::text as pagado
      from booking_payments bp join transactions t on t.id = bp.transaction_id
      where bp.booking_id = ${estadia} and t.deleted_at is null`;
    expect(pagado).toBe("120.00");
  });

  it("pagada completa, no admite más cobros", async () => {
    const r = await cobrar(estadia, "1.00");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/pagada completa/i);
  });

  it("el doble clic no cobra dos veces", async () => {
    const id = await reservar(r201, 20, 23);
    const clave = uuidv7();
    const a = await cobrar(id, "30.00", { clientRequestId: clave });
    const b = await cobrar(id, "30.00", { clientRequestId: clave });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.duplicate).toBe(true);
    expect(b.transactionId).toBe(a.transactionId);

    const [{ n }] = await sql`select count(*)::int as n from booking_payments where booking_id = ${id}`;
    expect(n).toBe(1);
  });

  it("anular el cobro en Finanzas lo saca del saldo", async () => {
    const id = await reservar(r203, 30, 31);
    const c = await cobrar(id, "40.00");
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    expect((await revertTransaction(ctx, { id: c.transactionId })).ok).toBe(true);

    // Saldo de vuelta en 40: se puede cobrar de nuevo.
    const r = await cobrar(id, "40.00");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.saldo).toBe("0.00");
  });

  it("un cobro no se corrige desde Finanzas", async () => {
    const id = await reservar(r203, 40, 41);
    const c = await cobrar(id, "40.00");
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    const r = await editTransaction(ctx, {
      id: c.transactionId,
      concept: "Otra cosa",
      occurredOn: hoy,
      categoryId: catIngreso,
      paymentMethodId: payUsd,
      amount: "35.00",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/pertenece a una reserva/i);
  });

  it("la base tampoco deja cambiar el dinero de un cobro", async () => {
    const [{ transaction_id }] = await sql`
      select bp.transaction_id from booking_payments bp
      join transactions t on t.id = bp.transaction_id
      where bp.tenant_id = ${tenant} and t.deleted_at is null limit 1`;

    // El trigger, por si algo se salta la app.
    expect(await pgErrorCode(() => sql`update transactions set amount = '1.00' where id = ${transaction_id}`)).toBe("23514");

    // Lo que no es dinero sí se puede tocar.
    expect(await pgErrorCode(() => sql`update transactions set notes = 'ok' where id = ${transaction_id}`)).toBeUndefined();
  });

  it("una reserva cancelada no se cobra", async () => {
    const id = await reservar(r203, 50, 51);
    expect((await cancelBooking(ctx, { id })).ok).toBe(true);
    const r = await cobrar(id, "10.00");
    expect(r.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Check-out
  // -------------------------------------------------------------------------

  it("no se hace check-out sin check-in", async () => {
    const id = await reservar(r201, 60, 61);
    const r = await checkOut(ctx, { id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/check-in/i);
  });

  it("con saldo, el check-out exige confirmarlo", async () => {
    const id = await reservar(r201, -1, 1, "Debe");
    expect((await checkIn(ctx, { id })).ok).toBe(true);
    expect((await cobrar(id, "30.00")).ok).toBe(true);

    const sinConfirmar = await checkOut(ctx, { id });
    expect(sinConfirmar.ok).toBe(false);
    if (sinConfirmar.ok) return;
    expect(sinConfirmar.saldo).toBe("50.00");

    const confirmado = await checkOut(ctx, { id, aceptarSaldo: true });
    expect(confirmado.ok).toBe(true);

    const [fila] = await sql`select status, checked_out_at from bookings where id = ${id}`;
    expect(fila.status).toBe("finalizada");
    expect(fila.checked_out_at).not.toBeNull();

    // Quedó dicho con cuánto salió debiendo.
    const [evento] = await sql`select diff from audit_log
      where entity_id = ${id} and diff ? 'saldoAlSalir'`;
    expect(evento.diff.saldoAlSalir).toBe("50.00");

    // Y el saldo se puede cobrar después de la salida.
    const tarde = await cobrar(id, "50.00");
    expect(tarde.ok).toBe(true);
  });

  it("pagada completa, sale sin confirmar nada", async () => {
    // `estadia` quedó pagada (120 de 120) más arriba.
    const r = await checkOut(ctx, { id: estadia });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.saldo).toBe("0.00");
  });

  it("no se hace check-out dos veces", async () => {
    const r = await checkOut(ctx, { id: estadia });
    expect(r.ok).toBe(false);
  });

  it("la base exige que el estado y las horas cuenten lo mismo", async () => {
    const id = await reservar(r204, 70, 71);
    // En curso sin hora de llegada.
    expect(await pgErrorCode(() => sql`update bookings set status = 'en_curso' where id = ${id}`)).toBe("23514");
  });

  // -------------------------------------------------------------------------
  // El dinero se cuenta una sola vez
  // -------------------------------------------------------------------------

  it("los ingresos son exactamente los cobros: el check-out no agrega nada", async () => {
    // LA prueba del diseño. Si el check-out generara una venta por el total,
    // el anticipo contaría dos veces y esto daría más de lo cobrado.
    const [{ cobrado }] = await sql`
      select coalesce(sum(t.amount), 0)::text as cobrado
      from transactions t
      where t.tenant_id = ${tenant} and t.currency = 'USD'
        and t.type = 'ingreso' and t.deleted_at is null`;
    const [usd] = await totalsByCurrency(tenant, { type: "ingreso", currency: "USD" });
    expect(usd.total).toBe(cobrado);

    // Y todas esas transacciones son cobros de reservas: no hay ninguna venta
    // generada al salir.
    const [{ sueltas }] = await sql`
      select count(*)::int as sueltas from transactions t
      where t.tenant_id = ${tenant} and t.deleted_at is null
        and not exists (select 1 from booking_payments bp where bp.transaction_id = t.id)`;
    expect(sueltas).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Lectura y aislamiento
  // -------------------------------------------------------------------------

  it("la cuadrícula trae lo pagado, el saldo y los cobros, anulados incluidos", async () => {
    const reservas = await bookingsInWindow(tenant, TZ, { desde: dia(30), hasta: dia(31) });
    const r = reservas.find((b) => b.resourceId === r203);
    expect(r).toBeDefined();
    if (!r) return;
    expect(r.total).toBe("40.00");
    expect(r.pagado).toBe("40.00");
    expect(r.saldo).toBe("0.00");
    // El anulado se ve, marcado; el vivo, no.
    expect(r.pagos.map((p) => p.voided).sort()).toEqual([false, true]);
  });

  it("otro cliente no puede cobrar ni registrar llegadas en esta reserva", async () => {
    const ajeno = { tenantId: otro, userId: user };
    expect((await checkIn(ajeno, { id: estadia })).ok).toBe(false);
    const r = await registerPayment(ajeno, {
      bookingId: estadia,
      monto: "1.00",
      paymentMethodId: payUsd,
      categoryId: catIngreso,
      clientRequestId: uuidv7(),
    });
    expect(r.ok).toBe(false);
  });
});
