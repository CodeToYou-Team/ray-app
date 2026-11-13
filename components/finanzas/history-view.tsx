"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MonthPoint } from "@/lib/finanzas/reports";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-01" -> "enero 2026". */
function nombreMes(key: string): string {
  const [anio, mes] = key.split("-");
  return `${MESES[Number(mes) - 1] ?? mes} ${anio}`;
}

interface Props {
  currency: string;
  currencies: string[];
  /** Del mas reciente al mas antiguo. */
  meses: MonthPoint[];
}

export function HistoryView({ currency, currencies, meses }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startNavigation] = useTransition();

  function setMoneda(v: string) {
    const params = new URLSearchParams(searchParams);
    params.set("moneda", v);
    startNavigation(() => router.push(`${pathname}?${params}`, { scroll: false }));
  }

  return (
    <div className={cn("space-y-4 max-w-4xl mx-auto", navigating && "opacity-70")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Historial"
          description="Mes a mes, con la variación respecto al mes anterior."
          className="min-w-0 flex-1"
        />

        <Select value={currency} onValueChange={setMoneda}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currencies.map((c) => (
              <SelectItem key={c} value={c}>
                <span className="font-mono text-xs">{c}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {meses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Sin movimientos en {currency}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Cuando registres operaciones en esta moneda, aparecen aquí por mes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Ingresos</TableHead>
                  <TableHead className="text-right">Gastos</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="w-28 text-right">vs. anterior</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meses.map((m, i) => {
                  // La lista viene del mas reciente al mas antiguo, asi que el
                  // mes anterior es el SIGUIENTE del arreglo.
                  const anterior = meses[i + 1];
                  return (
                    <TableRow key={m.month}>
                      <TableCell className="font-medium capitalize">
                        {nombreMes(m.month)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-success">
                        {formatMoney(m.ingresos, currency)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-destructive">
                        {formatMoney(m.gastos, currency)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-sm font-semibold",
                          Number(m.balance) < 0 && "text-destructive",
                        )}
                      >
                        {formatMoney(m.balance, currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Variacion
                          actual={m.ingresos}
                          previo={anterior?.ingresos}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Variacion de ingresos contra el mes anterior.
 *
 * Con base cero no se calcula porcentaje: pasar de 0 a 100 no es "infinito por
 * ciento", es simplemente el primer mes con ingresos.
 */
function Variacion({ actual, previo }: { actual: string; previo?: string }) {
  if (previo === undefined) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }

  const base = Number(previo);
  if (base === 0) {
    return (
      <span className="text-[11px] text-muted-foreground">
        {Number(actual) > 0 ? "primer mes" : "—"}
      </span>
    );
  }

  const pct = Math.round(((Number(actual) - base) / base) * 100);
  if (pct === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
        <Minus className="size-3" />
        igual
      </span>
    );
  }

  const sube = pct > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] font-medium",
        sube ? "text-success" : "text-destructive",
      )}
    >
      {sube ? (
        <TrendingUp className="size-3" />
      ) : (
        <TrendingDown className="size-3" />
      )}
      {sube ? "+" : ""}
      {pct}%
    </span>
  );
}
