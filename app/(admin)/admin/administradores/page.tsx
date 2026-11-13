import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { PageTransition } from "@/components/motion";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { AdminManager } from "@/components/admin/admin-manager";
import { requirePlatformAdmin } from "@/lib/authz/session";
import { listAdminHistory, listAdmins } from "@/lib/admin/admins";

export const metadata: Metadata = {
  title: "Administradores — Administración",
};

/**
 * Quien administra la plataforma. Solo superadmin.
 *
 * La comprobacion de nivel va antes de consultar nada. Aunque se saltara, las
 * politicas de 0022 le devolverian a un admin solo su propia fila y ningun
 * historial.
 */
export default async function AdministradoresPage() {
  const admin = await requirePlatformAdmin();

  if (admin.level !== "superadmin") {
    return (
      <EmptyState
        icon={<Lock className="size-5" />}
        title="Solo para superadmin"
        titleAs="h1"
        description="Nombrar, cambiar y quitar administradores lo hace un superadmin."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin">Volver a negocios</Link>
          </Button>
        }
      />
    );
  }

  const [admins, history] = await Promise.all([
    listAdmins(admin.id),
    listAdminHistory(admin.id),
  ]);

  return (
    <PageTransition>
      <AdminManager admins={admins} history={history} />
    </PageTransition>
  );
}
