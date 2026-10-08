import "server-only";

import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { withTenant } from "@/lib/db/tenant";
import { catalogItems, transactionItems, transactions } from "@/lib/db/schema";
import { normalizeMoney, subtractMoney } from "@/lib/money";
import type { TransactionType } from "@/lib/db/schema";

export interface TransactionRow {
  id: string;
  type: TransactionType;
  kind: string;
  concept: string;
  occurredOn: string;
  amount: string;
  currency: string;
  categoryLabel: string;
  paymentMethodLabel: string;
  /** Los ids, no solo las etiquetas: el formulario de correccion los precarga. */
  categoryId: string;
  paymentMethodId: string;
  /** La tasa con la que se convirtieron los precios, si hubo conversión. */
  exchangeRate: string | null;
  baseCurrency: string | null;
  notes: string | null;
  createdAt: Date;
}

/** Un renglon tal como quedo guardado, para precargar la correccion. */
export interface TransactionItemRow {
  itemType: "product" | "service";
  refId: string;
  qty: string;
  /** El precio CONGELADO, no el del catalogo hoy. */
  unitPrice: string;
}

export interface ListFilters {
  type?: TransactionType;
  /** Inclusive, formato YYYY-MM-DD. */
  from?: string;
  to?: string;
  currency?: string;
  /** Texto a buscar en el concepto. ILIKE: ignora may\u00fasculas, no acentos. */
  q?: string;
  page?: number;
  perPage?: number;
}

/**
 * Escapa los comodines de LIKE en lo que escribio el usuario.
 *
 * `%` y `_` significan algo dentro de un LIKE: sin esto, buscar "100%" traeria
 * todo lo que empieza por 100, y "a_b" cualquier cosa con una letra en medio.
 * El valor va igual como parametro, asi que esto no es contra inyeccion sino
 * contra que el buscador devuelva cosas que nadie pidio.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Total de una moneda. Los totales NUNCA se suman entre monedas. */
export interface CurrencyTotal {
  currency: string;
  total: string;
  count: number;
}

function baseWhere(tenantId: string, filters: ListFilters): SQL[] {
  const clauses: SQL[] = [
    eq(transactions.tenantId, tenantId),
    // Las anuladas no cuentan para nada, pero siguen en la tabla.
    isNull(transactions.deletedAt),
  ];
  if (filters.type) clauses.push(eq(transactions.type, filters.type));
  if (filters.from) clauses.push(gte(transactions.occurredOn, filters.from));
  if (filters.to) clauses.push(lte(transactions.occurredOn, filters.to));
  if (filters.currency) clauses.push(eq(transactions.currency, filters.currency));

  /**
   * Busqueda por concepto.
   *
   * Es un `%texto%`, asi que no usa indice: a esta escala (los movimientos de
   * un negocio, ya acotados al tenant por el WHERE y por RLS) un recorrido es
   * mas barato que mantener un indice de trigramas. Si algun dia deja de
   * serlo, lo que cambia es el indice, no esta funcion.
   */
  const q = filters.q?.trim();
  if (q) clauses.push(ilike(transactions.concept, `%${escapeLike(q)}%`));

  return clauses;
}

/**
 * Lista paginada, en el servidor.
 *
 * Nunca se traen todas las filas para filtrar en el navegador: con un año de
 * operacion de un negocio activo eso serian decenas de miles de filas viajando
 * en cada carga de pagina.
 */
export async function listTransactions(
  tenantId: string,
  filters: ListFilters = {},
): Promise<{ rows: TransactionRow[]; total: number }> {
  const page = Math.max(0, filters.page ?? 0);
  const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20));
  const where = and(...baseWhere(tenantId, filters));

  // catalog_items entra dos veces (categoria y metodo de pago), asi que hace
  // falta aliasarla. `alias()` de Drizzle en vez de SQL crudo: genera el join
  // correcto y mantiene el tipado de las columnas.
  const categoria = alias(catalogItems, "categoria");
  const metodo = alias(catalogItems, "metodo");

  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: transactions.id,
        type: transactions.type,
        kind: transactions.kind,
        concept: transactions.concept,
        occurredOn: transactions.occurredOn,
        amount: transactions.amount,
        currency: transactions.currency,
        notes: transactions.notes,
        createdAt: transactions.createdAt,
        categoryId: transactions.categoryId,
        paymentMethodId: transactions.paymentMethodId,
        exchangeRate: transactions.exchangeRate,
        baseCurrency: transactions.baseCurrency,
        categoryLabel: categoria.label,
        paymentMethodLabel: metodo.label,
      })
      .from(transactions)
      .innerJoin(categoria, eq(categoria.id, transactions.categoryId))
      .innerJoin(metodo, eq(metodo.id, transactions.paymentMethodId))
      .where(where)
      .orderBy(desc(transactions.occurredOn), desc(transactions.id))
      .limit(perPage)
      .offset(page * perPage);

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(where);

    return { rows: rows as TransactionRow[], total: Number(count) };
  });
}

/**
 * Los renglones de varias transacciones, en UNA consulta.
 *
 * Va por lote y no por transaccion al abrir el dialogo porque una pagina trae
 * 20 filas: pedirlos de a uno serian 20 viajes, y pedirlos desde el cliente
 * obligaria a exponer una lectura como Server Action.
 */
export async function itemsForTransactions(
  tenantId: string,
  ids: string[],
): Promise<Record<string, TransactionItemRow[]>> {
  if (ids.length === 0) return {};

  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        transactionId: transactionItems.transactionId,
        itemType: transactionItems.itemType,
        productId: transactionItems.productId,
        serviceId: transactionItems.serviceId,
        qty: transactionItems.qty,
        unitPrice: transactionItems.unitPrice,
      })
      .from(transactionItems)
      .where(
        and(
          eq(transactionItems.tenantId, tenantId),
          inArray(transactionItems.transactionId, ids),
        ),
      ),
  );

  const porTransaccion: Record<string, TransactionItemRow[]> = {};
  for (const r of rows) {
    const refId = r.productId ?? r.serviceId;
    if (!refId) continue;
    (porTransaccion[r.transactionId] ??= []).push({
      itemType: r.itemType,
      refId,
      qty: r.qty,
      unitPrice: r.unitPrice,
    });
  }
  return porTransaccion;
}

/**
 * Lo ultimo que se pago por cada producto, para precargar la proxima compra.
 *
 * Se deriva de las compras ya registradas en vez de guardarse en `products`:
 * una columna "costo" habria que mantenerla sincronizada a mano, y lo que
 * importa (cuanto costo la ultima vez) ya esta en los renglones.
 *
 * Es una sugerencia, no el precio: quien registra la sobreescribe si el
 * proveedor subio. Se ordena por fecha de la operacion y no por cuando se
 * tecleo, porque una compra cargada tarde no es la mas reciente.
 */
export async function lastPurchasePrices(
  tenantId: string,
): Promise<Record<string, string>> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        productId: transactionItems.productId,
        unitPrice: transactionItems.unitPrice,
        occurredOn: transactions.occurredOn,
        id: transactions.id,
      })
      .from(transactionItems)
      .innerJoin(
        transactions,
        eq(transactions.id, transactionItems.transactionId),
      )
      .where(
        and(
          eq(transactionItems.tenantId, tenantId),
          eq(transactions.kind, "compra"),
          isNull(transactions.deletedAt),
        ),
      )
      // Ascendente a proposito: al recorrer, cada producto queda con la ultima
      // compra que se vio, que es la mas reciente.
      .orderBy(transactions.occurredOn, transactions.id),
  );

  const ultimo: Record<string, string> = {};
  for (const r of rows) {
    if (r.productId) ultimo[r.productId] = r.unitPrice;
  }
  return ultimo;
}

/**
 * Totales agrupados por moneda.
 *
 * Devuelve una fila por moneda a proposito. Sumar Bs con USD daria un numero sin
 * significado, y como no se convierte nada, no hay un total unico que mostrar.
 */
export async function totalsByCurrency(
  tenantId: string,
  filters: ListFilters = {},
): Promise<CurrencyTotal[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        currency: transactions.currency,
        total: sql<string>`sum(${transactions.amount})::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(and(...baseWhere(tenantId, filters)))
      .groupBy(transactions.currency)
      .orderBy(sql`sum(${transactions.amount}) desc`),
  );
}

/** Las monedas en las que este cliente ha operado, para armar el selector. */
export async function usedCurrencies(tenantId: string): Promise<string[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .selectDistinct({ currency: transactions.currency })
      .from(transactions)
      .where(
        and(eq(transactions.tenantId, tenantId), isNull(transactions.deletedAt)),
      ),
  );
  return rows.map((r) => r.currency).sort();
}

export interface CurrencyBalance {
  currency: string;
  ingresos: string;
  gastos: string;
  /** Solo tiene sentido DENTRO de una moneda. Nunca entre monedas. */
  balance: string;
  count: number;
}

/**
 * Ingresos, gastos y balance, agrupados por moneda.
 *
 * El balance se calcula por moneda y nunca entre monedas: restar gastos en Bs de
 * ingresos en USD no da nada. Por eso devuelve una fila por moneda en vez de un
 * numero unico.
 */
export async function balanceByCurrency(
  tenantId: string,
  filters: ListFilters = {},
): Promise<CurrencyBalance[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        currency: transactions.currency,
        ingresos: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'ingreso'), 0)::text`,
        gastos: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'gasto'), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(and(...baseWhere(tenantId, { ...filters, type: undefined })))
      .groupBy(transactions.currency)
      .orderBy(transactions.currency),
  );

  return rows.map((r) => ({
    ...r,
    ingresos: normalizeMoney(r.ingresos),
    gastos: normalizeMoney(r.gastos),
    balance: subtractMoney(r.ingresos, r.gastos),
  }));
}
