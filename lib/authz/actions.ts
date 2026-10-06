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

export type SignupState = { error: string | null; confirmar: boolean };

const signupSchema = z.object({
  fullName: z.string().trim().min(1, "Escribe tu nombre").max(120),
  email: z.string().trim().toLowerCase().pipe(z.email("Correo inválido")),
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres"),
});

/**
 * Registro publico.
 *
 * Crear la cuenta NO da acceso a ningun cliente: eso lo decide una invitacion
 * previa dirigida a ese correo, que se canjea sola al entrar. Por eso esta
 * pantalla puede ser publica sin que nadie se cuele a los datos de nadie.
 *
 * Se usa signUp con la clave anonima, no la API de administracion: esa exige el
 * `service_role` key, que es la misma llave con BYPASSRLS que este proyecto
 * mantiene deliberadamente fuera.
 */
export async function signUp(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, confirmar: false };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  });

  if (error) {
    /**
     * El limite de correos del plan gratuito de Supabase es bajo y su mensaje
     * ("email rate limit exceeded") no le dice nada a un usuario final.
     */
    if (/rate limit/i.test(error.message)) {
      return {
        error:
          "Demasiados intentos de registro seguidos. Espera unos minutos y vuelve a probar.",
        confirmar: false,
      };
    }
    if (/already registered|already exists/i.test(error.message)) {
      return {
        error: "Ya existe una cuenta con ese correo. Entra en vez de registrarte.",
        confirmar: false,
      };
    }
    return { error: "No se pudo crear la cuenta.", confirmar: false };
  }

  // Sin sesion inmediata, el proyecto exige confirmar el correo.
  if (!data.session) return { error: null, confirmar: true };

  // Con confirmacion desactivada se entra directo; la invitacion se canjea al
  // resolver el cliente.
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
