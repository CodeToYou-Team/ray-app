"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  IconArrowUpRight,
  IconArrowDownRight,
  IconPlus,
  IconPackage,
  IconShoppingCart,
  IconChevronLeft,
  IconChevronRight,
  IconDotsVertical,
  IconBan,
  IconPencil,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TransactionForm,
  type EditingItem,
  type EditingTransaction,
  type FormOption,
  type FormSellable,
} from "./transaction-form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { voidTransaction } from "@/lib/finanzas/actions";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ViewRow {
  id: string;
  type: "ingreso" | "gasto";
  kind: string;
  concept: string;
  occurredOn: string;
  amount: string;
  currency: string;
  categoryLabel: string;
  paymentMethodLabel: string;
  /** Lo que hace falta para precargar la corrección, no para la tabla. */
  categoryId: string;
  paymentMethodId: string;
  notes: string | null;
  items: EditingItem[];
}

export interface ViewTotal {
  currency: string;
  total: string;
  count: number;
}

interface Props {
  title: string;
  description: string;
  /** undefined = las dos clases juntas (pantalla de Movimientos). */
  type?: "ingreso" | "gasto";
  rows: ViewRow[];
  totals: ViewTotal[];
  /** Solo en Movimientos: ingresos, gastos y balance por moneda. */
  balances?: {
    currency: string;
    ingresos: string;
    gastos: string;
    balance: string;
    count: number;
  }[];
  canVoid?: boolean;
  canEdit?: boolean;
  /** Los filtros aplicados, tal como quedaron tras sanear la URL. */
  filtros: { q: string; desde: string; hasta: string };
  total: number;
  page: number;
  perPage: number;
  categoriesByType: { ingreso: FormOption[]; gasto: FormOption[] };
  paymentMethods: FormOption[];
  sellables: FormSellable[];
}

const KIND_BADGE: Record<string, { label: string; icon: typeof IconPackage }> = {
  venta: { label: "Venta", icon: IconShoppingCart },
  compra: { label: "Compra", icon: IconPackage },
};

export function TransactionsView({
  title,
  description,
  type,
  rows,
  totals,
  balances,
  canVoid = false,
  canEdit = false,
  filtros,
  total,
  page,
  perPage,
  categoriesByType,
  paymentMethods,
  sellables,
}: Props) {
  // En Movimientos el formulario sirve para las dos clases, asi que cual abrir
  // se decide con el boton que se presiono.
  const [formType, setFormType] = useState<"ingreso" | "gasto">(type ?? "ingreso");
  const [dialogOpen, setDialogOpen] = useState(false);
  /** La fila que se está corrigiendo. `null` = el diálogo registra una nueva. */
  const [editing, setEditing] = useState<ViewRow | null>(null);
  const [navigating, startNavigation] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / perPage));

  /**
   * Todo el estado de la consulta vive en la URL, no en estado local.
   *
   * Asi el enlace se puede compartir tal cual, el boton de atras hace lo que
   * uno espera, y la pagina sigue siendo un RSC que le pide a Postgres solo las
   * filas que va a mostrar: filtrar en el navegador obligaria a traerlas todas.
   */
  const navegar = useCallback(
    (cambios: Record<string, string | number | undefined>) => {
      const params = new URLSearchParams(searchParams);
      for (const [clave, valor] of Object.entries(cambios)) {
        if (valor === undefined || valor === "" || valor === 0) {
          params.delete(clave);
        } else {
          params.set(clave, String(valor));
        }
      }
      startNavigation(() => {
        router.push(params.size ? `${pathname}?${params}` : pathname, {
          scroll: false,
        });
      });
    },
    [router, pathname, searchParams],
  );

  // Cambiar un filtro vuelve a la primera pagina: seguir en la 4 de un
  // resultado que ahora tiene 2 mostraria una tabla vacia sin explicacion.
  const filtrar = useCallback(
    (cambios: Record<string, string | undefined>) =>
      navegar({ ...cambios, page: undefined }),
    [navegar],
  );

  const hayFiltros = Boolean(filtros.q || filtros.desde || filtros.hasta);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex gap-2">
          {(type === undefined || type === "ingreso") && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setEditing(null);
                setFormType("ingreso");
                setDialogOpen(true);
              }}
            >
              <IconPlus className="size-3.5" />
              Registrar ingreso
            </Button>
          )}
          {(type === undefined || type === "gasto") && (
            <Button
              size="sm"
              variant={type === undefined ? "outline" : "default"}
              className="gap-1.5"
              onClick={() => {
                setEditing(null);
                setFormType("gasto");
                setDialogOpen(true);
              }}
            >
              <IconPlus className="size-3.5" />
              Registrar gasto
            </Button>
          )}
        </div>
      </div>

      {/*
        Una tarjeta por moneda, nunca un total unico.
        Sumar Bs con USD daria un numero que no es dinero, y como no se convierte
        nada, no existe un "total general" que mostrar.
      */}
      {balances && balances.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {balances.map((b) => (
            <Card key={b.currency}>
              <CardContent className="space-y-2 p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {b.currency}
                </p>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Ingresos</span>
                  <span className="font-mono text-success">
                    {formatMoney(b.ingresos, b.currency)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Gastos</span>
                  <span className="font-mono text-destructive">
                    {formatMoney(b.gastos, b.currency)}
                  </span>
                </div>
                {/* El balance solo tiene sentido DENTRO de una moneda. */}
                <div className="flex items-baseline justify-between border-t pt-2 text-sm font-semibold">
                  <span>Balance</span>
                  <span
                    className={cn(
                      "font-mono",
                      Number(b.balance) < 0 ? "text-destructive" : "text-success",
                    )}
                  >
                    {formatMoney(b.balance, b.currency)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!balances && totals.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {totals.map((t) => (
            <Card key={t.currency}>
              <CardContent className="p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Total en {t.currency}
                </p>
                <p
                  className={cn(
                    "mt-1 font-mono text-lg font-semibold",
                    type === "gasto" ? "text-destructive" : "text-success",
                  )}
                >
                  {formatMoney(t.total, t.currency)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t.count} {t.count === 1 ? "operación" : "operaciones"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="gap-3 pb-3">
          <Filtros
            filtros={filtros}
            onFiltrar={filtrar}
            navegando={navigating}
          />
          <CardTitle className="text-sm font-normal text-muted-foreground">
            <span className="font-semibold text-foreground">{total}</span>{" "}
            {total === 1 ? "operación" : "operaciones"}
            {hayFiltros && " que coinciden"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Fecha</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                {(canEdit || canVoid) && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canEdit || canVoid ? 6 : 5}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {hayFiltros ? (
                      <span className="space-y-2">
                        <span className="block">
                          Ninguna operación coincide con lo que buscaste.
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            filtrar({
                              q: undefined,
                              desde: undefined,
                              hasta: undefined,
                            })
                          }
                        >
                          Quitar los filtros
                        </Button>
                      </span>
                    ) : (
                      <>
                        Todavía no hay{" "}
                        {type === "ingreso"
                          ? "ingresos"
                          : type === "gasto"
                            ? "gastos"
                            : "movimientos"}{" "}
                        registrados.
                      </>
                    )}
                  </TableCell>
                </TableRow>
              )}

              {rows.map((r) => {
                const kindBadge = KIND_BADGE[r.kind];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(r.occurredOn)}
                    </TableCell>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {r.concept}
                        {kindBadge && (
                          <Badge variant="secondary" className="gap-1 text-[10px]">
                            <kindBadge.icon className="size-3" />
                            {kindBadge.label}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.categoryLabel}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.paymentMethodLabel}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 font-mono text-sm font-medium",
                          r.type === "ingreso" ? "text-success" : "text-destructive",
                        )}
                      >
                        {r.type === "ingreso" ? (
                          <IconArrowUpRight className="size-3.5" />
                        ) : (
                          <IconArrowDownRight className="size-3.5" />
                        )}
                        {formatMoney(r.amount, r.currency)}
                      </span>
                    </TableCell>
                    {(canEdit || canVoid) && (
                      <TableCell className="text-right">
                        <RowMenu
                          row={r}
                          canEdit={canEdit}
                          canVoid={canVoid}
                          onEdit={() => {
                            setEditing(r);
                            setFormType(r.type);
                            setDialogOpen(true);
                          }}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
              disabled={page === 0 || navigating}
              onClick={() => navegar({ page: page - 1 })}
            >
              <IconChevronLeft className="size-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pages || navigating}
              onClick={() => navegar({ page: page + 1 })}
            >
              Siguiente
              <IconChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/*
        `key` fuerza el remontaje al pasar de alta a corrección o entre filas:
        el formulario siembra su estado del `editing` que recibe al montarse,
        así que sin esto la segunda fila abriría con los datos de la primera.
      */}
      <TransactionForm
        key={editing?.id ?? `nuevo-${formType}`}
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setEditing(null);
        }}
        type={formType}
        categories={categoriesByType[formType]}
        paymentMethods={paymentMethods}
        sellables={sellables}
        editing={editing ? toEditing(editing) : undefined}
      />
    </div>
  );
}

/**
 * Buscador por concepto y rango de fechas.
 *
 * Lo que se escribe espera un momento antes de navegar: sin eso cada tecla
 * seria una consulta a Postgres y un render del servidor. Las fechas no
 * esperan, porque se eligen de una sola vez.
 */
function Filtros({
  filtros,
  onFiltrar,
  navegando,
}: {
  filtros: { q: string; desde: string; hasta: string };
  onFiltrar: (cambios: Record<string, string | undefined>) => void;
  navegando: boolean;
}) {
  const [texto, setTexto] = useState(filtros.q);
  const [ultimoAplicado, setUltimoAplicado] = useState(filtros.q);

  // Al volver con el boton de atras la URL manda, no lo que quedo tecleado.
  // Se ajusta durante el render y no en un efecto: asi React lo resuelve antes
  // de pintar, en vez de pintar el valor viejo y volver a renderizar.
  if (filtros.q !== ultimoAplicado) {
    setUltimoAplicado(filtros.q);
    setTexto(filtros.q);
  }

  useEffect(() => {
    // Ya aplicado: cubre el montaje y el eco de la propia navegacion, que si no
    // volveria a disparar la misma busqueda en bucle.
    if (texto === filtros.q) return;
    const t = setTimeout(() => onFiltrar({ q: texto || undefined }), 350);
    return () => clearTimeout(t);
  }, [texto, filtros.q, onFiltrar]);

  const hayFiltros = Boolean(filtros.q || filtros.desde || filtros.hasta);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[200px] flex-1 space-y-1.5">
        <Label htmlFor="buscar" className="text-xs text-muted-foreground">
          Buscar por concepto
        </Label>
        <div className="relative">
          <IconSearch className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="buscar"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Alquiler, venta del día…"
            className="pl-8"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="desde" className="text-xs text-muted-foreground">
          Desde
        </Label>
        <Input
          id="desde"
          type="date"
          value={filtros.desde}
          max={filtros.hasta || undefined}
          onChange={(e) => onFiltrar({ desde: e.target.value || undefined })}
          className="w-[150px]"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="hasta" className="text-xs text-muted-foreground">
          Hasta
        </Label>
        <Input
          id="hasta"
          type="date"
          value={filtros.hasta}
          min={filtros.desde || undefined}
          onChange={(e) => onFiltrar({ hasta: e.target.value || undefined })}
          className="w-[150px]"
        />
      </div>

      {hayFiltros && (
        <Button
          variant="ghost"
          size="sm"
          disabled={navegando}
          onClick={() => {
            setTexto("");
            onFiltrar({ q: undefined, desde: undefined, hasta: undefined });
          }}
        >
          <IconX className="size-3.5" />
          Limpiar
        </Button>
      )}
    </div>
  );
}

/** La fila de la tabla, en la forma que espera el formulario. */
function toEditing(row: ViewRow): EditingTransaction {
  return {
    id: row.id,
    kind: row.kind as EditingTransaction["kind"],
    concept: row.concept,
    occurredOn: row.occurredOn,
    categoryId: row.categoryId,
    paymentMethodId: row.paymentMethodId,
    amount: row.amount,
    notes: row.notes,
    items: row.items,
  };
}

/**
 * Acciones de una operacion: corregirla o anularla.
 *
 * Son cosas distintas y se ofrecen por separado. Corregir arregla un dato mal
 * tecleado y deja el registro en su sitio; anular dice que la operacion no
 * debio existir. Ninguna de las dos borra: la correccion compensa el inventario
 * con un movimiento de ajuste, la anulacion con uno de anulacion.
 *
 * Cada opcion aparece solo si el rol la tiene, y el Server Action vuelve a
 * exigir el permiso igual, porque es un endpoint publico.
 */
function RowMenu({
  row,
  canEdit,
  canVoid,
  onEdit,
}: {
  row: ViewRow;
  canEdit: boolean;
  canVoid: boolean;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" disabled={pending}>
            <IconDotsVertical className="size-4" />
            <span className="sr-only">Acciones de {row.concept}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && (
            <DropdownMenuItem onSelect={onEdit}>
              <IconPencil className="mr-2 size-4" />
              Corregir
            </DropdownMenuItem>
          )}
          {canEdit && canVoid && <DropdownMenuSeparator />}
          {canVoid && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={(event) => {
              // Sin esto el menu se desmonta antes de que arranque la
              // transicion y la accion no llega a ejecutarse.
              event.preventDefault();
              setError(null);
              start(async () => {
                const result = await voidTransaction({ id: row.id });
                if (result.ok) router.refresh();
                else setError(result.error ?? "No se pudo anular.");
              });
            }}
          >
            <IconBan className="mr-2 size-4" />
            {pending ? "Anulando…" : "Anular"}
          </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
