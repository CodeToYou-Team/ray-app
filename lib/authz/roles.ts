import type { MembershipRole } from "@/lib/db/schema";

/**
 * Permisos por rol, en codigo y no en tablas.
 *
 * Una matriz de permisos en base de datos sin UI para editarla es estrictamente
 * peor que esto: seriamos los unicos escribiendo filas, a mano por SQL, y nos
 * equivocariamos en silencio. Cuando un cliente pida un rol que no existe, ese
 * es el momento de mover esto a la base — no antes.
 */
export const CAPABILITIES = [
  // Transacciones
  "transaction:create",
  "transaction:read_all",
  "transaction:read_own",
  "transaction:update",
  "transaction:delete",
  // Productos y servicios
  "product:read",
  "product:manage",
  // Inventario
  "stock:read",
  "stock:adjust",
  // Catalogos (categorias, metodos de pago)
  "catalog:read",
  "catalog:manage",
  // Configuracion de columnas personalizadas
  "field:manage",
  // Reportes y consolidados de ingresos
  "report:read",
  // Usuarios del cliente
  "member:manage",
  // Configuracion del negocio (moneda por defecto)
  "tenant:manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES = {
  /** Dueño del negocio: todo, incluido el consolidado de ingresos. */
  owner: CAPABILITIES,

  /** Encargado: opera y ve todo, pero no toca usuarios ni el esquema de columnas. */
  manager: [
    "transaction:create",
    "transaction:read_all",
    "transaction:update",
    "product:read",
    "product:manage",
    "stock:read",
    "stock:adjust",
    "catalog:read",
    "catalog:manage",
    "report:read",
  ],

  /**
   * Personal: registra y ve lo suyo. Sin `report:read`, que es lo que separa a
   * quien registra de quien ve cuanto entro en total.
   */
  staff: [
    "transaction:create",
    "transaction:read_own",
    "product:read",
    "stock:read",
    "catalog:read",
  ],
} as const satisfies Record<MembershipRole, readonly Capability[]>;

export function roleHas(role: MembershipRole, capability: Capability): boolean {
  return (ROLE_CAPABILITIES[role] as readonly Capability[]).includes(capability);
}

export class ForbiddenError extends Error {
  constructor(readonly capability: Capability, role: MembershipRole) {
    super(`El rol "${role}" no tiene el permiso "${capability}".`);
    this.name = "ForbiddenError";
  }
}
