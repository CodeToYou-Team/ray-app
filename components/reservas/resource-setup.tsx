"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  IconAlertCircle,
  IconArchive,
  IconPlus,
  IconTool,
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
  archiveResource,
  configureServiceBooking,
  createResource,
  updateResourceCapacity,
} from "@/lib/reservas/actions";
import { formatMoney } from "@/lib/format";
import type { Unidad } from "@/lib/reservas/rango";

export interface SetupService {
  id: string;
  name: string;
  active: boolean;
  price: string;
  currency: string;
  unidad: Unidad | null;
  shared: boolean;
  perPerson: boolean;
  bookingCount: number;
  resources: { id: string; name: string; notes: string | null; capacity: number }[];
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
              <Link href="/productos">Ir a Productos y servicios</Link>
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
                Marcado como no disponible para vender en Productos: no acepta
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
                Nuevo
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
