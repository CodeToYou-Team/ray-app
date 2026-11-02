"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/authz/session";
import {
  inviteMember as inviteMemberCore,
  cancelInvitation as cancelInvitationCore,
  changeRole as changeRoleCore,
  removeMember as removeMemberCore,
  type MemberResult,
} from "@/lib/authz/members";
import {
  createTenant as createTenantCore,
  updateTenant as updateTenantCore,
  setTenantSuspended as setTenantSuspendedCore,
  emailBlockedElsewhere,
  type AdminResult,
  type CreateTenantInput,
  type UpdateTenantInput,
} from "./tenants";

/**
 * Server Actions de administracion de la plataforma.
 *
 * Todas empiezan con requirePlatformAdmin(). Son endpoints POST publicos como
 * cualquier otro Server Action: que /admin no se vea en el menu no impide
 * invocarlos.
 *
 * Las de equipo reusan el mismo nucleo que Ajustes › Equipo
 * (lib/authz/members.ts), con el admin como actor. Asi la regla de "siempre
 * queda al menos un dueño" vive en un solo sitio y vale para las dos puertas.
 * La de "no te cambies tu propio rol" no le estorba al admin: no es miembro.
 */

export type { AdminResult, CreateTenantInput, UpdateTenantInput, MemberResult };

function revalidateAdmin(tenantId?: string) {
  revalidatePath("/admin");
  if (tenantId) revalidatePath(`/admin/${tenantId}`);
}

export async function createTenant(
  input: CreateTenantInput,
): Promise<AdminResult<{ tenantId: string }>> {
  const admin = await requirePlatformAdmin();
  const result = await createTenantCore(admin.id, input);
  if (result.ok) revalidateAdmin();
  return result;
}

export async function updateTenant(
  tenantId: string,
  input: UpdateTenantInput,
): Promise<AdminResult> {
  const admin = await requirePlatformAdmin();
  const result = await updateTenantCore(admin.id, tenantId, input);
  if (result.ok) revalidateAdmin(tenantId);
  return result;
}

export async function setTenantSuspended(
  tenantId: string,
  suspended: boolean,
): Promise<AdminResult> {
  const admin = await requirePlatformAdmin();
  const result = await setTenantSuspendedCore(admin.id, tenantId, suspended);
  if (result.ok) revalidateAdmin(tenantId);
  return result;
}

// ---------------------------------------------------------------------------
// Equipo de un negocio. Firmas con el tenantId primero para poder hacer
// `.bind(null, tenantId)` y pasarlas al mismo TeamManager de Ajustes › Equipo.
// ---------------------------------------------------------------------------

export async function inviteMember(
  tenantId: string,
  input: { email: string; role: string },
): Promise<MemberResult> {
  const admin = await requirePlatformAdmin();

  // El dueño no puede comprobar esto (no ve otros negocios); el admin si, y es
  // justo el caso de rescate: invitar a un dueño nuevo que ya tiene cuenta.
  const bloqueo = await emailBlockedElsewhere(
    admin.id,
    input.email.trim().toLowerCase(),
    tenantId,
  );
  if (bloqueo) return { ok: false, error: bloqueo, field: "email" };

  try {
    return await inviteMemberCore({ tenantId, userId: admin.id }, input);
  } finally {
    revalidateAdmin(tenantId);
  }
}

export async function cancelInvitation(
  tenantId: string,
  id: string,
): Promise<MemberResult> {
  const admin = await requirePlatformAdmin();
  try {
    return await cancelInvitationCore({ tenantId, userId: admin.id }, id);
  } finally {
    revalidateAdmin(tenantId);
  }
}

export async function changeRole(
  tenantId: string,
  targetUserId: string,
  role: string,
): Promise<MemberResult> {
  const admin = await requirePlatformAdmin();
  try {
    return await changeRoleCore({ tenantId, userId: admin.id }, targetUserId, role);
  } finally {
    revalidateAdmin(tenantId);
  }
}

export async function removeMember(
  tenantId: string,
  targetUserId: string,
): Promise<MemberResult> {
  const admin = await requirePlatformAdmin();
  try {
    return await removeMemberCore({ tenantId, userId: admin.id }, targetUserId);
  } finally {
    revalidateAdmin(tenantId);
  }
}
