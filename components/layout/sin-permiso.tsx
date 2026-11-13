import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

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
      <EmptyState
        icon={<Lock className="size-5" />}
        title={titulo}
        titleAs="h2"
        description={
          <>
            <p>{explicacion}</p>
            <p className="mt-3 text-xs">
              Tu rol es{" "}
              <span className="font-medium text-foreground">
                {ROLE_LABEL[role] ?? role}
              </span>
              . Si necesitas entrar aquí, pídele al dueño que lo cambie.
            </p>
          </>
        }
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard">Volver al inicio</Link>
          </Button>
        }
      />
    </div>
  );
}
