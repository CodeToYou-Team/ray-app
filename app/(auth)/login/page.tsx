import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { tryGetTenant } from "@/lib/authz/session";

export const metadata: Metadata = {
  title: "Entrar — Ray App",
};

export default async function LoginPage() {
  // Con sesion activa no tiene sentido mostrar el formulario: quedabas mirando
  // un login estando ya dentro, y al enviarlo parecia que "se refrescaba".
  if (await tryGetTenant()) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Image
          src="/ray-logo-outlined.svg"
          alt=""
          width={2611}
          height={1201}
          unoptimized
          priority
          className="h-10 w-auto invert dark:invert-0"
        />
        <div>
          {/* El logo ya dice "RAY"; el h1 se queda para lectores de pantalla. */}
          <h1 className="sr-only">Ray App</h1>
          <p className="text-sm text-muted-foreground">
            Entra para gestionar tu negocio
          </p>
        </div>
      </div>

      <LoginForm />
    </div>
  );
}
