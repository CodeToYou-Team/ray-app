"use client";

import { IconArrowUpRight, IconArrowDownRight } from "@tabler/icons-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getCurrentMonthTransactions,
  formatCurrency,
  formatDate,
} from "@/lib/mock-data";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function RecentTransactions() {
  const transactions = getCurrentMonthTransactions()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 7);

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">
            Movimientos Recientes
          </CardTitle>
          <Link
            href="/finanzas/movimientos"
            className="text-xs font-medium text-primary hover:underline"
          >
            Ver todos
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-1">
          {transactions.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0"
            >
              <div
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg flex-shrink-0",
                  tx.type === "ingreso"
                    ? "bg-success/10 text-success"
                    : "bg-destructive/10 text-destructive",
                )}
              >
                {tx.type === "ingreso" ? (
                  <IconArrowUpRight className="size-4" />
                ) : (
                  <IconArrowDownRight className="size-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{tx.concept}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-4 font-normal"
                  >
                    {tx.category}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDate(tx.date)}
                  </span>
                </div>
              </div>
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums flex-shrink-0",
                  tx.type === "ingreso" ? "text-success" : "text-destructive",
                )}
              >
                {tx.type === "ingreso" ? "+" : "-"}
                {formatCurrency(tx.amount)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
