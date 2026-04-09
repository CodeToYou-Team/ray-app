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
      className="border-r border-sidebar-border/70 bg-[linear-gradient(165deg,color-mix(in_oklch,var(--sidebar)_82%,var(--sidebar-primary)_18%)_0%,color-mix(in_oklch,var(--sidebar)_72%,var(--sidebar-accent)_28%)_58%,color-mix(in_oklch,var(--sidebar)_74%,var(--sidebar-primary)_26%)_100%)]"
    >
      <SidebarHeader className="p-4 pb-2">
        <div className="flex items-center gap-2.5 px-1">
          <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_8px_18px_color-mix(in_oklch,var(--sidebar-primary)_32%,transparent)]">
            <IconBolt className="size-4" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-bold tracking-tight text-sidebar-foreground">
              Ray Finance
            </span>
            <span className="text-[10px] tracking-wide text-sidebar-foreground/50">
              Tu negocio bajo control
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
