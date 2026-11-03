"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  IconCalendarEvent,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import { compareMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { tableFields } from "@/lib/fields/resolve";
import { BookingDetail, BookingForm, ESTADO, valorCampo } from "./booking-dialogs";
import type { CobroConfig } from "./booking-payment";
import type { BoardBooking, BoardService, BookingFields } from "./types";

interface Filtros {
  q: string;
  estado: string;
  servicio: string;
  desde: string;
  hasta: string;
  saldo: boolean;
}

interface Props {
  rows: BoardBooking[];
  total: number;
  page: number;
  perPage: number;
  saldos: { currency: string; saldo: string; count: number }[];
  /** Los filtros aplicados, tal como quedaron tras sanear la URL. */
  filtros: Filtros;
  servicios: BoardService[];
  hoy: string;
  canManage: boolean;
  cobro: CobroConfig | null;
  campos: BookingFields;
}

const TODOS = "todos";

const OPCIONES_ESTADO: { value: string; label: string }[] = [
  { value: TODOS, label: "Todos los estados" },
  { value: "pendientes", label: "Pendientes (reservadas y en curso)" },
  { value: "reservada", label: "Reservadas" },
  { value: "en_curso", label: "En curso" },
  { value: "finalizada", label: "Finalizadas" },
  { value: "cancelada", label: "Canceladas" },
  { value: "no_show", label: "No se presentó" },
];

/** Las que tienen deuda: una cancelada o no presentada ya no debe nada. */
function debe(b: BoardBooking): boolean {
  return (
    (b.status === "reservada" || b.status === "en_curso" || b.status === "finalizada") &&
    compareMoney(b.saldo, "0") > 0
  );
}

function fechas(b: BoardBooking): string {
  if (b.unidad === "noche") {
    return `${formatDate(b.inicio.slice(0, 10))} → ${formatDate(b.fin.slice(0, 10))}`;
  }
  return `${formatDate(b.inicio.slice(0, 10))}, ${b.inicio.slice(11, 16)}–${b.fin.slice(11, 16)}`;
}

/**
 * Listado de reservas: buscar, filtrar y ver lo que se debe.
 *
 * Todo el estado de la consulta vive en la URL, como en Finanzas: el enlace se
 * comparte, el botón Atrás funciona, y Postgres trae solo la página que se ve.
 *
 * Tocar una fila abre el MISMO detalle que la cuadrícula: cobrar, modificar,
 * registrar llegada o salida funcionan igual desde aquí.
 */
export function BookingListView({
  rows,
  total,
  page,
  perPage,
  saldos,
  filtros,
  servicios,
  hoy,
  canManage,
  cobro,
  campos,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navegando, startNav] = useTransition();

  // Ids, no copias: después de cobrar o modificar, se lee la fila fresca.
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const detalle = detalleId ? rows.find((r) => r.id === detalleId) : undefined;
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const editando = editandoId ? rows.find((r) => r.id === editandoId) : undefined;
  const [aperturas, setAperturas] = useState(0);

  const pages = Math.max(1, Math.ceil(total / perPage));
  /** Las personalizadas marcadas "Mostrar como columna en el listado". */
  const columnas = tableFields(campos.fields);
  /**
   * Las fijas con columna propia. Documento y teléfono sin columna, pero
   * visibles, siguen debajo del titular, como siempre.
   */
  const { fijos } = campos;
  const fijasEnTabla = (["holder_document", "holder_phone", "notes"] as const).filter(
    (k) => fijos[k].enTabla,
  );
  const valorFijo = (b: (typeof rows)[number], k: (typeof fijasEnTabla)[number]) =>
    k === "holder_document" ? b.holderDocument : k === "holder_phone" ? b.holderPhone : b.notes;
  const bajoTitular = (b: (typeof rows)[number]) =>
    (["holder_document", "holder_phone"] as const)
      .filter((k) => fijos[k].visible && !fijos[k].enTabla)
      .map((k) => valorFijo(b, k))
      .filter(Boolean);
  const hayFiltros = Boolean(
    filtros.q || filtros.estado || filtros.servicio || filtros.desde || filtros.hasta || filtros.saldo,
  );

  const navegar = useCallback(
    (cambios: Record<string, string | number | undefined>) => {
      const params = new URLSearchParams(searchParams);
      for (const [clave, valor] of Object.entries(cambios)) {
        if (valor === undefined || valor === "" || valor === 0) params.delete(clave);
        else params.set(clave, String(valor));
      }
      startNav(() => {
        router.push(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
      });
    },
    [router, pathname, searchParams],
  );

  // Cambiar un filtro vuelve a la primera página: seguir en la 4 de un
  // resultado que ahora tiene 2 mostraría una tabla vacía sin explicación.
  const filtrar = useCallback(
    (cambios: Record<string, string | undefined>) => navegar({ ...cambios, page: undefined }),
    [navegar],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Listado de reservas</h2>
          <p className="text-sm text-muted-foreground">
            Busca una reserva o mira cuánto se debe
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" asChild>
          <Link href="/reservas">
            <IconCalendarEvent className="size-4" />
            Ver disponibilidad
          </Link>
        </Button>
      </div>

      {/*
        Lo que se debe, por moneda. Una tarjeta por moneda, nunca un total
        único: como en el resto de la app, no se suman bolívares con dólares.
      */}
      {saldos.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {saldos.map((s) => (
            <Card key={s.currency}>
              <CardContent className="p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Por cobrar en {s.currency}
                </p>
                <p className="mt-1 font-mono text-lg font-semibold text-destructive">
                  {formatMoney(s.saldo, s.currency)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  en {s.count} {s.count === 1 ? "reserva" : "reservas"}
                  {hayFiltros && " de las filtradas"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="gap-3 pb-3">
          <BarraFiltros
            filtros={filtros}
            servicios={servicios}
            onFiltrar={filtrar}
            navegando={navegando}
          />
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{total}</span>{" "}
            {total === 1 ? "reserva" : "reservas"}
            {hayFiltros && " que coinciden"}
          </p>
        </CardHeader>

        <CardContent className={cn("p-0", navegando && "opacity-60")}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fechas</TableHead>
                  <TableHead>{fijos.holder_name.label}</TableHead>
                  {fijasEnTabla.map((k) => (
                    <TableHead key={k}>{fijos[k].label}</TableHead>
                  ))}
                  <TableHead>Qué</TableHead>
                  {columnas.map((f) => (
                    <TableHead key={f.key}>{f.label}</TableHead>
                  ))}
                  <TableHead className="text-center">Pers.</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8 + fijasEnTabla.length + columnas.length} className="py-10 text-center text-sm text-muted-foreground">
                      {hayFiltros ? (
                        <span className="space-y-2">
                          <span className="block">Ninguna reserva coincide con lo que buscaste.</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              filtrar({
                                q: undefined,
                                estado: undefined,
                                servicio: undefined,
                                desde: undefined,
                                hasta: undefined,
                                saldo: undefined,
                              })
                            }
                          >
                            Quitar los filtros
                          </Button>
                        </span>
                      ) : (
                        "Todavía no hay reservas."
                      )}
                    </TableCell>
                  </TableRow>
                )}

                {rows.map((b) => {
                  const estado = ESTADO[b.status];
                  return (
                    <TableRow
                      key={b.id}
                      className="cursor-pointer"
                      onClick={() => setDetalleId(b.id)}
                    >
                      <TableCell className="whitespace-nowrap text-xs">{fechas(b)}</TableCell>
                      <TableCell>
                        <span className="block font-medium">{b.holderName}</span>
                        {bajoTitular(b).length > 0 && (
                          <span className="block text-[11px] text-muted-foreground">
                            {bajoTitular(b).join(" · ")}
                          </span>
                        )}
                      </TableCell>
                      {fijasEnTabla.map((k) => (
                        <TableCell key={k} className="max-w-48 truncate text-sm">
                          {valorFijo(b, k) || "—"}
                        </TableCell>
                      ))}
                      <TableCell className="text-sm text-muted-foreground">
                        {b.serviceName} ·{" "}
                        <span className="font-mono text-foreground">{b.resourceName}</span>
                      </TableCell>
                      {columnas.map((f) => (
                        <TableCell key={f.key} className="max-w-48 truncate text-sm">
                          {valorCampo(campos, f, b.custom[f.key])}
                        </TableCell>
                      ))}
                      <TableCell className="text-center font-mono text-sm">{b.partySize}</TableCell>
                      <TableCell>
                        <span
                          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${estado.className}`}
                        >
                          {estado.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatMoney(b.total, b.currency)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-sm",
                          debe(b) ? "font-semibold text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {/*
                          Una cancelada o no presentada no debe: mostrar su
                          "saldo" invitaría a cobrar algo que ya no se cobra.
                        */}
                        {b.status === "cancelada" || b.status === "no_show"
                          ? "—"
                          : formatMoney(b.saldo, b.currency)}
                      </TableCell>
                      <TableCell>
                        {/* El enlace no abre el detalle: lleva a la semana de la reserva. */}
                        <Link
                          href={`/reservas?desde=${b.inicio.slice(0, 10)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Ver en la cuadrícula"
                        >
                          <IconCalendarEvent className="size-4" />
                          <span className="sr-only">Ver en la cuadrícula</span>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Página {page + 1} de {pages}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0 || navegando}
              onClick={() => navegar({ page: page - 1 })}
            >
              <IconChevronLeft className="size-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pages || navegando}
              onClick={() => navegar({ page: page + 1 })}
            >
              Siguiente
              <IconChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {detalle && (
        <BookingDetail
          key={detalle.id}
          reserva={detalle}
          hoy={hoy}
          canManage={canManage}
          cobro={cobro}
          campos={campos}
          onClose={() => setDetalleId(null)}
          onModificar={() => {
            setDetalleId(null);
            setEditandoId(detalle.id);
            setAperturas((n) => n + 1);
          }}
        />
      )}

      {editando && (
        <BookingForm
          key={`editar-${editando.id}-${aperturas}`}
          open
          onOpenChange={(abierto) => {
            if (!abierto) setEditandoId(null);
          }}
          servicios={servicios}
          // Desde el listado no hay una ventana de días cargada: la
          // disponibilidad que muestra el formulario es solo la de esta
          // página. La palabra final, como siempre, la tiene la base.
          reservas={rows}
          inicial={{
            serviceId: editando.serviceId,
            resourceId: editando.resourceId,
            fecha: editando.inicio.slice(0, 10),
          }}
          editing={editando}
          campos={campos}
        />
      )}
    </div>
  );
}

/**
 * Búsqueda y filtros. Lo que se escribe espera un momento antes de navegar,
 * para no consultar por cada tecla; los selectores y las fechas, no.
 */
function BarraFiltros({
  filtros,
  servicios,
  onFiltrar,
  navegando,
}: {
  filtros: Filtros;
  servicios: BoardService[];
  onFiltrar: (cambios: Record<string, string | undefined>) => void;
  navegando: boolean;
}) {
  const [texto, setTexto] = useState(filtros.q);
  const [ultimoAplicado, setUltimoAplicado] = useState(filtros.q);

  // Al volver con Atrás, manda la URL. Se ajusta durante el render, no en un
  // efecto, para no pintar el valor viejo y volver a renderizar.
  if (filtros.q !== ultimoAplicado) {
    setUltimoAplicado(filtros.q);
    setTexto(filtros.q);
  }

  useEffect(() => {
    // Ya aplicado: cubre el montaje y el eco de la propia navegación.
    if (texto === filtros.q) return;
    const t = setTimeout(() => onFiltrar({ q: texto || undefined }), 350);
    return () => clearTimeout(t);
  }, [texto, filtros.q, onFiltrar]);

  const hayFiltros = Boolean(
    filtros.q || filtros.estado || filtros.servicio || filtros.desde || filtros.hasta || filtros.saldo,
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[200px] flex-1 space-y-1.5">
        <Label htmlFor="buscar-reserva" className="text-xs text-muted-foreground">
          Buscar por titular, documento, teléfono o columna personalizada
        </Label>
        <div className="relative">
          <IconSearch className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="buscar-reserva"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Pérez, V-12345678, 0414…"
            className="pl-8"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Estado</Label>
        <Select
          value={filtros.estado || TODOS}
          onValueChange={(v) => onFiltrar({ estado: v === TODOS ? undefined : v })}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPCIONES_ESTADO.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {servicios.length > 1 && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Servicio</Label>
          <Select
            value={filtros.servicio || TODOS}
            onValueChange={(v) => onFiltrar({ servicio: v === TODOS ? undefined : v })}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              {servicios.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="lis-desde" className="text-xs text-muted-foreground">
          Desde
        </Label>
        <Input
          id="lis-desde"
          type="date"
          value={filtros.desde}
          max={filtros.hasta || undefined}
          onChange={(e) => onFiltrar({ desde: e.target.value || undefined })}
          className="w-[150px]"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="lis-hasta" className="text-xs text-muted-foreground">
          Hasta
        </Label>
        <Input
          id="lis-hasta"
          type="date"
          value={filtros.hasta}
          min={filtros.desde || undefined}
          onChange={(e) => onFiltrar({ hasta: e.target.value || undefined })}
          className="w-[150px]"
        />
      </div>

      <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
        <input
          type="checkbox"
          checked={filtros.saldo}
          onChange={(e) => onFiltrar({ saldo: e.target.checked ? "1" : undefined })}
          className="size-4 accent-primary"
        />
        Solo con saldo pendiente
      </label>

      {hayFiltros && (
        <Button
          variant="ghost"
          size="sm"
          disabled={navegando}
          onClick={() => {
            setTexto("");
            onFiltrar({
              q: undefined,
              estado: undefined,
              servicio: undefined,
              desde: undefined,
              hasta: undefined,
              saldo: undefined,
            });
          }}
        >
          <IconX className="size-3.5" />
          Limpiar
        </Button>
      )}
    </div>
  );
}
