"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  IconAlertCircle,
  IconArchive,
  IconPlus,
  IconTool,
  IconX,
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
import {
  addSchedule,
  archiveResource,
  configureServiceBooking,
  createResource,
  removeSchedule,
  setResourceLabel,
  updateResourceCapacity,
} from "@/lib/reservas/actions";
import { formatMoney } from "@/lib/format";
import { DIAS_SEMANA, recursoLabel, type Turno, type Unidad } from "@/lib/reservas/rango";
import { cn } from "@/lib/utils";

export interface SetupService {
  id: string;
  name: string;
  active: boolean;
  price: string;
  currency: string;
  unidad: Unidad | null;
  shared: boolean;
  perPerson: boolean;
  /** Como se llaman sus recursos. NULL = el generico. */
  resourceLabel: string | null;
  bookingCount: number;
  resources: { id: string; name: string; notes: string | null; capacity: number }[];
  turnos: Turno[];
}

/**
 * Qué servicios se reservan, cómo, y con qué recursos.
 *
 * Tres decisiones por servicio:
 * - la unidad: por noche o por hora (o no se reserva);
 * - el modo: exclusivo (una reserva a la vez: la habitación) o compartido
 *   (varias hasta llenar los cupos: la clase, el tour);
 * - el cobro: por reserva (la habitación cuesta lo mismo vayan 1 o 3) o por
 *   persona (el tour, tanto por cabeza).
 */
export function ResourceSetup({ services }: { services: SetupService[] }) {
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-bold">Recursos</h2>
        <p className="text-sm text-muted-foreground">
          Elige qué servicios se reservan, cómo, y con qué habitaciones, canchas,
          salas o equipos
        </p>
      </div>

      {services.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <IconTool className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Todavía no tienes servicios. Crea uno primero, por ejemplo
              &ldquo;Habitación doble&rdquo; con su precio por noche.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/servicios">Ir a Servicios</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        services.map((s) => <ServiceCard key={s.id} service={s} />)
      )}
    </div>
  );
}

const SIN_RESERVA = "no";

function ServiceCard({ service }: { service: SetupService }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [capacidad, setCapacidad] = useState("1");

  // Unidad y modo quedan fijos con la primera reserva; el cobro no.
  const bloqueada = service.bookingCount > 0;

  function correr(accion: () => Promise<{ ok: boolean; error?: string }>, despues?: () => void) {
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

  function configurar(cambios: {
    unidad?: Unidad | null;
    compartido?: boolean;
    porPersona?: boolean;
  }) {
    correr(() =>
      configureServiceBooking({
        serviceId: service.id,
        unidad: cambios.unidad !== undefined ? cambios.unidad : service.unidad,
        compartido: cambios.compartido ?? service.shared,
        porPersona: cambios.porPersona ?? service.perPerson,
      }),
    );
  }

  function agregar() {
    const cap = Number(capacidad);
    if (!nombre.trim() || !Number.isInteger(cap) || cap < 1) return;
    correr(
      () => createResource({ serviceId: service.id, name: nombre, capacity: cap }),
      () => {
        setNombre("");
        setCapacidad("1");
      },
    );
  }

  const etiquetaCapacidad = service.shared ? "Cupos" : "Personas máx.";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">{service.name}</CardTitle>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {formatMoney(service.price, service.currency)}
              {service.unidad && ` / ${service.unidad}`}
              {service.unidad && service.perPerson && " / persona"}
            </p>
            {/*
              Explica por qué no aparece en Disponibilidad aunque esté bien
              configurado: el interruptor vive en otra pantalla.
            */}
            {!service.active && service.unidad && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Marcado como no disponible para vender en Servicios: no acepta
                reservas nuevas. Las que ya tiene siguen su curso.
              </p>
            )}
          </div>

          <Select
            value={service.unidad ?? SIN_RESERVA}
            onValueChange={(v) =>
              configurar({ unidad: v === SIN_RESERVA ? null : (v as Unidad) })
            }
            disabled={pending || bloqueada}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN_RESERVA}>No se reserva</SelectItem>
              <SelectItem value="noche">Se reserva por noche</SelectItem>
              <SelectItem value="hora">Se reserva por hora</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      {service.unidad && (
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Modo</Label>
              <Select
                value={service.shared ? "compartido" : "exclusivo"}
                onValueChange={(v) => configurar({ compartido: v === "compartido" })}
                disabled={pending || bloqueada}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exclusivo">Exclusivo: una reserva a la vez</SelectItem>
                  <SelectItem value="compartido">Compartido: varias hasta llenar cupos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Cobro</Label>
              <Select
                value={service.perPerson ? "persona" : "reserva"}
                onValueChange={(v) => configurar({ porPersona: v === "persona" })}
                disabled={pending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reserva">Por reserva: el mismo precio vayan cuantos vayan</SelectItem>
                  <SelectItem value="persona">Por persona: el precio por cada uno</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {service.shared
              ? "Compartido: cada recurso tiene un total de cupos, y se aceptan reservas hasta llenarlo. Sirve para clases, tours o estacionamientos."
              : "Exclusivo: una reserva ocupa el recurso entero, y la capacidad es cuántas personas caben en ella. Sirve para habitaciones o canchas."}
            {bloqueada &&
              ` Ya tiene ${service.bookingCount} ${service.bookingCount === 1 ? "reserva" : "reservas"}: la unidad y el modo no se pueden cambiar. El cobro sí, y solo afecta a las reservas nuevas.`}
          </p>

          <NombreRecursos
            key={service.resourceLabel ?? ""}
            serviceId={service.id}
            actual={service.resourceLabel}
            pending={pending}
            correr={correr}
          />

          {service.resources.length === 0 ? (
            <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              Agrega las habitaciones, canchas, salas o equipos que se reservan con
              este servicio. Sin al menos uno, no se puede reservar.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {service.resources.map((r) => (
                <FilaRecurso
                  key={`${r.id}-${r.capacity}`}
                  recurso={r}
                  etiqueta={etiquetaCapacidad}
                  pending={pending}
                  onCapacidad={(capacity) =>
                    correr(() => updateResourceCapacity({ id: r.id, capacity }))
                  }
                  onArchivar={() => correr(() => archiveResource({ id: r.id }))}
                />
              ))}
            </ul>
          )}

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              agregar();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={`nombre-${service.id}`} className="text-xs text-muted-foreground">
                {recursoLabel(service.resourceLabel)}
              </Label>
              <Input
                id={`nombre-${service.id}`}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder={service.unidad === "noche" ? "101" : "Cancha 1"}
                className="w-40"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`cap-${service.id}`} className="text-xs text-muted-foreground">
                {etiquetaCapacidad}
              </Label>
              <Input
                id={`cap-${service.id}`}
                type="number"
                min={1}
                step={1}
                value={capacidad}
                onChange={(e) => setCapacidad(e.target.value)}
                className="w-24 font-mono"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={pending || !nombre.trim()}
            >
              <IconPlus className="size-3.5" />
              Agregar
            </Button>
          </form>

          <p className="text-[11px] text-muted-foreground">
            Archivar un recurso lo saca de la disponibilidad sin borrar las
            reservas que ya tuvo. No se puede mientras tenga reservas pendientes.
          </p>

          {service.unidad === "hora" && (
            <Horarios
              serviceId={service.id}
              turnos={service.turnos}
              pending={pending}
              correr={correr}
            />
          )}
        </CardContent>
      )}

      {error && (
        <CardContent className="pt-0">
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            <IconAlertCircle className="mt-px size-4 shrink-0" />
            {error}
          </p>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Como se llaman los recursos del servicio: es la etiqueta que ve quien
 * reserva ("Habitación", "Cancha"). Se guarda al salir del campo o con Enter;
 * vacío vuelve al genérico.
 */
function NombreRecursos({
  serviceId,
  actual,
  pending,
  correr,
}: {
  serviceId: string;
  actual: string | null;
  pending: boolean;
  correr: (accion: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [valor, setValor] = useState(actual ?? "");

  function guardar() {
    if (valor.trim() === (actual ?? "")) return;
    correr(() => setResourceLabel({ serviceId, label: valor }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={`etiqueta-${serviceId}`} className="text-xs text-muted-foreground">
        Cómo se llaman
      </Label>
      <Input
        id={`etiqueta-${serviceId}`}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={guardar}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            guardar();
          }
        }}
        placeholder={recursoLabel(null)}
        maxLength={40}
        disabled={pending}
        className="h-8 w-44"
      />
      <span className="text-[11px] text-muted-foreground">
        Habitación, Cancha, Cabaña… Es lo que se lee al reservar.
      </span>
    </div>
  );
}

/**
 * Un recurso con su capacidad editable. Se guarda al salir del campo o con
 * Enter, solo si cambió. El padre lo monta con `key` que incluye la capacidad,
 * así un rechazo del servidor (bajarla por debajo de lo comprometido) vuelve a
 * mostrar el valor real en vez de dejar el que se escribió.
 */
function FilaRecurso({
  recurso,
  etiqueta,
  pending,
  onCapacidad,
  onArchivar,
}: {
  recurso: { id: string; name: string; capacity: number };
  etiqueta: string;
  pending: boolean;
  onCapacidad: (capacity: number) => void;
  onArchivar: () => void;
}) {
  const [valor, setValor] = useState(String(recurso.capacity));

  function guardar() {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 1) {
      setValor(String(recurso.capacity));
      return;
    }
    if (n !== recurso.capacity) onCapacidad(n);
  }

  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="font-mono text-sm">{recurso.name}</span>
      <div className="flex items-center gap-2">
        <Label htmlFor={`cap-${recurso.id}`} className="text-[11px] text-muted-foreground">
          {etiqueta}
        </Label>
        <Input
          id={`cap-${recurso.id}`}
          type="number"
          min={1}
          step={1}
          value={valor}
          disabled={pending}
          onChange={(e) => setValor(e.target.value)}
          onBlur={guardar}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              guardar();
            }
          }}
          className="h-8 w-20 font-mono"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={pending}
          onClick={onArchivar}
        >
          <IconArchive className="size-4" />
          <span className="sr-only">Archivar {recurso.name}</span>
        </Button>
      </div>
    </li>
  );
}

/** Lunes primero, como se lee la semana en español. Índice + 1 = día ISO. */
const DIAS_CORTOS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

/**
 * Horarios fijos de un servicio por hora.
 *
 * Sin turnos se reserva en cualquier tramo de 30 minutos. Con al menos uno,
 * solo en ellos: la clase de los martes a las 18:00, los turnos de hora y
 * media de una cancha. Valen para todos los recursos del servicio.
 */
function Horarios({
  serviceId,
  turnos,
  pending,
  correr,
}: {
  serviceId: string;
  turnos: Turno[];
  pending: boolean;
  correr: (accion: () => Promise<{ ok: boolean; error?: string }>, despues?: () => void) => void;
}) {
  const [dias, setDias] = useState<number[]>([]);
  const [inicio, setInicio] = useState("18:00");
  const [fin, setFin] = useState("19:00");

  const porDia = DIAS_SEMANA.map((_, i) => turnos.filter((t) => t.weekday === i + 1));
  const valido = dias.length > 0 && inicio && fin && fin > inicio;

  function alternar(dia: number) {
    setDias((ds) => (ds.includes(dia) ? ds.filter((d) => d !== dia) : [...ds, dia]));
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <p className="text-sm font-medium">Horarios fijos</p>
        <p className="text-[11px] text-muted-foreground">
          {turnos.length === 0
            ? "Sin horarios: se reserva en cualquier tramo de 30 minutos. Publica turnos si solo se puede reservar en ciertas horas (una clase los martes a las 18:00, turnos de hora y media)."
            : "Solo se puede reservar en estos turnos. Quitar uno no toca las reservas que ya se hicieron en él."}
        </p>
      </div>

      {turnos.length > 0 && (
        <ul className="divide-y rounded-md border">
          {porDia.map((delDia, i) =>
            delDia.length === 0 ? null : (
              <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="w-20 text-xs font-medium capitalize">{DIAS_SEMANA[i]}</span>
                {delDia.map((t) => (
                  <span
                    key={t.id}
                    className="flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 font-mono text-xs"
                  >
                    {t.start}–{t.end}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => correr(() => removeSchedule({ id: t.id }))}
                      className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                    >
                      <IconX className="size-3" />
                      <span className="sr-only">
                        Quitar el turno del {DIAS_SEMANA[i]} de {t.start} a {t.end}
                      </span>
                    </button>
                  </span>
                ))}
              </li>
            ),
          )}
        </ul>
      )}

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valido) return;
          correr(
            () => addSchedule({ serviceId, dias, inicio, fin }),
            () => setDias([]),
          );
        }}
      >
        <div className="flex flex-wrap gap-1" role="group" aria-label="Días del turno">
          {DIAS_CORTOS.map((d, i) => {
            const dia = i + 1;
            const activo = dias.includes(dia);
            return (
              <button
                key={dia}
                type="button"
                aria-pressed={activo}
                onClick={() => alternar(dia)}
                className={cn(
                  "size-8 rounded-md border text-xs font-medium transition-colors",
                  activo
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                )}
              >
                {d}
                <span className="sr-only"> {DIAS_SEMANA[i]}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={`t-ini-${serviceId}`} className="text-xs text-muted-foreground">
              Desde
            </Label>
            <Input
              id={`t-ini-${serviceId}`}
              type="time"
              step={1800}
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className="w-28 font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`t-fin-${serviceId}`} className="text-xs text-muted-foreground">
              Hasta
            </Label>
            <Input
              id={`t-fin-${serviceId}`}
              type="time"
              step={1800}
              value={fin}
              onChange={(e) => setFin(e.target.value)}
              className="w-28 font-mono"
            />
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={pending || !valido}>
            <IconPlus className="size-3.5" />
            Agregar turno
          </Button>
        </div>
        {fin && inicio && fin <= inicio && (
          <p className="text-xs text-destructive">
            La hora de fin tiene que ser después de la de inicio, el mismo día.
          </p>
        )}
      </form>
    </div>
  );
}
