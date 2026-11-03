"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/authz/session";
import {
  createField as createFieldCore,
  updateField as updateFieldCore,
  upsertFixedOverride as upsertFixedOverrideCore,
  archiveField as archiveFieldCore,
  reorderFields as reorderFieldsCore,
  type CreateFieldInput,
  type UpdateFieldInput,
  type FieldResult,
} from "./register";
import type { FieldEntity } from "@/lib/db/schema";

/**
 * Server Actions de configuracion de columnas.
 *
 * Todas exigen `field:manage`, que hoy solo tiene el rol `owner`: cambiar el
 * esquema de datos de un cliente no es una operacion del dia a dia.
 */

export type { CreateFieldInput, UpdateFieldInput, FieldResult };

function revalidateFields() {
  revalidatePath("/ajustes/columnas");
  revalidatePath("/productos");
  revalidatePath("/servicios");
  revalidatePath("/reservas");
  revalidatePath("/reservas/listado");
}

export async function createField(
  input: CreateFieldInput,
): Promise<FieldResult> {
  const { tenantId, user } = await requireCapability("field:manage");
  try {
    return await createFieldCore({ tenantId, userId: user.id }, input);
  } finally {
    revalidateFields();
  }
}

export async function updateField(
  id: string,
  input: UpdateFieldInput,
): Promise<FieldResult> {
  const { tenantId, user } = await requireCapability("field:manage");
  try {
    return await updateFieldCore({ tenantId, userId: user.id }, id, input);
  } finally {
    revalidateFields();
  }
}

/** Renombrar u ocultar una columna fija: crea su fila de override si no existe. */
export async function updateFixedField(
  entity: FieldEntity,
  key: string,
  input: UpdateFieldInput,
): Promise<FieldResult> {
  const { tenantId, user } = await requireCapability("field:manage");
  try {
    return await upsertFixedOverrideCore(
      { tenantId, userId: user.id },
      entity,
      key,
      input,
    );
  } finally {
    revalidateFields();
  }
}

export async function setFieldArchived(
  id: string,
  archived: boolean,
): Promise<FieldResult> {
  const { tenantId, user } = await requireCapability("field:manage");
  try {
    return await archiveFieldCore({ tenantId, userId: user.id }, id, archived);
  } finally {
    revalidateFields();
  }
}

export async function reorderFields(
  entity: FieldEntity,
  ids: string[],
): Promise<FieldResult> {
  const { tenantId, user } = await requireCapability("field:manage");
  try {
    return await reorderFieldsCore({ tenantId, userId: user.id }, entity, ids);
  } finally {
    revalidateFields();
  }
}
