import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/signup-form";
import { tryGetTenant } from "@/lib/authz/session";

export const metadata: Metadata = {
  title: "Crear cuenta — Ray App",
};

/**
 * Registro publico.
 *
 * Es seguro que sea publico porque registrarse NO da acceso a nada: sin una
 * invitacion previa dirigida a ese correo, el usuario queda autenticado y sin
 * cliente. El acceso lo concede el dueño apuntando el correo, no el registro.
 */
export default async function RegistroPage() {
  if (await tryGetTenant()) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Image
          src="/ray-logo-outlined.svg"
          alt="Ray App"
          width={2611}
          height={1201}
          unoptimized
          priority
          className="h-10 w-auto invert dark:invert-0"
        />
        <div>
          <h1 className="font-display text-2xl font-semibold leading-none tracking-tight">Crear cuenta</h1>
          <p className="text-sm text-muted-foreground">
            Usa el mismo correo con el que te invitaron
          </p>
        </div>
      </div>

      <SignupForm />

      <p className="text-center text-sm text-muted-foreground">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Entra aquí
        </Link>
      </p>
    </div>
  );
}
