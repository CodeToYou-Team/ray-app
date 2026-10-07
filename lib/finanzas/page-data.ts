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

/** Lo que el usuario puede filtrar desde la URL. */
export interface TransactionsSearchParams {
  page?: string;
  q?: string;
  desde?: string;
  hasta?: string;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Los filtros de la URL, saneados.
 *
 * La URL la escribe cualquiera, asi que una fecha que no tenga la forma
 * esperada se ignora en vez de llegar a Postgres y reventar la pagina entera
 * por un parametro mal pegado.
 */
function parseFilters(params: TransactionsSearchParams) {
  const q = params.q?.trim().slice(0, 100) || undefined;
  const from = params.desde && FECHA.test(params.desde) ? params.desde : undefined;
  const to = params.hasta && FECHA.test(params.hasta) ? params.hasta : undefined;

  // Un rango al reves no devuelve nada y parece que no hay datos. Se voltea,
  // que es lo que la persona quiso decir.
  const invertido = from && to && from > to;
  return {
    q,
    from: invertido ? to : from,
    to: invertido ? from : to,
  };
}

/**
 * Todo lo que necesita una pantalla de ingresos o gastos, en un solo lugar.
 *
 * Las tres pantallas (ingresos, gastos, movimientos) pedian exactamente los
 * mismos datos con un filtro distinto; tenerlo aca evita que se desincronicen.
 */
export async function loadTransactionsPage(
  type: TransactionType | undefined,
  searchParams: TransactionsSearchParams,
) {
  const { tenantId, role } = await requireTenant();
  const page = Math.max(0, Number(searchParams.page ?? 0) || 0);
  const filters = parseFilters(searchParams);

  // Sin `type` es la pantalla de Movimientos, la unica que muestra balance.
  const esMovimientos = type === undefined;

  // Quien no puede corregir no recibe los renglones: no los va a usar.
  const canEdit = roleHas(role, "transaction:update");

  const [{ rows, total }, totals, balances, catalogs, sellables] =
    await Promise.all([
      listTransactions(tenantId, { ...filters, type, page, perPage: PER_PAGE }),
      /**
       * Los totales llevan los MISMOS filtros que la lista.
       *
       * Si no, buscar "alquiler" mostraria tres filas y arriba el total de todo
       * el año: el numero mas visible de la pantalla no estaria hablando de lo
       * que se esta viendo.
       */
      totalsByCurrency(tenantId, { ...filters, type }),
      esMovimientos
        ? balanceByCurrency(tenantId, filters)
        : Promise.resolve(undefined),
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
    /** Lo que se aplico de verdad, no lo que venia en la URL. */
    filtros: {
      q: filters.q ?? "",
      desde: filters.from ?? "",
      hasta: filters.to ?? "",
    },
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
