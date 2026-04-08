"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";

import { SidebarNav } from "./sidebar-nav";
import { SidebarUser } from "./sidebar-user";
import { ThemeToggle } from "../theme-toggle";

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="border-b p-4">
        <h2 className="text-lg font-semibold">Ray App</h2>
        <p className="text-sm text-muted-foreground">Admin Panel</p>
        <ThemeToggle />
      </SidebarHeader>

      <SidebarContent className="p-4">
        <SidebarNav />
      </SidebarContent>

      <SidebarFooter className="border-t p-4">
        <SidebarUser />
      </SidebarFooter>
    </Sidebar>
  );
}
