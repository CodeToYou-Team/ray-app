import "server-only";

import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { listCatalogs } from "@/lib/catalogs/queries";
import { listSellables } from "@/lib/productos/queries";
import { listTransactions, totalsByCurrency, balanceByCurrency } from "./queries";
import type { TransactionType } from "@/lib/db/schema";

export const PER_PAGE = 20;

/**
 * Todo lo que necesita una pantalla de ingresos o gastos, en un solo lugar.
 *
 * Las tres pantallas (ingresos, gastos, movimientos) pedian exactamente los
 * mismos datos con un filtro distinto; tenerlo aca evita que se desincronicen.
 */
export async function loadTransactionsPage(
  type: TransactionType | undefined,
  searchParams: { page?: string },
) {
  const { tenantId, role } = await requireTenant();
  const page = Math.max(0, Number(searchParams.page ?? 0) || 0);

  // Sin `type` es la pantalla de Movimientos, la unica que muestra balance.
  const esMovimientos = type === undefined;

  const [{ rows, total }, totals, balances, catalogs, sellables] =
    await Promise.all([
      listTransactions(tenantId, { type, page, perPage: PER_PAGE }),
      totalsByCurrency(tenantId, { type }),
      esMovimientos ? balanceByCurrency(tenantId) : Promise.resolve(undefined),
      listCatalogs(tenantId, [
        "income_category",
        "expense_category",
        "payment_method",
      ]),
      listSellables(tenantId),
    ]);

  const asOptions = (key: "income_category" | "expense_category") =>
    (catalogs[key] ?? []).map((c) => ({ id: c.id, label: c.label }));

  return {
    rows,
    total,
    totals,
    balances,
    // El menu de anular solo se pinta si el rol puede; el Server Action lo
    // vuelve a exigir de todos modos, porque es un endpoint publico.
    canVoid: roleHas(role, "transaction:delete"),
    page,
    perPage: PER_PAGE,
    /**
     * Las categorias de las DOS clases, no solo la de la pantalla.
     *
     * En Movimientos el mismo formulario sirve para ingreso y gasto, y las
     * categorias de cada uno salen de catalogos distintos: mandar solo un juego
     * haria que al registrar un gasto aparecieran categorias de ingreso.
     */
    categoriesByType: {
      ingreso: asOptions("income_category"),
      gasto: asOptions("expense_category"),
    },
    paymentMethods: (catalogs.payment_method ?? []).map((m) => ({
      id: m.id,
      label: m.label,
      currency: m.currency,
    })),
    sellables,
  };
}
