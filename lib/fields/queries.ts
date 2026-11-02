import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { withTenant } from "@/lib/db/tenant";
import { catalogItems, fieldConfig } from "@/lib/db/schema";
import type { FieldConfigRow, FieldEntity } from "@/lib/db/schema";
import { resolveFields, type ResolvedField } from "./resolve";
import { validateCustomValues, type CustomValues } from "./validate";
import type { CatalogChoices } from "./types";
import type { Tx } from "@/lib/db";

/** Filas crudas de configuracion. Casi siempre quieres `getFields`. */
export async function loadFieldConfig(
  tenantId: string,
  entity?: FieldEntity,
): Promise<FieldConfigRow[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(fieldConfig)
      .where(
        and(
          eq(fieldConfig.tenantId, tenantId),
          entity ? eq(fieldConfig.entity, entity) : undefined,
        ),
      )
      .orderBy(asc(fieldConfig.sortOrder)),
  );
}

/** Igual que loadFieldConfig, pero dentro de una transaccion ya abierta. */
export async function loadFieldConfigIn(
  tx: Tx,
  tenantId: string,
  entity: FieldEntity,
): Promise<FieldConfigRow[]> {
  return tx
    .select()
    .from(fieldConfig)
    .where(
      and(eq(fieldConfig.tenantId, tenantId), eq(fieldConfig.entity, entity)),
    )
    .orderBy(asc(fieldConfig.sortOrder));
}

/** Campos ya resueltos, que es lo que consumen formulario, tabla y validador. */
export async function getFields(
  tenantId: string,
  entity: FieldEntity,
  options: { includeArchived?: boolean; includeHidden?: boolean } = {},
): Promise<ResolvedField[]> {
  const config = await loadFieldConfig(tenantId, entity);
  return resolveFields(entity, config, options);
}

/**
 * Valida los valores personalizados de un registro DENTRO de la transaccion que
 * los escribe: si alguien cambia la configuracion mientras se guarda, se valida
 * contra una foto consistente.
 *
 * Lo que agrega sobre `validateCustomValues`:
 *
 *   - Un campo OCULTO no se muestra en el formulario, asi que ni se exige ni se
 *     pisa: conserva el valor que el registro ya tenia (`previos`). Si se
 *     validara, un oculto obligatorio bloquearia cada guardado; si se
 *     reemplazara, ocultarlo borraria su dato en el siguiente guardado.
 *   - Un campo `catalog` se valida contra la base: el codigo tiene que existir
 *     en ese catalogo y no estar archivado.
 */
export async function validateCustomIn(
  tx: Tx,
  tenantId: string,
  entity: FieldEntity,
  raw: CustomValues | undefined,
  previos: CustomValues = {},
): Promise<{ ok: true; values: CustomValues } | { ok: false; error: string; field: string }> {
  const config = await loadFieldConfigIn(tx, tenantId, entity);
  const fields = resolveFields(entity, config, { includeHidden: true });

  const result = validateCustomValues(
    fields.filter((f) => !f.hidden),
    raw ?? {},
  );
  if (!result.ok) {
    return { ok: false, error: result.issues[0].message, field: result.issues[0].key };
  }

  for (const field of fields) {
    if (field.type !== "catalog" || !field.catalogKey) continue;
    const code = result.values[field.key];
    if (code === undefined) continue;

    const [item] = await tx
      .select({ id: catalogItems.id })
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.tenantId, tenantId),
          eq(catalogItems.catalogKey, field.catalogKey),
          eq(catalogItems.code, String(code)),
          isNull(catalogItems.archivedAt),
        ),
      );
    if (!item) {
      return {
        ok: false,
        error: `${field.label}: esa opción ya no está disponible`,
        field: field.key,
      };
    }
  }

  const values: CustomValues = { ...result.values };
  for (const field of fields) {
    if (field.source !== "custom" || field.archived || !field.hidden) continue;
    if (previos[field.key] !== undefined) values[field.key] = previos[field.key];
  }

  return { ok: true, values };
}

/**
 * Opciones de los campos `catalog` de una entidad, para el formulario y para
 * mostrar los valores guardados.
 *
 * `options` trae solo los activos (lo que se ofrece al elegir); `labels`
 * incluye los archivados, porque un registro viejo tiene que seguir mostrando
 * el nombre de lo que eligio.
 */
export async function catalogOptionsFor(
  tenantId: string,
  fields: ResolvedField[],
): Promise<CatalogChoices> {
  const keys = [
    ...new Set(
      fields
        .filter((f) => f.type === "catalog" && f.catalogKey)
        .map((f) => f.catalogKey!),
    ),
  ];
  if (keys.length === 0) return {};

  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        catalogKey: catalogItems.catalogKey,
        code: catalogItems.code,
        label: catalogItems.label,
        archivedAt: catalogItems.archivedAt,
      })
      .from(catalogItems)
      .where(and(eq(catalogItems.tenantId, tenantId), inArray(catalogItems.catalogKey, keys)))
      .orderBy(asc(catalogItems.sortOrder), asc(catalogItems.label)),
  );

  const salida: CatalogChoices = Object.fromEntries(
    keys.map((k) => [k, { options: [], labels: {} }]),
  );
  for (const row of rows) {
    const destino = salida[row.catalogKey];
    destino.labels[row.code] = row.label;
    if (!row.archivedAt) destino.options.push({ code: row.code, label: row.label });
  }
  return salida;
}
