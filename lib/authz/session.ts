import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withUser } from "@/lib/db/tenant";
import { claimInvitation } from "./members";
import { memberships, tenants, users } from "@/lib/db/schema";
import type { MembershipRole } from "@/lib/db/schema";
import { roleHas, ForbiddenError, type Capability } from "./roles";

export class UnauthenticatedError extends Error {
  constructor() {
    super("No hay sesion activa.");
    this.name = "UnauthenticatedError";
  }
}

export class NoMembershipError extends Error {
  constructor(userId: string) {
    super(`El usuario ${userId} no pertenece a ningun cliente.`);
    this.name = "NoMembershipError";
  }
}

export interface SessionUser {
  id: string;
  email: string;
}

export interface TenantUser extends SessionUser {
  /** De public.users, que mantiene sincronizado el trigger sobre auth.users. */
  fullName: string | null;
  /** Como mostrarlo en la UI: el nombre si lo hay, si no la parte local del correo. */
  displayName: string;
}

export interface TenantContext {
  user: TenantUser;
  tenantId: string;
  tenantSlug: string;
  timezone: string;
  primaryCurrency: string;
  role: MembershipRole;
}

/**
 * Usuario autenticado.
 *
 * Se usa `getUser()` y no `getSession()`: getSession lee la cookie sin validar
 * la firma del JWT contra el servidor de auth, asi que en el servidor no sirve
 * como fuente de verdad.
 *
 * Envuelto en `cache()` de React para que los RSC anidados de un mismo request
 * no repitan la llamada.
 */
export const requireSession = cache(async (): Promise<SessionUser> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user?.email) throw new UnauthenticatedError();

  return { id: data.user.id, email: data.user.email };
});

/**
 * Resuelve el cliente activo a partir de la membresia del usuario.
 *
 * Hoy un usuario pertenece a un solo cliente, asi que el cliente sale de la
 * sesion y las URLs se mantienen como estan (/finanzas/ingresos, no
 * /t/hotel/finanzas/ingresos). Dos consecuencias a tener presentes:
 *
 *   1. NO usar `"use cache"` ni cachear nada que dependa del cliente sin incluir
 *      el tenantId en la clave. Con el cliente derivado de la sesion, un cache
 *      mal clavado sirve la pagina del cliente A al cliente B.
 *   2. La impersonacion para soporte necesita una cookie firmada de admin, no
 *      basta cambiar la URL.
 *
 * Si algun dia un usuario pertenece a varios clientes, esto pasa a leer el slug
 * de la URL y a validarlo contra las membresias.
 */
export const requireTenant = cache(async (): Promise<TenantContext> => {
  const user = await requireSession();

  let row = await findMembership(user.id);

  /**
   * Sin membresia, puede ser alguien recien registrado a quien invitaron.
   *
   * El canje va aqui y no en el login para que funcione sea cual sea la puerta
   * de entrada: un enlace directo a una pantalla interna tiene que llevar al
   * mismo lugar que entrar por /login.
   */
  if (!row) {
    const claimed = await claimInvitation(user.id, user.email);
    if (claimed) row = await findMembership(user.id);
  }

  if (!row) throw new NoMembershipError(user.id);

  const { fullName, ...tenant } = row;

  return {
    user: {
      ...user,
      fullName,
      displayName: fullName?.trim() || user.email.split("@")[0],
    },
    ...tenant,
  };
});

/** Membresia del usuario, o undefined. Separado para poder reintentar tras canjear. */
async function findMembership(userId: string) {
  // withUser y no getDb() suelto: sin contexto, RLS no deja ver ninguna
  // membresia y la resolucion del cliente devolveria cero filas siempre.
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        tenantId: tenants.id,
        tenantSlug: tenants.slug,
        timezone: tenants.timezone,
        primaryCurrency: tenants.primaryCurrency,
        role: memberships.role,
        fullName: users.fullName,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.userId, userId))
      .limit(1),
  );

  return rows[0];
}

/**
 * Exige un permiso y devuelve el contexto.
 *
 * Cada Server Action tiene que llamar a esto arriba. Los Server Actions son
 * endpoints POST publicos, no son "internos": que la UI no pinte el boton no
 * impide que alguien invoque la accion.
 */
export async function requireCapability(
  capability: Capability,
): Promise<TenantContext> {
  const context = await requireTenant();
  if (!roleHas(context.role, capability)) {
    throw new ForbiddenError(capability, context.role);
  }
  return context;
}

/**
 * Como `requireTenant()` pero sin lanzar: devuelve null si no hay sesion o si el
 * usuario no pertenece a ningun cliente.
 *
 * Para los layouts, que necesitan decidir a donde redirigir. No usar en Server
 * Actions: ahi se quiere que falle fuerte.
 */
/** Sesion sin lanzar. Distingue "no entro" de "entro pero no lo invitaron". */
export const trySession = cache(async (): Promise<SessionUser | null> => {
  try {
    return await requireSession();
  } catch (error) {
    if (error instanceof UnauthenticatedError) return null;
    throw error;
  }
});

export const tryGetTenant = cache(async (): Promise<TenantContext | null> => {
  try {
    return await requireTenant();
  } catch (error) {
    if (
      error instanceof UnauthenticatedError ||
      error instanceof NoMembershipError
    ) {
      return null;
    }
    throw error;
  }
});
