import { resolveRoute } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * El titulo de una pantalla: una sola vez, en la pantalla.
 *
 * Antes el header pintaba el titulo y la descripcion (desde `ROUTES`) y ademas
 * cada vista repetia los dos con un `<h2>`, asi que toda pantalla decia su
 * nombre dos veces. Ahora el header es una tira de utilidades y el titulo vive
 * aqui, donde cabe en grande y donde el serif tiene sentido: Instrument Serif
 * solo existe en 400, asi que a 16px se veria delgado y a 30px se ve intencional.
 *
 * `route` lee titulo y descripcion de `ROUTES`, que sigue siendo el unico lugar
 * donde viven. `title`/`description` los sobreescriben cuando el nombre es
 * dinamico (el de un servicio, por ejemplo).
 */
export function PageHeader({
  route,
  title,
  description,
  badge,
  actions,
  className,
}: {
  route?: string;
  title?: string;
  description?: React.ReactNode;
  /** Estado junto al titulo: "Archivado", "Suspendido", ... */
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const def = route ? resolveRoute(route) : null;
  const titulo = title ?? def?.title;
  const descripcion = description ?? def?.description;

  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-4 gap-y-2",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-semibold leading-none tracking-tight text-foreground">
            {titulo}
          </h1>
          {badge}
        </div>
        {descripcion && (
          <p className="mt-1.5 text-sm text-muted-foreground">{descripcion}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
