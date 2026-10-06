import { PageTransition } from "@/components/motion";
import { HistoryView } from "@/components/finanzas/history-view";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { usedCurrencies } from "@/lib/finanzas/queries";
import { monthlySeries } from "@/lib/finanzas/reports";

/**
 * Historial mes a mes.
 *
 * Como todo lo que muestra montos, va por moneda: comparar un mes en Bs contra
 * otro en USD no dice nada mientras no se convierta, y no se convierte.
 */
export default async function HistorialPage({
  searchParams,
}: {
  searchParams: Promise<{ moneda?: string }>;
}) {
  const { tenantId, primaryCurrency, role } = await requireTenant();

  if (!roleHas(role, "report:read")) {
    return <SinPermiso role={role} explicacion={"El historial muestra los totales mes a mes. Tu rol registra operaciones, pero no ve los consolidados."} />;
  }
  const params = await searchParams;

  const disponibles = await usedCurrencies(tenantId);
  const currencies = disponibles.length > 0 ? disponibles : [primaryCurrency];
  const currency =
    params.moneda && currencies.includes(params.moneda)
      ? params.moneda
      : (currencies.find((c) => c === primaryCurrency) ?? currencies[0]);

  const serie = await monthlySeries(tenantId, { currency });

  return (
    <PageTransition>
      <HistoryView
        currency={currency}
        currencies={currencies}
        // Del mes mas reciente al mas antiguo: lo que se consulta primero es lo
        // ultimo que paso.
        meses={[...serie].reverse()}
      />
    </PageTransition>
  );
}
