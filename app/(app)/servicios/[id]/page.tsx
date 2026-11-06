import { notFound } from "next/navigation";
import { PageTransition } from "@/components/motion";
import { ServiceDetail } from "@/components/servicios/service-detail";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { listServicesCatalog } from "@/lib/productos/queries";
import { listCatalogs } from "@/lib/catalogs/queries";
import { getFields } from "@/lib/fields/queries";
import { listServicesForSetup } from "@/lib/reservas/queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Un servicio: sus datos y, si se reserva, como, sus tarifas, sus recursos y
 * su horario. Reemplaza a la antigua pantalla /reservas/recursos.
 *
 * Cualquiera con sesion la ve; editar exige `product:manage` (datos) o
 * `resource:manage` (lo de reservas), y cada Server Action lo verifica de
 * nuevo. Los ids de otro negocio no aparecen: las consultas van por
 * `withTenant`.
 */
export default async function ServicioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tenantId, role, primaryCurrency } = await requireTenant();
  const { id } = await params;
  const { tab } = await searchParams;
  if (!UUID_RE.test(id)) notFound();

  const [services, catalogs, fields, setup] = await Promise.all([
    listServicesCatalog(tenantId, { includeArchived: true }),
    listCatalogs(tenantId, ["service_category"]),
    getFields(tenantId, "service"),
    listServicesForSetup(tenantId, { serviceId: id }),
  ]);

  const servicio = services.find((s) => s.id === id);
  if (!servicio) notFound();

  return (
    <PageTransition>
      <ServiceDetail
        servicio={servicio}
        setup={setup[0] ?? null}
        categories={(catalogs.service_category ?? []).map((c) => ({
          id: c.id,
          label: c.label,
        }))}
        fields={fields}
        defaultCurrency={primaryCurrency}
        canManage={roleHas(role, "product:manage")}
        canSetup={roleHas(role, "resource:manage")}
        tabInicial={typeof tab === "string" ? tab : undefined}
      />
    </PageTransition>
  );
}
