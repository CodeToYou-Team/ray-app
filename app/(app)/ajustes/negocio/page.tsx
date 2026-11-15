import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/motion";
import { BusinessSettings } from "@/components/ajustes/business-settings";
import { ExchangeRates } from "@/components/ajustes/exchange-rates";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { listConfiguredRates } from "@/lib/tenant/rates";

/**
 * Ajustes del negocio.
 *
 * Exige `tenant:manage`, que solo tiene el dueño: la moneda por defecto y las
 * tasas deciden cómo se registra todo lo demás, y no son preferencias
 * personales.
 */
export default async function NegocioPage() {
  const { tenantId, primaryCurrency, role } = await requireTenant();

  if (!roleHas(role, "tenant:manage")) {
    return (
      <SinPermiso
        role={role}
        explicacion={
          "La configuración del negocio la define el dueño. Afecta a cómo se registra todo lo demás, así que no se cambia desde otros roles."
        }
      />
    );
  }

  const rates = await listConfiguredRates(tenantId);

  return (
    <PageTransition>
      <div className="max-w-2xl space-y-4">
        <PageHeader
          title="Negocio"
          description="La configuración que afecta a todo lo que registras"
        />

        <BusinessSettings current={primaryCurrency} />
        <ExchangeRates
          primaryCurrency={primaryCurrency}
          rates={rates.map((r) => ({
            ...r,
            // Un Date no cruza al cliente; la fecha es lo único que se muestra.
            updatedAt: r.updatedAt.toISOString().slice(0, 10),
          }))}
        />
      </div>
    </PageTransition>
  );
}
