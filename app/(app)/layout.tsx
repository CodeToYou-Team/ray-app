import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { Header } from "@/components/layout/header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { tryGetTenant } from "@/lib/authz/session";

/**
 * Shell de la aplicacion. Reemplaza los cuatro layouts byte-identicos que habia
 * en app/dashboard, app/finanzas, app/inventario y app/productos.
 *
 * El grupo de rutas (app) no aparece en la URL: /dashboard sigue siendo /dashboard.
 *
 * El redirect de aca es por comodidad, NO es la autorizacion. Cada lectura pasa
 * por RLS y cada Server Action por su propio requireCapability(): un layout no
 * puede ser lo unico que impida el acceso.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await tryGetTenant();
  if (!context) redirect("/login");

  return (
    <SidebarProvider>
      <AppSidebar
        user={{
          name: context.user.displayName,
          email: context.user.email,
          role: context.role,
        }}
      />
      <SidebarInset>
        <Header />
        <main className="app-shell-main">
          <div className="content-wrap">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
