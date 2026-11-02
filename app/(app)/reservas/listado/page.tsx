import { PageTransition } from "@/components/motion";
import { BookingListView } from "@/components/reservas/booking-list-view";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { SinPermiso } from "@/components/layout/sin-permiso";
import {
  LISTADO_POR_PAGINA,
  listBookableServices,
  listBookings,
  type BookingFilters,
  type FiltroEstado,
} from "@/lib/reservas/queries";
import { fechaValida, hoyEn } from "@/lib/reservas/rango";
import { loadCobroConfig } from "@/lib/reservas/page-data";

const ESTADOS: FiltroEstado[] = [
  "pendientes",
  "reservada",
  "en_curso",
  "finalizada",
  "cancelada",
  "no_show",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ListadoSearchParams {
  q?: string;
  estado?: string;
  servicio?: string;
  desde?: string;
  hasta?: string;
  saldo?: string;
  page?: string;
}

/**
 * Los filtros de la URL, saneados.
 *
 * La URL la escribe cualquiera: un estado o una fecha que no tengan la forma
 * esperada se ignoran en vez de llegar a Postgres y romper la página.
 */
function parseFilters(p: ListadoSearchParams): BookingFilters {
  const desde = p.desde && fechaValida(p.desde) ? p.desde : undefined;
  const hasta = p.hasta && fechaValida(p.hasta) ? p.hasta : undefined;
  // Un rango al revés no devuelve nada y parece que no hay reservas. Se
  // voltea, que es lo que la persona quiso decir.
  const invertido = desde && hasta && desde > hasta;
  return {
    q: p.q?.trim().slice(0, 100) || undefined,
    estado: ESTADOS.includes(p.estado as FiltroEstado) ? (p.estado as FiltroEstado) : undefined,
    serviceId: p.servicio && UUID.test(p.servicio) ? p.servicio : undefined,
    desde: invertido ? hasta : desde,
    hasta: invertido ? desde : hasta,
    conSaldo: p.saldo === "1",
    page: Math.max(0, Number(p.page ?? 0) || 0),
  };
}

/**
 * Listado de reservas: buscar una concreta y ver cuánto se debe.
 *
 * Complementa a la cuadrícula, que muestra solo 14 días: aquí se encuentra la
 * reserva de alguien sin saber cuándo es, y las que quedaron con saldo.
 */
export default async function ListadoReservasPage({
  searchParams,
}: {
  searchParams: Promise<ListadoSearchParams>;
}) {
  const { tenantId, timezone, role } = await requireTenant();

  if (!roleHas(role, "booking:read")) {
    return (
      <SinPermiso role={role} explicacion={"Tu rol no tiene acceso a las reservas."} />
    );
  }

  const filtros = parseFilters(await searchParams);

  const [{ rows, total, saldos }, servicios, cobro] = await Promise.all([
    listBookings(tenantId, timezone, filtros),
    listBookableServices(tenantId),
    loadCobroConfig(tenantId, role),
  ]);

  return (
    <PageTransition>
      <BookingListView
        rows={rows}
        total={total}
        page={filtros.page ?? 0}
        perPage={LISTADO_POR_PAGINA}
        saldos={saldos}
        filtros={{
          q: filtros.q ?? "",
          estado: filtros.estado ?? "",
          servicio: filtros.serviceId ?? "",
          desde: filtros.desde ?? "",
          hasta: filtros.hasta ?? "",
          saldo: filtros.conSaldo ?? false,
        }}
        servicios={servicios}
        hoy={hoyEn(timezone)}
        canManage={roleHas(role, "booking:manage")}
        cobro={cobro}
      />
    </PageTransition>
  );
}
