"use client";

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { IconAlertCircle } from "@tabler/icons-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Qué se está editando en la página del servicio. Uno a la vez: abrir la
 * edición de un recurso cierra la de la tarifa que estaba abierta. Así cada
 * fila se lee como dato y solo la elegida se vuelve formulario.
 *
 * Las claves son texto libre: "reserva", "tarifa:nueva", "recurso:<id>",
 * "dia:3"…
 */
interface Edicion {
  abierto: string | null;
  abrir: (clave: string) => void;
  cerrar: () => void;
}

const EdicionContext = createContext<Edicion | null>(null);

export function EdicionProvider({ children }: { children: ReactNode }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  return (
    <EdicionContext.Provider
      value={{ abierto, abrir: setAbierto, cerrar: () => setAbierto(null) }}
    >
      {children}
    </EdicionContext.Provider>
  );
}

export function useEdicion(): Edicion {
  const ctx = useContext(EdicionContext);
  if (!ctx) throw new Error("useEdicion fuera de EdicionProvider");
  return ctx;
}

type Accion = () => Promise<{ ok: boolean; error?: string }>;

/**
 * Corre una Server Action, muestra su error si lo hay y refresca la página si
 * salió bien. `despues` corre solo si salió bien (cerrar el formulario).
 */
export function useAccion() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function correr(accion: Accion, despues?: () => void) {
    setError(null);
    start(async () => {
      const r = await accion();
      if (r.ok) {
        despues?.();
        router.refresh();
      } else {
        setError(r.error ?? "No se pudo guardar.");
      }
    });
  }

  return { pending, error, setError, correr };
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
    >
      <IconAlertCircle className="mt-px size-4 shrink-0" />
      {children}
    </p>
  );
}

/** Una sección de la página: título, para qué sirve, su acción y su contenido. */
export function Seccion({
  titulo,
  descripcion,
  accion,
  children,
  className,
}: {
  titulo: string;
  descripcion?: ReactNode;
  accion?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0 max-w-xl">
          <h3 className="text-sm font-semibold">{titulo}</h3>
          {descripcion && (
            <p className="mt-0.5 text-xs text-muted-foreground">{descripcion}</p>
          )}
        </div>
        {accion}
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
  );
}

/** Un dato en modo lectura: etiqueta arriba, valor abajo. */
export function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}
