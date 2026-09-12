import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/lib/db/tenant";
import { catalogItems, type CatalogItem } from "@/lib/db/schema";
import type { CatalogKey } from "./keys";

export interface ListOptions {
  /**
   * Incluir los archivados. Para la pantalla de administracion (donde se ven y
   * se pueden restaurar), no para los selectores de los formularios.
   */
  includeArchived?: boolean;
}

/** Items de un catalogo, en el orden que definio el cliente. */
export async function listCatalog(
  tenantId: string,
  catalogKey: CatalogKey,
  options: ListOptions = {},
): Promise<CatalogItem[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.tenantId, tenantId),
          eq(catalogItems.catalogKey, catalogKey),
          options.includeArchived ? undefined : isNull(catalogItems.archivedAt),
        ),
      )
      .orderBy(asc(catalogItems.sortOrder), asc(catalogItems.label)),
  );
}

/**
 * Varios catalogos en una sola ida a la base.
 *
 * El formulario de transacciones necesita categorias y metodos de pago a la vez;
 * pedirlos por separado serian dos transacciones y dos viajes al pooler.
 */
export async function listCatalogs(
  tenantId: string,
  keys: CatalogKey[],
  options: ListOptions = {},
): Promise<Record<string, CatalogItem[]>> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.tenantId, tenantId),
          options.includeArchived ? undefined : isNull(catalogItems.archivedAt),
        ),
      )
      .orderBy(asc(catalogItems.sortOrder), asc(catalogItems.label)),
  );

  const grouped: Record<string, CatalogItem[]> = Object.fromEntries(
    keys.map((key) => [key, []]),
  );
  for (const row of rows) {
    grouped[row.catalogKey]?.push(row);
  }
  return grouped;
}

/**
 * Mapa code -> label para renderizar valores historicos.
 *
 * Incluye los archivados a proposito: un registro de enero que usa una categoria
 * archivada en marzo tiene que seguir mostrando su nombre, no un hueco.
 */
export async function catalogLabels(
  tenantId: string,
  catalogKey: CatalogKey,
): Promise<Map<string, string>> {
  const rows = await listCatalog(tenantId, catalogKey, { includeArchived: true });
  return new Map(rows.map((row) => [row.code, row.label]));
}
