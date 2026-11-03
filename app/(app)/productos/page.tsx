import { PageTransition } from "@/components/motion";
import { CatalogView } from "@/components/productos/catalog-view";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { listProducts } from "@/lib/productos/queries";
import { listCatalogs } from "@/lib/catalogs/queries";
import { getFields } from "@/lib/fields/queries";

export default async function ProductosPage() {
  const { tenantId, role, primaryCurrency } = await requireTenant();

  const [products, catalogs, fields] = await Promise.all([
    listProducts(tenantId, { includeArchived: true }),
    listCatalogs(tenantId, ["product_category"]),
    getFields(tenantId, "product"),
  ]);

  return (
    <PageTransition>
      <CatalogView
        kind="productos"
        products={products}
        categories={(catalogs.product_category ?? []).map((c) => ({
          id: c.id,
          label: c.label,
        }))}
        defaultCurrency={primaryCurrency}
        canManage={roleHas(role, "product:manage")}
        canAdjustStock={roleHas(role, "stock:adjust")}
        fields={fields}
      />
    </PageTransition>
  );
}
