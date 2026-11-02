import "server-only";

import { requireTenant } from "@/lib/authz/session";
import { balanceByCurrency, listTransactions } from "./queries";
import { listStock } from "@/lib/inventario/stock";
import { subtractMoney } from "@/lib/money";
import { hoyEn, mesDe } from "@/lib/fechas";
import { alcanceDeLectura } from "./alcance";

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
  const ctx = await requireTenant();
  const { tenantId, primaryCurrency, timezone } = ctx;

  // "Este mes" es el del negocio: el 31 a las 21:00 en Caracas todavia no es
  // el mes siguiente, aunque en UTC ya lo sea.
  const hoy = hoyEn(timezone);
  const esteMes = mesDe(hoy, 0);
  const mesPasado = mesDe(hoy, -1);

  // El Personal ve sus propias cifras, no las del negocio: las tarjetas y las
  // recientes llevan el mismo alcance que la lista de Finanzas.
  const alcance = alcanceDeLectura(ctx);

  const [actual, previo, ultimas, stock] = await Promise.all([
    balanceByCurrency(tenantId, { ...esteMes, ...alcance }),
    balanceByCurrency(tenantId, { ...mesPasado, ...alcance }),
    listTransactions(tenantId, { perPage: 8, ...alcance }),
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
    /** true = las cifras son solo de quien mira, y la pantalla tiene que decirlo. */
    soloPropias: alcance.createdBy !== undefined,
  };
}
