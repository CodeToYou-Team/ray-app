"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PageTransition,
  StaggerContainer,
  StaggerItem,
} from "@/components/motion";
import { getTopProducts, products, formatCurrency } from "@/lib/mock-data";
import { IconTrendingUp, IconAward, IconRefresh } from "@tabler/icons-react";

const COLORS = [
  "oklch(0.55 0.18 264)",
  "oklch(0.64 0.17 160)",
  "oklch(0.75 0.16 85)",
  "oklch(0.60 0.20 300)",
  "oklch(0.65 0.22 20)",
];

export default function ImpactoPage() {
  const topProducts = getTopProducts();

  // Margin per product
  const marginData = products
    .filter((p) => p.active)
    .map((p) => ({
      name: p.name.length > 18 ? p.name.slice(0, 18) + "…" : p.name,
      margin: Math.round(((p.salePrice - p.purchasePrice) / p.salePrice) * 100),
      profit: p.salePrice - p.purchasePrice,
    }))
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 6);

  // Revenue by product (pie)
  const revenueData = topProducts.map((p) => ({
    name: p.name.length > 20 ? p.name.slice(0, 20) + "…" : p.name,
    value: p.revenue,
  }));

  const totalRevenue = topProducts.reduce((s, p) => s + p.revenue, 0);

  return (
    <PageTransition>
      <div className="space-y-4 max-w-7xl mx-auto">
        <div>
          <h2 className="text-lg font-bold">Impacto en Ingresos</h2>
          <p className="text-sm text-muted-foreground">
            Relación entre productos, servicios e ingresos generados
          </p>
        </div>

        {/* Top products */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <IconAward className="size-4 text-warning" />
              <CardTitle className="text-sm font-semibold">
                Productos más vendidos
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <StaggerContainer className="space-y-2">
              {topProducts.map((product, index) => (
                <StaggerItem key={product.name}>
                  <div className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                    <span className="text-lg font-bold text-muted-foreground/50 w-8 text-center tabular-nums">
                      {index + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {product.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {product.units} unidades vendidas
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-success tabular-nums">
                        {formatCurrency(product.revenue)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {Math.round((product.revenue / totalRevenue) * 100)}%
                        del total
                      </p>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Revenue distribution */}
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <IconTrendingUp className="size-4 text-success" />
                <CardTitle className="text-sm font-semibold">
                  Distribución de ingresos por producto
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="h-[220px] w-[220px] flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={revenueData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {revenueData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--popover)",
                          border: "1px solid var(--border)",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        formatter={(value) => [
                          formatCurrency(Number(value)),
                          "",
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2">
                  {revenueData.map((item, i) => (
                    <div
                      key={item.name}
                      className="flex items-center gap-2 text-xs"
                    >
                      <div
                        className="size-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      <span className="truncate text-muted-foreground flex-1">
                        {item.name}
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatCurrency(item.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Margin chart */}
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <IconRefresh className="size-4 text-primary" />
                <CardTitle className="text-sm font-semibold">
                  Margen por producto
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={marginData}
                    layout="vertical"
                    margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke="var(--border)"
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      type="number"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickFormatter={(v) => `${v}%`}
                      domain={[0, 100]}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      width={120}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(value) => [`${value}%`, "Margen"]}
                    />
                    <Bar
                      dataKey="margin"
                      fill="var(--chart-1)"
                      radius={[0, 4, 4, 0]}
                      maxBarSize={20}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageTransition>
  );
}

