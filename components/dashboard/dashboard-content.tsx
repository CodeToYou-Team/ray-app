"use client";

import Link from "next/link";
import {
  IconArrowUpRight,
  IconArrowDownRight,
  IconTrendingUp,
  IconTrendingDown,
  IconAlertTriangle,
  IconPackage,
  IconPlus,
  IconShoppingCart,
} from "@tabler/icons-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StaggerContainer, StaggerItem } from "@/components/motion";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardCurrency } from "@/lib/finanzas/dashboard";

interface RecentRow {
  id: string;
  type: "ingreso" | "gasto";
  kind: string;
  concept: string;
  occurredOn: string;
  amount: string;
  currency: string;
  categoryLabel: string;
}

interface AlertRow {
  productId: string;
  name: string;
  stock: string;
  status: string;
}

interface Props {
  monedas: DashboardCurrency[];
  recientes: RecentRow[];
  alertas: AlertRow[];
  productosActivos: number;
  /** El rol solo ve lo que registró: las cifras son suyas, no del negocio. */
  soloPropias?: boolean;
}

function Change({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="text-[11px] text-muted-foreground">
        sin mes anterior para comparar
      </span>
    );
  }
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px]",
        up ? "text-success" : "text-destructive",
      )}
    >
      {up ? (
        <IconTrendingUp className="size-3" />
      ) : (
        <IconTrendingDown className="size-3" />
      )}
      {up ? "+" : ""}
      {value}% vs mes anterior
    </span>
  );
}

export function DashboardContent({
  monedas,
  recientes,
  alertas,
  productosActivos,
  soloPropias = false,
}: Props) {
  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {monedas.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-11 items-center justify-center rounded-xl bg-muted">
              <IconPlus className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">
                {soloPropias
                  ? "Todavía no registraste movimientos este mes"
                  : "Todavía no hay movimientos este mes"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Registra tu primer ingreso o gasto y los números aparecen aquí.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" asChild>
                <Link href="/finanzas/ingresos">Registrar ingreso</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/finanzas/gastos">Registrar gasto</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <StaggerContainer>
          {/*
            Una tarjeta por moneda. No hay un "total del mes" unico: con pagos
            en Bs, USD y USDT, ese numero solo existiria convirtiendo, y la tasa
            se mueve todos los dias.
          */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {monedas.map((m) => (
              <StaggerItem key={m.currency}>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-sm">
                      <span>{soloPropias ? "Lo que registraste este mes" : "Este mes"}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {m.currency}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs text-muted-foreground">
                          Ingresos
                        </span>
                        <span className="font-mono text-base font-semibold text-success">
                          {formatMoney(m.ingresos, m.currency)}
                        </span>
                      </div>
                      <div className="flex justify-end">
                        <Change value={m.ingresosChange} />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs text-muted-foreground">
                          Gastos
                        </span>
                        <span className="font-mono text-base font-semibold text-destructive">
                          {formatMoney(m.gastos, m.currency)}
                        </span>
                      </div>
                      <div className="flex justify-end">
                        <Change value={m.gastosChange} />
                      </div>
                    </div>

                    <div className="flex items-baseline justify-between border-t pt-2">
                      <span className="text-xs font-medium">Balance</span>
                      <span
                        className={cn(
                          "font-mono text-base font-bold",
                          Number(m.balance) < 0
                            ? "text-destructive"
                            : "text-foreground",
                        )}
                      >
                        {formatMoney(m.balance, m.currency)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </StaggerItem>
            ))}
          </div>
        </StaggerContainer>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm">
              {soloPropias ? "Tus últimos movimientos" : "Últimos movimientos"}
            </CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/finanzas/movimientos">Ver todos</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {recientes.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin movimientos registrados.
              </p>
            )}
            {recientes.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
              >
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    r.type === "ingreso"
                      ? "bg-success/10 text-success"
                      : "bg-destructive/10 text-destructive",
                  )}
                >
                  {r.type === "ingreso" ? (
                    <IconArrowUpRight className="size-4" />
                  ) : (
                    <IconArrowDownRight className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {r.concept}
                    {r.kind !== "operacion" && (
                      <Badge variant="secondary" className="ml-1.5 text-[9px]">
                        {r.kind === "venta" ? "Venta" : "Compra"}
                      </Badge>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.categoryLabel} · {formatDate(r.occurredOn)}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 font-mono text-sm font-medium",
                    r.type === "ingreso" ? "text-success" : "text-destructive",
                  )}
                >
                  {formatMoney(r.amount, r.currency)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Acciones rápidas</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" className="justify-start" asChild>
                <Link href="/finanzas/ingresos">
                  <IconArrowUpRight className="size-4" />
                  Ingreso
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="justify-start" asChild>
                <Link href="/finanzas/gastos">
                  <IconArrowDownRight className="size-4" />
                  Gasto
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="justify-start" asChild>
                <Link href="/productos/nuevo">
                  <IconPackage className="size-4" />
                  Producto
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="justify-start" asChild>
                <Link href="/inventario">
                  <IconShoppingCart className="size-4" />
                  Inventario
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <IconAlertTriangle className="size-4 text-warning" />
                Inventario
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {productosActivos}{" "}
                {productosActivos === 1 ? "producto" : "productos"} en catálogo
              </p>
              {alertas.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin alertas de stock.
                </p>
              ) : (
                alertas.slice(0, 5).map((a) => (
                  <div
                    key={a.productId}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="truncate">{a.name}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 font-mono text-[10px]",
                        a.status === "sin_stock"
                          ? "border-destructive/20 bg-destructive/10 text-destructive"
                          : "border-warning/20 bg-warning/10 text-warning",
                      )}
                    >
                      {a.stock.replace(/\.?0+$/, "") || "0"}
                    </Badge>
                  </div>
                ))
              )}
              {alertas.length > 5 && (
                <Button variant="ghost" size="sm" className="w-full" asChild>
                  <Link href="/inventario">
                    Ver las {alertas.length} alertas
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
