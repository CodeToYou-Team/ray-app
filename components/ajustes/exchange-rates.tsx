"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IconAlertCircle,
  IconArrowsExchange,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveExchangeRate, deleteExchangeRate } from "@/lib/tenant/settings";
import { CURRENCIES, currencyLabel } from "@/lib/currencies";
import { isRate } from "@/lib/money";
import { formatDate } from "@/lib/format";

export interface RateRow {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  updatedAt: string;
}

/**
 * "40.000000" -> "40". Los ceros de relleno son del tipo numeric, no del dato.
 */
function trim(rate: string): string {
  return rate.includes(".") ? rate.replace(/0+$/, "").replace(/\.$/, "") : rate;
}

/**
 * Tasas de cambio vigentes.
 *
 * Es lo que el negocio declara que cobra hoy, no un histórico. Cada operación
 * guarda la tasa con la que se registró, así que cambiar algo de acá no mueve
 * ningún monto ya asentado: solo decide con qué número llega precargado el
 * formulario de la próxima venta.
 */
export function ExchangeRates({
  rates,
  primaryCurrency,
}: {
  rates: RateRow[];
  primaryCurrency: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);

  const [base, setBase] = useState(primaryCurrency);
  const [quote, setQuote] = useState("");
  const [valor, setValor] = useState("");

  const puedeGuardar = base && quote && base !== quote && isRate(valor);

  function guardar() {
    setError(null);
    start(async () => {
      const r = await saveExchangeRate({
        baseCurrency: base,
        quoteCurrency: quote,
        rate: valor,
      });
      if (r.ok) {
        setAgregando(false);
        setQuote("");
        setValor("");
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  function quitar(id: string) {
    setError(null);
    start(async () => {
      const r = await deleteExchangeRate(id);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <IconArrowsExchange className="size-4" />
          Tasas de cambio
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          La tasa que estás aplicando hoy. Se propone al registrar una venta
          cobrada en otra moneda, para no tener que escribirla cada vez. Si no
          fijas ninguna, se propone la última que usaste.
        </p>

        {rates.length === 0 && !agregando && (
          <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            No tienes ninguna fijada. No hace falta: mientras tanto se propone
            la última tasa con la que registraste una venta.
          </p>
        )}

        {rates.length > 0 && (
          <ul className="divide-y rounded-md border">
            {rates.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div>
                  <p className="font-mono text-sm">
                    1 {r.baseCurrency} = {trim(r.rate)} {r.quoteCurrency}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Fijada el {formatDate(r.updatedAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  disabled={pending}
                  onClick={() => quitar(r.id)}
                >
                  <IconTrash className="size-4" />
                  <span className="sr-only">
                    Quitar la tasa de {r.baseCurrency} a {r.quoteCurrency}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}

        {agregando ? (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">De</Label>
                <Select value={base} onValueChange={setBase}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">A</Label>
                <Select value={quote} onValueChange={setQuote}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="Elige" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.filter((c) => c.code !== base).map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="valor" className="text-xs text-muted-foreground">
                  Tasa
                </Label>
                <Input
                  id="valor"
                  inputMode="decimal"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="0.000000"
                  className="w-36 font-mono"
                />
              </div>
            </div>

            {base && quote && (
              <p className="text-[11px] text-muted-foreground">
                1 {currencyLabel(base)} = {valor || "…"} {quote}
              </p>
            )}

            {valor && !isRate(valor) && (
              <p className="text-xs text-destructive">
                Usa un número mayor que cero, con hasta 6 decimales.
              </p>
            )}

            <div className="flex gap-2">
              <Button size="sm" onClick={guardar} disabled={pending || !puedeGuardar}>
                {pending ? "Guardando…" : "Guardar"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setAgregando(false);
                  setError(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAgregando(true)}
            disabled={pending}
          >
            <IconPlus className="size-3.5" />
            {rates.length === 0 ? "Fijar una tasa" : "Fijar otra"}
          </Button>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            <IconAlertCircle className="mt-px size-4 shrink-0" />
            {error}
          </p>
        )}

        <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          Cambiar o quitar una tasa de aquí no toca ninguna operación ya
          registrada. Cada una guardó la tasa con la que se hizo.
        </p>
      </CardContent>
    </Card>
  );
}
