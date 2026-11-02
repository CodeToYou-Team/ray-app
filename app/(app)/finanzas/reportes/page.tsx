import { PageTransition } from "@/components/motion";
import { ReportsView } from "@/components/finanzas/reports-view";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { usedCurrencies } from "@/lib/finanzas/queries";
import {
  byCategory,
  byPaymentMethod,
  monthlySeries,
  topProducts,
  periodSummary,
} from "@/lib/finanzas/reports";
import { hoyEn, mesDe } from "@/lib/fechas";

/**
 * Rango de fechas a partir de la clave del selector.
 *
 * "Hoy" es el del negocio, no el del servidor: en UTC, el último día del mes a
 * las 21:00 de Caracas ya es el mes siguiente, y los "últimos 6 meses" se
 * correrían un mes entero.
 */
function rangeFor(key: string, hoy: string): { from?: string; to?: string } {
  if (key === "all") return {};
  const meses = key === "3m" ? 3 : key === "12m" ? 12 : 6;
  return { from: mesDe(hoy, -(meses - 1)).from, to: hoy };
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
  const { tenantId, primaryCurrency, role, timezone } = await requireTenant();

  if (!roleHas(role, "report:read")) {
    return <SinPermiso role={role} explicacion={"Los reportes muestran los totales del negocio. Tu rol registra operaciones, pero no ve los consolidados."} />;
  }
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
  const range = rangeFor(periodKey, hoyEn(timezone));
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
