import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withUser } from "@/lib/db/tenant";
import { claimInvitation } from "./members";
import { isPlatformAdmin } from "@/lib/admin/tenants";
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

/**
 * El negocio existe y la persona pertenece a el, pero un admin lo suspendio.
 * Se distingue de NoMembershipError para no decirle "pide que te inviten" a
 * alguien que ya esta invitado.
 */
export class TenantSuspendedError extends Error {
  constructor(readonly tenantName: string) {
    super(`El cliente "${tenantName}" esta suspendido.`);
    this.name = "TenantSuspendedError";
  }
}

export class NotPlatformAdminError extends Error {
  constructor(userId: string) {
    super(`El usuario ${userId} no es administrador de la plataforma.`);
    this.name = "NotPlatformAdminError";
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

  /**
   * Aqui y no en el layout: todo Server Action pasa por requireTenant(), asi
   * que un negocio suspendido deja de poder escribir aunque alguien tenga la
   * pantalla abierta desde antes.
   */
  const { fullName, suspendedAt, tenantName, ...tenant } = row;
  if (suspendedAt) throw new TenantSuspendedError(tenantName);

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
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        timezone: tenants.timezone,
        primaryCurrency: tenants.primaryCurrency,
        role: memberships.role,
        fullName: users.fullName,
        suspendedAt: tenants.suspendedAt,
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
 * Exige ser administrador de la plataforma (tabla `platform_admins`).
 *
 * No depende de pertenecer a ningun negocio: un admin puede no tener membresia.
 * Cada Server Action de lib/admin empieza con esto, igual que las del negocio
 * empiezan con requireCapability().
 */
export const requirePlatformAdmin = cache(async (): Promise<SessionUser> => {
  const user = await requireSession();
  if (!(await isPlatformAdmin(user.id))) throw new NotPlatformAdminError(user.id);
  return user;
});

/** Para la UI: decidir si se muestra el enlace a Administracion. */
export const tryPlatformAdmin = cache(async (): Promise<SessionUser | null> => {
  const user = await trySession();
  if (!user) return null;
  return (await isPlatformAdmin(user.id)) ? user : null;
});

/** Sesion sin lanzar. Distingue "no entro" de "entro pero no lo invitaron". */
export const trySession = cache(async (): Promise<SessionUser | null> => {
  try {
    return await requireSession();
  } catch (error) {
    if (error instanceof UnauthenticatedError) return null;
    throw error;
  }
});

/**
 * En que situacion esta quien abre una pantalla, sin lanzar.
 *
 * Para layouts y pantallas publicas, que tienen que decidir a donde mandar a
 * cada uno. No usar en Server Actions: ahi se quiere que falle fuerte.
 */
export type Access =
  | { kind: "anonimo" }
  | { kind: "sin-negocio"; session: SessionUser; isAdmin: boolean }
  | { kind: "suspendido"; session: SessionUser; tenantName: string }
  | { kind: "ok"; context: TenantContext };

export const getAccess = cache(async (): Promise<Access> => {
  const session = await trySession();
  if (!session) return { kind: "anonimo" };

  try {
    return { kind: "ok", context: await requireTenant() };
  } catch (error) {
    if (error instanceof TenantSuspendedError) {
      return { kind: "suspendido", session, tenantName: error.tenantName };
    }
    if (error instanceof NoMembershipError) {
      return {
        kind: "sin-negocio",
        session,
        isAdmin: await isPlatformAdmin(session.id),
      };
    }
    throw error;
  }
});

/** El contexto del cliente si se puede entrar a la app, o null. */
export const tryGetTenant = cache(async (): Promise<TenantContext | null> => {
  const access = await getAccess();
  return access.kind === "ok" ? access.context : null;
});
