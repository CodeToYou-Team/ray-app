"use client";

import { usePathname } from "next/navigation";
import { IconBell, IconSearch } from "@tabler/icons-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

const routeTitles: Record<string, { title: string; description: string }> = {
  "/dashboard": { title: "Inicio", description: "Vista general de tu negocio" },
  "/finanzas": { title: "Finanzas", description: "Gestión financiera" },
  "/finanzas/ingresos": {
    title: "Ingresos",
    description: "Registro y seguimiento de ingresos",
  },
  "/finanzas/gastos": {
    title: "Gastos",
    description: "Registro y seguimiento de gastos",
  },
  "/finanzas/movimientos": {
    title: "Movimientos",
    description: "Todos los movimientos financieros",
  },
  "/finanzas/calendario": {
    title: "Calendario",
    description: "Eventos financieros programados",
  },
  "/finanzas/reportes": {
    title: "Reportes",
    description: "Análisis y reportes financieros",
  },
  "/finanzas/historial": {
    title: "Historial",
    description: "Historial financiero por periodo",
  },
  "/productos": {
    title: "Productos y Servicios",
    description: "Gestión de catálogo",
  },
  "/productos/nuevo": {
    title: "Nuevo Producto",
    description: "Registrar un nuevo producto",
  },
  "/productos/servicios/nuevo": {
    title: "Nuevo Servicio",
    description: "Registrar un nuevo servicio",
  },
  "/inventario": { title: "Inventario", description: "Stock disponible" },
  "/inventario/catalogo-productos": {
    title: "Catálogo de Productos",
    description: "Vista de catálogo completo",
  },
  "/inventario/catalogo-servicios": {
    title: "Catálogo de Servicios",
    description: "Servicios disponibles",
  },
  "/inventario/impacto": {
    title: "Impacto en Ingresos",
    description: "Relación inventario-ventas",
  },
  "/inventario/alertas": {
    title: "Alertas de Inventario",
    description: "Notificaciones de stock",
  },
};

export function Header() {
  const pathname = usePathname();
  const route = routeTitles[pathname] || {
    title: "Ray Finance",
    description: "",
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/70 bg-background/85 backdrop-blur-lg px-4 md:px-6">
      <SidebarTrigger className="-ml-1 rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground" />
      <Separator orientation="vertical" className="h-5" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-base font-semibold leading-none tracking-tight">
              {route.title}
            </h1>
            {route.description && (
              <p className="text-xs text-muted-foreground mt-1 hidden sm:block">
                {route.description}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="relative hidden md:block">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            className="h-9 w-56 pl-9 text-xs bg-card/75 border-border/60 shadow-[0_1px_0_0_color-mix(in_oklch,var(--foreground)_3%,transparent)_inset] focus-visible:ring-2"
          />
        </div>

        <Button
          variant="outline"
          size="icon"
          className="relative size-9 border-border/70 bg-card/75 hover:bg-muted/60"
        >
          <IconBell className="size-4 text-muted-foreground" />
          <Badge className="absolute -top-0.5 -right-0.5 size-4 p-0 flex items-center justify-center text-[9px] bg-primary text-primary-foreground border-2 border-background">
            3
          </Badge>
        </Button>
      </div>
    </header>
  );
}
