import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { withTenant, withUser } from "@/lib/db/tenant";
import {
  auditLog,
  invitations,
  memberships,
  users,
  type MembershipRole,
} from "@/lib/db/schema";

/**
 * Miembros de un cliente e invitaciones, sin autorizacion.
 * El punto de entrada es actions.ts.
 */

export interface ActorContext {
  tenantId: string;
  userId: string;
}

export type MemberResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Correo inválido"));

const roleSchema = z.enum(["owner", "manager", "staff"]);

export interface Member {
  userId: string;
  email: string;
  fullName: string | null;
  role: MembershipRole;
  joinedAt: Date;
  /** El propio usuario no puede quitarse a si mismo ni bajarse de rol. */
  isSelf: boolean;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: MembershipRole;
  createdAt: Date;
}

export async function listMembers(
  tenantId: string,
  currentUserId: string,
): Promise<Member[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, tenantId))
      .orderBy(asc(memberships.createdAt)),
  );

  return rows.map((r) => ({ ...r, isSelf: r.userId === currentUserId }));
}

export async function listPendingInvitations(
  tenantId: string,
): Promise<PendingInvitation[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.tenantId, tenantId),
          isNull(invitations.acceptedAt),
        ),
      )
      .orderBy(desc(invitations.createdAt)),
  );
}

export async function inviteMember(
  { tenantId, userId }: ActorContext,
  input: { email: string; role: string },
): Promise<MemberResult> {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) {
    return { ok: false, error: email.error.issues[0].message, field: "email" };
  }
  const role = roleSchema.safeParse(input.role);
  if (!role.success) return { ok: false, error: "Rol inválido", field: "role" };

  try {
    return await withTenant(tenantId, async (tx) => {
      // Si ya es miembro, invitarlo otra vez no tiene sentido.
      const yaMiembro = await tx
        .select({ id: users.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.tenantId, tenantId),
            sql`lower(${users.email}) = ${email.data}`,
          ),
        );

      if (yaMiembro.length > 0) {
        return {
          ok: false as const,
          error: "Esa persona ya forma parte del equipo.",
          field: "email",
        };
      }

      await tx
        .insert(invitations)
        .values({
          id: uuidv7(),
          tenantId,
          email: email.data,
          role: role.data,
          invitedBy: userId,
        })
        // Re-invitar a alguien pendiente solo actualiza su rol, no duplica.
        .onConflictDoUpdate({
          target: [invitations.tenantId, invitations.email],
          targetWhere: isNull(invitations.acceptedAt),
          set: { role: role.data, invitedBy: userId },
        });

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "invitations",
        entityId: uuidv7(),
        action: "create",
        actorId: userId,
        diff: { email: email.data, role: role.data },
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo crear la invitación." };
  }
}

export async function cancelInvitation(
  { tenantId, userId }: ActorContext,
  id: string,
): Promise<MemberResult> {
  try {
    await withTenant(tenantId, async (tx) => {
      await tx
        .delete(invitations)
        .where(
          and(
            eq(invitations.id, id),
            eq(invitations.tenantId, tenantId),
            // Una invitacion ya aceptada es historia: se queda.
            isNull(invitations.acceptedAt),
          ),
        );

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "invitations",
        entityId: id,
        action: "delete",
        actorId: userId,
        diff: {},
      });
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo cancelar la invitación." };
  }
}

/**
 * Cambia el rol de un miembro.
 *
 * Dos reglas que no son cosmeticas:
 *   - Nadie se cambia su propio rol: si el unico dueño se baja a staff por
 *     error, el cliente queda sin quien administre nada.
 *   - Siempre tiene que quedar al menos un dueño, por lo mismo.
 */
export async function changeRole(
  { tenantId, userId }: ActorContext,
  targetUserId: string,
  newRole: string,
): Promise<MemberResult> {
  const role = roleSchema.safeParse(newRole);
  if (!role.success) return { ok: false, error: "Rol inválido" };

  if (targetUserId === userId) {
    return { ok: false, error: "No puedes cambiar tu propio rol." };
  }

  try {
    return await withTenant(tenantId, async (tx) => {
      const [actual] = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, targetUserId),
            eq(memberships.tenantId, tenantId),
          ),
        );

      if (!actual) return { ok: false as const, error: "No se encontró a esa persona." };

      if (actual.role === "owner" && role.data !== "owner") {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, tenantId),
              eq(memberships.role, "owner"),
            ),
          );

        if (Number(n) <= 1) {
          return {
            ok: false as const,
            error: "Tiene que quedar al menos un dueño.",
          };
        }
      }

      await tx
        .update(memberships)
        .set({ role: role.data })
        .where(
          and(
            eq(memberships.userId, targetUserId),
            eq(memberships.tenantId, tenantId),
          ),
        );

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "memberships",
        entityId: targetUserId,
        action: "update",
        actorId: userId,
        diff: { role: { from: actual.role, to: role.data } },
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo cambiar el rol." };
  }
}

/** Quita a alguien del cliente. Sus registros historicos no se tocan. */
export async function removeMember(
  { tenantId, userId }: ActorContext,
  targetUserId: string,
): Promise<MemberResult> {
  if (targetUserId === userId) {
    return { ok: false, error: "No puedes quitarte a ti mismo." };
  }

  try {
    return await withTenant(tenantId, async (tx) => {
      const [actual] = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, targetUserId),
            eq(memberships.tenantId, tenantId),
          ),
        );

      if (!actual) return { ok: false as const, error: "No se encontró a esa persona." };

      if (actual.role === "owner") {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(memberships)
          .where(
            and(eq(memberships.tenantId, tenantId), eq(memberships.role, "owner")),
          );
        if (Number(n) <= 1) {
          return { ok: false as const, error: "Tiene que quedar al menos un dueño." };
        }
      }

      await tx
        .delete(memberships)
        .where(
          and(
            eq(memberships.userId, targetUserId),
            eq(memberships.tenantId, tenantId),
          ),
        );

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "memberships",
        entityId: targetUserId,
        action: "delete",
        actorId: userId,
        diff: { role: actual.role },
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo quitar a esa persona." };
  }
}

/**
 * Canjea una invitacion pendiente por una membresia.
 *
 * Se llama al resolver la sesion de alguien que todavia no pertenece a ningun
 * cliente. Devuelve el tenantId si habia invitacion, o null si no.
 *
 * Los dos contextos que usa no son un rodeo: la invitacion se LEE con el
 * contexto de usuario (quien la canjea todavia no tiene cliente), y recien
 * cuando se sabe a que cliente pertenece se abre el contexto de tenant para
 * escribir la membresia.
 */
export async function claimInvitation(
  userId: string,
  email: string,
): Promise<string | null> {
  const normalizado = email.trim().toLowerCase();

  const pendientes = await withUser(userId, (tx) =>
    tx
      .select({
        id: invitations.id,
        tenantId: invitations.tenantId,
        role: invitations.role,
      })
      .from(invitations)
      .where(
        and(
          sql`lower(${invitations.email}) = ${normalizado}`,
          isNull(invitations.acceptedAt),
        ),
      )
      // Si hay varias, gana la mas vieja: es a la que la persona respondio.
      .orderBy(asc(invitations.createdAt))
      .limit(1),
  );

  const invitacion = pendientes[0];
  if (!invitacion) return null;

  await withTenant(invitacion.tenantId, async (tx) => {
    await tx
      .insert(memberships)
      .values({
        id: uuidv7(),
        userId,
        tenantId: invitacion.tenantId,
        role: invitacion.role,
      })
      // Si por una carrera ya existe, no se duplica.
      .onConflictDoNothing();

    await tx
      .update(invitations)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(eq(invitations.id, invitacion.id));

    await tx.insert(auditLog).values({
      id: uuidv7(),
      tenantId: invitacion.tenantId,
      entity: "memberships",
      entityId: userId,
      action: "create",
      actorId: userId,
      diff: { via: "invitacion", role: invitacion.role, email: normalizado },
    });
  });

  return invitacion.tenantId;
}
