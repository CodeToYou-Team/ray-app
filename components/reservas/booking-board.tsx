"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  IconCalendarEvent,
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { compareMoney } from "@/lib/money";
import { sumarDias, unidadLabel } from "@/lib/reservas/rango";
import { cn } from "@/lib/utils";
import { BookingDetail, BookingForm, type Inicial } from "./booking-dialogs";
import type { CobroConfig } from "./booking-payment";
import type { BoardBooking, BoardService } from "./types";

interface Props {
  servicios: BoardService[];
  reservas: BoardBooking[];
  /** YYYY-MM-DD, primer día de la ventana. */
  desde: string;
  dias: number;
  /** YYYY-MM-DD en la zona del negocio. */
  hoy: string;
  canManage: boolean;
  canSetup: boolean;
  /** null = el rol no puede cobrar. */
  cobro: CobroConfig | null;
}

/**
 * Cómo se pinta una reserva según su estado. El color dice en qué está; el
 * punto, que todavía debe algo.
 */
function claseReserva(b: BoardBooking): string {
  if (b.status === "en_curso") return "bg-success/20 text-success hover:bg-success/30";
  if (b.status === "finalizada") return "bg-muted text-muted-foreground hover:bg-muted/80";
  return "bg-primary/15 text-primary hover:bg-primary/25";
}

function debe(b: BoardBooking): boolean {
  return compareMoney(b.saldo, "0") > 0;
}

/** "lun 10". El día de la semana de una fecha no depende de ninguna zona. */
function etiquetaDia(fecha: string): { semana: string; dia: string } {
  const d = new Date(`${fecha}T12:00:00`);
  return {
    semana: new Intl.DateTimeFormat("es", { weekday: "short" }).format(d),
    dia: String(Number(fecha.slice(8, 10))),
  };
}

function etiquetaMes(desde: string, hasta: string): string {
  const fmt = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" });
  const a = fmt.format(new Date(`${desde}T12:00:00`));
  const b = fmt.format(new Date(`${hasta}T12:00:00`));
  return a === b ? a : `${a} – ${b}`;
}

/**
 * Cuadrícula de disponibilidad: recursos × días.
 *
 * Una reserva por noche ocupa las celdas de sus noches (la de salida no). Una
 * por hora se muestra dentro del día, con su tramo. Lo vacío se puede tocar
 * para reservar ahí mismo, que es como trabaja una recepción.
 */
export function BookingBoard({
  servicios,
  reservas,
  desde,
  dias,
  hoy,
  canManage,
  canSetup,
  cobro,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navegando, startNav] = useTransition();

  const [inicial, setInicial] = useState<Inicial | null>(null);
  /** Cambia en cada apertura: el formulario se siembra de cero cada vez. */
  const [aperturas, setAperturas] = useState(0);
  /**
   * Se guarda el id, no la reserva: después de cobrar o registrar la llegada,
   * `router.refresh()` trae las reservas nuevas y el detalle tiene que leer
   * la versión fresca, no la que quedó copiada al abrirlo. Si la reserva sale
   * de la ventana (se canceló), el detalle se cierra solo.
   */
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const detalle = detalleId ? reservas.find((r) => r.id === detalleId) : undefined;

  const fechas = Array.from({ length: dias }, (_, i) => sumarDias(desde, i));
  const ultimo = fechas[fechas.length - 1];

  function irA(fecha: string | null) {
    const params = new URLSearchParams(searchParams);
    if (!fecha || fecha === hoy) params.delete("desde");
    else params.set("desde", fecha);
    startNav(() => {
      router.push(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    });
  }

  function nueva(valor: Inicial) {
    if (!canManage) return;
    setInicial(valor);
    setAperturas((n) => n + 1);
  }

  const reservables = servicios.filter((s) => s.resources.length > 0);

  // -------------------------------------------------------------------------
  // Sin nada que reservar todavía.
  // -------------------------------------------------------------------------
  if (servicios.length === 0) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <Encabezado />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <IconCalendarEvent className="size-6 text-muted-foreground" />
            <div>
              <p className="font-medium">Todavía no hay nada que reservar</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Marca un servicio como reservable (por ejemplo &ldquo;Habitación
                doble&rdquo;, por noche) y agrégale sus habitaciones, canchas o
                equipos.
              </p>
            </div>
            {canSetup ? (
              <Button size="sm" asChild>
                <Link href="/reservas/recursos">Configurar recursos</Link>
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Pídele al dueño o al encargado que lo configure.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Encabezado />
        {canManage && reservables.length > 0 && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() =>
              nueva({
                serviceId: reservables[0].id,
                resourceId: "",
                fecha: hoy >= desde && hoy <= ultimo ? hoy : desde,
              })
            }
          >
            <IconPlus className="size-3.5" />
            Nueva reserva
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium capitalize">{etiquetaMes(desde, ultimo)}</p>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={navegando}
            onClick={() => irA(sumarDias(desde, -7))}
          >
            <IconChevronLeft className="size-4" />
            <span className="sr-only sm:not-sr-only">Semana anterior</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={navegando || desde === hoy}
            onClick={() => irA(null)}
          >
            Hoy
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={navegando}
            onClick={() => irA(sumarDias(desde, 7))}
          >
            <span className="sr-only sm:not-sr-only">Semana siguiente</span>
            <IconChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <Card className={cn("overflow-hidden p-0", navegando && "opacity-60")}>
        {/*
          Scroll horizontal DENTRO de la tarjeta: catorce columnas no caben en
          un teléfono, y la página entera no puede desplazarse de lado.
        */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 z-10 min-w-28 bg-card px-3 py-2 text-left font-medium text-muted-foreground">
                  Recurso
                </th>
                {fechas.map((f) => {
                  const { semana, dia } = etiquetaDia(f);
                  return (
                    <th
                      key={f}
                      className={cn(
                        "min-w-16 px-1 py-2 text-center font-normal",
                        f === hoy ? "bg-primary/10 text-primary" : "text-muted-foreground",
                      )}
                    >
                      <span className="block text-[10px] uppercase">{semana}</span>
                      <span className="block text-sm font-semibold">{dia}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {servicios.map((s) => (
                <GrupoServicio
                  key={s.id}
                  servicio={s}
                  reservas={reservas.filter((r) => r.serviceId === s.id)}
                  fechas={fechas}
                  hoy={hoy}
                  canManage={canManage}
                  canSetup={canSetup}
                  onNueva={nueva}
                  onVer={(b) => setDetalleId(b.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {inicial && (
        <BookingForm
          key={aperturas}
          open
          onOpenChange={(abierto) => {
            if (!abierto) setInicial(null);
          }}
          servicios={reservables}
          reservas={reservas}
          inicial={inicial}
        />
      )}

      {detalle && (
        <BookingDetail
          key={detalle.id}
          reserva={detalle}
          servicio={servicios.find((s) => s.id === detalle.serviceId)}
          hoy={hoy}
          canManage={canManage}
          cobro={cobro}
          onClose={() => setDetalleId(null)}
        />
      )}
    </div>
  );
}

function Encabezado() {
  return (
    <div>
      <h2 className="text-lg font-bold">Disponibilidad</h2>
      <p className="text-sm text-muted-foreground">
        Qué está libre y qué está reservado, día por día
      </p>
    </div>
  );
}

function GrupoServicio({
  servicio,
  reservas,
  fechas,
  hoy,
  canManage,
  canSetup,
  onNueva,
  onVer,
}: {
  servicio: BoardService;
  reservas: BoardBooking[];
  fechas: string[];
  hoy: string;
  canManage: boolean;
  canSetup: boolean;
  onNueva: (v: Inicial) => void;
  onVer: (b: BoardBooking) => void;
}) {
  return (
    <>
      <tr className="border-b bg-muted/40">
        <td
          colSpan={fechas.length + 1}
          className="sticky left-0 px-3 py-1.5 text-[11px] font-medium"
        >
          {servicio.name}
          <span className="ml-2 font-mono font-normal text-muted-foreground">
            {formatMoney(servicio.price, servicio.currency)} {unidadLabel(servicio.unidad)}
          </span>
        </td>
      </tr>

      {servicio.resources.length === 0 ? (
        <tr className="border-b">
          <td
            colSpan={fechas.length + 1}
            className="px-3 py-3 text-[11px] text-muted-foreground"
          >
            Sin recursos todavía.{" "}
            {canSetup && (
              <Link href="/reservas/recursos" className="underline underline-offset-2">
                Agrégalos
              </Link>
            )}
          </td>
        </tr>
      ) : (
        servicio.resources.map((r) => (
          <tr key={r.id} className="border-b last:border-b-0">
            <th
              scope="row"
              className="sticky left-0 z-10 bg-card px-3 py-1 text-left font-mono text-xs font-medium"
            >
              {r.name}
            </th>
            {servicio.unidad === "noche" ? (
              <CeldasNoches
                servicioId={servicio.id}
                recursoId={r.id}
                reservas={reservas.filter((b) => b.resourceId === r.id)}
                fechas={fechas}
                hoy={hoy}
                canManage={canManage}
                onNueva={onNueva}
                onVer={onVer}
              />
            ) : (
              <CeldasHoras
                servicioId={servicio.id}
                recursoId={r.id}
                reservas={reservas.filter((b) => b.resourceId === r.id)}
                fechas={fechas}
                hoy={hoy}
                canManage={canManage}
                onNueva={onNueva}
                onVer={onVer}
              />
            )}
          </tr>
        ))
      )}
    </>
  );
}

interface CeldasProps {
  servicioId: string;
  recursoId: string;
  reservas: BoardBooking[];
  fechas: string[];
  hoy: string;
  canManage: boolean;
  onNueva: (v: Inicial) => void;
  onVer: (b: BoardBooking) => void;
}

function CeldaLibre({
  fecha,
  hoy,
  canManage,
  onClick,
}: {
  fecha: string;
  hoy: string;
  canManage: boolean;
  onClick: () => void;
}) {
  const pasado = fecha < hoy;
  return (
    <td className={cn("h-10 p-0.5", fecha === hoy && "bg-primary/5")}>
      {canManage && !pasado ? (
        <button
          type="button"
          onClick={onClick}
          className="group flex size-full items-center justify-center rounded text-muted-foreground/0 transition-colors hover:bg-muted hover:text-muted-foreground"
        >
          <IconPlus className="size-3.5" />
          <span className="sr-only">Reservar el {fecha}</span>
        </button>
      ) : null}
    </td>
  );
}

/**
 * Una fila por noche. Cada reserva ocupa una sola celda que abarca sus
 * noches dentro de la ventana (colSpan), así se lee como un bloque.
 */
function CeldasNoches({
  servicioId,
  recursoId,
  reservas,
  fechas,
  hoy,
  canManage,
  onNueva,
  onVer,
}: CeldasProps) {
  const celdas: React.ReactNode[] = [];
  let i = 0;

  while (i < fechas.length) {
    const f = fechas[i];
    // Una noche está ocupada si entrada <= f < salida (la de salida no cuenta).
    const b = reservas.find(
      (r) => r.inicio.slice(0, 10) <= f && f < r.fin.slice(0, 10),
    );

    if (!b) {
      celdas.push(
        <CeldaLibre
          key={f}
          fecha={f}
          hoy={hoy}
          canManage={canManage}
          onClick={() =>
            onNueva({ serviceId: servicioId, resourceId: recursoId, fecha: f })
          }
        />,
      );
      i++;
      continue;
    }

    const salida = b.fin.slice(0, 10);
    let span = 1;
    while (i + span < fechas.length && fechas[i + span] < salida) span++;

    const empiezaAntes = b.inicio.slice(0, 10) < f;
    const sigueDespues = i + span === fechas.length && salida > fechas[fechas.length - 1];

    celdas.push(
      <td key={f} colSpan={span} className="h-10 p-0.5">
        <button
          type="button"
          onClick={() => onVer(b)}
          title={`${b.holderName} · ${b.descripcion}${debe(b) ? ` · debe ${b.saldo} ${b.currency}` : ""}`}
          className={cn(
            "flex size-full items-center gap-1 truncate rounded px-2 text-left font-medium",
            claseReserva(b),
            empiezaAntes && "rounded-l-none",
            sigueDespues && "rounded-r-none",
          )}
        >
          {empiezaAntes && <span aria-hidden>‹</span>}
          {debe(b) && (
            <span
              aria-label="Con saldo pendiente"
              className="size-1.5 shrink-0 rounded-full bg-destructive"
            />
          )}
          <span className="truncate">{b.holderName}</span>
          {sigueDespues && <span aria-hidden className="ml-auto">›</span>}
        </button>
      </td>,
    );
    i += span;
  }

  return <>{celdas}</>;
}

/** Por hora: cada día lista sus tramos reservados y deja agregar otro. */
function CeldasHoras({
  servicioId,
  recursoId,
  reservas,
  fechas,
  hoy,
  canManage,
  onNueva,
  onVer,
}: CeldasProps) {
  return (
    <>
      {fechas.map((f) => {
        const delDia = reservas.filter((r) => r.inicio.slice(0, 10) === f);
        const pasado = f < hoy;
        return (
          <td
            key={f}
            className={cn("min-h-10 p-0.5 align-top", f === hoy && "bg-primary/5")}
          >
            <div className="flex flex-col gap-0.5">
              {delDia.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onVer(b)}
                  title={`${b.holderName} · ${b.descripcion}${debe(b) ? ` · debe ${b.saldo} ${b.currency}` : ""}`}
                  className={cn(
                    "flex items-center gap-1 truncate rounded px-1 py-0.5 text-left font-mono text-[10px]",
                    claseReserva(b),
                  )}
                >
                  {debe(b) && (
                    <span
                      aria-label="Con saldo pendiente"
                      className="size-1.5 shrink-0 rounded-full bg-destructive"
                    />
                  )}
                  {b.inicio.slice(11, 16)}
                </button>
              ))}
              {canManage && !pasado && (
                <button
                  type="button"
                  onClick={() =>
                    onNueva({ serviceId: servicioId, resourceId: recursoId, fecha: f })
                  }
                  className="flex h-6 items-center justify-center rounded text-muted-foreground/0 hover:bg-muted hover:text-muted-foreground"
                >
                  <IconPlus className="size-3" />
                  <span className="sr-only">Reservar el {f}</span>
                </button>
              )}
            </div>
          </td>
        );
      })}
    </>
  );
}
