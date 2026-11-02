import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { withTenant } from "@/lib/db/tenant";
import {
  auditLog,
  fieldConfig,
  fieldEntity,
  type FieldEntity,
  type FieldType,
} from "@/lib/db/schema";
import { FIELD_TYPES, slugifyKey, type FieldOption } from "./types";
import { fixedField } from "./fixed";
import { loadFieldConfigIn } from "./queries";

/**
 * Configuracion de columnas, sin autorizacion. El punto de entrada es actions.ts.
 *
 * Las reglas que hacen seguro que el cliente edite esto estan repartidas a
 * proposito: las estructurales en la base (clave inmutable, tipo inmutable) y
 * las de intencion aqui. Una regla que solo vive en la UI no es una regla.
 */

export interface ActorContext {
  tenantId: string;
  userId: string;
}

export type FieldResult =
  | { ok: true; id: string }
  | { ok: false; error: string; field?: string };

const optionSchema = z.object({
  /**
   * Opcional: una opcion NUEVA todavia no tiene codigo, se deriva de su
   * etiqueta en `prepareOptions`. Cuando viene, es porque la opcion ya existia
   * y hay que conservarlo — es lo que tienen guardado los productos.
   */
  code: z.string().trim().min(1).max(60).optional(),
  label: z.string().trim().min(1).max(80),
  archivedAt: z.string().optional(),
});

const createSchema = z.object({
  entity: z.enum(fieldEntity.enumValues),
  label: z.string().trim().min(1, "Escribe un nombre").max(80),
  type: z.enum(Object.keys(FIELD_TYPES) as [FieldType, ...FieldType[]]),
  required: z.boolean().optional(),
  options: z.array(optionSchema).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  showInTable: z.boolean().optional(),
});

const updateSchema = z.object({
  label: z.string().trim().min(1, "Escribe un nombre").max(80),
  required: z.boolean().optional(),
  options: z.array(optionSchema).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  hidden: z.boolean().optional(),
  showInTable: z.boolean().optional(),
});

export type CreateFieldInput = z.infer<typeof createSchema>;
export type UpdateFieldInput = z.infer<typeof updateSchema>;

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function describe(error: unknown): string {
  const code = pgCode(error);
  if (code === "23505") return "Ya existe una columna con ese nombre.";
  if (code === "23001") {
    return "Esa propiedad no se puede cambiar: el identificador y el tipo son fijos.";
  }
  if (code === "23514") return "Los datos no cumplen las reglas.";
  return "No se pudo guardar.";
}

/** Deriva codigos estables para las opciones y evita choques. */
function prepareOptions(
  entradas: { code?: string; label: string; archivedAt?: string }[] | undefined,
  previas: FieldOption[],
): FieldOption[] | { error: string } {
  if (!entradas) return previas;

  const codigosPrevios = new Map(previas.map((o) => [o.label.toLowerCase(), o.code]));
  const usados = new Set<string>();
  const salida: FieldOption[] = [];

  for (const entrada of entradas) {
    // Si la opcion ya existia (por codigo o por etiqueta), conserva SU codigo:
    // es lo que tienen guardado los productos.
    const code =
      entrada.code ||
      codigosPrevios.get(entrada.label.toLowerCase()) ||
      slugifyKey(entrada.label);

    if (!code) return { error: `"${entrada.label}" necesita al menos una letra o número.` };

    let unico = code;
    for (let n = 2; usados.has(unico); n++) unico = `${code}_${n}`;
    usados.add(unico);

    salida.push({
      code: unico,
      label: entrada.label.trim(),
      ...(entrada.archivedAt ? { archivedAt: entrada.archivedAt } : {}),
    });
  }

  /**
   * Las opciones que ya no vienen en la lista se ARCHIVAN, no se pierden.
   *
   * Si se borraran, cada producto que tuviera ese valor se renderizaria vacio y
   * al editarlo la validacion rechazaria una fila que era valida cuando se
   * escribio.
   */
  for (const previa of previas) {
    if (!salida.some((o) => o.code === previa.code)) {
      salida.push({
        ...previa,
        archivedAt: previa.archivedAt ?? new Date().toISOString(),
      });
    }
  }

  return salida;
}

export async function createField(
  { tenantId, userId }: ActorContext,
  raw: CreateFieldInput,
): Promise<FieldResult> {
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const input = parsed.data;
  const def = FIELD_TYPES[input.type];

  const baseKey = slugifyKey(input.label);
  if (!baseKey) {
    return {
      ok: false,
      error: "El nombre necesita al menos una letra o número.",
      field: "label",
    };
  }

  if (def.usesOptions && (!input.options || input.options.length === 0)) {
    return {
      ok: false,
      error: "Agrega al menos una opción.",
      field: "options",
    };
  }
  if (def.usesCatalog && !input.config?.catalogKey) {
    return { ok: false, error: "Elige un catálogo.", field: "config" };
  }

  const id = uuidv7();

  try {
    return await withTenant(tenantId, async (tx) => {
      const existentes = await loadFieldConfigIn(tx, tenantId, input.entity);

      // Una columna fija ocupa su clave: no se puede sombrear `price` con una
      // personalizada, porque el valor se leeria de dos lugares distintos.
      if (fixedField(input.entity, baseKey)) {
        return {
          ok: false as const,
          error: `"${input.label}" choca con una columna que ya existe.`,
          field: "label",
        };
      }

      // Mismo nombre exacto: duplicado de verdad. Mismo slug con nombre
      // distinto: se desambigua, igual que en los catalogos.
      if (
        existentes.some(
          (e) => (e.label ?? "").toLowerCase() === input.label.toLowerCase(),
        )
      ) {
        return {
          ok: false as const,
          error: "Ya existe una columna con ese nombre.",
          field: "label",
        };
      }

      const ocupadas = new Set(existentes.map((e) => e.key));
      let key = baseKey;
      for (let n = 2; ocupadas.has(key); n++) key = `${baseKey}_${n}`;

      const opciones = prepareOptions(input.options, []);
      if ("error" in opciones) {
        return { ok: false as const, error: opciones.error, field: "options" };
      }

      const [next] = await tx
        .select({
          value: sql<number>`coalesce(max(${fieldConfig.sortOrder}), -1) + 1`,
        })
        .from(fieldConfig)
        .where(
          and(
            eq(fieldConfig.tenantId, tenantId),
            eq(fieldConfig.entity, input.entity),
            eq(fieldConfig.source, "custom"),
          ),
        );

      await tx.insert(fieldConfig).values({
        id,
        tenantId,
        entity: input.entity,
        key,
        source: "custom",
        label: input.label,
        type: input.type,
        required: input.required ?? false,
        options: opciones,
        config: input.config ?? {},
        showInTable: input.showInTable ?? true,
        sortOrder: Number(next?.value ?? 0),
      });

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "field_config",
        entityId: id,
        action: "create",
        actorId: userId,
        diff: { entity: input.entity, key, type: input.type, label: input.label },
      });

      return { ok: true as const, id };
    });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/**
 * Edita lo que se puede editar.
 *
 * Deliberadamente NO admite cambiar `key` ni `type`: los dos son inmutables y
 * un trigger los defiende. Cambiar el tipo de un campo con datos escritos los
 * dejaria sin poder leerse ("rojo" no se convierte en número). El camino
 * soportado es crear uno nuevo y archivar el viejo.
 */
export async function updateField(
  { tenantId, userId }: ActorContext,
  id: string,
  raw: UpdateFieldInput,
): Promise<FieldResult> {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const input = parsed.data;

  try {
    return await withTenant(tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(fieldConfig)
        .where(and(eq(fieldConfig.id, id), eq(fieldConfig.tenantId, tenantId)));

      if (!before) return { ok: false as const, error: "No se encontró la columna." };

      const opciones = prepareOptions(input.options, before.options ?? []);
      if ("error" in opciones) {
        return { ok: false as const, error: opciones.error, field: "options" };
      }

      const fija = before.source === "fixed";
      const def = fixedField(before.entity, before.key);

      await tx
        .update(fieldConfig)
        .set({
          label: input.label,
          // De una columna fija solo se puede cambiar la presentacion: su
          // obligatoriedad y sus opciones salen del codigo.
          required: fija ? before.required : (input.required ?? false),
          options: fija ? before.options : opciones,
          config: fija ? before.config : (input.config ?? before.config),
          // El nombre nunca se oculta: sin el, la fila no se identifica.
          hidden: def?.alwaysVisible ? false : (input.hidden ?? before.hidden),
          showInTable: input.showInTable ?? before.showInTable,
        })
        .where(and(eq(fieldConfig.id, id), eq(fieldConfig.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "field_config",
        entityId: id,
        action: "update",
        actorId: userId,
        diff: {
          ...(before.label !== input.label
            ? { label: { from: before.label, to: input.label } }
            : {}),
        },
      });

      return { ok: true as const, id };
    });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/**
 * Crea la fila de override de una columna FIJA la primera vez que se toca.
 *
 * Las fijas no nacen con fila: asi, agregar una columna fija nueva en el codigo
 * no obliga a escribir en la base de cada cliente. La fila aparece solo cuando
 * el cliente decide cambiarle algo.
 */
export async function upsertFixedOverride(
  ctx: ActorContext,
  entity: FieldEntity,
  key: string,
  input: UpdateFieldInput,
): Promise<FieldResult> {
  const def = fixedField(entity, key);
  if (!def) return { ok: false, error: "Esa columna no existe." };

  const { tenantId } = ctx;

  try {
    const existente = await withTenant(tenantId, (tx) =>
      tx
        .select({ id: fieldConfig.id })
        .from(fieldConfig)
        .where(
          and(
            eq(fieldConfig.tenantId, tenantId),
            eq(fieldConfig.entity, entity),
            eq(fieldConfig.key, key),
          ),
        ),
    );

    if (existente[0]) return updateField(ctx, existente[0].id, input);

    const id = uuidv7();
    await withTenant(tenantId, async (tx) => {
      await tx.insert(fieldConfig).values({
        id,
        tenantId,
        entity,
        key,
        source: "fixed",
        label: input.label,
        // Null a proposito: el tipo de una fija vive en el codigo.
        type: null,
        hidden: def.alwaysVisible ? false : (input.hidden ?? false),
        showInTable: input.showInTable ?? true,
        sortOrder: 0,
      });
    });

    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/** Archiva una columna personalizada. Los datos se quedan en el JSONB. */
export async function archiveField(
  { tenantId, userId }: ActorContext,
  id: string,
  archived: boolean,
): Promise<FieldResult> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(fieldConfig)
        .where(and(eq(fieldConfig.id, id), eq(fieldConfig.tenantId, tenantId)));

      if (!before) return { ok: false as const, error: "No se encontró la columna." };
      if (before.source === "fixed") {
        return {
          ok: false as const,
          error: "Las columnas del sistema no se archivan. Puedes ocultarlas.",
        };
      }

      await tx
        .update(fieldConfig)
        .set({ archivedAt: archived ? new Date() : null })
        .where(and(eq(fieldConfig.id, id), eq(fieldConfig.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "field_config",
        entityId: id,
        action: archived ? "delete" : "restore",
        actorId: userId,
        diff: { key: before.key },
      });

      return { ok: true as const, id };
    });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/** Reordena las columnas personalizadas de una entidad. */
export async function reorderFields(
  { tenantId }: ActorContext,
  entity: FieldEntity,
  ids: string[],
): Promise<FieldResult> {
  try {
    await withTenant(tenantId, async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx
          .update(fieldConfig)
          .set({ sortOrder: index })
          .where(
            and(
              eq(fieldConfig.id, id),
              eq(fieldConfig.tenantId, tenantId),
              eq(fieldConfig.entity, entity),
            ),
          );
      }
    });
    return { ok: true, id: ids[0] ?? "" };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}
