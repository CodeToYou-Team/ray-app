import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { Header } from "@/components/layout/header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { getAccess } from "@/lib/authz/session";
import { isPlatformAdmin } from "@/lib/admin/admins";

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
  const access = await getAccess();

  if (access.kind !== "ok") {
    /**
     * Se distinguen los casos a proposito. Mandar a /login a alguien que YA
     * entro produce un bucle: inicia sesion bien, el layout lo rebota, y vuelve
     * a ver el formulario sin que nada explique por que.
     *
     * Un admin de la plataforma sin negocio propio no tiene nada que ver aqui:
     * su pantalla es /admin.
     */
    if (access.kind === "anonimo") redirect("/login");
    if (access.kind === "sin-negocio" && access.isAdmin) redirect("/admin");
    redirect("/sin-acceso");
  }

  const { context } = access;
  const isAdmin = await isPlatformAdmin(context.user.id);

  return (
    <SidebarProvider>
      <AppSidebar
        role={context.role}
        user={{
          name: context.user.displayName,
          email: context.user.email,
          role: context.role,
          isPlatformAdmin: isAdmin,
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
