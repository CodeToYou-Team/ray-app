import { describe, it, expect } from "vitest";
import { navTreeFor, navBottomFor, routeCapability, ROUTES, resolveRoute } from "@/lib/nav";
import { roleHas, CAPABILITIES } from "@/lib/authz/roles";
import type { MembershipRole } from "@/lib/db/schema";

/** Todos los href que el menu le muestra a un rol, aplanados. */
function hrefsVisibles(role: MembershipRole): string[] {
  const items = [...navTreeFor(role), ...navBottomFor(role)];
  return items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)]);
}

describe("menu segun el rol", () => {
  it("el dueño ve todo", () => {
    const hrefs = hrefsVisibles("owner");
    expect(hrefs).toContain("/ajustes/usuarios");
    expect(hrefs).toContain("/ajustes/columnas");
    expect(hrefs).toContain("/finanzas/reportes");
    expect(hrefs).toContain("/ajustes/negocio");
  });

  it("el encargado no ve Equipo ni Columnas, pero si Reportes", () => {
    const hrefs = hrefsVisibles("manager");
    // La moneda por defecto decide como se registra todo lo demas: no es una
    // preferencia que cambie quien opera el dia a dia.
    expect(hrefs).not.toContain("/ajustes/negocio");
    // El caso concreto que fallaba: el enlace aparecia y al entrar reventaba.
    expect(hrefs).not.toContain("/ajustes/usuarios");
    expect(hrefs).not.toContain("/ajustes/columnas");
    expect(hrefs).toContain("/finanzas/reportes");
    // Ajustes le sigue sirviendo: puede administrar catalogos.
    expect(hrefs).toContain("/ajustes/catalogos");
  });

  it("el personal no ve los reportes", () => {
    const hrefs = hrefsVisibles("staff");
    // Es lo que separa a quien registra de quien ve cuanto entro en total.
    expect(hrefs).not.toContain("/finanzas/reportes");
    expect(hrefs).not.toContain("/finanzas/historial");
    expect(hrefs).not.toContain("/ajustes/usuarios");

    // Pero si lo que necesita para trabajar.
    expect(hrefs).toContain("/finanzas/ingresos");
    expect(hrefs).toContain("/productos");
    expect(hrefs).toContain("/servicios");
    expect(hrefs).toContain("/inventario");
  });

  it("cada catalogo agrupa lo que depende de el", () => {
    const grupos = navTreeFor("owner");
    const hijos = (href: string) =>
      grupos.find((g) => g.href === href)?.children?.map((c) => c.href) ?? [];

    // Los productos llevan inventario; los servicios, reservas.
    expect(hijos("/productos")).toEqual(["/productos", "/inventario", "/inventario/alertas"]);
    expect(hijos("/servicios")).toEqual([
      "/servicios",
      "/reservas",
      "/reservas/listado",
      "/reservas/recursos",
    ]);
    // Ni inventario ni reservas quedan sueltos como grupo propio.
    expect(grupos.map((g) => g.href)).not.toContain("/inventario");
    expect(grupos.map((g) => g.href)).not.toContain("/reservas");
  });

  it("la recepcion reserva, pero no decide que habitaciones existen", () => {
    const hrefs = hrefsVisibles("staff");
    expect(hrefs).toContain("/reservas");
    // Buscar una reserva o ver quién debe es trabajo de recepción.
    expect(hrefs).toContain("/reservas/listado");
    expect(hrefs).not.toContain("/reservas/recursos");

    // El encargado si administra los recursos.
    expect(hrefsVisibles("manager")).toContain("/reservas/recursos");
  });

  it("un grupo sin hijos accesibles no se muestra vacio", () => {
    for (const role of ["owner", "manager", "staff"] as MembershipRole[]) {
      for (const item of [...navTreeFor(role), ...navBottomFor(role)]) {
        // Un grupo que declara hijos y se queda sin ninguno no tiene a donde
        // llevar: se oculta entero en vez de quedar como un enlace muerto.
        if (item.children) expect(item.children.length).toBeGreaterThan(0);
      }
    }
  });

  it("ningun rol ve un enlace que no puede abrir", () => {
    // La propiedad general: el menu nunca miente sobre lo que se puede hacer.
    for (const role of ["owner", "manager", "staff"] as MembershipRole[]) {
      for (const href of hrefsVisibles(role)) {
        const cap = routeCapability(href);
        if (cap) {
          expect(roleHas(role, cap), `${role} ve ${href} sin tener ${cap}`).toBe(true);
        }
      }
    }
  });

  it("los permisos del mapa de rutas existen de verdad", () => {
    // Un permiso mal escrito dejaria la ruta visible para todos en silencio.
    for (const route of ROUTES) {
      const cap = routeCapability(route.pattern);
      if (cap) {
        expect(CAPABILITIES, `${route.pattern} -> ${cap}`).toContain(cap);
      }
    }
  });

  it("toda ruta del menu esta registrada en ROUTES", () => {
    for (const role of ["owner", "manager", "staff"] as MembershipRole[]) {
      for (const href of hrefsVisibles(role)) {
        expect(resolveRoute(href), `${href} no esta en ROUTES`).not.toBeNull();
      }
    }
  });
});
