import "server-only";

import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { withTenant } from "@/lib/db/tenant";
import {
  bookingPayments,
  bookings,
  catalogItems,
  resources,
  serviceSchedules,
  services,
  transactions,
  type BookingStatus,
  type BookingUnit,
} from "@/lib/db/schema";
import { normalizeMoney, subtractMoney, sumMoney } from "@/lib/money";
import { escapeLike } from "@/lib/finanzas/queries";
import { bordesLocalesSql, periodoSql } from "./periodo";
import { cantidad, totalReserva, type Rango, type Turno } from "./rango";

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
  /** Turnos publicados. Vacío = se reserva en cualquier tramo de 30 minutos. */
  turnos: Turno[];
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

    const turnos = await turnosPorServicio(
      tx,
      tenantId,
      servs.map((s) => s.id),
    );

    return servs.map((s) => ({
      ...s,
      unidad: s.unidad!,
      turnos: turnos.get(s.id) ?? [],
      resources: recs
        .filter((r) => r.serviceId === s.id)
        .map(({ id, name, notes, capacity }) => ({ id, name, notes, capacity })),
    }));
  });
}

/**
 * Los turnos de varios servicios, en UNA consulta, ordenados por día y hora.
 * Se pasan a "HH:MM": los segundos de Postgres no le dicen nada a nadie.
 */
async function turnosPorServicio(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  ids: string[],
): Promise<Map<string, Turno[]>> {
  const rows = await tx
    .select({
      id: serviceSchedules.id,
      serviceId: serviceSchedules.serviceId,
      weekday: serviceSchedules.weekday,
      start: serviceSchedules.startTime,
      end: serviceSchedules.endTime,
    })
    .from(serviceSchedules)
    .where(
      and(eq(serviceSchedules.tenantId, tenantId), inArray(serviceSchedules.serviceId, ids)),
    )
    .orderBy(asc(serviceSchedules.weekday), asc(serviceSchedules.startTime));

  const porServicio = new Map<string, Turno[]>();
  for (const r of rows) {
    const lista = porServicio.get(r.serviceId) ?? [];
    lista.push({ id: r.id, weekday: r.weekday, start: r.start.slice(0, 5), end: r.end.slice(0, 5) });
    porServicio.set(r.serviceId, lista);
  }
  return porServicio;
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
  turnos: Turno[];
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
    const turnos = await turnosPorServicio(tx, tenantId, ids);

    return servs.map((s) => ({
      ...s,
      turnos: turnos.get(s.id) ?? [],
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
  /** Nombres, para que el detalle no dependa de que el recurso siga activo. */
  serviceName: string;
  resourceName: string;
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
  /** Columnas personalizadas, por clave. Se leen sin validar. */
  custom: Record<string, unknown>;
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
  return consultarReservas(tenantId, timezone, {
    where: [
      notInArray(bookings.status, NO_OCUPAN),
      sql`${bookings.period} && ${rangoVentana}`,
    ],
    orderBy: [sql`lower(${bookings.period})`],
  });
}

/**
 * La consulta de reservas que comparten la cuadrícula y el listado.
 *
 * Una sola forma de reserva para las dos pantallas: el detalle, los cobros y
 * "Modificar" funcionan igual se abran desde donde se abran, y el total y el
 * saldo se calculan en un solo lugar (`totalReserva`).
 */
async function consultarReservas(
  tenantId: string,
  timezone: string,
  opciones: { where: (SQL | undefined)[]; orderBy: SQL[]; limit?: number; offset?: number },
): Promise<BookingRow[]> {
  const bordes = bordesLocalesSql(bookings.period, timezone);

  const rows = await withTenant(tenantId, (tx) => {
    const q = tx
      .select({
        id: bookings.id,
        serviceId: bookings.serviceId,
        resourceId: bookings.resourceId,
        serviceName: services.name,
        resourceName: resources.name,
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
        custom: bookings.custom,
      })
      .from(bookings)
      .innerJoin(
        services,
        and(eq(services.id, bookings.serviceId), eq(services.tenantId, bookings.tenantId)),
      )
      .innerJoin(
        resources,
        and(eq(resources.id, bookings.resourceId), eq(resources.tenantId, bookings.tenantId)),
      )
      .where(and(eq(bookings.tenantId, tenantId), ...opciones.where))
      .orderBy(...opciones.orderBy);

    return opciones.limit !== undefined
      ? q.limit(opciones.limit).offset(opciones.offset ?? 0)
      : q;
  });

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

// ---------------------------------------------------------------------------
// Listado y búsqueda
// ---------------------------------------------------------------------------

export const LISTADO_POR_PAGINA = 20;

export type FiltroEstado = "pendientes" | BookingStatus;

export interface BookingFilters {
  /** Texto en el titular, el documento, el teléfono o una columna personalizada. */
  q?: string;
  estado?: FiltroEstado;
  serviceId?: string;
  /** YYYY-MM-DD local: reservas que tocan este día o después. */
  desde?: string;
  /** YYYY-MM-DD local: reservas que tocan este día o antes. */
  hasta?: string;
  /** Solo las que deben algo. */
  conSaldo?: boolean;
  page?: number;
}

/**
 * El total de una reserva, en SQL.
 *
 * Existe porque el filtro "con saldo pendiente" y la suma de lo que se debe
 * tienen que resolverse en Postgres para poder paginar en el servidor. La
 * cuenta que vale para mostrar sigue siendo `totalReserva()` en TypeScript;
 * esta tiene que dar EXACTAMENTE lo mismo, y hay una prueba que lo compara
 * (tests/reservas-listado.test.ts) para que no se separen en silencio.
 *
 * Unidades: noches = días entre las fechas LOCALES de entrada y salida; horas
 * = duración en horas (con tramos de 30 minutos, exacta en numeric). Un solo
 * redondeo al final, como `lineSubtotal`.
 */
function totalSql(timezone: string): SQL {
  const unidades = sql`CASE WHEN ${services.bookingUnit} = 'noche'
    THEN ((upper(${bookings.period}) AT TIME ZONE ${timezone})::date
          - (lower(${bookings.period}) AT TIME ZONE ${timezone})::date)::numeric
    ELSE extract(epoch FROM (upper(${bookings.period}) - lower(${bookings.period}))) / 3600
  END`;
  return sql`round(${unidades}
    * CASE WHEN ${bookings.perPerson} THEN ${bookings.partySize} ELSE 1 END
    * ${bookings.unitPrice}, 2)`;
}

/** Lo cobrado de una reserva, en SQL: los cobros cuya transacción sigue viva. */
const pagadoSql = sql`coalesce((
  SELECT sum(bp.applied_amount)
  FROM booking_payments bp
  JOIN transactions t ON t.id = bp.transaction_id AND t.tenant_id = bp.tenant_id
  WHERE bp.booking_id = ${bookings.id}
    AND bp.tenant_id = ${bookings.tenantId}
    AND t.deleted_at IS NULL
), 0)`;

/**
 * Una cancelada o una no presentada no "deben": su total ya no se cobra. Lo
 * cobrado se conserva, pero lo que faltaba deja de ser deuda.
 */
const DEBEN: BookingStatus[] = ["reservada", "en_curso", "finalizada"];

function condiciones(timezone: string, f: BookingFilters): (SQL | undefined)[] {
  const q = f.q?.trim();
  const patron = q ? `%${escapeLike(q)}%` : undefined;

  return [
    patron
      ? or(
          ilike(bookings.holderName, patron),
          ilike(bookings.holderDocument, patron),
          ilike(bookings.holderPhone, patron),
          // Los VALORES de las columnas personalizadas (la placa, el número de
          // vuelo), no sus claves: buscar "placa" no debe traer todas.
          sql`exists (select 1 from jsonb_each_text(${bookings.custom}) c where c.value ilike ${patron})`,
        )
      : undefined,
    f.estado === "pendientes"
      ? inArray(bookings.status, ["reservada", "en_curso"])
      : f.estado
        ? eq(bookings.status, f.estado)
        : undefined,
    f.serviceId ? eq(bookings.serviceId, f.serviceId) : undefined,
    // Rangos que TOCAN el periodo pedido, en días locales del negocio.
    f.desde
      ? sql`upper(${bookings.period}) > (${f.desde}::date)::timestamp AT TIME ZONE ${timezone}`
      : undefined,
    f.hasta
      ? sql`lower(${bookings.period}) < ((${f.hasta}::date) + 1)::timestamp AT TIME ZONE ${timezone}`
      : undefined,
    f.conSaldo
      ? and(
          inArray(bookings.status, DEBEN),
          sql`${totalSql(timezone)} - ${pagadoSql} > 0`,
        )
      : undefined,
  ];
}

export interface SaldoPorMoneda {
  currency: string;
  saldo: string;
  /** Cuántas reservas deben algo en esa moneda. */
  count: number;
}

/**
 * El listado de reservas: buscado, filtrado y paginado en el servidor.
 *
 * Además devuelve, por moneda, cuánto se debe en total entre las reservas
 * filtradas: la pregunta "cuánto me deben" sin recorrer página por página.
 * Nunca un total entre monedas.
 */
export async function listBookings(
  tenantId: string,
  timezone: string,
  filtros: BookingFilters,
): Promise<{ rows: BookingRow[]; total: number; saldos: SaldoPorMoneda[] }> {
  const page = Math.max(0, filtros.page ?? 0);
  const where = condiciones(timezone, filtros);

  const [rows, [{ total }], saldos] = await Promise.all([
    consultarReservas(tenantId, timezone, {
      where,
      // Lo más reciente o próximo primero.
      orderBy: [sql`lower(${bookings.period}) desc`, sql`${bookings.id} desc`],
      limit: LISTADO_POR_PAGINA,
      offset: page * LISTADO_POR_PAGINA,
    }),
    withTenant(tenantId, (tx) =>
      tx
        .select({ total: count() })
        .from(bookings)
        .innerJoin(
          services,
          and(eq(services.id, bookings.serviceId), eq(services.tenantId, bookings.tenantId)),
        )
        .where(and(eq(bookings.tenantId, tenantId), ...where)),
    ),
    withTenant(tenantId, (tx) => {
      const saldo = sql`${totalSql(timezone)} - ${pagadoSql}`;
      return tx
        .select({
          currency: bookings.currency,
          saldo: sql<string>`sum(${saldo})::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(bookings)
        .innerJoin(
          services,
          and(eq(services.id, bookings.serviceId), eq(services.tenantId, bookings.tenantId)),
        )
        .where(
          and(
            eq(bookings.tenantId, tenantId),
            ...where,
            inArray(bookings.status, DEBEN),
            sql`${saldo} > 0`,
          ),
        )
        .groupBy(bookings.currency)
        .orderBy(bookings.currency);
    }),
  ]);

  return {
    rows,
    total: Number(total),
    saldos: saldos.map((s) => ({ ...s, saldo: normalizeMoney(s.saldo) })),
  };
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
