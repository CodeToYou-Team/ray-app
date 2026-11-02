import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { withPlatformAdmin } from "@/lib/db/tenant";
import {
  auditLog,
  catalogItems,
  invitations,
  memberships,
  tenants,
  users,
} from "@/lib/db/schema";
import {
  CATALOG_KEYS,
  DEFAULT_CATALOG_ITEMS,
  slugifyCode,
} from "@/lib/catalogs/keys";
import { isKnownCurrency } from "@/lib/currencies";

/**
 * Administracion de negocios, sin autorizacion: reciben el id del admin ya
 * verificado. El punto de entrada es actions.ts, que exige
 * requirePlatformAdmin() primero. La separacion es la misma de finanzas: esto
 * se testea sin simular una sesion de Supabase — nunca llamarlo desde una ruta.
 *
 * Lo que el admin NO hace desde aqui: ver operaciones, reservas o productos de
 * un negocio. Las politicas de 0021 solo le abren tenants, membresias, usuarios
 * e invitaciones.
 */

export type AdminResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; field?: string };

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  primaryCurrency: string;
  suspendedAt: Date | null;
  createdAt: Date;
  memberCount: number;
  /** Correos de los dueños actuales. */
  owners: string[];
  /** Correos con una invitacion de dueño todavia sin canjear. */
  pendingOwners: string[];
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Correo inválido"));

const timezoneSchema = z
  .string()
  .trim()
  .refine(isValidTimezone, "Zona horaria desconocida (ej. America/Caracas).");

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isKnownCurrency, "Esa moneda no está en la lista.");

const tenantFieldsSchema = z.object({
  name: z.string().trim().min(1, "Escribe el nombre del negocio").max(120),
  timezone: timezoneSchema,
  primaryCurrency: currencySchema,
});

const createSchema = tenantFieldsSchema.extend({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "El identificador es muy corto")
    .max(60)
    .regex(SLUG_RE, "Solo minúsculas, números y guiones (ej. hotel-sol)."),
  ownerEmail: emailSchema,
});

export type CreateTenantInput = z.input<typeof createSchema>;
export type UpdateTenantInput = z.input<typeof tenantFieldsSchema>;

/**
 * Postgres e Intl comparten la base de zonas IANA. Se valida aqui para dar un
 * mensaje claro: un nombre mal escrito haria fallar cada reporte por hora del
 * negocio con un error de SQL, no al guardarlo.
 */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("es", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function firstIssue(error: z.ZodError): { error: string; field?: string } {
  const issue = error.issues[0];
  const field = issue.path[0];
  return {
    error: issue.message,
    field: typeof field === "string" ? field : undefined,
  };
}

export async function listTenants(adminId: string): Promise<TenantSummary[]> {
  return withPlatformAdmin(adminId, async (tx) => {
    const [rows, miembros, pendientes] = await Promise.all([
      tx
        .select({
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          timezone: tenants.timezone,
          primaryCurrency: tenants.primaryCurrency,
          suspendedAt: tenants.suspendedAt,
          createdAt: tenants.createdAt,
        })
        .from(tenants)
        .orderBy(desc(tenants.createdAt)),
      tx
        .select({
          tenantId: memberships.tenantId,
          role: memberships.role,
          email: users.email,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId)),
      tx
        .select({ tenantId: invitations.tenantId, email: invitations.email })
        .from(invitations)
        .where(
          and(isNull(invitations.acceptedAt), eq(invitations.role, "owner")),
        ),
    ]);

    return rows.map((t) => {
      const suyos = miembros.filter((m) => m.tenantId === t.id);
      return {
        ...t,
        memberCount: suyos.length,
        owners: suyos.filter((m) => m.role === "owner").map((m) => m.email),
        pendingOwners: pendientes
          .filter((p) => p.tenantId === t.id)
          .map((p) => p.email),
      };
    });
  });
}

export async function getTenant(
  adminId: string,
  tenantId: string,
): Promise<TenantSummary | null> {
  const todos = await listTenants(adminId);
  return todos.find((t) => t.id === tenantId) ?? null;
}

/**
 * ¿Ese correo puede sumarse a `tenantId`?
 *
 * Hoy un usuario pertenece a UN negocio: requireTenant() toma la primera
 * membresia que encuentra. Si ya es miembro de otro, la invitacion nunca se
 * canjearia y quedaria pendiente para siempre sin que nadie entienda por que.
 * Una invitacion pendiente en otro negocio tambien gana: el canje toma la mas
 * vieja.
 *
 * Solo lo puede responder el admin: es la unica lectura que cruza clientes.
 */
export async function emailBlockedElsewhere(
  adminId: string,
  email: string,
  tenantId: string | null,
): Promise<string | null> {
  return withPlatformAdmin(adminId, async (tx) => {
    const [miembro] = await tx
      .select({ tenantId: tenants.id, name: tenants.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (miembro && miembro.tenantId !== tenantId) {
      return `Ese correo ya pertenece a "${miembro.name}". Hoy una persona solo puede estar en un negocio.`;
    }

    const [invitado] = await tx
      .select({ tenantId: tenants.id, name: tenants.name })
      .from(invitations)
      .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
      .where(and(eq(invitations.email, email), isNull(invitations.acceptedAt)))
      .orderBy(asc(invitations.createdAt))
      .limit(1);

    if (invitado && invitado.tenantId !== tenantId) {
      return `Ese correo tiene una invitación pendiente de "${invitado.name}". Cancélala primero.`;
    }

    return null;
  });
}

/**
 * Alta de un negocio: el cliente, sus catalogos por defecto y la invitacion de
 * su dueño, en una sola transaccion.
 *
 * El dueño NO tiene que estar registrado: queda una invitacion de dueño que se
 * canjea sola cuando se registra (o entra, si ya tenia cuenta sin negocio) con
 * ese correo. Es el mismo canje que usa Ajustes › Equipo.
 */
export async function createTenant(
  adminId: string,
  input: CreateTenantInput,
): Promise<AdminResult<{ tenantId: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const data = parsed.data;

  const bloqueo = await emailBlockedElsewhere(adminId, data.ownerEmail, null);
  if (bloqueo) return { ok: false, error: bloqueo, field: "ownerEmail" };

  const tenantId = uuidv7();

  try {
    await withPlatformAdmin(
      adminId,
      async (tx) => {
        await tx.insert(tenants).values({
          id: tenantId,
          name: data.name,
          slug: data.slug,
          timezone: data.timezone,
          primaryCurrency: data.primaryCurrency,
        });

        const items = CATALOG_KEYS.flatMap((catalogKey) =>
          DEFAULT_CATALOG_ITEMS[catalogKey].map((item, index) => ({
            id: uuidv7(),
            tenantId,
            catalogKey,
            code: slugifyCode(item.label),
            label: item.label,
            currency: item.currency ?? null,
            sortOrder: index,
          })),
        );
        await tx.insert(catalogItems).values(items);

        await tx.insert(invitations).values({
          id: uuidv7(),
          tenantId,
          email: data.ownerEmail,
          role: "owner",
          invitedBy: adminId,
        });

        await tx.insert(auditLog).values({
          id: uuidv7(),
          tenantId,
          entity: "tenants",
          entityId: tenantId,
          action: "create",
          actorId: adminId,
          diff: {
            via: "admin",
            name: data.name,
            slug: data.slug,
            timezone: data.timezone,
            primaryCurrency: data.primaryCurrency,
            ownerEmail: data.ownerEmail,
          },
        });
      },
      tenantId,
    );
  } catch (error) {
    if (pgCode(error) === "23505") {
      return {
        ok: false,
        error: "Ese identificador ya lo usa otro negocio.",
        field: "slug",
      };
    }
    return { ok: false, error: "No se pudo crear el negocio." };
  }

  return { ok: true, tenantId };
}

/**
 * Nombre, zona horaria y moneda por defecto. El slug no se toca: es la clave
 * con la que se identifica al negocio en soporte, y las claves son inmutables.
 */
export async function updateTenant(
  adminId: string,
  tenantId: string,
  input: UpdateTenantInput,
): Promise<AdminResult> {
  const parsed = tenantFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const data = parsed.data;

  try {
    return await withPlatformAdmin(
      adminId,
      async (tx) => {
        const [antes] = await tx
          .select({
            name: tenants.name,
            timezone: tenants.timezone,
            primaryCurrency: tenants.primaryCurrency,
          })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .for("update");

        if (!antes) return { ok: false as const, error: "No existe ese negocio." };

        const diff: Record<string, { from: string; to: string }> = {};
        for (const key of ["name", "timezone", "primaryCurrency"] as const) {
          if (antes[key] !== data[key]) {
            diff[key] = { from: antes[key], to: data[key] };
          }
        }
        if (Object.keys(diff).length === 0) return { ok: true as const };

        await tx
          .update(tenants)
          .set({ ...data, updatedAt: new Date() })
          .where(eq(tenants.id, tenantId));

        await tx.insert(auditLog).values({
          id: uuidv7(),
          tenantId,
          entity: "tenants",
          entityId: tenantId,
          action: "update",
          actorId: adminId,
          diff: { via: "admin", ...diff },
        });

        return { ok: true as const };
      },
      tenantId,
    );
  } catch {
    return { ok: false, error: "No se pudieron guardar los cambios." };
  }
}

/**
 * Suspende o reactiva. Suspender no borra nada: nadie del negocio puede entrar
 * mientras dure, y reactivar lo deja exactamente como estaba.
 */
export async function setTenantSuspended(
  adminId: string,
  tenantId: string,
  suspended: boolean,
): Promise<AdminResult> {
  try {
    return await withPlatformAdmin(
      adminId,
      async (tx) => {
        const [antes] = await tx
          .select({ suspendedAt: tenants.suspendedAt })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .for("update");

        if (!antes) return { ok: false as const, error: "No existe ese negocio." };
        if ((antes.suspendedAt !== null) === suspended) return { ok: true as const };

        const ahora = suspended ? new Date() : null;
        await tx
          .update(tenants)
          .set({ suspendedAt: ahora, updatedAt: new Date() })
          .where(eq(tenants.id, tenantId));

        await tx.insert(auditLog).values({
          id: uuidv7(),
          tenantId,
          entity: "tenants",
          entityId: tenantId,
          action: "update",
          actorId: adminId,
          diff: {
            via: "admin",
            suspendedAt: {
              from: antes.suspendedAt?.toISOString() ?? null,
              to: ahora?.toISOString() ?? null,
            },
          },
        });

        return { ok: true as const };
      },
      tenantId,
    );
  } catch {
    return {
      ok: false,
      error: suspended
        ? "No se pudo suspender el negocio."
        : "No se pudo reactivar el negocio.",
    };
  }
}
