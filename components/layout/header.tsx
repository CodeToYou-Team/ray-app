"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronRight, Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { ancestrosDe, resolveRoute } from "@/lib/nav";

/**
 * Una tira de utilidades, no un titulo.
 *
 * El nombre de la pantalla lo pinta el PageHeader dentro de la pagina, en
 * grande. Aqui solo queda por donde vas (los ancestros) y las herramientas que
 * sirven en cualquier pantalla.
 */
export function Header() {
  const pathname = usePathname();
  const migas = ancestrosDe(pathname);

  if (process.env.NODE_ENV === "development" && !resolveRoute(pathname)) {
    // Antes esto caia en un titulo generico "Ray App" y la ruta faltante pasaba
    // desapercibida. Ahora se avisa en dev.
    console.warn(`[nav] Ruta sin registrar en lib/nav.ts: ${pathname}`);
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-lg md:px-6">
      <SidebarTrigger className="-ml-1 rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground" />
      <Separator orientation="vertical" className="h-5" />

      <nav
        aria-label="Ruta"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground"
      >
        {migas.map((miga, i) => (
          <span key={miga.pattern} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && (
              <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />
            )}
            <Link
              href={miga.href}
              className="truncate rounded-sm transition-colors hover:text-foreground"
            >
              {miga.navLabel ?? miga.title}
            </Link>
          </span>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-1">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            className="h-9 w-56 border-border/60 bg-card/80 pl-9 text-sm"
          />
        </div>

        <ThemeToggle />

        <Button variant="ghost" size="icon" className="relative size-9">
          <Bell className="size-4.5 text-muted-foreground" />
        </Button>
      </div>
    </header>
  );
}
