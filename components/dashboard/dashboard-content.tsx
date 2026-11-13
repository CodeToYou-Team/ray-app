"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  TriangleAlert,
  Package,
  Plus,
  ShoppingCart,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StaggerContainer, StaggerItem } from "@/components/motion";
import { EmptyState } from "@/components/empty-state";
import { Money, Num } from "@/components/dinero";
import { formatDate } from "@/lib/format";
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
      <span className="text-2xs text-muted-foreground">
        sin mes anterior para comparar
      </span>
    );
  }
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-2xs",
        up ? "text-success" : "text-destructive",
      )}
    >
      {up ? (
        <TrendingUp className="size-3" />
      ) : (
        <TrendingDown className="size-3" />
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
      <PageHeader
        route="/dashboard"
        // Quien solo ve lo suyo no deberia leer "vista general de tu negocio":
        // las cifras de abajo son las suyas, no las del negocio.
        description={
          soloPropias
            ? "Lo que registraste tú, no el total del negocio"
            : undefined
        }
      />
      {monedas.length === 0 ? (
        <EmptyState
          icon={<Plus className="size-5" />}
          title={
            soloPropias
              ? "Todavía no registraste movimientos este mes"
              : "Todavía no hay movimientos este mes"
          }
          description="Registra tu primer ingreso o gasto y los números aparecen aquí."
          action={
            <>
              <Button size="sm" asChild>
                <Link href="/finanzas/ingresos">Registrar ingreso</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/finanzas/gastos">Registrar gasto</Link>
              </Button>
            </>
          }
        />
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
                      <Badge variant="outline" className="font-mono text-2xs">
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
                        <Money
                          value={m.ingresos}
                          currency={m.currency}
                          tone="success"
                          className="text-base font-semibold"
                        />
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
                        <Money
                          value={m.gastos}
                          currency={m.currency}
                          tone="destructive"
                          className="text-base font-semibold"
                        />
                      </div>
                      <div className="flex justify-end">
                        <Change value={m.gastosChange} />
                      </div>
                    </div>

                    <div className="flex items-baseline justify-between border-t pt-2">
                      <span className="text-xs font-medium">Balance</span>
                      <Money
                        value={m.balance}
                        currency={m.currency}
                        tone={Number(m.balance) < 0 ? "destructive" : "default"}
                        className="text-base font-bold"
                      />
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
                    <ArrowUpRight className="size-4" />
                  ) : (
                    <ArrowDownRight className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {r.concept}
                    {r.kind !== "operacion" && (
                      <Badge variant="secondary" className="ml-1.5 text-2xs">
                        {r.kind === "venta" ? "Venta" : "Compra"}
                      </Badge>
                    )}
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {r.categoryLabel} · {formatDate(r.occurredOn)}
                  </p>
                </div>
                <Money
                  value={r.amount}
                  currency={r.currency}
                  tone={r.type === "ingreso" ? "success" : "destructive"}
                  className="shrink-0 text-sm font-medium"
                />
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
                  <ArrowUpRight className="size-4" />
                  Ingreso
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="justify-start" asChild>
                <Link href="/finanzas/gastos">
                  <ArrowDownRight className="size-4" />
                  Gasto
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="justify-start" asChild>
                <Link href="/productos">
                  <Package className="size-4" />
                  Producto
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="justify-start" asChild>
                <Link href="/inventario">
                  <ShoppingCart className="size-4" />
                  Inventario
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <TriangleAlert className="size-4 text-warning" />
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
                        "shrink-0 text-2xs",
                        a.status === "sin_stock"
                          ? "border-destructive/20 bg-destructive/10 text-destructive"
                          : "border-warning/20 bg-warning/10 text-warning",
                      )}
                    >
                      <Num value={a.stock} />
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
