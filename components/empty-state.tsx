import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * El estado vacio, en un solo lugar.
 *
 * El patron ya existia —medallon de 44px, titulo, explicacion y accion— pero
 * estaba copiado a mano en cada pantalla, con el medallon a veces de 40px y el
 * icono a veces de 24. Aqui el tamano y el tono se eligen por nombre.
 *
 * El icono entra como nodo para no atar esto a un juego de iconos; por
 * convencion va a `size-5`.
 */

const TONOS = {
  muted: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
} as const;

export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = "muted",
  titleAs: Titulo = "p",
  className,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Botones. Se centran y envuelven si no caben. */
  action?: React.ReactNode;
  tone?: keyof typeof TONOS;
  /** Una pantalla completa pide encabezado; un hueco dentro de una lista, no. */
  titleAs?: "p" | "h2" | "h1";
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div
          className={cn(
            "flex size-11 items-center justify-center rounded-xl",
            TONOS[tone],
          )}
        >
          {icon}
        </div>

        <div>
          <Titulo className="font-medium">{title}</Titulo>
          {description && (
            <div className="mt-1 max-w-md text-sm text-muted-foreground">
              {description}
            </div>
          )}
        </div>

        {action && (
          <div className="flex flex-wrap justify-center gap-2">{action}</div>
        )}
      </CardContent>
    </Card>
  );
}
