import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { IconMailQuestion } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trySession, tryGetTenant } from "@/lib/authz/session";
import { signOut } from "@/lib/authz/actions";

export const metadata: Metadata = {
  title: "Sin acceso — Ray App",
};

/**
 * Cuenta creada, pero sin invitacion.
 *
 * Es el estado normal de quien se registra por su cuenta: registrarse no da
 * acceso a ningun cliente. En vez de rebotarlo al login — que parece un fallo —
 * se le explica que falta y con que correo entro, que es el dato que su jefe
 * necesita para invitarlo bien.
 */
export default async function SinAccesoPage() {
  const session = await trySession();
  if (!session) redirect("/login");
  if (await tryGetTenant()) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-warning/10 text-warning">
            <IconMailQuestion className="size-5" />
          </div>

          <div>
            <h1 className="font-semibold">Tu cuenta está creada</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Todavía nadie te dio acceso a un negocio. Pídele a quien lo
              administra que te invite con este correo:
            </p>
            <p className="mt-2 rounded-md bg-muted/50 px-3 py-2 font-mono text-sm">
              {session.email}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Tiene que ser exactamente ese. Cuando te invite, vuelve a entrar y
              el acceso se activa solo.
            </p>
          </div>

          <form action={signOut}>
            <Button variant="outline" size="sm" type="submit">
              Salir
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
