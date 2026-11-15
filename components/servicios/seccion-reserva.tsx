"use client";

import { useState } from "react";
import { CalendarPlus, Pencil } from "lucide-react";
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
import { configureServiceBooking, setResourceLabel } from "@/lib/reservas/actions";
import type { ServiceSetupRow } from "@/lib/reservas/queries";
import { recursoLabel, type Unidad } from "@/lib/reservas/rango";
import { Dato, ErrorBox, Seccion, useAccion, useEdicion } from "./seccion";

const SIN_RESERVA = "no";

export const TEXTO_UNIDAD: Record<Unidad, string> = {
  noche: "Por fechas",
  hora: "Por horas",
};

const AYUDA_UNIDAD: Record<Unidad, string> = {
  noche: "Noches, días, semanas o meses: habitaciones, cabañas, alquileres.",
  hora: "Un día y un tramo de horas: canchas, salas, clases.",
};

/**
 * Cómo se reserva el servicio: si se reserva, por fechas u horas, exclusivo o
 * compartido, cómo se cobra y cómo se llaman sus recursos.
 *
 * Por fechas u horas y el modo no cambian mientras haya reservas PENDIENTES
 * (lo exige el servidor); las canceladas o ya terminadas no lo impiden. El
 * cobro y el nombre se cambian siempre.
 */
export function SeccionReserva({
  servicio,
  puedeEditar,
}: {
  servicio: ServiceSetupRow;
  puedeEditar: boolean;
}) {
  const { abierto, abrir, cerrar } = useEdicion();
  const editando = abierto === "reserva";
  const bloqueada = servicio.pendientes > 0;

  if (editando) {
    return (
      <Seccion titulo="Cómo se reserva">
        <FormReserva servicio={servicio} bloqueada={bloqueada} onListo={cerrar} />
      </Seccion>
    );
  }

  if (!servicio.unidad) {
    return (
      <Seccion
        titulo="Cómo se reserva"
        descripcion="Este servicio solo se vende. Si además se reserva (habitaciones, canchas, clases, equipos), actívalo para agregarle sus recursos, tarifas y horario."
      >
        {puedeEditar ? (
          <Button size="sm" className="gap-1.5" onClick={() => abrir("reserva")}>
            <CalendarPlus className="size-4" />
            Hacer reservable
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Que se reserve lo decide el dueño o el encargado.
          </p>
        )}
      </Seccion>
    );
  }

  return (
    <Seccion
      titulo="Cómo se reserva"
      descripcion={
        bloqueada
          ? `Tiene ${servicio.pendientes} ${servicio.pendientes === 1 ? "reserva pendiente" : "reservas pendientes"}: hasta que terminen, si se reserva por fechas u horas y el modo no cambian. El cobro sí.`
          : undefined
      }
      accion={
        puedeEditar && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => abrir("reserva")}>
            <Pencil className="size-3.5" />
            Editar
          </Button>
        )
      }
    >
      <dl className="grid gap-4 sm:grid-cols-2">
        <Dato etiqueta="Se reserva">
          {TEXTO_UNIDAD[servicio.unidad]}
          <span className="block text-xs text-muted-foreground">
            {AYUDA_UNIDAD[servicio.unidad]}
          </span>
        </Dato>
        <Dato etiqueta="Modo">
          {servicio.shared ? "Compartido" : "Exclusivo"}
          <span className="block text-xs text-muted-foreground">
            {servicio.shared
              ? "Varias reservas a la vez, hasta llenar los cupos."
              : "Una reserva ocupa el recurso entero."}
          </span>
        </Dato>
        <Dato etiqueta="Cobro">
          {servicio.perPerson ? "Por persona" : "Por reserva"}
          <span className="block text-xs text-muted-foreground">
            {servicio.perPerson
              ? "La tarifa se multiplica por cada persona."
              : "El mismo precio vayan cuantos vayan."}
          </span>
        </Dato>
        <Dato etiqueta="Sus recursos se llaman">
          {recursoLabel(servicio.resourceLabel)}
          <span className="block text-xs text-muted-foreground">
            Es lo que se lee al reservar.
          </span>
        </Dato>
      </dl>
    </Seccion>
  );
}

function FormReserva({
  servicio,
  bloqueada,
  onListo,
}: {
  servicio: ServiceSetupRow;
  bloqueada: boolean;
  onListo: () => void;
}) {
  const { pending, error, correr } = useAccion();
  const [unidad, setUnidad] = useState<Unidad | null>(servicio.unidad ?? "noche");
  const [compartido, setCompartido] = useState(servicio.shared);
  const [porPersona, setPorPersona] = useState(servicio.perPerson);
  const [nombre, setNombre] = useState(servicio.resourceLabel ?? "");

  function guardar() {
    correr(async () => {
      const cambiaReserva =
        unidad !== servicio.unidad ||
        (unidad !== null && (compartido !== servicio.shared || porPersona !== servicio.perPerson));
      if (cambiaReserva) {
        const r = await configureServiceBooking({
          serviceId: servicio.id,
          unidad,
          compartido,
          porPersona,
        });
        if (!r.ok) return r;
      }
      if (unidad && nombre.trim() !== (servicio.resourceLabel ?? "")) {
        return setResourceLabel({ serviceId: servicio.id, label: nombre });
      }
      return { ok: true };
    }, onListo);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="r-unidad">Se reserva</Label>
          <Select
            value={unidad ?? SIN_RESERVA}
            onValueChange={(v) => setUnidad(v === SIN_RESERVA ? null : (v as Unidad))}
            disabled={bloqueada}
          >
            <SelectTrigger id="r-unidad" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="noche">Por fechas (noches, días, semanas)</SelectItem>
              <SelectItem value="hora">Por horas</SelectItem>
              {/* Recién activado, ofrecer "no" sería cancelar con otro botón. */}
              {servicio.unidad && <SelectItem value={SIN_RESERVA}>No se reserva</SelectItem>}
            </SelectContent>
          </Select>
        </div>

        {unidad && (
          <div className="space-y-1.5">
            <Label htmlFor="r-nombre">¿Cómo se llaman sus recursos?</Label>
            <Input
              id="r-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder={unidad === "noche" ? "Habitación" : "Cancha"}
              maxLength={40}
            />
          </div>
        )}
      </div>

      {unidad && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="r-modo">Modo</Label>
            <Select
              value={compartido ? "compartido" : "exclusivo"}
              onValueChange={(v) => setCompartido(v === "compartido")}
              disabled={bloqueada}
            >
              <SelectTrigger id="r-modo" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exclusivo">Exclusivo: una reserva a la vez</SelectItem>
                <SelectItem value="compartido">Compartido: varias hasta llenar cupos</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-2xs text-muted-foreground">
              {compartido
                ? "Cada recurso tiene cupos y se aceptan reservas hasta llenarlos: clases, tours, estacionamientos."
                : "Una reserva ocupa el recurso entero: habitaciones, canchas, salas."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="r-cobro">Cobro</Label>
            <Select
              value={porPersona ? "persona" : "reserva"}
              onValueChange={(v) => setPorPersona(v === "persona")}
            >
              <SelectTrigger id="r-cobro" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reserva">Por reserva</SelectItem>
                <SelectItem value="persona">Por persona</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-2xs text-muted-foreground">
              {porPersona
                ? "El precio de la tarifa por cada persona: el tour, la clase."
                : "El mismo precio vayan 1 o 3: la habitación, la cancha."}{" "}
              Cambiarlo solo afecta a las reservas nuevas.
            </p>
          </div>
        </div>
      )}

      {bloqueada && (
        <p className="text-2xs text-muted-foreground">
          Tiene reservas pendientes (en curso o por llegar): hasta que terminen, o las
          canceles, si se reserva por fechas u horas y el modo no se pueden cambiar.
        </p>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex gap-2">
        <Button size="sm" onClick={guardar} disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onListo} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
