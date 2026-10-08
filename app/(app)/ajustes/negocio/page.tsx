import { PageTransition } from "@/components/motion";
import { BusinessSettings } from "@/components/ajustes/business-settings";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { SinPermiso } from "@/components/layout/sin-permiso";

/**
 * Ajustes del negocio.
 *
 * Exige `tenant:manage`, que solo tiene el dueño: la moneda por defecto decide
 * cómo se registra todo lo demás, y no es una preferencia personal.
 */
export default async function NegocioPage() {
  const { primaryCurrency, role } = await requireTenant();

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

  return (
    <PageTransition>
      <BusinessSettings current={primaryCurrency} />
    </PageTransition>
  );
}
