"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { withTenant } from "@/lib/db/tenant";
import { auditLog, catalogItems } from "@/lib/db/schema";
import { requireCapability } from "@/lib/authz/session";
import { CATALOGS, isCatalogKey, slugifyCode, type CatalogKey } from "./keys";
import { isKnownCurrency } from "@/lib/currencies";

/**
 * Server Actions de catalogos.
 *
 * Cada una empieza con `requireCapability`. Los Server Actions son endpoints
 * POST publicos, no rutinas internas: que la UI no pinte el boton no impide que
 * alguien invoque la accion directamente.
 */

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; field?: "label" | "currency" };

const labelSchema = z
  .string()
  .trim()
  .min(1, "El nombre no puede estar vacío")
  .max(80, "Máximo 80 caracteres");

/**
 * Se valida contra la lista conocida, no contra un regex de 3 letras.
 *
 * El selector de la UI ya limita las opciones, pero un Server Action es un
 * endpoint POST publico: sin esto, "usd" o "UDS" entrarian igual. Y como los
 * totales van separados por moneda y no se convierte nada, un codigo mal
 * escrito no produce ningun error — parte una moneda en dos en silencio.
 */
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  // 3 a 5: las ISO 4217 son de 3 (USD, VES), pero las stablecoins son de 4
  // (USDT, USDC). El .refine de abajo es la validacion real; este regex solo
  // descarta basura antes de buscar en la lista.
  .regex(/^[A-Z0-9]{3,5}$/, "Código de moneda inválido")
  .refine(isKnownCurrency, "Esa moneda no está en la lista disponible");

/** Traduce errores de Postgres a algo que el usuario entienda. */
function describeDbError(error: unknown): string {
  let current: unknown = error;
  while (current) {
    const code = (current as { code?: unknown }).code;
    if (code === "23505") {
      return "Ya existe un elemento con ese nombre en este catálogo.";
    }
    if (code === "23514") return "Los datos no cumplen las reglas del catálogo.";
    if (code === "23001") return "Ese elemento no se puede modificar así.";
    if (code === "23503") return "No se puede quitar: hay registros que lo usan.";
    current = (current as { cause?: unknown }).cause;
  }
  return "No se pudo completar la operación.";
}

type ParsedInput =
  | { error: string; field?: "label" | "currency" }
  | { catalogKey: CatalogKey; label: string; currency: string | null };

function parseInput(
  rawKey: string,
  rawLabel: string,
  rawCurrency: string | null,
): ParsedInput {
  if (!isCatalogKey(rawKey)) return { error: "Catálogo desconocido" };

  const parsedLabel = labelSchema.safeParse(rawLabel);
  if (!parsedLabel.success) {
    return { error: parsedLabel.error.issues[0].message, field: "label" };
  }

  let currency: string | null = null;
  if (CATALOGS[rawKey].hasCurrency) {
    const parsed = currencySchema.safeParse(rawCurrency ?? "");
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message, field: "currency" };
    }
    currency = parsed.data;
  }

  return { catalogKey: rawKey, label: parsedLabel.data, currency };
}

export async function createCatalogItem(input: {
  catalogKey: string;
  label: string;
  currency?: string | null;
}): Promise<ActionResult> {
  const { tenantId, user } = await requireCapability("catalog:manage");

  const parsed = parseInput(
    input.catalogKey,
    input.label,
    input.currency ?? null,
  );
  if ("error" in parsed) {
    return { ok: false, error: parsed.error, field: parsed.field };
  }

  const baseCode = slugifyCode(parsed.label);
  if (!baseCode) {
    return {
      ok: false,
      error: "El nombre necesita al menos una letra o número.",
      field: "label",
    };
  }

  const id = uuidv7();

  try {
    const duplicateLabel = await withTenant(tenantId, async (tx) => {
      const existing = await tx
        .select({
          code: catalogItems.code,
          label: catalogItems.label,
          sortOrder: catalogItems.sortOrder,
        })
        .from(catalogItems)
        .where(
          and(
            eq(catalogItems.tenantId, tenantId),
            eq(catalogItems.catalogKey, parsed.catalogKey),
          ),
        );

      // Mismo nombre exacto: es un duplicado de verdad, se rechaza.
      const clash = existing.find(
        (row) => row.label.toLowerCase() === parsed.label.toLowerCase(),
      );
      if (clash) return true;

      /**
       * Mismo code pero nombre distinto: se desambigua en vez de rechazar.
       * Pasa mas de lo que parece, porque el slug descarta simbolos y acentos
       * ("Efectivo $" y "Efectivo €" dan los dos "efectivo"). Rechazar le diria
       * al usuario "ya existe" señalando un nombre que no se parece al que
       * escribio.
       */
      const taken = new Set(existing.map((row) => row.code));
      let code = baseCode;
      for (let n = 2; taken.has(code); n++) code = `${baseCode}_${n}`;

      const nextOrder =
        existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;

      await tx.insert(catalogItems).values({
        id,
        tenantId,
        catalogKey: parsed.catalogKey,
        code,
        label: parsed.label,
        currency: parsed.currency,
        sortOrder: nextOrder,
      });

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "catalog_items",
        entityId: id,
        action: "create",
        actorId: user.id,
        diff: {
          catalogKey: parsed.catalogKey,
          code,
          label: parsed.label,
          currency: parsed.currency,
        },
      });

      return false;
    });

    if (duplicateLabel) {
      return {
        ok: false,
        error: "Ya existe un elemento con ese nombre en este catálogo.",
        field: "label",
      };
    }
  } catch (error) {
    return { ok: false, error: describeDbError(error) };
  }

  revalidatePath("/ajustes/catalogos");
  return { ok: true };
}

/** Solo cambia lo editable. El `code` es inmutable: renombrar toca `label`. */
export async function updateCatalogItem(input: {
  id: string;
  catalogKey: string;
  label: string;
  currency?: string | null;
}): Promise<ActionResult> {
  const { tenantId, user } = await requireCapability("catalog:manage");

  const parsed = parseInput(
    input.catalogKey,
    input.label,
    input.currency ?? null,
  );
  if ("error" in parsed) {
    return { ok: false, error: parsed.error, field: parsed.field };
  }

  try {
    const found = await withTenant(tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(catalogItems)
        .where(
          and(eq(catalogItems.id, input.id), eq(catalogItems.tenantId, tenantId)),
        );

      if (!before) return false;

      await tx
        .update(catalogItems)
        .set({ label: parsed.label, currency: parsed.currency })
        .where(
          and(eq(catalogItems.id, input.id), eq(catalogItems.tenantId, tenantId)),
        );

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "catalog_items",
        entityId: input.id,
        action: "update",
        actorId: user.id,
        diff: {
          label: { from: before.label, to: parsed.label },
          ...(before.currency !== parsed.currency
            ? { currency: { from: before.currency, to: parsed.currency } }
            : {}),
        },
      });

      return true;
    });

    if (!found) return { ok: false, error: "No se encontró ese elemento." };
  } catch (error) {
    return { ok: false, error: describeDbError(error) };
  }

  revalidatePath("/ajustes/catalogos");
  return { ok: true };
}

/**
 * "Eliminar" archiva, no borra.
 *
 * Borrar de verdad una categoria con transacciones romperia la FK, o peor,
 * dejaria huerfano el historico y los reportes de meses ya cerrados. Archivada:
 * desaparece de los selectores nuevos y se sigue viendo en los registros viejos.
 */
export async function setCatalogItemArchived(input: {
  id: string;
  archived: boolean;
}): Promise<ActionResult> {
  const { tenantId, user } = await requireCapability("catalog:manage");

  try {
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(catalogItems)
        .set({ archivedAt: input.archived ? new Date() : null })
        .where(
          and(eq(catalogItems.id, input.id), eq(catalogItems.tenantId, tenantId)),
        );

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "catalog_items",
        entityId: input.id,
        action: input.archived ? "delete" : "restore",
        actorId: user.id,
        diff: {},
      });
    });
  } catch (error) {
    return { ok: false, error: describeDbError(error) };
  }

  revalidatePath("/ajustes/catalogos");
  return { ok: true };
}

/** Reordena un catalogo completo. `ids` viene en el orden deseado. */
export async function reorderCatalog(input: {
  catalogKey: string;
  ids: string[];
}): Promise<ActionResult> {
  const { tenantId } = await requireCapability("catalog:manage");

  if (!isCatalogKey(input.catalogKey)) {
    return { ok: false, error: "Catálogo desconocido" };
  }

  try {
    await withTenant(tenantId, async (tx) => {
      for (const [index, id] of input.ids.entries()) {
        await tx
          .update(catalogItems)
          .set({ sortOrder: index })
          .where(
            and(
              eq(catalogItems.id, id),
              eq(catalogItems.tenantId, tenantId),
              eq(catalogItems.catalogKey, input.catalogKey),
            ),
          );
      }
    });
  } catch (error) {
    return { ok: false, error: describeDbError(error) };
  }

  revalidatePath("/ajustes/catalogos");
  return { ok: true };
}
