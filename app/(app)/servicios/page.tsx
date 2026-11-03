import { PageTransition } from "@/components/motion";
import { CatalogView } from "@/components/productos/catalog-view";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { listServicesCatalog } from "@/lib/productos/queries";
import { listCatalogs } from "@/lib/catalogs/queries";
import { getFields } from "@/lib/fields/queries";

/**
 * El catalogo de servicios. Comparte el componente con productos, pero tiene
 * su propia pagina porque en el menu cuelga de el todo lo de reservas.
 */
export default async function ServiciosPage() {
  const { tenantId, role, primaryCurrency } = await requireTenant();

  const [services, catalogs, fields] = await Promise.all([
    listServicesCatalog(tenantId, { includeArchived: true }),
    listCatalogs(tenantId, ["service_category"]),
    getFields(tenantId, "service"),
  ]);

  return (
    <PageTransition>
      <CatalogView
        kind="servicios"
        services={services}
        categories={(catalogs.service_category ?? []).map((c) => ({
          id: c.id,
          label: c.label,
        }))}
        defaultCurrency={primaryCurrency}
        canManage={roleHas(role, "product:manage")}
        fields={fields}
      />
    </PageTransition>
  );
}
