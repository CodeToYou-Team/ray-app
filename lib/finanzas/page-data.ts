import "server-only";

import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { listCatalogs } from "@/lib/catalogs/queries";
import { listSellables } from "@/lib/productos/queries";
import {
  listTransactions,
  itemsForTransactions,
  totalsByCurrency,
  balanceByCurrency,
} from "./queries";
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

  // Quien no puede corregir no recibe los renglones: no los va a usar.
  const canEdit = roleHas(role, "transaction:update");

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

  /**
   * Los renglones de las ventas y compras de ESTA pagina.
   *
   * Se traen junto con las filas, en una sola consulta, para que el dialogo de
   * correccion abra con los datos ya puestos. Las operaciones sueltas no tienen
   * renglones, asi que ni se preguntan.
   */
  const items = canEdit
    ? await itemsForTransactions(
        tenantId,
        rows.filter((r) => r.kind !== "operacion").map((r) => r.id),
      )
    : {};

  const asOptions = (key: "income_category" | "expense_category") =>
    (catalogs[key] ?? []).map((c) => ({ id: c.id, label: c.label }));

  return {
    rows: rows.map((r) => ({ ...r, items: items[r.id] ?? [] })),
    total,
    totals,
    balances,
    // El menu de anular solo se pinta si el rol puede; el Server Action lo
    // vuelve a exigir de todos modos, porque es un endpoint publico.
    canVoid: roleHas(role, "transaction:delete"),
    canEdit,
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
