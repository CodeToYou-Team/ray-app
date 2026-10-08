import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/authz/session";
import { navBottomFor } from "@/lib/nav";

/**
 * Ajustes no tiene contenido propio: lleva a su primera sección, igual que
 * /finanzas lleva a /finanzas/ingresos. Las secciones se ven desplegadas en el
 * sidebar al entrar.
 *
 * A cuál lleva depende del rol. Mandar a todos a la primera dejaría al
 * encargado, que no configura el negocio, aterrizando en una pantalla de "no
 * tienes acceso" cada vez que abre Ajustes — teniendo secciones que sí puede
 * usar justo al lado.
 */
export default async function AjustesPage() {
  const { role } = await requireTenant();

  const ajustes = navBottomFor(role).find((i) => i.href === "/ajustes");
  const primera = ajustes?.children?.[0]?.href;

  redirect(primera ?? "/dashboard");
}
