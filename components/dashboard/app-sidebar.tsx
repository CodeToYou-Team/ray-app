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
      <SidebarHeader className="p-4 pb-2">
        <div className="flex shrink-0 items-center gap-2.5 px-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Image
              src="/ray-mark.svg"
              alt=""
              width={561}
              height={1201}
              unoptimized
              priority
              className="h-5 w-auto"
            />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="font-display text-base font-semibold leading-none tracking-tight text-sidebar-foreground">
              Ray App
            </span>
            <span className="text-2xs tracking-wide text-sidebar-foreground/60">
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
