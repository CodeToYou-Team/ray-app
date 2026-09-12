"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageTransition } from "@/components/motion";
import { monthlyData, formatCurrency } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import {
  IconTrendingUp,
  IconTrendingDown,
  IconMinus,
} from "@tabler/icons-react";

export default function HistorialPage() {
  // Group by year
  const byYear: Record<string, typeof monthlyData> = {};
  monthlyData.forEach((m) => {
    const year = m.month.split("-")[0];
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(m);
  });

  const years = Object.entries(byYear).sort(([a], [b]) => b.localeCompare(a));

  return (
    <PageTransition>
      <div className="space-y-4 max-w-7xl mx-auto">
        <div>
          <h2 className="text-lg font-bold">Historial Financiero</h2>
          <p className="text-sm text-muted-foreground">
            Resumen histórico por periodo con comparaciones
          </p>
        </div>

        {years.map(([year, months]) => {
          const totalIncome = months.reduce((s, m) => s + m.income, 0);
          const totalExpenses = months.reduce((s, m) => s + m.expenses, 0);
          const totalProfit = totalIncome - totalExpenses;

          return (
            <Card key={year} className="border-border/50 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-bold">{year}</CardTitle>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-muted-foreground">
                      Ingresos:{" "}
                      <span className="font-semibold text-success">
                        {formatCurrency(totalIncome)}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      Gastos:{" "}
                      <span className="font-semibold text-destructive">
                        {formatCurrency(totalExpenses)}
                      </span>
                    </span>
                    <Badge
                      variant={totalProfit >= 0 ? "default" : "destructive"}
                      className="text-xs font-semibold"
                    >
                      {totalProfit >= 0 ? "+" : ""}
                      {formatCurrency(totalProfit)}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-0">
                  {months.map((month, idx) => {
                    const profit = month.income - month.expenses;
                    const prevMonth = idx > 0 ? months[idx - 1] : null;
                    const incomeChange = prevMonth
                      ? Math.round(
                          ((month.income - prevMonth.income) /
                            prevMonth.income) *
                            100,
                        )
                      : 0;

                    return (
                      <div
                        key={month.month}
                        className="flex items-center gap-4 py-3 border-b border-border/30 last:border-0"
                      >
                        <div className="w-12 text-center">
                          <span className="text-sm font-bold">
                            {month.shortMonth}
                          </span>
                        </div>

                        <div className="flex-1 grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Ingresos
                            </p>
                            <p className="font-semibold text-success tabular-nums">
                              {formatCurrency(month.income)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Gastos
                            </p>
                            <p className="font-semibold text-destructive tabular-nums">
                              {formatCurrency(month.expenses)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Balance
                            </p>
                            <p
                              className={cn(
                                "font-semibold tabular-nums",
                                profit >= 0
                                  ? "text-foreground"
                                  : "text-destructive",
                              )}
                            >
                              {formatCurrency(profit)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 w-20 justify-end">
                          {prevMonth ? (
                            <span
                              className={cn(
                                "inline-flex items-center gap-0.5 text-xs font-medium rounded-full px-1.5 py-0.5",
                                incomeChange >= 0
                                  ? "bg-success/10 text-success"
                                  : "bg-destructive/10 text-destructive",
                              )}
                            >
                              {incomeChange >= 0 ? (
                                <IconTrendingUp className="size-3" />
                              ) : (
                                <IconTrendingDown className="size-3" />
                              )}
                              {incomeChange > 0 ? "+" : ""}
                              {incomeChange}%
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-xs rounded-full px-1.5 py-0.5 bg-muted text-muted-foreground">
                              <IconMinus className="size-3" />
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PageTransition>
  );
}

