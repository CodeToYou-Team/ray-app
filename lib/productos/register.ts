import "server-only";

import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { withTenant } from "@/lib/db/tenant";
import {
  auditLog,
  catalogItems,
  products,
  services,
  stockMovements,
} from "@/lib/db/schema";
import { isMoney, isQuantity, normalizeMoney, normalizeQuantity, isZero } from "@/lib/money";
import { isKnownCurrency } from "@/lib/currencies";
import { loadFieldConfigIn } from "@/lib/fields/queries";
import { resolveFields } from "@/lib/fields/resolve";
import { validateCustomValues } from "@/lib/fields/validate";
import type { Tx } from "@/lib/db";
import type { FieldEntity } from "@/lib/db/schema";

/**
 * Alta y edicion de productos y servicios, sin autorizacion.
 *
 * Igual que lib/finanzas/register.ts: vive separado de actions.ts para poder
 * probar la logica sin simular una sesion. El punto de entrada es actions.ts.
 */

export interface ActorContext {
  tenantId: string;
  userId: string;
}

export type ItemResult =
  | { ok: true; id: string }
  | { ok: false; error: string; field?: string };

const moneySchema = z.string().refine(isMoney, "Precio inválido");
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isKnownCurrency, "Moneda no disponible");

const productSchema = z.object({
  name: z.string().trim().min(1, "Escribe un nombre").max(160),
  sku: z.string().trim().max(60).optional(),
  categoryId: z.uuid("Elige una categoría"),
  price: moneySchema,
  currency: currencySchema,
  minStock: z.string().refine(isQuantity, "Cantidad inválida").optional(),
  /** Solo al crear: genera el movimiento 'inicial'. */
  initialStock: z.string().refine(isQuantity, "Cantidad inválida").optional(),
  isActive: z.boolean().optional(),
  /**
   * Valores de las columnas personalizadas, indexados por la clave inmutable
   * del campo. Se validan contra la configuracion del cliente, no contra un
   * esquema fijo.
   */
  custom: z.record(z.string(), z.unknown()).optional(),
});

const serviceSchema = productSchema.omit({
  sku: true,
  minStock: true,
  initialStock: true,
});

/**
 * Valida los campos personalizados contra la configuracion del cliente.
 *
 * Corre dentro de la misma transaccion que la escritura: si alguien cambia la
 * configuracion mientras se guarda, se valida contra una foto consistente.
 */
async function resolveCustom(
  tx: Tx,
  tenantId: string,
  entity: FieldEntity,
  raw: Record<string, unknown> | undefined,
): Promise<{ values: Record<string, unknown> } | { error: string; field: string }> {
  const config = await loadFieldConfigIn(tx, tenantId, entity);
  const fields = resolveFields(entity, config, { includeHidden: true });

  const result = validateCustomValues(fields, raw ?? {});
  if (!result.ok) {
    return { error: result.issues[0].message, field: result.issues[0].key };
  }
  return { values: result.values };
}

export type ProductInput = z.infer<typeof productSchema>;
export type ServiceInput = z.infer<typeof serviceSchema>;

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
  if (code === "23505") return "Ya existe otro producto con ese SKU.";
  if (code === "23503") return "Esa categoría no existe.";
  if (code === "23514") return "Los datos no cumplen las reglas del catálogo.";
  return "No se pudo guardar.";
}

/** Valida que la categoria salga del catalogo correcto y este activa. */
async function checkCategory(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  categoryId: string,
  catalogKey: "product_category" | "service_category",
): Promise<string | null> {
  const [row] = await tx
    .select({ archivedAt: catalogItems.archivedAt, label: catalogItems.label })
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.id, categoryId),
        eq(catalogItems.tenantId, tenantId),
        eq(catalogItems.catalogKey, catalogKey),
      ),
    );

  if (!row) return "Esa categoría no existe.";
  if (row.archivedAt) return `"${row.label}" está archivada.`;
  return null;
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

export async function registerProduct(
  { tenantId, userId }: ActorContext,
  raw: ProductInput,
): Promise<ItemResult> {
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0].message,
      field: String(parsed.error.issues[0].path[0] ?? ""),
    };
  }
  const input = parsed.data;
  const id = uuidv7();

  try {
    return await withTenant(tenantId, async (tx) => {
      const problema = await checkCategory(
        tx,
        tenantId,
        input.categoryId,
        "product_category",
      );
      if (problema) return { ok: false as const, error: problema, field: "categoryId" };

      const custom = await resolveCustom(tx, tenantId, "product", input.custom);
      if ("error" in custom) {
        return { ok: false as const, error: custom.error, field: custom.field };
      }

      await tx.insert(products).values({
        id,
        tenantId,
        name: input.name,
        sku: input.sku || null,
        categoryId: input.categoryId,
        categoryCatalogKey: "product_category",
        price: normalizeMoney(input.price),
        currency: input.currency,
        minStock: input.minStock ? normalizeQuantity(input.minStock) : null,
        isActive: input.isActive ?? true,
        custom: custom.values,
      });

      /**
       * El stock inicial es un MOVIMIENTO, no una columna. Asi la primera
       * cantidad queda en el mismo historial que las compras y las ventas, y el
       * "por que dice 14" tiene respuesta desde el dia uno.
       */
      if (input.initialStock && !isZero(input.initialStock, 3)) {
        await tx.insert(stockMovements).values({
          id: uuidv7(),
          tenantId,
          productId: id,
          delta: normalizeQuantity(input.initialStock),
          reason: "inicial",
          occurredAt: new Date(),
          createdBy: userId,
        });
      }

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "products",
        entityId: id,
        action: "create",
        actorId: userId,
        diff: { name: input.name, price: input.price, currency: input.currency },
      });

      return { ok: true as const, id };
    });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function updateProduct(
  { tenantId, userId }: ActorContext,
  id: string,
  raw: ProductInput,
): Promise<ItemResult> {
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0].message,
      field: String(parsed.error.issues[0].path[0] ?? ""),
    };
  }
  const input = parsed.data;

  try {
    return await withTenant(tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, id), eq(products.tenantId, tenantId)));
      if (!before) return { ok: false as const, error: "No se encontró el producto." };

      const problema = await checkCategory(
        tx,
        tenantId,
        input.categoryId,
        "product_category",
      );
      if (problema) return { ok: false as const, error: problema, field: "categoryId" };

      const custom = await resolveCustom(tx, tenantId, "product", input.custom);
      if ("error" in custom) {
        return { ok: false as const, error: custom.error, field: custom.field };
      }

      await tx
        .update(products)
        .set({
          name: input.name,
          sku: input.sku || null,
          categoryId: input.categoryId,
          price: normalizeMoney(input.price),
          currency: input.currency,
          minStock: input.minStock ? normalizeQuantity(input.minStock) : null,
          isActive: input.isActive ?? true,
          /**
           * Se reemplaza el objeto entero, no se mezcla.
           *
           * Mezclar dejaria para siempre los valores de campos que el cliente
           * archivo, y el JSONB iria acumulando claves fantasma que nadie ve ni
           * puede borrar. Los campos archivados no se validan ni se reescriben,
           * asi que su valor se pierde al guardar — que es justo lo que
           * significa archivar un campo.
           */
          custom: custom.values,
        })
        .where(and(eq(products.id, id), eq(products.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "products",
        entityId: id,
        action: "update",
        actorId: userId,
        diff: {
          // El cambio de precio es lo que mas importa auditar: no altera las
          // ventas ya registradas, pero si todas las futuras.
          ...(before.price !== normalizeMoney(input.price)
            ? { price: { from: before.price, to: normalizeMoney(input.price) } }
            : {}),
          ...(before.name !== input.name
            ? { name: { from: before.name, to: input.name } }
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
 * Ajuste manual de inventario (conteo fisico, merma).
 *
 * Nunca "fija" el stock: inserta la diferencia como movimiento. Poner el stock
 * en un valor absoluto borraria la explicacion de por que cambio.
 */
export async function adjustStock(
  { tenantId, userId }: ActorContext,
  input: { productId: string; delta: string; reason: "ajuste" | "merma"; note?: string },
): Promise<ItemResult> {
  if (!isQuantity(input.delta)) {
    return { ok: false, error: "Cantidad inválida.", field: "delta" };
  }
  const delta = normalizeQuantity(input.delta);
  if (isZero(delta, 3)) {
    return { ok: false, error: "El ajuste no puede ser cero.", field: "delta" };
  }

  const id = uuidv7();
  try {
    return await withTenant(tenantId, async (tx) => {
      const [producto] = await tx
        .select({ name: products.name })
        .from(products)
        .where(
          and(eq(products.id, input.productId), eq(products.tenantId, tenantId)),
        );
      if (!producto) return { ok: false as const, error: "No se encontró el producto." };

      await tx.insert(stockMovements).values({
        id,
        tenantId,
        productId: input.productId,
        delta,
        reason: input.reason,
        note: input.note || null,
        occurredAt: new Date(),
        createdBy: userId,
      });

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "stock_movements",
        entityId: id,
        action: "create",
        actorId: userId,
        diff: { producto: producto.name, delta, reason: input.reason },
      });

      return { ok: true as const, id };
    });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/** Archiva. No borra: hay ventas historicas que lo referencian. */
export async function archiveProduct(
  { tenantId, userId }: ActorContext,
  id: string,
  archived: boolean,
): Promise<ItemResult> {
  try {
    return await withTenant(tenantId, async (tx) => {
      await tx
        .update(products)
        .set({ deletedAt: archived ? new Date() : null })
        .where(and(eq(products.id, id), eq(products.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "products",
        entityId: id,
        action: archived ? "delete" : "restore",
        actorId: userId,
        diff: {},
      });

      return { ok: true as const, id };
    });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

// ---------------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------------

export async function registerService(
  { tenantId, userId }: ActorContext,
  raw: ServiceInput,
): Promise<ItemResult> {
  const parsed = serviceSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0].message,
      field: String(parsed.error.issues[0].path[0] ?? ""),
    };
  }
  const input = parsed.data;
  const id = uuidv7();

  try {
    return await withTenant(tenantId, async (tx) => {
      const problema = await checkCategory(
        tx,
        tenantId,
        input.categoryId,
        "service_category",
      );
      if (problema) return { ok: false as const, error: problema, field: "categoryId" };

      const custom = await resolveCustom(tx, tenantId, "service", input.custom);
      if ("error" in custom) {
        return { ok: false as const, error: custom.error, field: custom.field };
      }

      await tx.insert(services).values({
        id,
        tenantId,
        name: input.name,
        categoryId: input.categoryId,
        categoryCatalogKey: "service_category",
        price: normalizeMoney(input.price),
        currency: input.currency,
        isActive: input.isActive ?? true,
        custom: custom.values,
      });

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "services",
        entityId: id,
        action: "create",
        actorId: userId,
        diff: { name: input.name, price: input.price, currency: input.currency },
      });

      return { ok: true as const, id };
    });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function updateService(
  { tenantId, userId }: ActorContext,
  id: string,
  raw: ServiceInput,
): Promise<ItemResult> {
  const parsed = serviceSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0].message,
      field: String(parsed.error.issues[0].path[0] ?? ""),
    };
  }
  const input = parsed.data;

  try {
    return await withTenant(tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(services)
        .where(and(eq(services.id, id), eq(services.tenantId, tenantId)));
      if (!before) return { ok: false as const, error: "No se encontró el servicio." };

      const problema = await checkCategory(
        tx,
        tenantId,
        input.categoryId,
        "service_category",
      );
      if (problema) return { ok: false as const, error: problema, field: "categoryId" };

      const custom = await resolveCustom(tx, tenantId, "service", input.custom);
      if ("error" in custom) {
        return { ok: false as const, error: custom.error, field: custom.field };
      }

      await tx
        .update(services)
        .set({
          name: input.name,
          categoryId: input.categoryId,
          price: normalizeMoney(input.price),
          currency: input.currency,
          isActive: input.isActive ?? true,
          custom: custom.values,
        })
        .where(and(eq(services.id, id), eq(services.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "services",
        entityId: id,
        action: "update",
        actorId: userId,
        diff: {
          ...(before.price !== normalizeMoney(input.price)
            ? { price: { from: before.price, to: normalizeMoney(input.price) } }
            : {}),
        },
      });

      return { ok: true as const, id };
    });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function archiveService(
  { tenantId, userId }: ActorContext,
  id: string,
  archived: boolean,
): Promise<ItemResult> {
  try {
    return await withTenant(tenantId, async (tx) => {
      await tx
        .update(services)
        .set({ deletedAt: archived ? new Date() : null })
        .where(and(eq(services.id, id), eq(services.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "services",
        entityId: id,
        action: archived ? "delete" : "restore",
        actorId: userId,
        diff: {},
      });

      return { ok: true as const, id };
    });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}
