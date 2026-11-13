"use client";

import {
  ChevronsUpDown,
  LogOut,
  Moon,
  Sun,
  ShieldCog,
} from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { useTheme } from "next-themes";
import { signOut } from "@/lib/authz/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

export interface SidebarUserProps {
  name: string;
  email: string;
  /** Rol dentro del cliente activo: owner, manager o staff. */
  role: string;
  /** Muestra el acceso a /admin. Es comodidad: /admin verifica por su cuenta. */
  isPlatformAdmin?: boolean;
}

/** Iniciales para el avatar. "Manuel Rodríguez" -> "MR", "ana@x.com" -> "AN". */
function initialsOf(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export function SidebarUser({ name, email, role, isPlatformAdmin }: SidebarUserProps) {
  const { setTheme, theme } = useTheme();
  const [signingOut, startSignOut] = useTransition();
  const initials = initialsOf(name, email);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="rounded-lg border border-transparent bg-sidebar-accent/35 transition-all hover:bg-sidebar-accent/70 data-[state=open]:bg-sidebar-accent data-[state=open]:border-sidebar-border/60"
            >
              <Avatar className="size-8 rounded-lg bg-sidebar-primary/20">
                <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium text-sidebar-foreground">
                  {name}
                </span>
                <span className="truncate text-xs text-sidebar-foreground/50">
                  {email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/40" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-56 rounded-lg"
            side="top"
            align="start"
            sideOffset={8}
          >
            <DropdownMenuItem
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? (
                <Sun className="size-4 mr-2" />
              ) : (
                <Moon className="size-4 mr-2" />
              )}
              {theme === "dark" ? "Modo claro" : "Modo oscuro"}
            </DropdownMenuItem>
            {isPlatformAdmin && (
              <DropdownMenuItem asChild>
                <Link href="/admin">
                  <ShieldCog className="size-4 mr-2" />
                  Administración
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-2xs uppercase tracking-wider text-muted-foreground">
              Rol: {role}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={signingOut}
              onSelect={(event) => {
                // Sin esto el menu se cierra y desmonta el item antes de que
                // arranque la transicion, y el signOut nunca llega a correr.
                event.preventDefault();
                startSignOut(async () => {
                  await signOut();
                });
              }}
            >
              <LogOut className="size-4 mr-2" />
              {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
