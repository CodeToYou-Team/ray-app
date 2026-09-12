import { PageTransition } from "@/components/motion";
import { CatalogView } from "@/components/productos/catalog-view";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { listProducts, listServicesCatalog } from "@/lib/productos/queries";
import { listCatalogs } from "@/lib/catalogs/queries";
import { getFields } from "@/lib/fields/queries";

export default async function ProductosPage() {
  const { tenantId, role, primaryCurrency } = await requireTenant();

  const [products, services, catalogs, productFields, serviceFields] =
    await Promise.all([
      listProducts(tenantId, { includeArchived: true }),
      listServicesCatalog(tenantId, { includeArchived: true }),
      listCatalogs(tenantId, ["product_category", "service_category"]),
      getFields(tenantId, "product"),
      getFields(tenantId, "service"),
    ]);

  return (
    <PageTransition>
      <CatalogView
        products={products}
        services={services}
        productCategories={(catalogs.product_category ?? []).map((c) => ({
          id: c.id,
          label: c.label,
        }))}
        serviceCategories={(catalogs.service_category ?? []).map((c) => ({
          id: c.id,
          label: c.label,
        }))}
        defaultCurrency={primaryCurrency}
        canManage={roleHas(role, "product:manage")}
        canAdjustStock={roleHas(role, "stock:adjust")}
        productFields={productFields}
        serviceFields={serviceFields}
      />
    </PageTransition>
  );
}
