"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthState = { error: string | null };

const credentialsSchema = z.object({
  email: z.string().trim().min(1, "Escribe tu correo").email("Correo inválido"),
  password: z.string().min(1, "Escribe tu contraseña"),
});

/**
 * Inicio de sesion.
 *
 * Los mensajes de error son deliberadamente iguales para "no existe ese correo"
 * y "contraseña incorrecta": distinguirlos convierte el login en un oraculo para
 * averiguar que correos estan registrados.
 */
export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Correo o contraseña incorrectos." };
  }

  // Fuera del try/catch: redirect() funciona lanzando una excepcion especial que
  // Next intercepta, asi que atraparla romperia la navegacion.
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
