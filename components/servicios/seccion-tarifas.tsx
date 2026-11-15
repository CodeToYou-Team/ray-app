"use client";

import { useState } from "react";
import { Archive, Pencil, Plus } from "lucide-react";
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
import { CurrencySelect } from "@/components/currency-select";
import { addRate, archiveRate, updateRate } from "@/lib/reservas/actions";
import type { TarifaRow } from "@/lib/reservas/queries";
import { isMoney } from "@/lib/money";
import { formatMoney } from "@/lib/format";
import {
  nombreTarifa,
  porUnidad,
  TARIFAS_DEL_GRANO,
  type Unidad,
  type UnidadTarifa,
} from "@/lib/reservas/rango";
import { ErrorBox, Seccion, useAccion, useEdicion } from "./seccion";

const UNIDAD_TARIFA: Record<UnidadTarifa, string> = {
  hora: "Por hora",
  bloque: "Por bloque de horas",
  dia: "Por día",
  noche: "Por noche",
  semana: "Por semana",
  mes: "Por mes",
};

/**
 * Las tarifas del servicio: con cuál se puede reservar y a qué precio. Cada
 * reserva usa una y la congela, así que cambiar un precio o archivar una
 * tarifa solo afecta a las reservas nuevas.
 */
export function SeccionTarifas({
  serviceId,
  grano,
  tarifas,
  monedaServicio,
  perPerson,
  puedeEditar,
}: {
  serviceId: string;
  grano: Unidad;
  tarifas: TarifaRow[];
  monedaServicio: string;
  perPerson: boolean;
  puedeEditar: boolean;
}) {
  const { abierto, abrir, cerrar } = useEdicion();
  const { pending, error, correr } = useAccion();
  const agregando = abierto === "tarifa:nueva";

  return (
    <Seccion
      titulo="Tarifas"
      descripcion={
        (grano === "noche"
          ? "Por noche, por día, por semana o por mes. Al reservar se elige una."
          : "Por hora (se cobra la fracción: 1,5 horas) o por bloques completos, como una tanda de 4 horas. Al reservar se elige una.") +
        " Cambiar un precio no toca las reservas ya hechas."
      }
      accion={
        puedeEditar &&
        !agregando && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => abrir("tarifa:nueva")}
          >
            <Plus className="size-3.5" />
            Agregar tarifa
          </Button>
        )
      }
    >
      <div className="space-y-3">
        <ul className="divide-y rounded-md border">
          {tarifas.map((t) =>
            abierto === `tarifa:${t.id}` ? (
              <li key={t.id} className="bg-muted/30 p-3">
                <FormTarifaExistente tarifa={t} onListo={cerrar} />
              </li>
            ) : (
              <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{nombreTarifa(t)}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {formatMoney(t.price, t.currency)} {porUnidad(t)}
                    {perPerson && " / persona"}
                  </p>
                </div>
                {puedeEditar && (
                  <span className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={pending}
                      onClick={() => abrir(`tarifa:${t.id}`)}
                    >
                      <Pencil className="size-4" />
                      <span className="sr-only">Editar {nombreTarifa(t)}</span>
                    </Button>
                    {/* La única no se archiva: sin tarifas no se podría reservar. */}
                    {tarifas.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={pending}
                        title="Archivar"
                        onClick={() => correr(() => archiveRate({ id: t.id }))}
                      >
                        <Archive className="size-4" />
                        <span className="sr-only">Archivar {nombreTarifa(t)}</span>
                      </Button>
                    )}
                  </span>
                )}
              </li>
            ),
          )}
        </ul>

        {error && <ErrorBox>{error}</ErrorBox>}

        {agregando && (
          <div className="rounded-md border bg-muted/30 p-3">
            <FormTarifaNueva
              serviceId={serviceId}
              grano={grano}
              monedaServicio={monedaServicio}
              onListo={cerrar}
            />
          </div>
        )}
      </div>
    </Seccion>
  );
}

function FormTarifaNueva({
  serviceId,
  grano,
  monedaServicio,
  onListo,
}: {
  serviceId: string;
  grano: Unidad;
  monedaServicio: string;
  onListo: () => void;
}) {
  const { pending, error, correr } = useAccion();
  const opciones = TARIFAS_DEL_GRANO[grano];
  const [unit, setUnit] = useState<UnidadTarifa>(opciones[0]);
  const [horas, setHoras] = useState("4");
  const [label, setLabel] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState(monedaServicio);

  const minutos = Math.round(Number(horas.replace(",", ".")) * 60);
  const bloqueValido =
    unit !== "bloque" || (minutos >= 30 && minutos <= 1440 && minutos % 30 === 0);
  const valido = isMoney(price) && bloqueValido;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valido) return;
        correr(
          () =>
            addRate({
              serviceId,
              unit,
              minutes: unit === "bloque" ? minutos : undefined,
              label: label || undefined,
              price,
              currency,
            }),
          onListo,
        );
      }}
    >
      <p className="text-sm font-medium">Nueva tarifa</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="t-unidad" className="text-xs">
            Se cobra
          </Label>
          <Select value={unit} onValueChange={(v) => setUnit(v as UnidadTarifa)}>
            <SelectTrigger id="t-unidad" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {opciones.map((u) => (
                <SelectItem key={u} value={u}>
                  {UNIDAD_TARIFA[u]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {unit === "bloque" && (
          <div className="space-y-1.5">
            <Label htmlFor="t-horas" className="text-xs">
              Horas por bloque
            </Label>
            <Input
              id="t-horas"
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              value={horas}
              onChange={(e) => setHoras(e.target.value)}
              className="font-mono"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="t-nombre" className="text-xs">
            Nombre (opcional)
          </Label>
          <Input
            id="t-nombre"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={nombreTarifa({ unit, minutes: unit === "bloque" ? minutos : null })}
            maxLength={60}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="t-precio" className="text-xs">
              Precio
            </Label>
            <Input
              id="t-precio"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="font-mono"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Moneda</Label>
            <CurrencySelect value={currency} onChange={setCurrency} />
          </div>
        </div>
      </div>
      {!bloqueValido && (
        <p className="text-xs text-destructive">
          Un bloque dura de media hora a 24 horas, en tramos de media hora.
        </p>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !valido}>
          {pending ? "Guardando…" : "Agregar"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onListo} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** Una tarifa en edición: nombre, precio y moneda. La unidad no se cambia. */
function FormTarifaExistente({
  tarifa,
  onListo,
}: {
  tarifa: TarifaRow;
  onListo: () => void;
}) {
  const { pending, error, correr } = useAccion();
  const [label, setLabel] = useState(tarifa.label ?? "");
  const [price, setPrice] = useState(tarifa.price);
  const [currency, setCurrency] = useState(tarifa.currency);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isMoney(price)) return;
        correr(
          () => updateRate({ id: tarifa.id, label: label || undefined, price, currency }),
          onListo,
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="space-y-1.5">
          <Label htmlFor={`te-nombre-${tarifa.id}`} className="text-xs">
            Nombre
          </Label>
          <Input
            id={`te-nombre-${tarifa.id}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={nombreTarifa({ ...tarifa, label: null })}
            maxLength={60}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`te-precio-${tarifa.id}`} className="text-xs">
            Precio {porUnidad(tarifa)}
          </Label>
          <Input
            id={`te-precio-${tarifa.id}`}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-28 font-mono"
            autoFocus
          />
        </div>
        <div className="w-36 space-y-1.5">
          <Label className="text-xs">Moneda</Label>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !isMoney(price)}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onListo} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
