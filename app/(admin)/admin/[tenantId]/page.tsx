import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageTransition } from "@/components/motion";
import { TeamManager } from "@/components/ajustes/team-manager";
import { TenantSettings } from "@/components/admin/tenant-settings";
import { requirePlatformAdmin } from "@/lib/authz/session";
import { getTenant } from "@/lib/admin/tenants";
import { listMembers, listPendingInvitations } from "@/lib/authz/members";
import { signupUrlFromHeaders } from "@/lib/authz/signup-url";
import {
  inviteMember,
  cancelInvitation,
  changeRole,
  removeMember,
} from "@/lib/admin/actions";

export const metadata: Metadata = {
  title: "Negocio — Administración",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminTenantPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const admin = await requirePlatformAdmin();
  const { tenantId } = await params;
  if (!UUID_RE.test(tenantId)) notFound();

  const tenant = await getTenant(admin.id, tenantId);
  if (!tenant) notFound();

  // El equipo se lee con el contexto del propio negocio, igual que en Ajustes ›
  // Equipo. El admin no es miembro, asi que ninguna fila sale como "(tú)".
  const [members, invitations, signupUrl] = await Promise.all([
    listMembers(tenantId, admin.id),
    listPendingInvitations(tenantId),
    signupUrlFromHeaders(),
  ]);

  return (
    <PageTransition>
      <div className="space-y-6">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Negocios
        </Link>

        <TenantSettings tenant={tenant} />

        <TeamManager
          members={members}
          invitations={invitations}
          signupUrl={signupUrl}
          title="Equipo"
          description="Para rescatar un negocio sin dueño, invita a uno nuevo o sube de rol a alguien que ya esté. Siempre queda al menos un dueño."
          actions={{
            inviteMember: inviteMember.bind(null, tenantId),
            cancelInvitation: cancelInvitation.bind(null, tenantId),
            changeRole: changeRole.bind(null, tenantId),
            removeMember: removeMember.bind(null, tenantId),
          }}
        />
      </div>
    </PageTransition>
  );
}
