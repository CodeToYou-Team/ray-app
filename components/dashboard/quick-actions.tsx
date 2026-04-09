"use client";

import Link from "next/link";
import {
  IconArrowUpRight,
  IconArrowDownRight,
  IconPackage,
  IconBuildingWarehouse,
  IconChartBar,
  IconPlus,
} from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const actions = [
  {
    label: "Registrar ingreso",
    href: "/finanzas/ingresos",
    icon: IconArrowUpRight,
    color: "bg-success/10 text-success hover:bg-success/20",
  },
  {
    label: "Registrar gasto",
    href: "/finanzas/gastos",
    icon: IconArrowDownRight,
    color: "bg-destructive/10 text-destructive hover:bg-destructive/20",
  },
  {
    label: "Nuevo producto",
    href: "/productos/nuevo",
    icon: IconPlus,
    color: "bg-primary/10 text-primary hover:bg-primary/20",
  },
  {
    label: "Ver inventario",
    href: "/inventario",
    icon: IconBuildingWarehouse,
    color: "bg-warning/10 text-warning hover:bg-warning/20",
  },
  {
    label: "Ver reportes",
    href: "/finanzas/reportes",
    icon: IconChartBar,
    color: "bg-info/10 text-info hover:bg-info/20",
  },
  {
    label: "Catálogo",
    href: "/inventario/catalogo-productos",
    icon: IconPackage,
    color: "bg-chart-4/10 text-chart-4 hover:bg-chart-4/20",
  },
];

export function QuickActions() {
  return (
    <Card className="border-border/60 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--card)_96%,white)_0%,var(--card)_100%)] shadow-[0_1px_1px_color-mix(in_oklch,var(--foreground)_7%,transparent),0_10px_26px_-20px_color-mix(in_oklch,var(--foreground)_25%,transparent)]">
      <CardContent className="p-4">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.12em] mb-3">
          Accesos rápidos
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {actions.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className={cn(
                "group flex items-center gap-2 rounded-lg border border-transparent px-3 py-2.5 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5",
                action.color,
              )}
            >
              <action.icon className="size-3.5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
              <span className="truncate">{action.label}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
