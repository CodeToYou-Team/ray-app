import { PageTransition } from "@/components/motion";
import { BookingBoard } from "@/components/reservas/booking-board";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { bookingsInWindow, listBookableServices } from "@/lib/reservas/queries";
import { fechaValida, hoyEn, sumarDias } from "@/lib/reservas/rango";
import { loadCobroConfig } from "@/lib/reservas/page-data";

/** Cuántos días muestra la cuadrícula de una vez. Dos semanas. */
const DIAS = 14;

/**
 * Disponibilidad: recursos × días.
 *
 * La ventana vive en la URL (`?desde=`), igual que la paginación de finanzas:
 * se comparte el enlace, el botón de atrás funciona, y Postgres trae solo las
 * reservas que tocan esos 14 días.
 *
 * "Hoy" es hoy en la zona del NEGOCIO. Con la del servidor (UTC), entre las
 * 20:00 y la medianoche de Caracas la cuadrícula ya mostraría el día siguiente.
 */
export default async function ReservasPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string }>;
}) {
  const { tenantId, timezone, role } = await requireTenant();

  if (!roleHas(role, "booking:read")) {
    return (
      <SinPermiso
        role={role}
        explicacion={"Tu rol no tiene acceso a las reservas."}
      />
    );
  }

  const params = await searchParams;
  const hoy = hoyEn(timezone);
  const desde = params.desde && fechaValida(params.desde) ? params.desde : hoy;
  const hasta = sumarDias(desde, DIAS);

  const [servicios, reservas, cobro] = await Promise.all([
    listBookableServices(tenantId),
    bookingsInWindow(tenantId, timezone, { desde, hasta }),
    loadCobroConfig(tenantId, role),
  ]);

  return (
    <PageTransition>
      <BookingBoard
        servicios={servicios}
        reservas={reservas}
        desde={desde}
        dias={DIAS}
        hoy={hoy}
        canManage={roleHas(role, "booking:manage")}
        canSetup={roleHas(role, "resource:manage")}
        cobro={cobro}
      />
    </PageTransition>
  );
}
