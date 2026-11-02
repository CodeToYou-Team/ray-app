import type { Metadata } from "next";
import Link from "next/link";
import { IconLock } from "@tabler/icons-react";
import { PageTransition } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <IconLock className="size-5" />
          </div>
          <div>
            <h1 className="font-semibold">Solo para superadmin</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Nombrar, cambiar y quitar administradores lo hace un superadmin.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin">Volver a negocios</Link>
          </Button>
        </CardContent>
      </Card>
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
