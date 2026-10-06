"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { navTreeFor, navBottomFor, type NavItem } from "@/lib/nav";
import type { MembershipRole } from "@/lib/db/schema";

export function SidebarNav({ role }: { role: MembershipRole }) {
  const pathname = usePathname();
  const arriba = navTreeFor(role);
  const abajo = navBottomFor(role);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1">
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10px] uppercase tracking-widest font-semibold mb-1">
            Principal
          </SidebarGroupLabel>
          <SidebarMenu>
            {arriba.map((item) => (
              <NavEntry key={item.name} item={item} pathname={pathname} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </div>

      <SidebarGroup>
        <SidebarMenu>
          {abajo.map((item) => (
            <NavEntry key={item.name} item={item} pathname={pathname} />
          ))}
        </SidebarMenu>
      </SidebarGroup>
    </div>
  );
}

function isActive(pathname: string, href: string): boolean {
  // /dashboard es prefijo de nada, pero si se usara startsWith quedaria activo
  // en rutas que solo empiezan igual.
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

function isGroupActive(pathname: string, item: NavItem): boolean {
  if (isActive(pathname, item.href)) return true;
  return item.children?.some((c) => isActive(pathname, c.href)) ?? false;
}

/**
 * Una entrada del sidebar, con sus hijos si los tiene.
 *
 * Vive en un solo lugar a proposito: antes el bloque principal y el de abajo
 * eran dos copias casi identicas, y solo la de arriba pintaba hijos. Por eso
 * "Columnas" quedo invisible pese a estar registrada en lib/nav.ts.
 */
function NavEntry({ item, pathname }: { item: NavItem; pathname: string }) {
  const activo = isGroupActive(pathname, item);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={activo}
        tooltip={item.name}
        className="transition-all duration-200 data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground hover:bg-sidebar-primary/80 hover:text-sidebar-primary-foreground"
      >
        <Link href={item.href}>
          <item.icon className="size-4" />
          <span>{item.name}</span>
        </Link>
      </SidebarMenuButton>

      {item.children && activo && (
        <SidebarMenuSub>
          {item.children.map((child) => (
            <SidebarMenuSubItem className="p-0.5" key={child.href}>
              <SidebarMenuSubButton
                asChild
                isActive={isActive(pathname, child.href)}
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
  );
}
