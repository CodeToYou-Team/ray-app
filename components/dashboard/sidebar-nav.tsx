"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { name: "Dashboard", href: "/dashboard" },
  { name: "Productos", href: "/dashboard" },
  { name: "Clientes", href: "/dashboard" },
  { name: "Configuración", href: "/dashboard" },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-1">
      {navItems.map((item) => {
        const isActive = pathname === item.href;

        return (
          <Link
            key={item.name}
            href={item.href}
            className={`block rounded-md px-3 py-2 text-sm transition-colors ${
              isActive
                ? "bg-sidebar text-accent-foreground hover:bg-accent"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}
