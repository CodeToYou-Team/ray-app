"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setPrimaryCurrency } from "@/lib/tenant/settings";
import {
  PRIMARY_CURRENCIES,
  STABLECOINS,
  OTHER_CURRENCIES,
  currencyLabel,
} from "@/lib/currencies";

const GRUPOS = [
  { label: "Las más usadas", items: PRIMARY_CURRENCIES },
  { label: "Stablecoins", items: STABLECOINS },
  { label: "Otras", items: OTHER_CURRENCIES },
];

/**
 * Ajustes del negocio.
 *
 * La moneda por defecto no reescribe nada: cada operación guarda la suya como
 * snapshot. Decide qué se propone de aquí en adelante, y contra qué se compara
 * cuando se cobra en otra moneda.
 */
export function BusinessSettings({ current }: { current: string }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const cambio = value !== current;

  function guardar() {
    setError(null);
    setGuardado(false);
    start(async () => {
      const result = await setPrimaryCurrency(value);
      if (result.ok) {
        setGuardado(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Moneda por defecto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Es la moneda en la que piensas tus precios. Se propone al crear
            productos y es la que el panel muestra primero. Si cobras en otra,
            al registrar la operación se te pide la tasa de cambio que
            aplicaste.
          </p>

          <div className="space-y-2">
            <Label htmlFor="moneda">Moneda</Label>
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger id="moneda" className="w-full sm:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRUPOS.map((g) => (
                  <SelectGroup key={g.label}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {g.items.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {currencyLabel(c.code)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/*
            Lo que NO hace. Es la duda inmediata de cualquiera que toque este
            selector, y la respuesta tranquiliza en vez de asustar.
          */}
          <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            Cambiarla no toca ninguna operación ya registrada ni ningún precio
            que ya tengas cargado. Cada operación guarda su propia moneda, así
            que los totales de meses anteriores siguen diciendo lo mismo.
          </p>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              <CircleAlert className="mt-px size-4 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={guardar} disabled={pending || !cambio}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
            {guardado && !cambio && (
              <span className="flex items-center gap-1.5 text-xs text-success">
                <Check className="size-3.5" />
                Guardado
              </span>
            )}
          </div>
        </CardContent>
    </Card>
  );
}
