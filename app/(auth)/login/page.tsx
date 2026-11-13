import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { IconBolt } from "@tabler/icons-react";
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
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <IconBolt className="size-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl leading-none tracking-tight">Ray App</h1>
          <p className="text-sm text-muted-foreground">
            Entra para gestionar tu negocio
          </p>
        </div>
      </div>

      <LoginForm />
    </div>
  );
}
