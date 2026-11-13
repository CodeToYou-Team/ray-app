"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Error inesperado dentro de la app.
 *
 * Sin esto, cualquier excepcion llega al usuario como la pantalla de error de
 * Next — en desarrollo un stack trace, en produccion un "Application error" sin
 * contexto. Ninguno de los dos le dice nada a quien esta trabajando.
 *
 * En produccion Next NO expone el mensaje al cliente, solo un `digest` que
 * correlaciona con el log del servidor. Por eso se muestra ese digest: es el
 * unico dato con el que se puede encontrar que paso de verdad.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Mientras no haya Sentry, al menos queda en la consola del navegador.
    console.error("[app]", error);
  }, [error]);

  return (
    <div className="max-w-xl mx-auto">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <TriangleAlert className="size-5" />
          </div>

          <div>
            <h2 className="font-semibold">Algo salió mal</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              No pudimos cargar esta pantalla. Tus datos no se vieron afectados.
            </p>
            {error.digest && (
              <p className="mt-3 text-xs text-muted-foreground">
                Si vuelve a pasar, pasa este código:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {error.digest}
                </code>
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={reset} className="gap-1.5">
              <RotateCw className="size-3.5" />
              Reintentar
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard">Volver al inicio</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
