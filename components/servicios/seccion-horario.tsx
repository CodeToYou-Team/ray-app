"use client";

import { useState } from "react";
import { IconPencil, IconPlus, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HoraSelect } from "@/components/reservas/hora-select";
import { setScheduleMode, setWeekSchedule } from "@/lib/reservas/actions";
import {
  DIAS_SEMANA,
  esTodoElDia,
  FIN_DEL_DIA,
  horaAMinutos,
  horasEnTramos,
  TRAMO_MINUTOS,
  type ModoHorario,
  type Turno,
} from "@/lib/reservas/rango";
import { cn } from "@/lib/utils";
import { ErrorBox, Seccion, useAccion, useEdicion } from "./seccion";

/** Una franja (o un turno) de un día. */
interface Franja {
  start: string;
  end: string;
}

type TipoDia = "cerrado" | "todo" | "horas";

const TODO_EL_DIA: Franja = { start: "00:00", end: FIN_DEL_DIA };

/** Lunes primero, como se lee la semana en español. Índice + 1 = día ISO. */
const DIAS_CORTOS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

const INICIOS = horasEnTramos(0, 24 * 60 - TRAMO_MINUTOS);

function minutosAHora(m: number): string {
  const tope = Math.min(m, 24 * 60);
  return `${String(Math.floor(tope / 60)).padStart(2, "0")}:${String(tope % 60).padStart(2, "0")}`;
}

function ordenar(franjas: Franja[]): Franja[] {
  return [...franjas].sort((a, b) => a.start.localeCompare(b.start));
}

/** Por qué no se puede guardar un día, o null. Mismo criterio que el servidor. */
function problema(franjas: Franja[]): string | null {
  const orden = ordenar(franjas);
  for (let i = 0; i < orden.length; i++) {
    if (orden[i].end <= orden[i].start) {
      return "Cada franja tiene que terminar después de empezar.";
    }
    if (i > 0 && orden[i].start < orden[i - 1].end) {
      return `${orden[i - 1].start}–${orden[i - 1].end} y ${orden[i].start}–${orden[i].end} se cruzan.`;
    }
  }
  return null;
}

/**
 * Horario de un servicio por horas.
 *
 * Se lee como una semana: cada día dice si está cerrado, abierto todo el día
 * o en qué franjas. El lápiz abre SOLO ese día, y lo que se elige se puede
 * copiar a otros. Se guarda la semana entera (`setWeekSchedule`), así "todo
 * el día" reemplaza las franjas que el día tenía sin chocar con ellas.
 *
 * Por atención, sin ninguna fila se reserva a cualquier hora: por eso, si no
 * hay horario, cada día se muestra "todo el día" y, al cerrar uno, los demás
 * se guardan abiertos todo el día en vez de quedar cerrados de golpe.
 */
export function SeccionHorario({
  serviceId,
  modo,
  turnos,
  puedeEditar,
}: {
  serviceId: string;
  modo: ModoHorario;
  turnos: Turno[];
  puedeEditar: boolean;
}) {
  const { abierto, abrir, cerrar } = useEdicion();
  const { pending, error, correr } = useAccion();

  const semana: Franja[][] = DIAS_SEMANA.map((_, i) =>
    ordenar(
      turnos.filter((t) => t.weekday === i + 1).map((t) => ({ start: t.start, end: t.end })),
    ),
  );
  const sinHorario = turnos.length === 0;
  const atencion = modo === "atencion";

  const descripcion = atencion
    ? sinHorario
      ? "Sin horario: se reserva a cualquier hora, todos los días, en tramos de 30 minutos. Edita un día para cerrarlo o ponerle horas."
      : "Se reserva cualquier tramo que quepa entero en una franja del día. Cambiar el horario no toca las reservas ya hechas."
    : sinHorario
      ? "Sin turnos: se reserva libre, en tramos de 30 minutos. Agrega turnos si solo se reserva en tramos exactos (la clase del martes a las 18:00)."
      : "Solo se reserva en estos turnos, enteros. Un día sin turnos no se reserva. Quitar uno no toca las reservas ya hechas.";

  return (
    <Seccion
      titulo="Horario"
      descripcion={descripcion}
      accion={
        puedeEditar && (
          <Select
            value={modo}
            onValueChange={(v) =>
              correr(() => setScheduleMode({ serviceId, modo: v as ModoHorario }))
            }
            disabled={pending}
          >
            <SelectTrigger className="w-52" aria-label="Qué es el horario">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="atencion">Horario de atención</SelectItem>
              <SelectItem value="turnos">Turnos exactos</SelectItem>
            </SelectContent>
          </Select>
        )
      }
    >
      <div className="space-y-3">
        {error && <ErrorBox>{error}</ErrorBox>}

        <ul className="divide-y rounded-md border">
          {semana.map((franjas, i) => {
            const dia = i + 1;
            if (abierto === `dia:${dia}`) {
              return (
                <li key={dia} className="bg-muted/30 p-3">
                  <EditorDia
                    serviceId={serviceId}
                    atencion={atencion}
                    dia={dia}
                    semana={semana}
                    sinHorario={sinHorario}
                    onListo={cerrar}
                  />
                </li>
              );
            }
            return (
              <li key={dia} className="flex items-center gap-3 px-3 py-2">
                <span className="w-24 shrink-0 text-sm font-medium capitalize">
                  {DIAS_SEMANA[i]}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                  <ResumenDia franjas={franjas} atencion={atencion} sinHorario={sinHorario} />
                </span>
                {puedeEditar && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={() => abrir(`dia:${dia}`)}
                  >
                    <IconPencil className="size-4" />
                    <span className="sr-only">Editar el {DIAS_SEMANA[i]}</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        {puedeEditar && !sinHorario && (
          <Limpiar serviceId={serviceId} atencion={atencion} />
        )}
      </div>
    </Seccion>
  );
}

function ResumenDia({
  franjas,
  atencion,
  sinHorario,
}: {
  franjas: Franja[];
  atencion: boolean;
  sinHorario: boolean;
}) {
  if (atencion && (sinHorario || esTodoElDia(franjas))) {
    return <span className="text-sm">Todo el día</span>;
  }
  if (franjas.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        {atencion ? "Cerrado" : "Sin turnos"}
      </span>
    );
  }
  return (
    <>
      {franjas.map((f) => (
        <span
          key={f.start}
          className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-xs"
        >
          {f.start}–{f.end}
        </span>
      ))}
    </>
  );
}

/** Volver a "sin horario", con confirmación: borra la semana entera. */
function Limpiar({ serviceId, atencion }: { serviceId: string; atencion: boolean }) {
  const { abierto, abrir, cerrar } = useEdicion();
  const { pending, error, correr } = useAccion();
  const confirmando = abierto === "horario:limpiar";

  if (!confirmando) {
    return (
      <button
        type="button"
        onClick={() => abrir("horario:limpiar")}
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {atencion ? "Quitar el horario: abrir todos los días, a toda hora" : "Quitar todos los turnos"}
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md bg-muted/50 p-3">
      <p className="text-xs">
        {atencion
          ? "Se podrá reservar a cualquier hora, todos los días. Las reservas hechas no cambian."
          : "Sin turnos se reserva libre, en tramos de 30 minutos. Las reservas hechas no cambian."}
      </p>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => correr(() => setWeekSchedule({ serviceId, franjas: [] }), cerrar)}
        >
          {pending ? "Guardando…" : atencion ? "Quitar horario" : "Quitar turnos"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={cerrar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function EditorDia({
  serviceId,
  atencion,
  dia,
  semana,
  sinHorario,
  onListo,
}: {
  serviceId: string;
  atencion: boolean;
  dia: number;
  semana: Franja[][];
  sinHorario: boolean;
  onListo: () => void;
}) {
  const { pending, error, correr } = useAccion();
  const actuales = semana[dia - 1];

  const [tipo, setTipo] = useState<TipoDia>(() =>
    !atencion
      ? "horas"
      : sinHorario || esTodoElDia(actuales)
        ? "todo"
        : actuales.length === 0
          ? "cerrado"
          : "horas",
  );
  const [franjas, setFranjas] = useState<Franja[]>(() =>
    actuales.length > 0 && !(atencion && esTodoElDia(actuales))
      ? actuales
      : atencion
        ? [{ start: "08:00", end: "18:00" }]
        : [],
  );
  const [copiar, setCopiar] = useState<number[]>([]);

  const conHoras = tipo === "horas";
  const falla = conHoras ? problema(franjas) : null;

  function cambiar(i: number, cambio: Partial<Franja>) {
    setFranjas((fs) =>
      fs.map((f, j) => {
        if (j !== i) return f;
        const nueva = { ...f, ...cambio };
        // Que el fin siga siendo después del inicio, con la misma duración.
        if (cambio.start && nueva.end <= nueva.start) {
          const dur = Math.max(TRAMO_MINUTOS, horaAMinutos(f.end) - horaAMinutos(f.start));
          nueva.end = minutosAHora(horaAMinutos(nueva.start) + dur);
        }
        return nueva;
      }),
    );
  }

  function agregar() {
    setFranjas((fs) => {
      const ultima = ordenar(fs).at(-1);
      const desde = ultima ? Math.min(horaAMinutos(ultima.end), 23 * 60) : 9 * 60;
      return [...fs, { start: minutosAHora(desde), end: minutosAHora(desde + 60) }];
    });
  }

  function guardar() {
    // Sin horario por atención = todo el día cada día. Se escribe así para
    // que cerrar un día no cierre de golpe los otros seis.
    const base: Franja[][] =
      atencion && sinHorario ? DIAS_SEMANA.map(() => [TODO_EL_DIA]) : semana.map((d) => [...d]);
    const nuevas =
      tipo === "cerrado" ? [] : tipo === "todo" ? [TODO_EL_DIA] : ordenar(franjas);
    for (const d of [dia, ...copiar]) base[d - 1] = nuevas;

    // Abierto todo el día los siete días es lo mismo que no tener horario.
    const todaLaSemana = atencion && base.every((d) => esTodoElDia(d));
    const filas = todaLaSemana
      ? []
      : base.flatMap((d, i) =>
          d.map((f) => ({ weekday: i + 1, inicio: f.start, fin: f.end })),
        );

    correr(() => setWeekSchedule({ serviceId, franjas: filas }), onListo);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium capitalize">{DIAS_SEMANA[dia - 1]}</p>

      {atencion && (
        <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label="Ese día">
          {(
            [
              ["cerrado", "Cerrado"],
              ["todo", "Todo el día"],
              ["horas", "Por horas"],
            ] as const
          ).map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={tipo === valor}
              onClick={() => setTipo(valor)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors",
                tipo === valor
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {texto}
            </button>
          ))}
        </div>
      )}

      {conHoras && (
        <div className="space-y-2">
          {franjas.length === 0 && (
            <p className="text-xs text-muted-foreground">Ningún turno ese día.</p>
          )}
          {franjas.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <HoraSelect
                aria-label="Desde"
                value={f.start}
                opciones={INICIOS}
                onChange={(v) => cambiar(i, { start: v })}
                className="w-24"
              />
              <span className="text-xs text-muted-foreground">a</span>
              <HoraSelect
                aria-label="Hasta"
                value={f.end}
                opciones={horasEnTramos(horaAMinutos(f.start) + TRAMO_MINUTOS)}
                onChange={(v) => cambiar(i, { end: v })}
                className="w-24"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setFranjas((fs) => fs.filter((_, j) => j !== i))}
              >
                <IconX className="size-4" />
                <span className="sr-only">Quitar {f.start}–{f.end}</span>
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={agregar}>
            <IconPlus className="size-3.5" />
            {atencion ? "Agregar franja" : "Agregar turno"}
          </Button>
          {falla && <p className="text-xs text-destructive">{falla}</p>}
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Aplicar también a</Label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Aplicar también a">
          {DIAS_CORTOS.map((corto, i) => {
            const d = i + 1;
            if (d === dia) return null;
            const activo = copiar.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={activo}
                onClick={() =>
                  setCopiar((cs) => (activo ? cs.filter((c) => c !== d) : [...cs, d]))
                }
                className={cn(
                  "size-8 rounded-md border text-xs font-medium transition-colors",
                  activo ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {corto}
                <span className="sr-only"> {DIAS_SEMANA[i]}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() =>
              setCopiar((cs) =>
                cs.length === 6 ? [] : [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== dia),
              )
            }
            className="h-8 rounded-md px-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {copiar.length === 6 ? "Ninguno" : "Todos"}
          </button>
        </div>
      </div>

      {atencion && sinHorario && tipo !== "todo" && (
        <p className="text-[11px] text-muted-foreground">
          Hoy se reserva a cualquier hora. Al guardar, los días que no toques quedan abiertos
          todo el día.
        </p>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex gap-2">
        <Button size="sm" onClick={guardar} disabled={pending || Boolean(falla)}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onListo} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
