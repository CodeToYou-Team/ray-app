"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { expensesByCategory, formatCurrency } from "@/lib/mock-data";

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

export function ExpensesPieChart() {
  const total = expensesByCategory.reduce((sum, item) => sum + item.amount, 0);

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">
            Distribución de Gastos
          </CardTitle>
          <span className="text-xs text-muted-foreground">Marzo 2026</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center gap-4">
          <div className="h-[200px] w-[200px] flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={expensesByCategory}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="amount"
                  nameKey="category"
                  strokeWidth={0}
                >
                  {expensesByCategory.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(value) => [formatCurrency(Number(value)), ""]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-1.5 min-w-0">
            {expensesByCategory.slice(0, 6).map((item, index) => (
              <div
                key={item.category}
                className="flex items-center gap-2 text-xs"
              >
                <div
                  className="size-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                <span className="truncate text-muted-foreground flex-1">
                  {item.category}
                </span>
                <span className="font-medium tabular-nums">
                  {Math.round((item.amount / total) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
