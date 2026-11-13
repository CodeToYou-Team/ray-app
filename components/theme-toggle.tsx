"use client";

import { IconMoon, IconSun } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  // La visibilidad de los iconos la resuelve el variant `dark:` sobre la clase que
  // next-themes pone en <html>, no JS. Asi no hay lectura del tema en render (que
  // provocaria hydration mismatch) ni un flag `mounted` que oculte el boton al cargar.
  // `resolvedTheme` solo se lee dentro del handler, que corre ya hidratado.
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Cambiar tema"
      className="relative w-9 h-9 rounded-md hover:bg-accent hover:text-accent-foreground"
    >
      <IconSun className="absolute size-4.5 rotate-0 scale-100 opacity-100 transition-all duration-300 ease-out dark:rotate-90 dark:scale-0 dark:opacity-0" />
      <IconMoon className="absolute size-4.5 -rotate-90 scale-0 opacity-0 transition-all duration-300 ease-out dark:rotate-0 dark:scale-100 dark:opacity-100" />
    </Button>
  );
}
