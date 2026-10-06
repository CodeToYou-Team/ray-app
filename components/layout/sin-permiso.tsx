import Link from "next/link";
import { IconLock } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const ROLE_LABEL: Record<string, string> = {
  owner: "Dueño",
  manager: "Encargado",
  staff: "Personal",
};

/**
 * Pantalla de permiso insuficiente.
 *
 * Se RENDERIZA en vez de lanzar: lanzar producia la pantalla de error de Next,
 * que a un usuario no le dice nada y parece que la app se rompio. Esto se ve
 * dentro de la app, con el menu al lado, asi que la persona puede seguir
 * trabajando en lo que si le toca.
 *
 * No reemplaza la verificacion: la pagina no consulta ningun dato antes de
 * decidir, y los Server Actions siguen exigiendo el permiso por su cuenta.
 */
export function SinPermiso({
  titulo = "No tienes acceso a esta sección",
  explicacion,
  role,
}: {
  titulo?: string;
  explicacion: string;
  role: string;
}) {
  return (
    <div className="max-w-xl mx-auto">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <IconLock className="size-5" />
          </div>

          <div>
            <h2 className="font-semibold">{titulo}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{explicacion}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              Tu rol es{" "}
              <span className="font-medium text-foreground">
                {ROLE_LABEL[role] ?? role}
              </span>
              . Si necesitas entrar aquí, pídele al dueño que lo cambie.
            </p>
          </div>

          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard">Volver al inicio</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
