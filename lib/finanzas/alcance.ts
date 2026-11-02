import "server-only";

import { ForbiddenError, roleHas } from "@/lib/authz/roles";
import type { TenantContext } from "@/lib/authz/session";

/**
 * Qué operaciones puede LEER este rol, como filtro para las consultas.
 *
 * `transaction:read_all` ve todo el negocio; `transaction:read_own` solo lo que
 * registró esa persona. Antes los dos permisos existían y ninguna consulta los
 * miraba, así que el Personal veía todas las operaciones y sus totales — que
 * es justamente lo que lo separa del dueño.
 *
 * Es un único lugar a propósito: la lista, los totales de arriba y el Inicio
 * tienen que aplicar el MISMO alcance. Si uno lo olvida, el número grande de
 * la pantalla vuelve a ser el del negocio entero.
 *
 * Sin ninguno de los dos permisos lanza en vez de devolver "todo": un rol
 * nuevo que nadie pensó no debe heredar la vista completa por omisión.
 */
export function alcanceDeLectura(
  ctx: Pick<TenantContext, "role" | "user">,
): { createdBy?: string } {
  if (roleHas(ctx.role, "transaction:read_all")) return {};
  if (roleHas(ctx.role, "transaction:read_own")) return { createdBy: ctx.user.id };
  throw new ForbiddenError("transaction:read_own", ctx.role);
}
