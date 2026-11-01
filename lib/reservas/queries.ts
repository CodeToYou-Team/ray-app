import "server-only";

import { and, asc, count, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { withTenant } from "@/lib/db/tenant";
import {
  bookings,
  resources,
  services,
  type BookingStatus,
  type BookingUnit,
} from "@/lib/db/schema";
import { lineSubtotal } from "@/lib/money";
import { bordesLocalesSql, periodoSql } from "./periodo";
import { cantidad, type Rango } from "./rango";

export interface ResourceRow {
  id: string;
  name: string;
  notes: string | null;
}

export interface BookableService {
  id: string;
  name: string;
  unidad: BookingUnit;
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
 */
export async function listBookableServices(
  tenantId: string,
): Promise<BookableService[]> {
  return withTenant(tenantId, async (tx) => {
    const servs = await tx
      .select({
        id: services.id,
        name: services.name,
        unidad: services.bookingUnit,
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
        .map(({ id, name, notes }) => ({ id, name, notes })),
    }));
  });
}

export interface ServiceSetupRow {
  id: string;
  name: string;
  price: string;
  currency: string;
  unidad: BookingUnit | null;
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
        price: services.price,
        currency: services.currency,
        unidad: services.bookingUnit,
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
        .map(({ id, name, notes }) => ({ id, name, notes })),
    }));
  });
}

export interface BookingRow {
  id: string;
  serviceId: string;
  resourceId: string;
  unidad: BookingUnit;
  status: BookingStatus;
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
    return {
      ...r,
      unidad,
      qty,
      descripcion: c.ok ? c.descripcion : "",
      total: lineSubtotal(qty, r.unitPrice),
    };
  });
}
