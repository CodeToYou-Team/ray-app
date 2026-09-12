import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/tenant";
import { fieldConfig } from "@/lib/db/schema";
import type { FieldConfigRow, FieldEntity } from "@/lib/db/schema";
import { resolveFields, type ResolvedField } from "./resolve";
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
