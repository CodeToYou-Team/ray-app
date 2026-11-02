import { PageTransition } from "@/components/motion";
import { BookingBoard } from "@/components/reservas/booking-board";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { bookingsInWindow, listBookableServices } from "@/lib/reservas/queries";
import { fechaValida, hoyEn, sumarDias } from "@/lib/reservas/rango";
import { listCatalogs } from "@/lib/catalogs/queries";
import { lastExchangeRates } from "@/lib/finanzas/queries";
import { rateSuggestions } from "@/lib/tenant/rates";

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

  // Cobrar es registrar un ingreso: lo que hace falta para eso solo se carga
  // si el rol puede hacerlo.
  const canCharge = roleHas(role, "transaction:create");

  const [servicios, reservas, catalogos, tasas] = await Promise.all([
    listBookableServices(tenantId),
    bookingsInWindow(tenantId, timezone, { desde, hasta }),
    canCharge
      ? listCatalogs(tenantId, ["income_category", "payment_method"])
      : Promise.resolve(null),
    canCharge
      ? lastExchangeRates(tenantId).then((u) => rateSuggestions(tenantId, u))
      : Promise.resolve({}),
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
        cobro={
          catalogos
            ? {
                paymentMethods: (catalogos.payment_method ?? []).map((m) => ({
                  id: m.id,
                  label: m.label,
                  currency: m.currency ?? "",
                })),
                categories: (catalogos.income_category ?? []).map((c) => ({
                  id: c.id,
                  label: c.label,
                })),
                tasas,
              }
            : null
        }
      />
    </PageTransition>
  );
}
