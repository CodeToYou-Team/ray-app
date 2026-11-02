import "server-only";

import { and, asc, count, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { withTenant } from "@/lib/db/tenant";
import {
  bookingPayments,
  bookings,
  catalogItems,
  resources,
  services,
  transactions,
  type BookingStatus,
  type BookingUnit,
} from "@/lib/db/schema";
import { subtractMoney, sumMoney } from "@/lib/money";
import { bordesLocalesSql, periodoSql } from "./periodo";
import { cantidad, totalReserva, type Rango } from "./rango";

export interface ResourceRow {
  id: string;
  name: string;
  notes: string | null;
  /** Exclusivo: personas por reserva. Compartido: cupos en total a la vez. */
  capacity: number;
}

export interface BookableService {
  id: string;
  name: string;
  /**
   * "Disponible para vender". Apagado, el servicio NO acepta reservas nuevas,
   * pero sigue en la lista: sus reservas ya hechas tienen que poder recibir
   * su llegada, sus cobros y su salida.
   */
  active: boolean;
  unidad: BookingUnit;
  /** Muchas reservas a la vez hasta llenar la capacidad. */
  shared: boolean;
  perPerson: boolean;
  price: string;
  currency: string;
  resources: ResourceRow[];
}

/**
 * Los servicios que se reservan, con sus recursos activos.
 *
 * Es lo que arma las filas de la cuadrícula y las opciones del formulario.
 * Un servicio reservable sin recursos aparece igual: así la pantalla puede
 * decir "agrega habitaciones" en vez de esconderlo.
 *
 * Los que NO están disponibles para vender también vienen, marcados con
 * `active: false`. Esconderlos haría desaparecer sus reservas ya hechas: el
 * huésped que llega la semana que viene no tendría dónde registrarse. Quien
 * decide qué se ofrece para reservar de nuevo es la pantalla, con `active`.
 */
export async function listBookableServices(
  tenantId: string,
): Promise<BookableService[]> {
  return withTenant(tenantId, async (tx) => {
    const servs = await tx
      .select({
        id: services.id,
        name: services.name,
        active: services.isActive,
        unidad: services.bookingUnit,
        shared: services.bookingShared,
        perPerson: services.bookingPerPerson,
        price: services.price,
        currency: services.currency,
      })
      .from(services)
      .where(
        and(
          eq(services.tenantId, tenantId),
          isNull(services.deletedAt),
          isNotNull(services.bookingUnit),
        ),
      )
      .orderBy(asc(services.name));

    if (servs.length === 0) return [];

    const recs = await tx
      .select({
        id: resources.id,
        serviceId: resources.serviceId,
        name: resources.name,
        notes: resources.notes,
        capacity: resources.capacity,
      })
      .from(resources)
      .where(
        and(
          eq(resources.tenantId, tenantId),
          isNull(resources.archivedAt),
          inArray(
            resources.serviceId,
            servs.map((s) => s.id),
          ),
        ),
      )
      // Orden "natural": 101, 102, 110 y no 101, 110, 102.
      .orderBy(sql`length(${resources.name})`, asc(resources.name));

    return servs.map((s) => ({
      ...s,
      unidad: s.unidad!,
      resources: recs
        .filter((r) => r.serviceId === s.id)
        .map(({ id, name, notes, capacity }) => ({ id, name, notes, capacity })),
    }));
  });
}

export interface ServiceSetupRow {
  id: string;
  name: string;
  /** "Disponible para vender", que se cambia en Productos. */
  active: boolean;
  price: string;
  currency: string;
  unidad: BookingUnit | null;
  shared: boolean;
  perPerson: boolean;
  /** Si ya tiene reservas, la unidad no se puede cambiar. */
  bookingCount: number;
  resources: ResourceRow[];
}

/**
 * Todos los servicios, reservables o no, para la pantalla de configuración.
 */
export async function listServicesForSetup(
  tenantId: string,
): Promise<ServiceSetupRow[]> {
  return withTenant(tenantId, async (tx) => {
    const servs = await tx
      .select({
        id: services.id,
        name: services.name,
        active: services.isActive,
        price: services.price,
        currency: services.currency,
        unidad: services.bookingUnit,
        shared: services.bookingShared,
        perPerson: services.bookingPerPerson,
      })
      .from(services)
      .where(and(eq(services.tenantId, tenantId), isNull(services.deletedAt)))
      .orderBy(asc(services.name));

    if (servs.length === 0) return [];
    const ids = servs.map((s) => s.id);

    const [recs, conteos] = [
      await tx
        .select({
          id: resources.id,
          serviceId: resources.serviceId,
          name: resources.name,
          notes: resources.notes,
          capacity: resources.capacity,
        })
        .from(resources)
        .where(
          and(
            eq(resources.tenantId, tenantId),
            isNull(resources.archivedAt),
            inArray(resources.serviceId, ids),
          ),
        )
        .orderBy(sql`length(${resources.name})`, asc(resources.name)),
      await tx
        .select({ serviceId: bookings.serviceId, n: count() })
        .from(bookings)
        .where(and(eq(bookings.tenantId, tenantId), inArray(bookings.serviceId, ids)))
        .groupBy(bookings.serviceId),
    ];

    const porServicio = new Map(conteos.map((c) => [c.serviceId, c.n]));

    return servs.map((s) => ({
      ...s,
      bookingCount: porServicio.get(s.id) ?? 0,
      resources: recs
        .filter((r) => r.serviceId === s.id)
        .map(({ id, name, notes, capacity }) => ({ id, name, notes, capacity })),
    }));
  });
}

/** Un cobro de una reserva, como se muestra en su detalle. */
export interface BookingPaymentRow {
  transactionId: string;
  /** Lo que abonó, en la moneda de la RESERVA. */
  appliedAmount: string;
  /** Lo que entró, en la moneda del pago. */
  amount: string;
  currency: string;
  exchangeRate: string | null;
  occurredOn: string;
  paymentMethodLabel: string;
  /** Anulado en Finanzas: se muestra, pero ya no cuenta para el saldo. */
  voided: boolean;
}

export interface BookingRow {
  id: string;
  serviceId: string;
  resourceId: string;
  unidad: BookingUnit;
  status: BookingStatus;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
  /** Cuántas personas o cupos ocupa. */
  partySize: number;
  shared: boolean;
  perPerson: boolean;
  /** Suma de los cobros vivos, en la moneda de la reserva. */
  pagado: string;
  saldo: string;
  pagos: BookingPaymentRow[];
  /** Hora LOCAL del negocio, "YYYY-MM-DDTHH:MI". Comparables como texto. */
  inicio: string;
  fin: string;
  qty: string;
  descripcion: string;
  unitPrice: string;
  total: string;
  currency: string;
  holderName: string;
  holderDocument: string | null;
  holderPhone: string | null;
  notes: string | null;
}

/** Los estados que ocupan el recurso. Coincide con el predicado del EXCLUDE. */
const NO_OCUPAN: BookingStatus[] = ["cancelada", "no_show"];

/**
 * Las reservas que tocan una ventana de días, en hora local del negocio.
 *
 * `desde` y `hasta` son fechas locales; la ventana es `[desde, hasta)`. La
 * comparación de rangos la hace Postgres con `&&`, sobre los mismos instantes
 * que usa el EXCLUDE: la cuadrícula y la garantía no pueden discrepar sobre si
 * dos reservas se cruzan.
 */
export async function bookingsInWindow(
  tenantId: string,
  timezone: string,
  ventana: { desde: string; hasta: string },
): Promise<BookingRow[]> {
  const rangoVentana = periodoSql(
    { unidad: "noche", desde: ventana.desde, hasta: ventana.hasta },
    timezone,
  );
  const bordes = bordesLocalesSql(bookings.period, timezone);

  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: bookings.id,
        serviceId: bookings.serviceId,
        resourceId: bookings.resourceId,
        unidad: services.bookingUnit,
        status: bookings.status,
        checkedInAt: bookings.checkedInAt,
        checkedOutAt: bookings.checkedOutAt,
        partySize: bookings.partySize,
        shared: bookings.shared,
        perPerson: bookings.perPerson,
        inicio: bordes.inicio,
        fin: bordes.fin,
        unitPrice: bookings.unitPrice,
        currency: bookings.currency,
        holderName: bookings.holderName,
        holderDocument: bookings.holderDocument,
        holderPhone: bookings.holderPhone,
        notes: bookings.notes,
      })
      .from(bookings)
      .innerJoin(
        services,
        and(eq(services.id, bookings.serviceId), eq(services.tenantId, bookings.tenantId)),
      )
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          notInArray(bookings.status, NO_OCUPAN),
          sql`${bookings.period} && ${rangoVentana}`,
        ),
      )
      .orderBy(sql`lower(${bookings.period})`),
  );

  const pagos = await paymentsForBookings(
    tenantId,
    rows.map((r) => r.id),
  );

  return rows.map((r) => {
    const unidad = r.unidad ?? "noche";
    const rango: Rango =
      unidad === "noche"
        ? { unidad, desde: r.inicio.slice(0, 10), hasta: r.fin.slice(0, 10) }
        : {
            unidad,
            fecha: r.inicio.slice(0, 10),
            inicio: r.inicio.slice(11, 16),
            fin: r.fin.slice(11, 16),
          };
    const c = cantidad(rango);
    const qty = c.ok ? c.qty : "0";
    const total = totalReserva({
      qty,
      partySize: r.partySize,
      perPerson: r.perPerson,
      unitPrice: r.unitPrice,
    });
    const suyos = pagos[r.id] ?? [];
    // Solo los vivos: un cobro anulado en Finanzas sale del saldo.
    const pagado = sumMoney(suyos.filter((p) => !p.voided).map((p) => p.appliedAmount));
    return {
      ...r,
      unidad,
      qty,
      descripcion: c.ok ? c.descripcion : "",
      total,
      pagado,
      saldo: subtractMoney(total, pagado),
      pagos: suyos,
    };
  });
}

/**
 * Los cobros de varias reservas, en UNA consulta.
 *
 * Incluye los anulados (marcados), para que el detalle muestre la historia
 * completa: "cobré 100 y lo anulé" es información, no ruido.
 */
export async function paymentsForBookings(
  tenantId: string,
  ids: string[],
): Promise<Record<string, BookingPaymentRow[]>> {
  if (ids.length === 0) return {};

  const metodo = alias(catalogItems, "metodo");

  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        bookingId: bookingPayments.bookingId,
        transactionId: transactions.id,
        appliedAmount: bookingPayments.appliedAmount,
        amount: transactions.amount,
        currency: transactions.currency,
        exchangeRate: transactions.exchangeRate,
        occurredOn: transactions.occurredOn,
        deletedAt: transactions.deletedAt,
        paymentMethodLabel: metodo.label,
      })
      .from(bookingPayments)
      .innerJoin(
        transactions,
        and(
          eq(transactions.id, bookingPayments.transactionId),
          eq(transactions.tenantId, bookingPayments.tenantId),
        ),
      )
      .innerJoin(metodo, eq(metodo.id, transactions.paymentMethodId))
      .where(
        and(
          eq(bookingPayments.tenantId, tenantId),
          inArray(bookingPayments.bookingId, ids),
        ),
      )
      .orderBy(asc(transactions.occurredOn), asc(transactions.id)),
  );

  const porReserva: Record<string, BookingPaymentRow[]> = {};
  for (const { bookingId, deletedAt, ...p } of rows) {
    (porReserva[bookingId] ??= []).push({ ...p, voided: deletedAt !== null });
  }
  return porReserva;
}
