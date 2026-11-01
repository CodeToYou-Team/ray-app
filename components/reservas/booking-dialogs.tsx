"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconAlertCircle, IconCalendarX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cancelBooking, createBooking } from "@/lib/reservas/actions";
import {
  bordesLocales,
  cantidad,
  seCruzan,
  sumarDias,
  TRAMO_MINUTOS,
  type Rango,
} from "@/lib/reservas/rango";
import { lineSubtotal } from "@/lib/money";
import { formatDate, formatMoney } from "@/lib/format";
import type { BoardBooking, BoardService } from "./types";

/** Con qué abre el formulario: lo que se tocó en la cuadrícula. */
export interface Inicial {
  serviceId: string;
  /** "" si se abrió desde "Nueva reserva" y no desde una celda. */
  resourceId: string;
  fecha: string;
}

function ErrorBox({ children }: { children: React.ReactNode }) {
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

// ---------------------------------------------------------------------------
// Nueva reserva
// ---------------------------------------------------------------------------

/**
 * Formulario de reserva.
 *
 * El estado se siembra una sola vez de `inicial`; el padre lo monta con `key`
 * para que cada apertura empiece de cero.
 *
 * Lo que marca como "ocupado" sale de las reservas ya cargadas en la
 * cuadrícula, y solo sirve para no ofrecer lo que ya se sabe tomado. La
 * palabra final la tiene el EXCLUDE de la base: si otra persona reservó esa
 * habitación hace un segundo, el servidor lo rechaza igual.
 */
export function BookingForm({
  open,
  onOpenChange,
  servicios,
  reservas,
  inicial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servicios: BoardService[];
  reservas: BoardBooking[];
  inicial: Inicial;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [serviceId, setServiceId] = useState(inicial.serviceId);
  const [resourceId, setResourceId] = useState(inicial.resourceId);

  // Por noche
  const [desde, setDesde] = useState(inicial.fecha);
  const [hasta, setHasta] = useState(sumarDias(inicial.fecha, 1));
  // Por hora
  const [fecha, setFecha] = useState(inicial.fecha);
  const [inicio, setInicio] = useState("09:00");
  const [fin, setFin] = useState("10:00");

  const [holderName, setHolderName] = useState("");
  const [holderDocument, setHolderDocument] = useState("");
  const [holderPhone, setHolderPhone] = useState("");
  const [notes, setNotes] = useState("");

  const servicio = servicios.find((s) => s.id === serviceId);
  const unidad = servicio?.unidad ?? "noche";

  const rango: Rango =
    unidad === "noche"
      ? { unidad, desde, hasta }
      : { unidad, fecha, inicio, fin };

  const cant = cantidad(rango);
  const total =
    servicio && cant.ok ? lineSubtotal(cant.qty, servicio.price) : null;

  /**
   * Recursos que ya se sabe ocupados en el rango pedido. Son unas decenas de
   * reservas como mucho (las de la ventana visible): se recalcula en cada
   * render sin costo que valga la pena memorizar.
   */
  const ocupados = cant.ok
    ? new Set(
        reservas
          .filter((r) => seCruzan(bordesLocales(rango), { inicio: r.inicio, fin: r.fin }))
          .map((r) => r.resourceId),
      )
    : new Set<string>();

  const recursoOcupado = Boolean(resourceId && ocupados.has(resourceId));
  const recurso = servicio?.resources.find((r) => r.id === resourceId);

  const puedeGuardar =
    servicio && resourceId && cant.ok && holderName.trim() && !recursoOcupado;

  function guardar() {
    if (!servicio) return;
    setError(null);
    start(async () => {
      const r = await createBooking({
        serviceId: servicio.id,
        resourceId,
        rango,
        holderName,
        holderDocument: holderDocument || undefined,
        holderPhone: holderPhone || undefined,
        notes: notes || undefined,
      });
      if (r.ok) {
        onOpenChange(false);
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Nueva reserva</DialogTitle>
          <DialogDescription className="text-xs">
            El precio queda fijado al reservar: si la tarifa cambia después, esta
            reserva no.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="servicio">Qué se reserva</Label>
              <Select
                value={serviceId}
                onValueChange={(v) => {
                  setServiceId(v);
                  // Los recursos son de cada servicio.
                  setResourceId("");
                }}
              >
                <SelectTrigger id="servicio" className="w-full">
                  <SelectValue placeholder="Elige" />
                </SelectTrigger>
                <SelectContent>
                  {servicios.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="recurso">
                {unidad === "noche" ? "Habitación" : "Recurso"}
              </Label>
              <Select value={resourceId} onValueChange={setResourceId}>
                <SelectTrigger id="recurso" className="w-full">
                  <SelectValue placeholder="Elige" />
                </SelectTrigger>
                <SelectContent>
                  {servicio?.resources.map((r) => {
                    const tomado = ocupados.has(r.id);
                    return (
                      <SelectItem key={r.id} value={r.id} disabled={tomado}>
                        {r.name}
                        {tomado && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">
                            ocupado
                          </span>
                        )}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          {unidad === "noche" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="desde">Entrada</Label>
                <Input
                  id="desde"
                  type="date"
                  value={desde}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDesde(v);
                    // Mover la entrada más allá de la salida dejaría un rango
                    // al revés: se empuja la salida para conservar las noches.
                    if (v && hasta <= v) setHasta(sumarDias(v, 1));
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hasta">Salida</Label>
                <Input
                  id="hasta"
                  type="date"
                  value={hasta}
                  min={desde ? sumarDias(desde, 1) : undefined}
                  onChange={(e) => setHasta(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="fecha">Fecha</Label>
                <Input
                  id="fecha"
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inicio">Desde</Label>
                <Input
                  id="inicio"
                  type="time"
                  step={TRAMO_MINUTOS * 60}
                  value={inicio}
                  onChange={(e) => setInicio(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fin">Hasta</Label>
                <Input
                  id="fin"
                  type="time"
                  step={TRAMO_MINUTOS * 60}
                  value={fin}
                  onChange={(e) => setFin(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* El total, o lo que impide calcularlo. */}
          {!cant.ok ? (
            <p className="text-xs text-destructive">{cant.error}</p>
          ) : servicio && total ? (
            <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
              <span className="text-xs text-muted-foreground">
                {cant.descripcion} × {formatMoney(servicio.price, servicio.currency)}
              </span>
              <span className="font-mono text-sm font-semibold">
                {formatMoney(total, servicio.currency)}
              </span>
            </div>
          ) : null}

          {recursoOcupado && recurso && (
            <p className="text-xs text-destructive">
              {recurso.name} ya tiene una reserva que se cruza con esas fechas.
              Elige otro o cambia las fechas.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="titular">A nombre de</Label>
            <Input
              id="titular"
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              placeholder="Nombre y apellido"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="documento">Cédula o documento (opcional)</Label>
              <Input
                id="documento"
                value={holderDocument}
                onChange={(e) => setHolderDocument(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefono">Teléfono (opcional)</Label>
              <Input
                id="telefono"
                type="tel"
                value={holderPhone}
                onChange={(e) => setHolderPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notas">Notas (opcional)</Label>
            <Textarea
              id="notas"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && <ErrorBox>{error}</ErrorBox>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={pending || !puedeGuardar}>
            {pending ? "Guardando…" : "Reservar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Detalle y cancelación
// ---------------------------------------------------------------------------

function describirRango(r: BoardBooking): string {
  if (r.unidad === "noche") {
    return `${formatDate(r.inicio.slice(0, 10))} → ${formatDate(r.fin.slice(0, 10))}`;
  }
  return `${formatDate(r.inicio.slice(0, 10))}, ${r.inicio.slice(11, 16)}–${r.fin.slice(11, 16)}`;
}

export function BookingDetail({
  reserva,
  servicio,
  canManage,
  onClose,
}: {
  reserva: BoardBooking;
  servicio: BoardService | undefined;
  canManage: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const recurso = servicio?.resources.find((r) => r.id === reserva.resourceId);

  function cancelar() {
    setError(null);
    start(async () => {
      const r = await cancelBooking({ id: reserva.id, reason: motivo || undefined });
      if (r.ok) {
        onClose();
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{reserva.holderName}</DialogTitle>
          <DialogDescription className="text-xs">
            {servicio?.name} · <span className="font-mono">{recurso?.name}</span>
          </DialogDescription>
        </DialogHeader>

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Fechas</dt>
            <dd className="text-right">{describirRango(reserva)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Total</dt>
            <dd className="text-right">
              <span className="text-xs text-muted-foreground">
                {reserva.descripcion} × {formatMoney(reserva.unitPrice, reserva.currency)} ={" "}
              </span>
              <span className="font-mono font-semibold">
                {formatMoney(reserva.total, reserva.currency)}
              </span>
            </dd>
          </div>
          {reserva.holderDocument && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Documento</dt>
              <dd>{reserva.holderDocument}</dd>
            </div>
          )}
          {reserva.holderPhone && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Teléfono</dt>
              <dd>
                <a href={`tel:${reserva.holderPhone}`} className="underline underline-offset-2">
                  {reserva.holderPhone}
                </a>
              </dd>
            </div>
          )}
          {reserva.notes && (
            <div className="space-y-1">
              <dt className="text-muted-foreground">Notas</dt>
              <dd className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">
                {reserva.notes}
              </dd>
            </div>
          )}
        </dl>

        {cancelando && (
          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo (opcional)</Label>
            <Input
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Llamó para cancelar"
            />
            <p className="text-[11px] text-muted-foreground">
              La reserva no se borra: queda como cancelada y el recurso se libera
              para esas fechas.
            </p>
          </div>
        )}

        {error && <ErrorBox>{error}</ErrorBox>}

        <DialogFooter>
          {canManage && reserva.status === "reservada" ? (
            cancelando ? (
              <>
                <Button variant="ghost" onClick={() => setCancelando(false)} disabled={pending}>
                  Volver
                </Button>
                <Button variant="destructive" onClick={cancelar} disabled={pending}>
                  {pending ? "Cancelando…" : "Confirmar cancelación"}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={() => setCancelando(true)}
              >
                <IconCalendarX className="size-4" />
                Cancelar reserva
              </Button>
            )
          ) : (
            <Button variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
