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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  createResource,
  setServiceBookingUnit,
} from "@/lib/reservas/actions";
import { formatMoney } from "@/lib/format";
import type { Unidad } from "@/lib/reservas/rango";

export interface SetupService {
  id: string;
  name: string;
  price: string;
  currency: string;
  unidad: Unidad | null;
  bookingCount: number;
  resources: { id: string; name: string; notes: string | null }[];
}

/**
 * Qué servicios se reservan y con qué recursos.
 *
 * Un servicio se reserva si tiene unidad (noche u hora). Sin unidad se vende
 * como siempre, como renglón de una venta: una "Instalación" no ocupa nada.
 */
export function ResourceSetup({ services }: { services: SetupService[] }) {
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-bold">Recursos</h2>
        <p className="text-sm text-muted-foreground">
          Elige qué servicios se reservan y con qué habitaciones, canchas o equipos
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

  const bloqueada = service.bookingCount > 0;

  function cambiarUnidad(valor: string) {
    setError(null);
    start(async () => {
      const r = await setServiceBookingUnit({
        serviceId: service.id,
        unidad: valor === SIN_RESERVA ? null : (valor as Unidad),
      });
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  function agregar() {
    if (!nombre.trim()) return;
    setError(null);
    start(async () => {
      const r = await createResource({ serviceId: service.id, name: nombre });
      if (r.ok) {
        setNombre("");
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  function archivar(id: string) {
    setError(null);
    start(async () => {
      const r = await archiveResource({ id });
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">{service.name}</CardTitle>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {formatMoney(service.price, service.currency)}
              {service.unidad && ` ${service.unidad === "noche" ? "/ noche" : "/ hora"}`}
            </p>
          </div>

          <Select
            value={service.unidad ?? SIN_RESERVA}
            onValueChange={cambiarUnidad}
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

        {bloqueada && (
          <p className="text-[11px] text-muted-foreground">
            Ya tiene {service.bookingCount}{" "}
            {service.bookingCount === 1 ? "reserva" : "reservas"}, así que la forma
            de reservarlo no se puede cambiar. Para otra, crea otro servicio.
          </p>
        )}
      </CardHeader>

      {service.unidad && (
        <CardContent className="space-y-3">
          {service.resources.length === 0 ? (
            <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              Agrega las habitaciones, canchas o equipos que se reservan con este
              servicio. Sin al menos uno, no se puede reservar.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {service.resources.map((r) => (
                <Badge
                  key={r.id}
                  variant="secondary"
                  className="gap-1 py-1 pl-2.5 pr-1 font-mono text-xs"
                >
                  {r.name}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => archivar(r.id)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                  >
                    <IconArchive className="size-3" />
                    <span className="sr-only">Archivar {r.name}</span>
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              agregar();
            }}
          >
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder={service.unidad === "noche" ? "101" : "Cancha 1"}
              className="max-w-48"
              aria-label={`Nuevo recurso de ${service.name}`}
            />
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
