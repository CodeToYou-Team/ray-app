import { redirect } from "next/navigation";

/**
 * Ajustes no tiene contenido propio: lleva a su primera seccion, igual que
 * /finanzas lleva a /finanzas/ingresos. Las secciones se ven desplegadas en el
 * sidebar al entrar.
 */
export default function AjustesPage() {
  redirect("/ajustes/catalogos");
}
