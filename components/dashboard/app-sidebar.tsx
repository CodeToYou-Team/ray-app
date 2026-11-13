"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";

import { SidebarNav } from "./sidebar-nav";
import { SidebarUser, type SidebarUserProps } from "./sidebar-user";
import type { MembershipRole } from "@/lib/db/schema";
import { Zap } from "lucide-react";

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
      <SidebarHeader className="p-4 pb-2">
        <div className="flex shrink-0 items-center gap-2.5 px-1">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Zap className="size-4" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="font-display text-base leading-none tracking-tight text-sidebar-foreground">
              Ray App
            </span>
            <span className="text-[11px] tracking-wide text-sidebar-foreground/60">
              Gestión moderna para tu negocio
            </span>
          </div>
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
