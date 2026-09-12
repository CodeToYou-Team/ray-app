"use client";

import {
  IconAlertTriangle,
  IconPackageOff,
  IconPackage,
  IconCircleCheck,
  IconBell,
} from "@tabler/icons-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PageTransition,
  StaggerContainer,
  StaggerItem,
} from "@/components/motion";
import { inventoryAlerts, formatDate } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const typeConfig = {
  no_stock: {
    icon: IconPackageOff,
    label: "Sin stock",
    color: "text-destructive",
    bg: "bg-destructive/10",
    badge: "bg-destructive/10 text-destructive",
  },
  low_stock: {
    icon: IconAlertTriangle,
    label: "Stock bajo",
    color: "text-warning",
    bg: "bg-warning/10",
    badge: "bg-warning/10 text-warning",
  },
  overstock: {
    icon: IconPackage,
    label: "Exceso",
    color: "text-info",
    bg: "bg-info/10",
    badge: "bg-info/10 text-info",
  },
};

export default function AlertasPage() {
  const active = inventoryAlerts.filter((a) => !a.resolved);
  const resolved = inventoryAlerts.filter((a) => a.resolved);

  return (
    <PageTransition>
      <div className="space-y-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Alertas de Inventario</h2>
            <p className="text-sm text-muted-foreground">
              Notificaciones sobre el estado de tu stock
            </p>
          </div>
          <Badge variant="destructive" className="text-xs">
            {active.length} activa{active.length !== 1 ? "s" : ""}
          </Badge>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-destructive/30 bg-destructive/5 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <IconPackageOff className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sin stock</p>
                <p className="text-xl font-bold text-destructive">
                  {active.filter((a) => a.type === "no_stock").length}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-warning/30 bg-warning/5 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-warning/10 text-warning">
                <IconAlertTriangle className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Stock bajo</p>
                <p className="text-xl font-bold text-warning">
                  {active.filter((a) => a.type === "low_stock").length}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-success/30 bg-success/5 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-success/10 text-success">
                <IconCircleCheck className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Resueltas</p>
                <p className="text-xl font-bold text-success">
                  {resolved.length}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Active alerts */}
        {active.length > 0 && (
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <IconBell className="size-4 text-warning" />
                <CardTitle className="text-sm font-semibold">
                  Alertas activas
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <StaggerContainer className="space-y-1">
                {active.map((alert) => {
                  const config = typeConfig[alert.type];
                  const Icon = config.icon;

                  return (
                    <StaggerItem key={alert.id}>
                      <div className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0">
                        <div
                          className={cn(
                            "flex size-9 items-center justify-center rounded-lg flex-shrink-0",
                            config.bg,
                          )}
                        >
                          <Icon className={cn("size-4", config.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold">
                              {alert.productName}
                            </p>
                            <Badge
                              variant="secondary"
                              className={cn("text-[10px]", config.badge)}
                            >
                              {config.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Stock actual:{" "}
                            <span className="font-medium">
                              {alert.currentStock}
                            </span>{" "}
                            · Stock mínimo:{" "}
                            <span className="font-medium">
                              {alert.minStock}
                            </span>{" "}
                            · Detectada: {formatDate(alert.date)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                          >
                            Reabastecer
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                          >
                            Resolver
                          </Button>
                        </div>
                      </div>
                    </StaggerItem>
                  );
                })}
              </StaggerContainer>
            </CardContent>
          </Card>
        )}

        {/* Resolved alerts */}
        {resolved.length > 0 && (
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <IconCircleCheck className="size-4 text-success" />
                <CardTitle className="text-sm font-semibold">
                  Historial de alertas resueltas
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-1">
                {resolved.map((alert) => {
                  const config = typeConfig[alert.type];
                  const Icon = config.icon;

                  return (
                    <div
                      key={alert.id}
                      className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0 opacity-60"
                    >
                      <div className="flex size-9 items-center justify-center rounded-lg bg-muted flex-shrink-0">
                        <Icon className="size-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">
                            {alert.productName}
                          </p>
                          <Badge variant="secondary" className="text-[10px]">
                            Resuelta
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {config.label} · {formatDate(alert.date)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {active.length === 0 && resolved.length === 0 && (
          <div className="text-center py-16">
            <IconCircleCheck className="size-12 mx-auto mb-3 text-success/30" />
            <p className="text-sm font-medium text-muted-foreground">
              No hay alertas de inventario
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Tu inventario está en buen estado
            </p>
          </div>
        )}
      </div>
    </PageTransition>
  );
}

