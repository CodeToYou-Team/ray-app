import "server-only";

import { requireTenant } from "@/lib/authz/session";
import { balanceByCurrency, listTransactions } from "./queries";
import { listStock } from "@/lib/inventario/stock";
import { subtractMoney } from "@/lib/money";

/** Primer y ultimo dia de un mes, en formato YYYY-MM-DD. */
function monthRange(offset = 0): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  return { from: fmt(start), to: fmt(end) };
}

export interface DashboardCurrency {
  currency: string;
  ingresos: string;
  gastos: string;
  balance: string;
  /** Variacion porcentual de ingresos contra el mes anterior, o null si no hay base. */
  ingresosChange: number | null;
  gastosChange: number | null;
}

function percentChange(actual: string, previo: string): number | null {
  const p = Number(previo);
  if (p === 0) return null;
  return Math.round(((Number(actual) - p) / p) * 100);
}

/**
 * Datos del dashboard.
 *
 * Todo va POR MONEDA. No hay un "ingreso del mes" unico: con pagos en Bs, USD y
 * USDT, un solo numero solo se podria armar convirtiendo, y eso es justo lo que
 * este proyecto decidio no hacer porque la tasa se mueve todos los dias.
 */
export async function loadDashboard() {
  const { tenantId, primaryCurrency } = await requireTenant();
  const esteMes = monthRange(0);
  const mesPasado = monthRange(-1);

  const [actual, previo, ultimas, stock] = await Promise.all([
    balanceByCurrency(tenantId, esteMes),
    balanceByCurrency(tenantId, mesPasado),
    listTransactions(tenantId, { perPage: 8 }),
    listStock(tenantId),
  ]);

  const previoPorMoneda = new Map(previo.map((p) => [p.currency, p]));

  const monedas: DashboardCurrency[] = actual.map((a) => {
    const antes = previoPorMoneda.get(a.currency);
    return {
      currency: a.currency,
      ingresos: a.ingresos,
      gastos: a.gastos,
      balance: subtractMoney(a.ingresos, a.gastos),
      ingresosChange: antes ? percentChange(a.ingresos, antes.ingresos) : null,
      gastosChange: antes ? percentChange(a.gastos, antes.gastos) : null,
    };
  });

  // La moneda principal del cliente va primera; es solo presentacion.
  monedas.sort((a, b) => {
    if (a.currency === primaryCurrency) return -1;
    if (b.currency === primaryCurrency) return 1;
    return a.currency.localeCompare(b.currency);
  });

  return {
    monedas,
    primaryCurrency,
    recientes: ultimas.rows,
    alertas: stock.filter((s) => s.status !== "ok"),
    productosActivos: stock.length,
    periodo: esteMes,
  };
}
