"use client";

import { useState } from "react";
import { Archive, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { archiveResource, createResource, updateResource } from "@/lib/reservas/actions";
import type { ResourceRow } from "@/lib/reservas/queries";
import { recursoLabel, type Unidad } from "@/lib/reservas/rango";
import { ErrorBox, Seccion, useAccion, useEdicion } from "./seccion";

/**
 * Las habitaciones, canchas o equipos del servicio.
 *
 * Cada uno se lee como dato; el lápiz abre SOLO ese para editar su nombre,
 * capacidad y notas. Archivar pide confirmación en la misma fila: saca el
 * recurso de la disponibilidad y no hay botón para traerlo de vuelta.
 */
export function SeccionRecursos({
  serviceId,
  unidad,
  shared,
  resourceLabel,
  recursos,
  puedeEditar,
}: {
  serviceId: string;
  unidad: Unidad;
  shared: boolean;
  resourceLabel: string | null;
  recursos: ResourceRow[];
  puedeEditar: boolean;
}) {
  const { abierto, abrir, cerrar } = useEdicion();
  const etiqueta = recursoLabel(resourceLabel);
  const agregando = abierto === "recurso:nuevo";

  return (
    <Seccion
      titulo="Recursos"
      descripcion={`Cada ${etiqueta.toLowerCase()} que se reserva con este servicio, con ${
        shared ? "sus cupos" : "cuántas personas caben"
      }. Sin al menos uno, no se puede reservar.`}
      accion={
        puedeEditar &&
        !agregando && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => abrir("recurso:nuevo")}
          >
            <Plus className="size-3.5" />
            Agregar {etiqueta.toLowerCase()}
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {recursos.length === 0 && !agregando ? (
          <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            Todavía no hay ninguno. Agrega{" "}
            {unidad === "noche" ? "las habitaciones o cabañas" : "las canchas, salas o equipos"}{" "}
            que se reservan con este servicio.
          </p>
        ) : (
          recursos.length > 0 && (
            <ul className="divide-y rounded-md border">
              {recursos.map((r) =>
                abierto === `recurso:${r.id}` ? (
                  <li key={r.id} className="bg-muted/30 p-3">
                    <FormRecurso
                      serviceId={serviceId}
                      recurso={r}
                      etiqueta={etiqueta}
                      shared={shared}
                      onListo={cerrar}
                    />
                  </li>
                ) : (
                  <FilaRecurso
                    key={r.id}
                    recurso={r}
                    shared={shared}
                    puedeEditar={puedeEditar}
                    confirmando={abierto === `archivar:${r.id}`}
                    onEditar={() => abrir(`recurso:${r.id}`)}
                    onArchivar={() => abrir(`archivar:${r.id}`)}
                    onCancelar={cerrar}
                  />
                ),
              )}
            </ul>
          )
        )}

        {agregando && (
          <div className="rounded-md border bg-muted/30 p-3">
            <FormRecurso
              serviceId={serviceId}
              etiqueta={etiqueta}
              shared={shared}
              placeholder={unidad === "noche" ? "101" : "Cancha 1"}
              onListo={cerrar}
            />
          </div>
        )}
      </div>
    </Seccion>
  );
}

function capacidadTexto(capacity: number, shared: boolean): string {
  if (shared) return capacity === 1 ? "1 cupo" : `${capacity} cupos`;
  return capacity === 1 ? "1 persona" : `Hasta ${capacity} personas`;
}

function FilaRecurso({
  recurso,
  shared,
  puedeEditar,
  confirmando,
  onEditar,
  onArchivar,
  onCancelar,
}: {
  recurso: ResourceRow;
  shared: boolean;
  puedeEditar: boolean;
  confirmando: boolean;
  onEditar: () => void;
  onArchivar: () => void;
  onCancelar: () => void;
}) {
  const { pending, error, correr } = useAccion();

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{recurso.name}</p>
          <p className="text-xs text-muted-foreground">
            {capacidadTexto(recurso.capacity, shared)}
            {recurso.notes && <span> · {recurso.notes}</span>}
          </p>
        </div>
        {puedeEditar && !confirmando && (
          <span className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" className="size-8" onClick={onEditar}>
              <Pencil className="size-4" />
              <span className="sr-only">Editar {recurso.name}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title="Archivar"
              onClick={onArchivar}
            >
              <Archive className="size-4" />
              <span className="sr-only">Archivar {recurso.name}</span>
            </Button>
          </span>
        )}
      </div>

      {confirmando && (
        <div className="mt-2 space-y-2 rounded-md bg-muted/50 p-3">
          <p className="text-xs">
            ¿Archivar <span className="font-medium">{recurso.name}</span>? Sale de la
            disponibilidad y no se puede volver a activar; las reservas que ya tuvo se
            conservan. No se puede mientras tenga reservas pendientes.
          </p>
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => correr(() => archiveResource({ id: recurso.id }), onCancelar)}
            >
              {pending ? "Archivando…" : "Archivar"}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={onCancelar}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Crear (sin `recurso`) o editar uno. */
function FormRecurso({
  serviceId,
  recurso,
  etiqueta,
  shared,
  placeholder,
  onListo,
}: {
  serviceId: string;
  recurso?: ResourceRow;
  etiqueta: string;
  shared: boolean;
  placeholder?: string;
  onListo: () => void;
}) {
  const { pending, error, correr } = useAccion();
  const [nombre, setNombre] = useState(recurso?.name ?? "");
  const [capacidad, setCapacidad] = useState(String(recurso?.capacity ?? 1));
  const [notas, setNotas] = useState(recurso?.notes ?? "");

  const cap = Number(capacidad);
  const valido = nombre.trim().length > 0 && Number.isInteger(cap) && cap >= 1;
  const id = recurso?.id ?? "nuevo";

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valido) return;
        correr(
          () =>
            recurso
              ? updateResource({ id: recurso.id, name: nombre, capacity: cap, notes: notas })
              : createResource({
                  serviceId,
                  name: nombre,
                  capacity: cap,
                  notes: notas || undefined,
                }),
          onListo,
        );
      }}
    >
      {!recurso && <p className="text-sm font-medium">Nuevo: {etiqueta.toLowerCase()}</p>}
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <div className="space-y-1.5">
          <Label htmlFor={`rec-nombre-${id}`} className="text-xs">
            Nombre
          </Label>
          <Input
            id={`rec-nombre-${id}`}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder={placeholder}
            maxLength={100}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`rec-cap-${id}`} className="text-xs">
            {shared ? "Cupos" : "Personas máx."}
          </Label>
          <Input
            id={`rec-cap-${id}`}
            type="number"
            min={1}
            step={1}
            value={capacidad}
            onChange={(e) => setCapacidad(e.target.value)}
            className="font-mono"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`rec-notas-${id}`} className="text-xs">
          Notas (opcional)
        </Label>
        <Textarea
          id={`rec-notas-${id}`}
          rows={2}
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Vista al mar, cama matrimonial…"
          maxLength={500}
        />
      </div>
      {recurso && (
        <p className="text-[11px] text-muted-foreground">
          {shared
            ? "No se pueden bajar los cupos por debajo de lo que ya está reservado."
            : "No se puede bajar por debajo de una reserva pendiente para más personas."}
        </p>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !valido}>
          {pending ? "Guardando…" : recurso ? "Guardar" : "Agregar"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onListo} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
