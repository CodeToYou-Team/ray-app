import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/lib/db/tenant";
import { products, stockMovements } from "@/lib/db/schema";
import { normalizeQuantity } from "@/lib/money";

/**
 * El stock NO es una columna: es la suma de los movimientos.
 *
 * Una columna `products.stock` que se incrementa es una fabrica de bugs — se
 * dobla al reintentar, se desincroniza al anular, y cuando el conteo fisico no
 * cuadra no hay forma de saber donde se perdio. Con movimientos append-only,
 * "por que dice 14 y hay 12" es una consulta.
 *
 * A esta escala (miles de filas por cliente) sumar en cada lectura es gratis. Si
 * algun dia pesa, se agrega una tabla de cache mantenida por trigger — pero
 * derivado primero, cacheado despues, nunca al reves.
 */

export type StockStatus = "sin_stock" | "bajo" | "ok";

export interface ProductStock {
  productId: string;
  name: string;
  sku: string | null;
  /** Cantidad actual, como string: puede tener 3 decimales. */
  stock: string;
  minStock: string | null;
  status: StockStatus;
}

export function stockStatus(stock: string, minStock: string | null): StockStatus {
  const actual = Number(stock);
  if (actual <= 0) return "sin_stock";
  if (minStock !== null && actual <= Number(minStock)) return "bajo";
  return "ok";
}

/** Stock de todos los productos activos del cliente. */
export async function listStock(tenantId: string): Promise<ProductStock[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        productId: products.id,
        name: products.name,
        sku: products.sku,
        minStock: products.minStock,
        stock: sql<string>`coalesce(sum(${stockMovements.delta}), 0)::text`,
      })
      .from(products)
      .leftJoin(
        stockMovements,
        and(
          eq(stockMovements.productId, products.id),
          eq(stockMovements.tenantId, products.tenantId),
        ),
      )
      .where(and(eq(products.tenantId, tenantId), isNull(products.deletedAt)))
      .groupBy(products.id, products.name, products.sku, products.minStock)
      .orderBy(products.name),
  );

  // Se normaliza la escala: Postgres devuelve "7.000" cuando hay movimientos
  // (numeric(14,3)) pero "0" cuando el coalesce cae al literal entero. Sin esto
  // la misma columna se veria con y sin decimales segun el producto.
  return rows.map((r) => {
    const stock = normalizeQuantity(r.stock);
    return {
      ...r,
      stock,
      minStock: r.minStock === null ? null : normalizeQuantity(r.minStock),
      status: stockStatus(stock, r.minStock),
    };
  });
}

/** Stock de un solo producto. */
export async function getStock(
  tenantId: string,
  productId: string,
): Promise<string> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        stock: sql<string>`coalesce(sum(${stockMovements.delta}), 0)::text`,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.tenantId, tenantId),
          eq(stockMovements.productId, productId),
        ),
      ),
  );
  return normalizeQuantity(rows[0]?.stock ?? "0");
}

/**
 * Si el error es el `ST001` del trigger de stock (drizzle/0023), qué producto
 * no alcanzó y cuánto queda de verdad. `null` si es cualquier otro error.
 *
 * El stock se vuelve a leer en vez de sacarlo del mensaje: la transacción que
 * falló ya se deshizo, y lo que le sirve a quien vende es lo confirmado, no la
 * cuenta a medias que hizo el trigger.
 */
export async function faltaDeStock(
  tenantId: string,
  error: unknown,
): Promise<{ productId: string; name: string; stock: string } | null> {
  const pg = pgError(error);
  if (pg?.code !== "ST001" || !pg.detail) return null;

  const productId = pg.detail;
  const [producto] = await withTenant(tenantId, (tx) =>
    tx
      .select({ name: products.name })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId))),
  );
  return {
    productId,
    name: producto?.name ?? "un producto",
    stock: await getStock(tenantId, productId),
  };
}

/** El error de Postgres debajo de los envoltorios de Drizzle. */
function pgError(error: unknown): { code: string; detail?: string } | undefined {
  let current: unknown = error;
  while (current) {
    const { code, detail } = current as { code?: unknown; detail?: unknown };
    if (typeof code === "string") {
      return { code, detail: typeof detail === "string" ? detail : undefined };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export interface StockMovementRow {
  id: string;
  delta: string;
  reason: string;
  note: string | null;
  occurredAt: Date;
}

/**
 * Historial de un producto, del mas reciente al mas viejo.
 *
 * Es la respuesta a "por que dice 14 y hay 12": cada entrada y cada salida, con
 * su motivo y de que operacion vino.
 */
export async function listMovements(
  tenantId: string,
  productId: string,
  limit = 100,
): Promise<StockMovementRow[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: stockMovements.id,
        delta: stockMovements.delta,
        reason: stockMovements.reason,
        note: stockMovements.note,
        occurredAt: stockMovements.occurredAt,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.tenantId, tenantId),
          eq(stockMovements.productId, productId),
        ),
      )
      .orderBy(sql`${stockMovements.occurredAt} desc, ${stockMovements.id} desc`)
      .limit(limit),
  );
}
