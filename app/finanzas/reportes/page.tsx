"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PageTransition,
  StaggerContainer,
  StaggerItem,
} from "@/components/motion";
import {
  monthlyData,
  expensesByCategory,
  formatCurrency,
  getCurrentMonthIncome,
  getCurrentMonthExpenses,
} from "@/lib/mock-data";
import {
  IconTrendingUp,
  IconTrendingDown,
  IconChartPie,
  IconChartBar,
} from "@tabler/icons-react";

const COLORS = [
  "oklch(0.55 0.18 264)",
  "oklch(0.64 0.17 160)",
  "oklch(0.75 0.16 85)",
  "oklch(0.60 0.20 300)",
  "oklch(0.65 0.22 20)",
  "oklch(0.50 0.15 200)",
  "oklch(0.70 0.14 130)",
  "oklch(0.58 0.12 50)",
];

export default function ReportesPage() {
  const last6 = monthlyData.slice(-6);
  const income = getCurrentMonthIncome();
  const expenses = getCurrentMonthExpenses();
  const profit = income - expenses;
  const margin = income > 0 ? Math.round((profit / income) * 100) : 0;

  // Cumulative profit data
  const profitData = last6.map((m) => ({
    ...m,
    profit: m.income - m.expenses,
  }));

  return (
    <PageTransition>
      <div className="space-y-4 max-w-7xl mx-auto">
        <div>
          <h2 className="text-lg font-bold">Reportes Financieros</h2>
          <p className="text-sm text-muted-foreground">
            Análisis detallado de tu desempeño financiero
          </p>
        </div>

        {/* Quick metrics */}
        <StaggerContainer className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StaggerItem>
            <Card className="border-border/50 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <IconTrendingUp className="size-3.5 text-success" />
                  <span className="text-xs text-muted-foreground">
                    Ingresos totales
                  </span>
                </div>
                <p className="text-xl font-bold text-success">
                  {formatCurrency(income)}
                </p>
              </CardContent>
            </Card>
          </StaggerItem>
          <StaggerItem>
            <Card className="border-border/50 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <IconTrendingDown className="size-3.5 text-destructive" />
                  <span className="text-xs text-muted-foreground">
                    Gastos totales
                  </span>
                </div>
                <p className="text-xl font-bold text-destructive">
                  {formatCurrency(expenses)}
                </p>
              </CardContent>
            </Card>
          </StaggerItem>
          <StaggerItem>
            <Card className="border-border/50 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <IconChartBar className="size-3.5 text-primary" />
                  <span className="text-xs text-muted-foreground">
                    Utilidad neta
                  </span>
                </div>
                <p className="text-xl font-bold">{formatCurrency(profit)}</p>
              </CardContent>
            </Card>
          </StaggerItem>
          <StaggerItem>
            <Card className="border-border/50 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <IconChartPie className="size-3.5 text-warning" />
                  <span className="text-xs text-muted-foreground">
                    Margen de utilidad
                  </span>
                </div>
                <p className="text-xl font-bold">{margin}%</p>
              </CardContent>
            </Card>
          </StaggerItem>
        </StaggerContainer>

        {/* Charts grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Revenue vs Expenses */}
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Comparativa mensual
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={last6}
                    margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="var(--border)"
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      dataKey="shortMonth"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(value) => [formatCurrency(Number(value)), ""]}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: "11px" }}
                    />
                    <Bar
                      dataKey="income"
                      name="Ingresos"
                      fill="var(--chart-2)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={28}
                    />
                    <Bar
                      dataKey="expenses"
                      name="Gastos"
                      fill="var(--chart-5)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={28}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Profit trend */}
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Tendencia de utilidad
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={profitData}
                    margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="profitGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="var(--chart-1)"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="var(--chart-1)"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="var(--border)"
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      dataKey="shortMonth"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(value) => [formatCurrency(Number(value)), ""]}
                    />
                    <Area
                      type="monotone"
                      dataKey="profit"
                      name="Utilidad"
                      stroke="var(--chart-1)"
                      fill="url(#profitGradient)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Expense distribution */}
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Distribución de gastos por categoría
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6">
                <div className="h-[220px] w-[220px] flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={expensesByCategory}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="amount"
                        nameKey="category"
                        strokeWidth={0}
                      >
                        {expensesByCategory.map((_, i) => (
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
                  {expensesByCategory.map((item, i) => {
                    const total = expensesByCategory.reduce(
                      (s, e) => s + e.amount,
                      0,
                    );
                    return (
                      <div
                        key={item.category}
                        className="flex items-center gap-2 text-xs"
                      >
                        <div
                          className="size-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: COLORS[i % COLORS.length] }}
                        />
                        <span className="flex-1 truncate text-muted-foreground">
                          {item.category}
                        </span>
                        <span className="font-medium tabular-nums">
                          {formatCurrency(item.amount)}
                        </span>
                        <span className="text-muted-foreground w-8 text-right tabular-nums">
                          {Math.round((item.amount / total) * 100)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Monthly income breakdown */}
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Resumen por periodo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {last6.map((month) => {
                  const profit = month.income - month.expenses;
                  const maxVal = Math.max(...last6.map((m) => m.income));
                  const width = (month.income / maxVal) * 100;
                  return (
                    <div key={month.month} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">
                          {month.shortMonth} {month.month.split("-")[0]}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-success tabular-nums">
                            {formatCurrency(month.income)}
                          </span>
                          <span className="text-destructive tabular-nums">
                            {formatCurrency(month.expenses)}
                          </span>
                          <span
                            className={`font-semibold tabular-nums ${profit >= 0 ? "text-success" : "text-destructive"}`}
                          >
                            {formatCurrency(profit)}
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/60 transition-all"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageTransition>
  );
}

