"use client";

import Image from "next/image";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";

import { SidebarNav } from "./sidebar-nav";
import { SidebarUser, type SidebarUserProps } from "./sidebar-user";
import type { MembershipRole } from "@/lib/db/schema";

export function AppSidebar({
  user,
  role,
}: {
  user: SidebarUserProps;
  role: MembershipRole;
}) {
  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border bg-sidebar"
    >
      <SidebarHeader className="p-4 pb-2 group-data-[collapsible=icon]:p-2">
        <div className="flex flex-col gap-2 px-1">
          {/*
            El logo completo, tal como esta dibujado: el rayo y la palabra RAY.
            Va invertido en tema claro porque la marca es blanca; sobre el fondo
            del sidebar (casi blanco) seria invisible. En el rail colapsado se
            encoge solo: object-contain lo mete en 48px sin deformarlo.
          */}
          <Image
            src="/ray-logo-outlined.svg"
            alt="Ray App"
            width={2611}
            height={1201}
            unoptimized
            priority
            className="h-7 w-auto max-w-full object-contain invert dark:invert-0"
          />
          <span className="text-2xs tracking-wide text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
            Gestión moderna para tu negocio
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarNav role={role} />
      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarUser {...user} />
      </SidebarFooter>
    </Sidebar>
  );
}
