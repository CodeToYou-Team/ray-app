"use client";

import { useState, useTransition } from "react";
import { IconAlertCircle, IconArrowsExchange } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { registerPayment } from "@/lib/reservas/actions";
import { compareMoney, convertMoney, isMoney, isRate } from "@/lib/money";
import { formatDate, formatMoney } from "@/lib/format";
import type { BoardBooking } from "./types";

/** Lo que hace falta para cobrar, cargado por la página solo si el rol puede. */
export interface CobroConfig {
  paymentMethods: { id: string; label: string; currency: string }[];
  categories: { id: string; label: string }[];
  /** Sugerencia de tasa por par "USD>VES", con su origen. */
  tasas: Record<string, { rate: string; occurredOn: string; source: "configurada" | "ultima" }>;
}

/**
 * Cobrar una reserva, todo o una parte.
 *
 * El monto se escribe en la moneda de la RESERVA ("abona 100 USD"), aunque se
 * pague en otra: es lo que se descuenta del saldo. Si el método cobra en otra
 * moneda, se pide la tasa y se muestra cuánto entra de verdad.
 *
 * El `requestId` se genera al montar: el doble clic no cobra dos veces.
 */
export function PaymentForm({
  reserva,
  config,
  onDone,
  onBack,
}: {
  reserva: BoardBooking;
  config: CobroConfig;
  onDone: () => void;
  onBack: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());

  // Por defecto, un método en la moneda de la reserva: es el caso sin tasa.
  const preferido =
    config.paymentMethods.find((m) => m.currency === reserva.currency) ??
    config.paymentMethods[0];

  const [monto, setMonto] = useState(reserva.saldo);
  const [methodId, setMethodId] = useState(preferido?.id ?? "");
  const [categoryId, setCategoryId] = useState(config.categories[0]?.id ?? "");

  const metodo = config.paymentMethods.find((m) => m.id === methodId);
  const necesitaTasa = Boolean(metodo && metodo.currency !== reserva.currency);
  const par = necesitaTasa && metodo ? `${reserva.currency}>${metodo.currency}` : "";
  const sugerida = par ? config.tasas[par] : undefined;

  const [rate, setRate] = useState(sugerida?.rate ?? "");
  /**
   * Cambiar de método cambia el par de monedas: se propone la tasa de ese par.
   * Se ajusta durante el render, no en un efecto, y solo cuando CAMBIA el par,
   * así no pisa lo que ya se escribió.
   */
  const [ultimoPar, setUltimoPar] = useState(par);
  if (par !== ultimoPar) {
    setUltimoPar(par);
    setRate(par ? (config.tasas[par]?.rate ?? "") : "");
  }

  const montoValido = isMoney(monto) && compareMoney(monto, "0") > 0;
  const pasaDelSaldo = montoValido && compareMoney(monto, reserva.saldo) > 0;
  const tasaValida = !necesitaTasa || isRate(rate);
  const entra =
    necesitaTasa && montoValido && isRate(rate) ? convertMoney(monto, rate) : null;

  const puedeCobrar =
    montoValido && !pasaDelSaldo && metodo && categoryId && tasaValida;

  function cobrar() {
    setError(null);
    start(async () => {
      const r = await registerPayment({
        bookingId: reserva.id,
        monto,
        paymentMethodId: methodId,
        categoryId,
        exchangeRate: necesitaTasa ? rate : undefined,
        clientRequestId: requestId,
      });
      if (r.ok) onDone();
      else setError(r.error);
    });
  }

  if (config.paymentMethods.length === 0 || config.categories.length === 0) {
    return (
      <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
        Para cobrar hace falta al menos un método de pago y una categoría de
        ingreso. Créalos en Ajustes › Catálogos.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="monto">Cuánto abona ({reserva.currency})</Label>
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => setMonto(reserva.saldo)}
          >
            Todo el saldo: {formatMoney(reserva.saldo, reserva.currency)}
          </button>
        </div>
        <Input
          id="monto"
          inputMode="decimal"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          className="font-mono"
        />
        {monto && !isMoney(monto) && (
          <p className="text-xs text-destructive">Usa números con hasta 2 decimales.</p>
        )}
        {pasaDelSaldo && (
          <p className="text-xs text-destructive">
            Pasa del saldo. Si te dieron de más, cobra el saldo y anota el vuelto.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="metodo">Método de pago</Label>
          <Select value={methodId} onValueChange={setMethodId}>
            <SelectTrigger id="metodo" className="w-full">
              <SelectValue placeholder="Elige uno" />
            </SelectTrigger>
            <SelectContent>
              {config.paymentMethods.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                  <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                    {m.currency}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="categoria">Categoría</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id="categoria" className="w-full">
              <SelectValue placeholder="Elige una" />
            </SelectTrigger>
            <SelectContent>
              {config.categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {necesitaTasa && metodo && (
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-2">
            <IconArrowsExchange className="size-4 text-primary" />
            <Label htmlFor="tasa-cobro" className="text-sm">
              Tasa de cambio
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              1 {reserva.currency} =
            </span>
            <Input
              id="tasa-cobro"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="0.000000"
              className="w-36 font-mono"
            />
            <span className="font-mono text-xs text-muted-foreground">{metodo.currency}</span>
          </div>
          {sugerida && rate === sugerida.rate && (
            <p className="text-[11px] text-muted-foreground">
              {sugerida.source === "configurada"
                ? "Es la que tienes fijada en Ajustes."
                : `Es la que usaste el ${formatDate(sugerida.occurredOn)}.`}{" "}
              Cámbiala si hoy es otra.
            </p>
          )}
          {rate && !isRate(rate) && (
            <p className="text-xs text-destructive">
              Usa un número mayor que cero, con hasta 6 decimales.
            </p>
          )}
          {entra && (
            <p className="text-xs">
              Entran{" "}
              <span className="font-mono font-semibold">
                {formatMoney(entra, metodo.currency)}
              </span>
            </p>
          )}
        </div>
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

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={pending}>
          Volver
        </Button>
        <Button size="sm" onClick={cobrar} disabled={pending || !puedeCobrar}>
          {pending ? "Cobrando…" : "Cobrar"}
        </Button>
      </div>
    </div>
  );
}
