import { PageTransition } from "@/components/motion";
import { ResourceSetup } from "@/components/reservas/resource-setup";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { listServicesForSetup } from "@/lib/reservas/queries";

/**
 * Qué servicios se reservan y con qué recursos.
 *
 * Exige `resource:manage`: la recepción reserva y cancela, pero no decide qué
 * habitaciones existen. Se decide ANTES de consultar nada.
 */
export default async function RecursosPage() {
  const { tenantId, role } = await requireTenant();

  if (!roleHas(role, "resource:manage")) {
    return (
      <SinPermiso
        role={role}
        explicacion={
          "Qué habitaciones, canchas o equipos existen lo decide el dueño o el encargado. Tu rol puede reservarlos desde Disponibilidad."
        }
      />
    );
  }

  const services = await listServicesForSetup(tenantId);

  return (
    <PageTransition>
      <ResourceSetup services={services} />
    </PageTransition>
  );
}
