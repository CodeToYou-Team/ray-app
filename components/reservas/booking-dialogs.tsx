"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IconAlertCircle,
  IconCalendarX,
  IconCash,
  IconLogin,
  IconLogout,
} from "@tabler/icons-react";
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
import {
  cancelBooking,
  checkIn,
  checkOut,
  createBooking,
  markNoShow,
} from "@/lib/reservas/actions";
import {
  bordesLocales,
  cantidad,
  seCruzan,
  sumarDias,
  TRAMO_MINUTOS,
  type Rango,
} from "@/lib/reservas/rango";
import { compareMoney, lineSubtotal } from "@/lib/money";
import { formatDate, formatMoney } from "@/lib/format";
import type { BoardBooking, BoardService } from "./types";
import { PaymentForm, type CobroConfig } from "./booking-payment";

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
// Detalle: estado, cobros y acciones
// ---------------------------------------------------------------------------

const ESTADO: Record<BoardBooking["status"], { label: string; className: string }> = {
  reservada: { label: "Reservada", className: "bg-primary/15 text-primary" },
  en_curso: { label: "En curso", className: "bg-success/15 text-success" },
  finalizada: { label: "Finalizada", className: "bg-muted text-muted-foreground" },
  cancelada: { label: "Cancelada", className: "bg-muted text-muted-foreground" },
  no_show: { label: "No se presentó", className: "bg-muted text-muted-foreground" },
};

function describirRango(r: BoardBooking): string {
  if (r.unidad === "noche") {
    return `${formatDate(r.inicio.slice(0, 10))} → ${formatDate(r.fin.slice(0, 10))}`;
  }
  return `${formatDate(r.inicio.slice(0, 10))}, ${r.inicio.slice(11, 16)}–${r.fin.slice(11, 16)}`;
}

type Modo = "ver" | "cobrando" | "cancelando" | "saliendo" | "noshow";

/**
 * Detalle de una reserva y lo que se puede hacer con ella según su estado.
 *
 * Los botones que se muestran son una comodidad: el servidor vuelve a
 * verificar estado, fechas y permisos. Si aquí "hoy" difiere del servidor por
 * un par de minutos alrededor de la medianoche, quien decide es el servidor.
 */
export function BookingDetail({
  reserva,
  servicio,
  hoy,
  canManage,
  cobro,
  onClose,
}: {
  reserva: BoardBooking;
  servicio: BoardService | undefined;
  /** YYYY-MM-DD en la zona del negocio. */
  hoy: string;
  canManage: boolean;
  /** null = el rol no puede cobrar. */
  cobro: CobroConfig | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("ver");
  const [motivo, setMotivo] = useState("");

  const recurso = servicio?.resources.find((r) => r.id === reserva.resourceId);
  const estado = ESTADO[reserva.status];
  const debe = compareMoney(reserva.saldo, "0") > 0;

  // Lo mismo que verifica el servidor, para decidir qué botones mostrar.
  const llegada = reserva.inicio.slice(0, 10);
  const empezo = llegada <= hoy;
  const termino =
    reserva.unidad === "noche" ? reserva.fin.slice(0, 10) <= hoy : llegada < hoy;

  const puedeLlegar = canManage && reserva.status === "reservada" && empezo && !termino;
  const puedeNoShow = canManage && reserva.status === "reservada" && empezo;
  const puedeCancelar = canManage && reserva.status === "reservada";
  const puedeSalir = canManage && reserva.status === "en_curso";
  const puedeCobrar =
    cobro !== null &&
    debe &&
    (reserva.status === "reservada" ||
      reserva.status === "en_curso" ||
      reserva.status === "finalizada");

  /** Corre una acción del servidor y refresca; cerrar o no lo decide quien llama. */
  function correr(accion: () => Promise<{ ok: boolean; error?: string }>, cerrar = false) {
    setError(null);
    start(async () => {
      const r = await accion();
      if (r.ok) {
        setModo("ver");
        if (cerrar) onClose();
        router.refresh();
      } else {
        setError(r.error ?? "No se pudo completar.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="text-base">{reserva.holderName}</DialogTitle>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${estado.className}`}
            >
              {estado.label}
            </span>
          </div>
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
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Pagado</dt>
            <dd className="font-mono">{formatMoney(reserva.pagado, reserva.currency)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t pt-2">
            <dt className="font-medium">Saldo</dt>
            <dd
              className={`font-mono font-semibold ${debe ? "text-destructive" : "text-success"}`}
            >
              {formatMoney(reserva.saldo, reserva.currency)}
            </dd>
          </div>
        </dl>

        {reserva.pagos.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Cobros</p>
            <ul className="divide-y rounded-md border text-xs">
              {reserva.pagos.map((p) => (
                <li
                  key={p.transactionId}
                  className={`flex items-center justify-between gap-3 px-3 py-2 ${p.voided ? "text-muted-foreground line-through" : ""}`}
                >
                  <span>
                    {formatDate(p.occurredOn)} · {p.paymentMethodLabel}
                    {p.voided && <span className="ml-1 no-underline">(anulado)</span>}
                  </span>
                  <span className="text-right font-mono">
                    {formatMoney(p.amount, p.currency)}
                    {/* Si se cobró en otra moneda, lo que abonó en la de la reserva. */}
                    {p.currency !== reserva.currency && (
                      <span className="block text-[10px] text-muted-foreground">
                        = {formatMoney(p.appliedAmount, reserva.currency)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(reserva.holderDocument || reserva.holderPhone || reserva.notes) && (
          <dl className="space-y-2 text-sm">
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
        )}

        {/* ------------------------------------------------------------- */}
        {/* Sub-pasos que piden confirmación o datos                       */}
        {/* ------------------------------------------------------------- */}

        {modo === "cobrando" && cobro && (
          <PaymentForm
            reserva={reserva}
            config={cobro}
            onBack={() => setModo("ver")}
            onDone={() => {
              setModo("ver");
              router.refresh();
            }}
          />
        )}

        {modo === "saliendo" && (
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm">
              Queda un saldo de{" "}
              <span className="font-mono font-semibold">
                {formatMoney(reserva.saldo, reserva.currency)}
              </span>
              .
            </p>
            <p className="text-[11px] text-muted-foreground">
              Si sale así, el saldo queda pendiente y se puede cobrar después.
              Queda registrado quién aceptó la salida con saldo.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              {puedeCobrar && (
                <Button size="sm" variant="outline" onClick={() => setModo("cobrando")}>
                  Cobrar primero
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => correr(() => checkOut({ id: reserva.id, aceptarSaldo: true }))}
              >
                {pending ? "Registrando…" : "Salir con saldo pendiente"}
              </Button>
            </div>
          </div>
        )}

        {modo === "noshow" && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm">¿Marcar que no se presentó?</p>
            <p className="text-[11px] text-muted-foreground">
              Libera {recurso?.name ?? "el recurso"} para esas fechas.
              {compareMoney(reserva.pagado, "0") > 0 &&
                ` Lo cobrado (${formatMoney(reserva.pagado, reserva.currency)}) se conserva.`}
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setModo("ver")} disabled={pending}>
                Volver
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => correr(() => markNoShow({ id: reserva.id }), true)}
              >
                {pending ? "Marcando…" : "No se presentó"}
              </Button>
            </div>
          </div>
        )}

        {modo === "cancelando" && (
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
              {compareMoney(reserva.pagado, "0") > 0 &&
                " Lo cobrado se mantiene como ingreso; si devuelves el anticipo, anula el cobro en Finanzas."}
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setModo("ver")} disabled={pending}>
                Volver
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  correr(() => cancelBooking({ id: reserva.id, reason: motivo || undefined }), true)
                }
              >
                {pending ? "Cancelando…" : "Confirmar cancelación"}
              </Button>
            </div>
          </div>
        )}

        {error && <ErrorBox>{error}</ErrorBox>}

        {/* ------------------------------------------------------------- */}
        {/* Acciones                                                       */}
        {/* ------------------------------------------------------------- */}

        {modo === "ver" && (
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {puedeCancelar && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => setModo("cancelando")}
                >
                  <IconCalendarX className="size-4" />
                  Cancelar
                </Button>
              )}
              {puedeNoShow && (
                <Button size="sm" variant="ghost" onClick={() => setModo("noshow")}>
                  No se presentó
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {puedeCobrar && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setModo("cobrando")}
                >
                  <IconCash className="size-4" />
                  Cobrar
                </Button>
              )}
              {puedeLlegar && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={pending}
                  onClick={() => correr(() => checkIn({ id: reserva.id }))}
                >
                  <IconLogin className="size-4" />
                  {pending ? "Registrando…" : "Registrar llegada"}
                </Button>
              )}
              {puedeSalir && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={pending}
                  onClick={() =>
                    debe ? setModo("saliendo") : correr(() => checkOut({ id: reserva.id }))
                  }
                >
                  <IconLogout className="size-4" />
                  {pending ? "Registrando…" : "Registrar salida"}
                </Button>
              )}
              {!puedeCobrar && !puedeLlegar && !puedeSalir && (
                <Button size="sm" variant="ghost" onClick={onClose}>
                  Cerrar
                </Button>
              )}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
