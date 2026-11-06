import { PageTransition } from "@/components/motion";
import { ServicesView, type ResumenReserva } from "@/components/servicios/services-view";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { listServicesCatalog } from "@/lib/productos/queries";
import { listCatalogs } from "@/lib/catalogs/queries";
import { getFields } from "@/lib/fields/queries";
import { listServicesForSetup } from "@/lib/reservas/queries";

/**
 * El catalogo de servicios. Cada fila resume como se reserva y lleva a la
 * pagina del servicio, donde se configura todo lo demas.
 */
export default async function ServiciosPage() {
  const { tenantId, role, primaryCurrency } = await requireTenant();

  const [services, catalogs, fields, setup] = await Promise.all([
    listServicesCatalog(tenantId, { includeArchived: true }),
    listCatalogs(tenantId, ["service_category"]),
    getFields(tenantId, "service"),
    listServicesForSetup(tenantId),
  ]);

  const reservas: Record<string, ResumenReserva> = Object.fromEntries(
    setup.map((s) => [
      s.id,
      { unidad: s.unidad, recursos: s.resources.length, tarifas: s.tarifas.length },
    ]),
  );

  return (
    <PageTransition>
      <ServicesView
        services={services}
        reservas={reservas}
        categories={(catalogs.service_category ?? []).map((c) => ({
          id: c.id,
          label: c.label,
        }))}
        defaultCurrency={primaryCurrency}
        canManage={roleHas(role, "product:manage")}
        canSetup={roleHas(role, "resource:manage")}
        fields={fields}
      />
    </PageTransition>
  );
}
