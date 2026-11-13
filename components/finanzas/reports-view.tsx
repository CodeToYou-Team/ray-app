"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp, TrendingDown, Scale } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import type { GroupedTotal, MonthPoint, TopProduct, ReportSummary } from "@/lib/finanzas/reports";

/**
 * Paleta categorica. Se lee de los tokens del tema, asi que respeta claro y
 * oscuro sin definir colores aparte.
 */
const COLORS = [
  "var(--color-primary)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-info)",
  "var(--color-destructive)",
  "var(--color-muted-foreground)",
];

/**
 * Recharts tipa el valor del tooltip como posiblemente indefinido (una serie
 * puede no tener punto en esa categoria), asi que se normaliza antes de
 * formatear en vez de castear.
 */
function tooltipMoney(currency: string) {
  return (value: unknown): string =>
    value === undefined || value === null
      ? "—"
      : formatMoney(String(value), currency);
}

interface Props {
  currency: string;
  currencies: string[];
  period: { from: string; to: string };
  periodKey: string;
  summary: ReportSummary;
  ingresosPorCategoria: GroupedTotal[];
  gastosPorCategoria: GroupedTotal[];
  porMetodo: GroupedTotal[];
  serie: MonthPoint[];
  top: TopProduct[];
}

const PERIODOS = [
  { key: "3m", label: "Últimos 3 meses" },
  { key: "6m", label: "Últimos 6 meses" },
  { key: "12m", label: "Últimos 12 meses" },
  { key: "all", label: "Todo" },
];

export function ReportsView({
  currency,
  currencies,
  summary,
  periodKey,
  ingresosPorCategoria,
  gastosPorCategoria,
  porMetodo,
  serie,
  top,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startNavigation] = useTransition();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    startNavigation(() => router.push(`${pathname}?${params}`, { scroll: false }));
  }

  const sinDatos = summary.operaciones === 0;

  return (
    <div className={cn("space-y-4 max-w-7xl mx-auto", navigating && "opacity-70")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Reportes"
          description="Todo lo que ves es de una sola moneda. Los montos no se convierten entre sí, así que mezclarlos en un gráfico no diría nada."
          className="min-w-0 flex-1"
        />

        <div className="flex gap-2">
          <Select value={currency} onValueChange={(v) => setParam("moneda", v)}>
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

          <Select value={periodKey} onValueChange={(v) => setParam("periodo", v)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODOS.map((p) => (
                <SelectItem key={p.key} value={p.key}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {sinDatos ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">
              No hay operaciones en {currency} para este periodo
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Prueba con otra moneda o un rango más amplio.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Ingresos"
              value={formatMoney(summary.ingresos, currency)}
              icon={TrendingUp}
              tone="success"
            />
            <StatCard
              label="Gastos"
              value={formatMoney(summary.gastos, currency)}
              icon={TrendingDown}
              tone="destructive"
            />
            <StatCard
              label="Balance"
              value={formatMoney(summary.balance, currency)}
              icon={Scale}
              tone={Number(summary.balance) < 0 ? "destructive" : "default"}
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Evolución mensual</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serie}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11 }}
                      stroke="var(--color-muted-foreground)"
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="var(--color-muted-foreground)"
                      width={70}
                    />
                    <Tooltip
                      formatter={tooltipMoney(currency)}
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="ingresos"
                      name="Ingresos"
                      fill="var(--color-success)"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="gastos"
                      name="Gastos"
                      fill="var(--color-destructive)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownCard
              title="Ingresos por categoría"
              rows={ingresosPorCategoria}
              currency={currency}
            />
            <BreakdownCard
              title="Gastos por categoría"
              rows={gastosPorCategoria}
              currency={currency}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Ingresos por método de pago</CardTitle>
              </CardHeader>
              <CardContent>
                {porMetodo.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Sin datos.
                  </p>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={porMetodo.map((m) => ({
                            name: m.label,
                            value: Number(m.total),
                          }))}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={50}
                          outerRadius={85}
                          paddingAngle={2}
                        >
                          {porMetodo.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={tooltipMoney(currency)}
                          contentStyle={{
                            background: "var(--color-popover)",
                            border: "1px solid var(--color-border)",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Productos más vendidos</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="w-20 text-right">Unidades</TableHead>
                      <TableHead className="w-28 text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {top.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          Aún no hay ventas con productos. Registra una venta
                          eligiendo productos, no solo un monto.
                        </TableCell>
                      </TableRow>
                    )}
                    {top.map((p) => (
                      <TableRow key={p.productId}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {p.qty.replace(/\.?0+$/, "") || "0"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatMoney(p.total, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof TrendingUp;
  tone: "success" | "destructive" | "default";
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "flex size-9 items-center justify-center rounded-lg",
            tone === "success" && "bg-success/10 text-success",
            tone === "destructive" && "bg-destructive/10 text-destructive",
            tone === "default" && "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p
            className={cn(
              "truncate font-mono text-lg font-semibold",
              tone === "success" && "text-success",
              tone === "destructive" && "text-destructive",
            )}
          >
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Desglose con barra proporcional: se lee mejor que una torta con 8 rebanadas. */
function BreakdownCard({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: GroupedTotal[];
  currency: string;
}) {
  const mayor = Math.max(...rows.map((r) => Number(r.total)), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin datos en este periodo.
          </p>
        )}
        {rows.map((r, i) => (
          <div key={r.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{r.label}</span>
                <Badge variant="outline" className="shrink-0 text-[9px]">
                  {r.count}
                </Badge>
              </span>
              <span className="shrink-0 font-mono text-sm">
                {formatMoney(r.total, currency)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(Number(r.total) / mayor) * 100}%`,
                  background: COLORS[i % COLORS.length],
                }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
