import "server-only";

import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/lib/db/tenant";
import {
  platformAdmins,
  platformAuditLog,
  users,
  platformAdminLevel,
  type PlatformAdminLevel,
} from "@/lib/db/schema";
import type { AdminResult } from "./tenants";

/**
 * Administradores de la plataforma, sin autorizacion: reciben el id del actor
 * ya verificado. El punto de entrada es actions.ts, que exige
 * requirePlatformSuperadmin() primero.
 *
 * La base no confia en esa comprobacion: las politicas de 0022 solo dejan
 * escribir en platform_admins a un superadmin, un trigger impide quedarse sin
 * ninguno y otro deja cada cambio en platform_audit_log. Lo que se decide aqui
 * es solo lo que la base no puede saber, como "no te cambies a ti mismo".
 */

export interface PlatformAdmin {
  userId: string;
  email: string;
  fullName: string | null;
  level: PlatformAdminLevel;
  createdAt: Date;
  /** Bajarse o quitarse uno mismo se rechaza; la UI ni lo ofrece. */
  isSelf: boolean;
}

export interface AdminHistoryEntry {
  id: string;
  action: "create" | "update" | "delete" | "restore";
  /** Del momento del cambio: sigue ahi aunque la cuenta se borre. */
  email: string | null;
  diff: Record<string, unknown>;
  /** null = el script, con el rol dueño. */
  actorEmail: string | null;
  at: Date;
}

const levelSchema = z.enum(platformAdminLevel);

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Correo inválido"));

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Los errores que la base puede devolver aqui, en palabras de la UI. */
function describe(error: unknown, fallback: string): string {
  const code = pgCode(error);
  if (code === "PA001") return "Tiene que quedar al menos un superadmin.";
  // RLS rechazando un INSERT: quien llama no es superadmin.
  if (code === "42501") return "Solo un superadmin puede gestionar administradores.";
  return fallback;
}

/** Nivel del usuario en la plataforma, o null si no es admin. */
export async function getPlatformAdminLevel(
  userId: string,
): Promise<PlatformAdminLevel | null> {
  const rows = await withPlatformAdmin(userId, (tx) =>
    tx
      .select({ level: platformAdmins.level })
      .from(platformAdmins)
      .where(eq(platformAdmins.userId, userId)),
  );
  return rows[0]?.level ?? null;
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  return (await getPlatformAdminLevel(userId)) !== null;
}

/**
 * Todos los admins. Solo un superadmin ve a los demas: para un admin la
 * politica devuelve su propia fila y nada mas.
 */
export async function listAdmins(actorId: string): Promise<PlatformAdmin[]> {
  const rows = await withPlatformAdmin(actorId, (tx) =>
    tx
      .select({
        userId: platformAdmins.userId,
        email: users.email,
        fullName: users.fullName,
        level: platformAdmins.level,
        createdAt: platformAdmins.createdAt,
      })
      .from(platformAdmins)
      .innerJoin(users, eq(users.id, platformAdmins.userId))
      .orderBy(asc(platformAdmins.createdAt)),
  );
  return rows.map((r) => ({ ...r, isSelf: r.userId === actorId }));
}

export async function listAdminHistory(
  actorId: string,
  limit = 30,
): Promise<AdminHistoryEntry[]> {
  return withPlatformAdmin(actorId, async (tx) => {
    const rows = await tx
      .select({
        id: platformAuditLog.id,
        action: platformAuditLog.action,
        diff: platformAuditLog.diff,
        actorId: platformAuditLog.actorId,
        at: platformAuditLog.at,
      })
      .from(platformAuditLog)
      .where(eq(platformAuditLog.entity, "platform_admins"))
      .orderBy(desc(platformAuditLog.at))
      .limit(limit);

    // El actor siempre fue admin al momento del cambio, pero puede haber
    // dejado de serlo: su correo sale de users, que el admin puede leer.
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id) => id !== null))];
    const actores = actorIds.length
      ? await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, actorIds))
      : [];
    const correoDe = new Map(actores.map((a) => [a.id, a.email]));

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      email: typeof r.diff.email === "string" ? r.diff.email : null,
      diff: r.diff,
      actorEmail: r.actorId ? (correoDe.get(r.actorId) ?? "cuenta borrada") : null,
      at: r.at,
    }));
  });
}

/**
 * Nombra admin a alguien que YA tiene cuenta.
 *
 * No hay invitacion pendiente como con los dueños a proposito: ser admin es el
 * acceso mas alto que existe, y una invitacion a un correo que todavia no se
 * registro se la queda quien se registre primero con el.
 */
export async function grantAdmin(
  actorId: string,
  input: { email: string; level: string },
): Promise<AdminResult> {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) {
    return { ok: false, error: email.error.issues[0].message, field: "email" };
  }
  const level = levelSchema.safeParse(input.level);
  if (!level.success) return { ok: false, error: "Nivel inválido", field: "level" };

  try {
    return await withPlatformAdmin(actorId, async (tx) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${email.data}`)
        .limit(1);

      if (!user) {
        return {
          ok: false as const,
          error: "No hay ninguna cuenta con ese correo. Tiene que registrarse primero.",
          field: "email",
        };
      }

      const insertados = await tx
        .insert(platformAdmins)
        .values({ userId: user.id, level: level.data })
        .onConflictDoNothing()
        .returning({ userId: platformAdmins.userId });

      if (insertados.length === 0) {
        return {
          ok: false as const,
          error: "Esa persona ya es administrador.",
          field: "email",
        };
      }

      return { ok: true as const };
    });
  } catch (error) {
    return { ok: false, error: describe(error, "No se pudo nombrar al administrador.") };
  }
}

export async function changeAdminLevel(
  actorId: string,
  targetUserId: string,
  newLevel: string,
): Promise<AdminResult> {
  const level = levelSchema.safeParse(newLevel);
  if (!level.success) return { ok: false, error: "Nivel inválido" };

  // Igual que con los dueños: bajarse a uno mismo por error es el camino mas
  // corto a quedarse sin quien gestione los admins.
  if (targetUserId === actorId) {
    return { ok: false, error: "No puedes cambiar tu propio nivel." };
  }

  try {
    return await withPlatformAdmin(actorId, async (tx) => {
      const cambiados = await tx
        .update(platformAdmins)
        .set({ level: level.data })
        .where(eq(platformAdmins.userId, targetUserId))
        .returning({ userId: platformAdmins.userId });

      // Sin filas: no existe, o quien llama no es superadmin y RLS no le deja
      // ver la fila. Ninguno de los dos casos cambia nada.
      if (cambiados.length === 0) {
        return { ok: false as const, error: "No se encontró a ese administrador." };
      }
      return { ok: true as const };
    });
  } catch (error) {
    return { ok: false, error: describe(error, "No se pudo cambiar el nivel.") };
  }
}

export async function revokeAdmin(
  actorId: string,
  targetUserId: string,
): Promise<AdminResult> {
  if (targetUserId === actorId) {
    return { ok: false, error: "No puedes quitarte a ti mismo." };
  }

  try {
    return await withPlatformAdmin(actorId, async (tx) => {
      const borrados = await tx
        .delete(platformAdmins)
        .where(eq(platformAdmins.userId, targetUserId))
        .returning({ userId: platformAdmins.userId });

      if (borrados.length === 0) {
        return { ok: false as const, error: "No se encontró a ese administrador." };
      }
      return { ok: true as const };
    });
  } catch (error) {
    return { ok: false, error: describe(error, "No se pudo quitar al administrador.") };
  }
}
