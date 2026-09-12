import type { Metadata } from "next";
import { PageTransition } from "@/components/motion";
import { CatalogManager } from "@/components/catalogs/catalog-manager";
import { listCatalogs } from "@/lib/catalogs/queries";
import { CATALOG_KEYS } from "@/lib/catalogs/keys";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";

export const metadata: Metadata = {
  title: "Catálogos — Ray App",
};

/**
 * Lectura por RSC. Las escrituras van por los Server Actions de
 * lib/catalogs/actions.ts, cada uno con su propio requireCapability.
 */
export default async function CatalogosPage() {
  const { tenantId, role } = await requireTenant();

  const grouped = await listCatalogs(tenantId, [...CATALOG_KEYS], {
    includeArchived: true,
  });

  const catalogs = CATALOG_KEYS.map((key) => ({
    key,
    items: (grouped[key] ?? []).map((item) => ({
      id: item.id,
      code: item.code,
      label: item.label,
      currency: item.currency,
      archivedAt: item.archivedAt,
    })),
  }));

  return (
    <PageTransition>
      <CatalogManager
        catalogs={catalogs}
        canManage={roleHas(role, "catalog:manage")}
      />
    </PageTransition>
  );
}
