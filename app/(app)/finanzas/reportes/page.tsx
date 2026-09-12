import { PageTransition } from "@/components/motion";
import { ReportsView } from "@/components/finanzas/reports-view";
import { requireCapability } from "@/lib/authz/session";
import { usedCurrencies } from "@/lib/finanzas/queries";
import {
  byCategory,
  byPaymentMethod,
  monthlySeries,
  topProducts,
  periodSummary,
} from "@/lib/finanzas/reports";

/** Rango de fechas a partir de la clave del selector. */
function rangeFor(key: string): { from?: string; to?: string } {
  if (key === "all") return {};
  const meses = key === "3m" ? 3 : key === "12m" ? 12 : 6;
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1), 1);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  return { from: fmt(desde), to: fmt(hoy) };
}

/**
 * Reportes.
 *
 * Exige `report:read`: es lo que separa a quien registra operaciones de quien ve
 * cuanto entro en total. El rol `staff` no lo tiene.
 */
export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ moneda?: string; periodo?: string }>;
}) {
  const { tenantId, primaryCurrency } = await requireCapability("report:read");
  const params = await searchParams;

  const disponibles = await usedCurrencies(tenantId);
  // Si el cliente todavia no opero, se ofrece al menos su moneda principal.
  const currencies = disponibles.length > 0 ? disponibles : [primaryCurrency];
  const currency =
    params.moneda && currencies.includes(params.moneda)
      ? params.moneda
      : (currencies.find((c) => c === primaryCurrency) ?? currencies[0]);

  const periodKey = ["3m", "6m", "12m", "all"].includes(params.periodo ?? "")
    ? params.periodo!
    : "6m";
  const range = rangeFor(periodKey);
  const filters = { currency, ...range };

  const [summary, ingresos, gastos, metodos, serie, top] = await Promise.all([
    periodSummary(tenantId, filters),
    byCategory(tenantId, "ingreso", filters),
    byCategory(tenantId, "gasto", filters),
    byPaymentMethod(tenantId, "ingreso", filters),
    monthlySeries(tenantId, filters),
    topProducts(tenantId, filters),
  ]);

  return (
    <PageTransition>
      <ReportsView
        currency={currency}
        currencies={currencies}
        period={{ from: range.from ?? "", to: range.to ?? "" }}
        periodKey={periodKey}
        summary={summary}
        ingresosPorCategoria={ingresos}
        gastosPorCategoria={gastos}
        porMetodo={metodos}
        serie={serie}
        top={top}
      />
    </PageTransition>
  );
}
