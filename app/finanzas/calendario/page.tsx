"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageTransition } from "@/components/motion";
import { calendarEvents, formatCurrency } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import {
  IconCalendar,
  IconCreditCard,
  IconArrowUpRight,
  IconClock,
  IconBell,
} from "@tabler/icons-react";

const typeConfig = {
  pago: {
    label: "Pago",
    color: "bg-destructive/10 text-destructive",
    icon: IconCreditCard,
  },
  cobro: {
    label: "Cobro",
    color: "bg-success/10 text-success",
    icon: IconArrowUpRight,
  },
  vencimiento: {
    label: "Vencimiento",
    color: "bg-warning/10 text-warning",
    icon: IconClock,
  },
  recordatorio: {
    label: "Recordatorio",
    color: "bg-info/10 text-info",
    icon: IconBell,
  },
};

// Group events by week
function groupByWeek(events: typeof calendarEvents) {
  const weeks: Record<string, typeof calendarEvents> = {};
  events.forEach((ev) => {
    const date = new Date(ev.date + "T00:00:00");
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const key = weekStart.toISOString().split("T")[0];
    if (!weeks[key]) weeks[key] = [];
    weeks[key].push(ev);
  });
  return Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b));
}

export default function CalendarioPage() {
  const weeks = groupByWeek(calendarEvents);

  const totalPagos = calendarEvents
    .filter((e) => e.type === "pago" && e.amount)
    .reduce((s, e) => s + (e.amount || 0), 0);
  const totalCobros = calendarEvents
    .filter((e) => e.type === "cobro" && e.amount)
    .reduce((s, e) => s + (e.amount || 0), 0);

  return (
    <PageTransition>
      <div className="space-y-4 max-w-7xl mx-auto">
        <div>
          <h2 className="text-lg font-bold">Calendario Financiero</h2>
          <p className="text-sm text-muted-foreground">
            Pagos programados, cobros esperados y fechas clave — Abril 2026
          </p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="border-border/50 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <IconCreditCard className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Pagos programados
                </p>
                <p className="text-lg font-bold text-destructive">
                  {formatCurrency(totalPagos)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-success/10 text-success">
                <IconArrowUpRight className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Cobros esperados
                </p>
                <p className="text-lg font-bold text-success">
                  {formatCurrency(totalCobros)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <IconCalendar className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Eventos del mes</p>
                <p className="text-lg font-bold">{calendarEvents.length}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Events grouped by week */}
        <div className="space-y-4">
          {weeks.map(([weekKey, events]) => {
            const weekDate = new Date(weekKey + "T00:00:00");
            const weekEnd = new Date(weekDate);
            weekEnd.setDate(weekDate.getDate() + 6);
            const formatter = new Intl.DateTimeFormat("es-MX", {
              day: "numeric",
              month: "short",
            });

            return (
              <Card key={weekKey} className="border-border/50 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                    Semana del {formatter.format(weekDate)} al{" "}
                    {formatter.format(weekEnd)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-1">
                  {events
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((event) => {
                      const config = typeConfig[event.type];
                      const Icon = config.icon;
                      const date = new Date(event.date + "T00:00:00");

                      return (
                        <div
                          key={event.id}
                          className="flex items-center gap-3 py-2.5 border-b border-border/30 last:border-0"
                        >
                          <div className="text-center w-10 flex-shrink-0">
                            <p className="text-lg font-bold leading-none">
                              {date.getDate()}
                            </p>
                            <p className="text-[10px] text-muted-foreground uppercase">
                              {date.toLocaleDateString("es-MX", {
                                weekday: "short",
                              })}
                            </p>
                          </div>
                          <div
                            className={cn(
                              "flex size-8 items-center justify-center rounded-lg flex-shrink-0",
                              config.color,
                            )}
                          >
                            <Icon className="size-3.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{event.title}</p>
                            {event.description && (
                              <p className="text-xs text-muted-foreground truncate">
                                {event.description}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {event.amount && (
                              <span
                                className={cn(
                                  "text-sm font-semibold tabular-nums",
                                  event.type === "cobro"
                                    ? "text-success"
                                    : event.type === "pago"
                                      ? "text-destructive"
                                      : "",
                                )}
                              >
                                {formatCurrency(event.amount)}
                              </span>
                            )}
                            <Badge
                              variant="secondary"
                              className="text-[10px] font-normal"
                            >
                              {config.label}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </PageTransition>
  );
}

