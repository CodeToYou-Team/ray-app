import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { withTenant } from "@/lib/db/tenant";
import { catalogItems, products, services, stockMovements } from "@/lib/db/schema";
import { normalizeQuantity } from "@/lib/money";

/** Lo minimo para poblar el selector de renglones de una venta o compra. */
export interface SellableItem {
  id: string;
  name: string;
  price: string;
  currency: string;
  kind: "product" | "service";
  /**
   * Solo productos: cuanto queda ahora. Sirve para avisar en el formulario
   * antes de enviar; quien decide es el trigger de stock al guardar, porque
   * entre que se abre el formulario y se envia otra caja pudo vender.
   */
  stock?: string;
}

/**
 * Productos y servicios activos, para el editor de renglones.
 *
 * Van juntos porque una venta puede llevar de los dos. Una compra de insumos
 * solo admite productos — eso lo filtra el formulario y lo hace cumplir un
 * trigger en la base.
 */
export async function listSellables(tenantId: string): Promise<SellableItem[]> {
  const [prods, servs] = await withTenant(tenantId, async (tx) => [
    await tx
      .select({
        id: products.id,
        name: products.name,
        price: products.price,
        currency: products.currency,
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
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.isActive, true),
          isNull(products.deletedAt),
        ),
      )
      .groupBy(products.id, products.name, products.price, products.currency)
      .orderBy(asc(products.name)),
    await tx
      .select({
        id: services.id,
        name: services.name,
        price: services.price,
        currency: services.currency,
      })
      .from(services)
      .where(
        and(
          eq(services.tenantId, tenantId),
          eq(services.isActive, true),
          isNull(services.deletedAt),
        ),
      )
      .orderBy(asc(services.name)),
  ]);

  return [
    ...prods.map((p) => ({
      ...p,
      stock: normalizeQuantity(p.stock),
      kind: "product" as const,
    })),
    ...servs.map((s) => ({ ...s, kind: "service" as const })),
  ];
}

export interface CatalogProduct {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string;
  categoryLabel: string;
  price: string;
  currency: string;
  minStock: string | null;
  isActive: boolean;
  archived: boolean;
  /** Suma de movimientos, no una columna guardada. */
  stock: string;
  /** Valores de las columnas personalizadas, por clave inmutable. */
  custom: Record<string, unknown>;
}

export interface CatalogService {
  id: string;
  name: string;
  categoryId: string;
  categoryLabel: string;
  price: string;
  currency: string;
  isActive: boolean;
  archived: boolean;
  custom: Record<string, unknown>;
}

/**
 * Catalogo de productos con su stock.
 *
 * El stock sale del LEFT JOIN sumado, no de una columna: un producto sin ningun
 * movimiento tiene que aparecer en cero, no desaparecer de la lista.
 */
export async function listProducts(
  tenantId: string,
  options: { includeArchived?: boolean } = {},
): Promise<CatalogProduct[]> {
  const categoria = alias(catalogItems, "categoria");

  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        categoryId: products.categoryId,
        categoryLabel: categoria.label,
        price: products.price,
        currency: products.currency,
        minStock: products.minStock,
        isActive: products.isActive,
        deletedAt: products.deletedAt,
        custom: products.custom,
        stock: sql<string>`coalesce(sum(${stockMovements.delta}), 0)::text`,
      })
      .from(products)
      .innerJoin(categoria, eq(categoria.id, products.categoryId))
      .leftJoin(
        stockMovements,
        and(
          eq(stockMovements.productId, products.id),
          eq(stockMovements.tenantId, products.tenantId),
        ),
      )
      .where(
        and(
          eq(products.tenantId, tenantId),
          options.includeArchived ? undefined : isNull(products.deletedAt),
        ),
      )
      .groupBy(
        products.id,
        products.name,
        products.sku,
        products.categoryId,
        categoria.label,
        products.price,
        products.currency,
        products.minStock,
        products.isActive,
        products.deletedAt,
        products.custom,
      )
      .orderBy(asc(products.name)),
  );

  return rows.map(({ deletedAt, ...r }) => ({
    ...r,
    archived: deletedAt !== null,
    stock: normalizeQuantity(r.stock),
    minStock: r.minStock === null ? null : normalizeQuantity(r.minStock),
  }));
}

export async function listServicesCatalog(
  tenantId: string,
  options: { includeArchived?: boolean } = {},
): Promise<CatalogService[]> {
  const categoria = alias(catalogItems, "categoria");

  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: services.id,
        name: services.name,
        categoryId: services.categoryId,
        categoryLabel: categoria.label,
        price: services.price,
        currency: services.currency,
        isActive: services.isActive,
        deletedAt: services.deletedAt,
        custom: services.custom,
      })
      .from(services)
      .innerJoin(categoria, eq(categoria.id, services.categoryId))
      .where(
        and(
          eq(services.tenantId, tenantId),
          options.includeArchived ? undefined : isNull(services.deletedAt),
        ),
      )
      .orderBy(asc(services.name)),
  );

  return rows.map(({ deletedAt, ...r }) => ({
    ...r,
    archived: deletedAt !== null,
  }));
}
