"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconLayoutDashboard,
  IconWallet,
  IconPackage,
  IconBuildingWarehouse,
  IconSettings,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar";

interface NavItem {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  children?: { name: string; href: string }[];
}

const navItems: NavItem[] = [
  {
    name: "Inicio",
    href: "/dashboard",
    icon: IconLayoutDashboard,
  },
  {
    name: "Finanzas",
    href: "/finanzas",
    icon: IconWallet,
    children: [
      { name: "Ingresos", href: "/finanzas/ingresos" },
      { name: "Gastos", href: "/finanzas/gastos" },
      { name: "Movimientos", href: "/finanzas/movimientos" },
      { name: "Calendario", href: "/finanzas/calendario" },
      { name: "Reportes", href: "/finanzas/reportes" },
      { name: "Historial", href: "/finanzas/historial" },
    ],
  },
  {
    name: "Productos",
    href: "/productos",
    icon: IconPackage,
  },
  {
    name: "Inventario",
    href: "/inventario",
    icon: IconBuildingWarehouse,
    children: [
      { name: "Stock", href: "/inventario" },
      { name: "Catálogo Productos", href: "/inventario/catalogo-productos" },
      { name: "Catálogo Servicios", href: "/inventario/catalogo-servicios" },
      { name: "Impacto", href: "/inventario/impacto" },
      { name: "Alertas", href: "/inventario/alertas" },
    ],
  },
];

const bottomItems: NavItem[] = [
  {
    name: "Configuración",
    href: "/configuracion",
    icon: IconSettings,
  },
];

export function SidebarNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const isGroupActive = (item: NavItem) => {
    if (isActive(item.href)) return true;
    return item.children?.some((c) => isActive(c.href)) ?? false;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1">
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10px] uppercase tracking-widest font-semibold mb-1">
            Principal
          </SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => (
              <SidebarMenuItem key={item.name}>
                <SidebarMenuButton
                  asChild
                  isActive={isGroupActive(item)}
                  tooltip={item.name}
                  className="transition-all duration-200 data-[active=true]:bg-sidebar-primary/18 data-[active=true]:text-sidebar-foreground data-[active=true]:shadow-[0_0_0_1px_color-mix(in_oklch,var(--sidebar-primary)_26%,transparent)_inset] hover:bg-sidebar-accent/80"
                >
                  <Link href={item.href}>
                    <item.icon className="size-4" />
                    <span>{item.name}</span>
                  </Link>
                </SidebarMenuButton>
                {item.children && isGroupActive(item) && (
                  <SidebarMenuSub>
                    {item.children.map((child) => (
                      <SidebarMenuSubItem key={child.href}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={isActive(child.href)}
                          className="data-[active=true]:text-sidebar-foreground data-[active=true]:font-medium"
                        >
                          <Link href={child.href}>
                            <span>{child.name}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </div>

      <SidebarGroup>
        <SidebarMenu>
          {bottomItems.map((item) => (
            <SidebarMenuItem key={item.name}>
              <SidebarMenuButton
                asChild
                isActive={isActive(item.href)}
                tooltip={item.name}
                className="transition-all duration-200 data-[active=true]:bg-sidebar-primary/18 data-[active=true]:text-sidebar-foreground hover:bg-sidebar-accent/80"
              >
                <Link href={item.href}>
                  <item.icon className="size-4" />
                  <span>{item.name}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
    </div>
  );
}
