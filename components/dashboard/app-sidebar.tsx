"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";

import { SidebarNav } from "./sidebar-nav";
import { SidebarUser } from "./sidebar-user";
import { IconBolt } from "@tabler/icons-react";

export function AppSidebar() {
  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border bg-sidebar"
    >
      <SidebarHeader className="p-4 pb-2">
        <div className="flex shrink-0 items-center gap-2.5 px-1">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <IconBolt className="size-4" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-bold tracking-tight text-sidebar-foreground">
              Ray App
            </span>
            <span className="text-[11px] tracking-wide text-sidebar-foreground/60">
              Gestión moderna para tu negocio
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarNav />
      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarUser />
      </SidebarFooter>
    </Sidebar>
  );
}
