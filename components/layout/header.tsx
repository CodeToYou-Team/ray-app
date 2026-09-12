"use client";

import { usePathname } from "next/navigation";
import { IconBell, IconSearch } from "@tabler/icons-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { resolveRoute } from "@/lib/nav";

export function Header() {
  const pathname = usePathname();
  const route = resolveRoute(pathname);

  if (process.env.NODE_ENV === "development" && !route) {
    // Antes esto caia en un titulo generico "Ray App" y la ruta faltante pasaba
    // desapercibida. Ahora se avisa en dev.
    console.warn(`[nav] Ruta sin registrar en lib/nav.ts: ${pathname}`);
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/70 bg-background/85 backdrop-blur-lg px-4 md:px-6">
      <SidebarTrigger className="-ml-1 rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground" />
      <Separator orientation="vertical" className="h-5" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-base font-semibold leading-none tracking-tight">
              {route?.title ?? "Ray App"}
            </h1>
            {route?.description && (
              <p className="text-xs text-muted-foreground mt-1 hidden sm:block">
                {route.description}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <div className="relative hidden md:block">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            className="h-9 w-56 pl-9 text-sm bg-card/80 border-border/60"
          />
        </div>

        <ThemeToggle />

        <Button variant="ghost" size="icon" className="relative size-9">
          <IconBell className="size-[18px] text-muted-foreground" />
          <Badge className="absolute -top-0.5 -right-0.5 size-4 p-0 flex items-center justify-center text-[9px] bg-primary text-primary-foreground border-2 border-background">
            3
          </Badge>
        </Button>
      </div>
    </header>
  );
}
