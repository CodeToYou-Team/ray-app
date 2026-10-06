import { headers } from "next/headers";
import { PageTransition } from "@/components/motion";
import { TeamManager } from "@/components/ajustes/team-manager";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { listMembers, listPendingInvitations } from "@/lib/authz/members";

/**
 * Gestion del equipo.
 *
 * Exige `member:manage` en la propia pagina: quien no puede invitar ni cambiar
 * roles tampoco deberia ver quien tiene que permiso.
 */
export default async function UsuariosPage() {
  const { tenantId, user, role } = await requireTenant();

  if (!roleHas(role, "member:manage")) {
    return <SinPermiso role={role} explicacion={"Solo el dueño puede ver quién tiene acceso y cambiar permisos."} />;
  }

  const [members, invitations, headerList] = await Promise.all([
    listMembers(tenantId, user.id),
    listPendingInvitations(tenantId),
    headers(),
  ]);

  // Se arma desde el host real para que el enlace sirva tanto en local como en
  // produccion sin configurar nada.
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "http";

  return (
    <PageTransition>
      <TeamManager
        members={members}
        invitations={invitations}
        signupUrl={`${proto}://${host}/registro`}
      />
    </PageTransition>
  );
}
