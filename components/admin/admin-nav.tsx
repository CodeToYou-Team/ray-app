"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Secciones de /admin. "Administradores" solo se pinta para superadmin. */
export function AdminNav({ isSuperadmin }: { isSuperadmin: boolean }) {
  const pathname = usePathname();
  const enAdmins = pathname.startsWith("/admin/administradores");

  const items = [
    { href: "/admin", label: "Negocios", active: !enAdmins },
    ...(isSuperadmin
      ? [{ href: "/admin/administradores", label: "Administradores", active: enAdmins }]
      : []),
  ];

  return (
    <nav className="flex items-center gap-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-sm transition-colors",
            item.active
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
