import { PageTransition } from "@/components/motion";
import { TeamManager } from "@/components/ajustes/team-manager";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { listMembers, listPendingInvitations } from "@/lib/authz/members";
import { signupUrlFromHeaders } from "@/lib/authz/signup-url";

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

  const [members, invitations, signupUrl] = await Promise.all([
    listMembers(tenantId, user.id),
    listPendingInvitations(tenantId),
    signupUrlFromHeaders(),
  ]);

  return (
    <PageTransition>
      <TeamManager
        members={members}
        invitations={invitations}
        signupUrl={signupUrl}
      />
    </PageTransition>
  );
}
