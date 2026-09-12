"use client";

import { useState, useTransition } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TransactionForm,
  type FormOption,
  type FormSellable,
} from "./transaction-form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  const [navigating, startNavigation] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / perPage));

  // La pagina vive en la URL y no en estado local: asi se puede compartir el
  // enlace, el boton de atras funciona, y la pagina sigue siendo un RSC que
  // consulta solo las filas que va a mostrar.
  function goToPage(next: number) {
    const params = new URLSearchParams(searchParams);
    if (next <= 0) params.delete("page");
    else params.set("page", String(next));
    startNavigation(() => {
      router.push(`${pathname}?${params}`, { scroll: false });
    });
  }

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
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {total} {total === 1 ? "operación" : "operaciones"}
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
                {canVoid && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canVoid ? 6 : 5}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Todavía no hay{" "}
                    {type === "ingreso"
                      ? "ingresos"
                      : type === "gasto"
                        ? "gastos"
                        : "movimientos"}{" "}
                    registrados.
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
                    {canVoid && (
                      <TableCell className="text-right">
                        <VoidMenu row={r} />
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
              onClick={() => goToPage(page - 1)}
            >
              <IconChevronLeft className="size-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pages || navigating}
              onClick={() => goToPage(page + 1)}
            >
              Siguiente
              <IconChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <TransactionForm
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        type={formType}
        categories={categoriesByType[formType]}
        paymentMethods={paymentMethods}
        sellables={sellables}
      />
    </div>
  );
}

/**
 * Anular una operacion.
 *
 * No borra: marca la operacion como anulada e inserta los movimientos de stock
 * compensatorios, dejando los originales como rastro de la correccion.
 */
function VoidMenu({ row }: { row: ViewRow }) {
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
