import "server-only";

import { and, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { withTenant } from "@/lib/db/tenant";
import {
  catalogItems,
  products,
  transactionItems,
  transactions,
} from "@/lib/db/schema";
import type { TransactionType } from "@/lib/db/schema";
import { normalizeMoney, subtractMoney } from "@/lib/money";

/**
 * Consultas de reportes.
 *
 * TODAS reciben una moneda obligatoria. No es una comodidad: como no se
 * convierte nada entre monedas, un grafico de barras que mezcle Bs y USD en el
 * mismo eje no representa nada — las barras serian comparables solo por
 * casualidad. La pantalla elige una moneda y todo lo que muestra es de esa.
 */

export interface ReportFilters {
  currency: string;
  /** Inclusive, formato YYYY-MM-DD. */
  from?: string;
  to?: string;
}

function baseWhere(tenantId: string, filters: ReportFilters): SQL[] {
  const clauses: SQL[] = [
    eq(transactions.tenantId, tenantId),
    isNull(transactions.deletedAt),
    eq(transactions.currency, filters.currency),
  ];
  if (filters.from) clauses.push(gte(transactions.occurredOn, filters.from));
  if (filters.to) clauses.push(lte(transactions.occurredOn, filters.to));
  return clauses;
}

export interface GroupedTotal {
  label: string;
  total: string;
  count: number;
}

/** Totales por categoria, de mayor a menor. */
export async function byCategory(
  tenantId: string,
  type: TransactionType,
  filters: ReportFilters,
): Promise<GroupedTotal[]> {
  const categoria = alias(catalogItems, "categoria");

  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        label: categoria.label,
        total: sql<string>`sum(${transactions.amount})::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .innerJoin(categoria, eq(categoria.id, transactions.categoryId))
      .where(and(...baseWhere(tenantId, filters), eq(transactions.type, type)))
      .groupBy(categoria.label)
      .orderBy(desc(sql`sum(${transactions.amount})`)),
  );

  return rows.map((r) => ({ ...r, total: normalizeMoney(r.total) }));
}

/**
 * Totales por metodo de pago.
 *
 * Responde "cuanto entro por Zelle y cuanto en efectivo". Como cada metodo
 * define su moneda, dentro de una moneda dada solo aparecen los metodos que la
 * usan — que es justo lo que se quiere ver.
 */
export async function byPaymentMethod(
  tenantId: string,
  type: TransactionType,
  filters: ReportFilters,
): Promise<GroupedTotal[]> {
  const metodo = alias(catalogItems, "metodo");

  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        label: metodo.label,
        total: sql<string>`sum(${transactions.amount})::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .innerJoin(metodo, eq(metodo.id, transactions.paymentMethodId))
      .where(and(...baseWhere(tenantId, filters), eq(transactions.type, type)))
      .groupBy(metodo.label)
      .orderBy(desc(sql`sum(${transactions.amount})`)),
  );

  return rows.map((r) => ({ ...r, total: normalizeMoney(r.total) }));
}

export interface MonthPoint {
  /** YYYY-MM */
  month: string;
  ingresos: string;
  gastos: string;
  balance: string;
}

/**
 * Serie mensual de ingresos, gastos y balance.
 *
 * Se agrupa por `occurred_on`, que es un `date` sin hora: no hay ambiguedad de
 * zona horaria, a diferencia de agrupar por un timestamp.
 */
export async function monthlySeries(
  tenantId: string,
  filters: ReportFilters,
): Promise<MonthPoint[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        month: sql<string>`to_char(${transactions.occurredOn}, 'YYYY-MM')`,
        ingresos: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'ingreso'), 0)::text`,
        gastos: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'gasto'), 0)::text`,
      })
      .from(transactions)
      .where(and(...baseWhere(tenantId, filters)))
      .groupBy(sql`to_char(${transactions.occurredOn}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${transactions.occurredOn}, 'YYYY-MM')`),
  );

  return rows.map((r) => ({
    month: r.month,
    ingresos: normalizeMoney(r.ingresos),
    gastos: normalizeMoney(r.gastos),
    balance: subtractMoney(r.ingresos, r.gastos),
  }));
}

export interface TopProduct {
  productId: string;
  name: string;
  /** Unidades vendidas. */
  qty: string;
  total: string;
}

/**
 * Productos mas vendidos.
 *
 * Sale de `transaction_items`, que existe porque las ventas se registran con
 * renglones. Con montos sueltos esta pregunta no tendria respuesta.
 */
export async function topProducts(
  tenantId: string,
  filters: ReportFilters,
  limit = 10,
): Promise<TopProduct[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        productId: products.id,
        name: products.name,
        qty: sql<string>`sum(${transactionItems.qty})::text`,
        total: sql<string>`sum(${transactionItems.subtotal})::text`,
      })
      .from(transactionItems)
      .innerJoin(
        transactions,
        and(
          eq(transactions.id, transactionItems.transactionId),
          eq(transactions.tenantId, transactionItems.tenantId),
        ),
      )
      .innerJoin(
        products,
        and(
          eq(products.id, transactionItems.productId),
          eq(products.tenantId, transactionItems.tenantId),
        ),
      )
      .where(
        and(
          ...baseWhere(tenantId, filters),
          // Solo ventas: una compra de insumos tambien tiene renglones, pero no
          // dice nada sobre que se vende mas.
          eq(transactions.kind, "venta"),
        ),
      )
      .groupBy(products.id, products.name)
      .orderBy(desc(sql`sum(${transactionItems.subtotal})`))
      .limit(limit),
  );

  return rows.map((r) => ({ ...r, total: normalizeMoney(r.total) }));
}

export interface ReportSummary {
  ingresos: string;
  gastos: string;
  balance: string;
  operaciones: number;
}

/** Totales del periodo, para las tarjetas de arriba. */
export async function periodSummary(
  tenantId: string,
  filters: ReportFilters,
): Promise<ReportSummary> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        ingresos: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'ingreso'), 0)::text`,
        gastos: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'gasto'), 0)::text`,
        operaciones: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(and(...baseWhere(tenantId, filters))),
  );

  const r = rows[0] ?? { ingresos: "0", gastos: "0", operaciones: 0 };
  return {
    ingresos: normalizeMoney(r.ingresos),
    gastos: normalizeMoney(r.gastos),
    balance: subtractMoney(r.ingresos, r.gastos),
    operaciones: Number(r.operaciones),
  };
}
