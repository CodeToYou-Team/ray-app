import Link from "next/link";
import { redirect } from "next/navigation";
import { IconArrowLeft, IconShieldCog } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { tryGetTenant, tryPlatformAdmin, trySession } from "@/lib/authz/session";
import { signOut } from "@/lib/authz/actions";

/**
 * Shell de la administracion de la plataforma.
 *
 * Separado de (app) a proposito: el admin puede no pertenecer a ningun negocio,
 * y el sidebar de (app) esta construido alrededor del rol dentro de uno.
 *
 * Como en (app), el redirect es comodidad. Cada pagina y cada Server Action de
 * lib/admin exige requirePlatformAdmin() por su cuenta.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await tryPlatformAdmin();
  if (!admin) {
    redirect((await trySession()) ? "/dashboard" : "/login");
  }

  // Solo para ofrecer la vuelta: un admin que ademas trabaja en un negocio.
  const tenant = await tryGetTenant();

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-lg md:px-6">
        <Link href="/admin" className="flex items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <IconShieldCog className="size-4" />
          </span>
          <span className="text-sm">Administración</span>
        </Link>

        <span className="ml-1 hidden truncate text-xs text-muted-foreground sm:inline">
          {admin.email}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {tenant && (
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/dashboard">
                <IconArrowLeft className="size-3.5" />
                <span className="hidden sm:inline">Volver a la app</span>
              </Link>
            </Button>
          )}
          <ThemeToggle />
          <form action={signOut}>
            <Button variant="outline" size="sm" type="submit">
              Salir
            </Button>
          </form>
        </div>
      </header>

      <main className="app-shell-main">
        <div className="content-wrap mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
