import type { ComponentType } from "react";
import {
  IconLayoutDashboard,
  IconWallet,
  IconPackage,
  IconBuildingWarehouse,
  IconSettings,
} from "@tabler/icons-react";

/**
 * Registro unico de rutas de la app.
 *
 * Antes esta informacion estaba duplicada: `routeTitles` en el header (16 rutas
 * hardcodeadas) y `navItems` en el sidebar. Las dos listas se desincronizaban y
 * cualquier ruta no registrada caia en un titulo generico "Ray App" sin avisar.
 *
 * Ahora agregar una ruta es una entrada en ROUTES; mostrarla en el sidebar es
 * agregar su href a NAV_STRUCTURE. Los titulos viven en un solo lugar.
 */
export interface RouteDef {
  /** Patron de ruta. Un segmento que empieza con ":" es dinamico. */
  pattern: string;
  /** Titulo que muestra el header. */
  title: string;
  description?: string;
  /** Etiqueta corta para el grupo del sidebar. Por defecto usa `title`. */
  navLabel?: string;
}

export const ROUTES: RouteDef[] = [
  { pattern: "/dashboard", title: "Inicio", description: "Vista general de tu negocio" },

  { pattern: "/finanzas", title: "Finanzas", description: "Gestión financiera" },
  { pattern: "/finanzas/ingresos", title: "Ingresos", description: "Registro y seguimiento de ingresos" },
  { pattern: "/finanzas/gastos", title: "Gastos", description: "Registro y seguimiento de gastos" },
  { pattern: "/finanzas/movimientos", title: "Movimientos", description: "Todos los movimientos financieros" },
  { pattern: "/finanzas/calendario", title: "Calendario", description: "Eventos financieros programados" },
  { pattern: "/finanzas/reportes", title: "Reportes", description: "Análisis y reportes financieros" },
  { pattern: "/finanzas/historial", title: "Historial", description: "Historial financiero por periodo" },

  {
    pattern: "/productos",
    title: "Productos y Servicios",
    description: "Gestión de catálogo",
    navLabel: "Productos",
  },
  // Crear y editar se hacen en dialogos dentro de /productos, asi que ya no hay
  // rutas propias para eso.

  // Ojo: en el sidebar es el grupo "Inventario", y ademas aparece como hijo
  // "Stock". Esa etiqueta de hijo se declara en NAV_STRUCTURE, no aqui.
  { pattern: "/inventario", title: "Inventario", description: "Stock disponible" },
  {
    pattern: "/inventario/catalogo-productos",
    title: "Catálogo de Productos",
    description: "Vista de catálogo completo",
    navLabel: "Catálogo Productos",
  },
  {
    pattern: "/inventario/catalogo-servicios",
    title: "Catálogo de Servicios",
    description: "Servicios disponibles",
    navLabel: "Catálogo Servicios",
  },
  {
    pattern: "/inventario/impacto",
    title: "Impacto en Ingresos",
    description: "Relación inventario-ventas",
    navLabel: "Impacto",
  },
  {
    pattern: "/inventario/alertas",
    title: "Alertas de Inventario",
    description: "Notificaciones de stock",
    navLabel: "Alertas",
  },

  { pattern: "/ajustes", title: "Ajustes", description: "Configuración del negocio" },
  {
    pattern: "/ajustes/catalogos",
    title: "Catálogos",
    description: "Categorías y métodos de pago editables",
  },
  {
    pattern: "/ajustes/columnas",
    title: "Columnas",
    description: "Qué información guardas de productos y servicios",
  },
];

/**
 * Resuelve el pathname actual contra ROUTES. Gana el patron mas especifico
 * (el que usa menos segmentos dinamicos). Devuelve null si la ruta no esta
 * registrada, para que quien llame decida — en vez de un titulo generico que
 * escondia el error.
 */
export function resolveRoute(pathname: string): RouteDef | null {
  const segments = pathname.split("/").filter(Boolean);
  let best: RouteDef | null = null;
  let bestParamCount = Number.POSITIVE_INFINITY;

  for (const route of ROUTES) {
    const patternSegments = route.pattern.split("/").filter(Boolean);
    if (patternSegments.length !== segments.length) continue;

    let paramCount = 0;
    let matches = true;
    for (let i = 0; i < patternSegments.length; i++) {
      const segment = patternSegments[i];
      if (segment.startsWith(":")) {
        paramCount++;
        continue;
      }
      if (segment !== segments[i]) {
        matches = false;
        break;
      }
    }

    if (matches && paramCount < bestParamCount) {
      best = route;
      bestParamCount = paramCount;
    }
  }

  return best;
}

function route(pattern: string): RouteDef {
  const found = ROUTES.find((r) => r.pattern === pattern);
  if (!found) throw new Error(`Ruta no registrada en ROUTES: ${pattern}`);
  return found;
}

function label(pattern: string): string {
  const r = route(pattern);
  return r.navLabel ?? r.title;
}

export interface NavItem {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  children?: { name: string; href: string }[];
}

/** Un hijo del sidebar: el href basta, o un objeto si necesita otra etiqueta. */
type NavChild = string | { href: string; name: string };

interface NavGroup {
  href: string;
  icon: ComponentType<{ className?: string }>;
  children?: NavChild[];
}

const NAV_STRUCTURE: NavGroup[] = [
  { href: "/dashboard", icon: IconLayoutDashboard },
  {
    href: "/finanzas",
    icon: IconWallet,
    children: [
      "/finanzas/ingresos",
      "/finanzas/gastos",
      "/finanzas/movimientos",
      "/finanzas/calendario",
      "/finanzas/reportes",
      "/finanzas/historial",
    ],
  },
  { href: "/productos", icon: IconPackage },
  {
    href: "/inventario",
    icon: IconBuildingWarehouse,
    children: [
      { href: "/inventario", name: "Stock" },
      "/inventario/catalogo-productos",
      "/inventario/catalogo-servicios",
      "/inventario/impacto",
      "/inventario/alertas",
    ],
  },
];

function buildNav(groups: NavGroup[]): NavItem[] {
  return groups.map((group) => ({
    name: label(group.href),
    href: group.href,
    icon: group.icon,
    children: group.children?.map((child) =>
      typeof child === "string"
        ? { name: label(child), href: child }
        : { name: child.name, href: child.href },
    ),
  }));
}

export const NAV_TREE: NavItem[] = buildNav(NAV_STRUCTURE);

export const NAV_BOTTOM: NavItem[] = buildNav([
  {
    href: "/ajustes",
    icon: IconSettings,
    children: ["/ajustes/catalogos", "/ajustes/columnas"],
  },
]);
