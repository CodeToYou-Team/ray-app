"use client";

import {
  IconAlertTriangle,
  IconPackageOff,
  IconInfoCircle,
} from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import { inventoryAlerts, calendarEvents } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import Link from "next/link";

export function AlertsBanner() {
  const activeAlerts = inventoryAlerts.filter((a) => !a.resolved);
  const upcomingPayments = calendarEvents
    .filter((e) => e.type === "vencimiento")
    .slice(0, 2);

  if (activeAlerts.length === 0 && upcomingPayments.length === 0) return null;

  return (
    <Card className="border-warning/35 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--warning)_10%,white)_0%,color-mix(in_oklch,var(--warning)_4%,white)_100%)] shadow-[0_1px_1px_color-mix(in_oklch,var(--foreground)_7%,transparent),0_12px_26px_-20px_color-mix(in_oklch,var(--warning)_26%,transparent)]">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-warning/14 text-warning ring-1 ring-warning/20 flex-shrink-0">
            <IconAlertTriangle className="size-4" />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm font-semibold tracking-tight">
              Atención requerida
            </p>
            <div className="space-y-1.5">
              {activeAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <IconPackageOff
                    className={cn(
                      "size-3.5 flex-shrink-0",
                      alert.type === "no_stock"
                        ? "text-destructive"
                        : "text-warning",
                    )}
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      {alert.productName}
                    </span>{" "}
                    —{" "}
                    {alert.type === "no_stock"
                      ? "Sin stock"
                      : `Stock bajo (${alert.currentStock} uds)`}
                  </span>
                </div>
              ))}
              {upcomingPayments.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <IconInfoCircle className="size-3.5 flex-shrink-0 text-info" />
                  <span>
                    <span className="font-medium text-foreground">
                      {event.title}
                    </span>{" "}
                    — vence {event.date}
                  </span>
                </div>
              ))}
            </div>
            <Link
              href="/inventario/alertas"
              className="text-xs font-medium text-primary hover:underline"
            >
              Ver todas las alertas
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
