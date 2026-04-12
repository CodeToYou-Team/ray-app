"use client";

import { IconArrowUpRight, IconArrowDownRight } from "@tabler/icons-react";
import type { ComponentType } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: string;
  change: number;
  changeLabel: string;
  icon: ComponentType<{ className?: string }>;
  trend: "up" | "down" | "neutral";
  accentColor?: "default" | "success" | "destructive" | "warning";
}

const accentMap = {
  default: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
};

export function KpiCard({
  title,
  value,
  change,
  changeLabel,
  icon: Icon,
  trend,
  accentColor = "default",
}: KpiCardProps) {
  const isPositive = trend === "up";

  return (
    <Card className="group relative overflow-hidden border-border/60 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--card)_97%,white)_0%,var(--card)_100%)] shadow-[0_1px_1px_color-mix(in_oklch,var(--foreground)_7%,transparent),0_10px_26px_-18px_color-mix(in_oklch,var(--foreground)_20%,transparent)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_1px_1px_color-mix(in_oklch,var(--foreground)_8%,transparent),0_16px_34px_-16px_color-mix(in_oklch,var(--foreground)_26%,transparent)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--primary)_15%,transparent)_0%,transparent_100%)]" />
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              {title}
            </p>
            <p className="text-2xl font-bold tracking-tight text-foreground/95">
              {value}
            </p>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-xs font-medium rounded-full px-1.5 py-0.5",
                  isPositive
                    ? "bg-success/10 text-success"
                    : "bg-destructive/10 text-destructive",
                  trend === "neutral" && "bg-muted text-muted-foreground",
                )}
              >
                {trend !== "neutral" &&
                  (isPositive ? (
                    <IconArrowUpRight className="size-3" />
                  ) : (
                    <IconArrowDownRight className="size-3" />
                  ))}
                {change > 0 ? "+" : ""}
                {change}%
              </span>
              <span className="text-[11px] text-muted-foreground">
                {changeLabel}
              </span>
            </div>
          </div>
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-xl ring-1 ring-black/5",
              accentMap[accentColor],
            )}
          >
            <Icon className="size-5 transition-transform duration-300 group-hover:scale-110" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
