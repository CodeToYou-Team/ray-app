"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "./session";
import {
  inviteMember as inviteMemberCore,
  cancelInvitation as cancelInvitationCore,
  changeRole as changeRoleCore,
  removeMember as removeMemberCore,
  type MemberResult,
} from "./members";

/**
 * Server Actions de gestion de equipo.
 *
 * Todas exigen `member:manage`, que hoy solo tiene `owner`. Un `manager` opera
 * el negocio pero no decide quien entra ni con que permisos.
 */

export type { MemberResult };

function revalidateEquipo() {
  revalidatePath("/ajustes/usuarios");
}

export async function inviteMember(input: {
  email: string;
  role: string;
}): Promise<MemberResult> {
  const { tenantId, user } = await requireCapability("member:manage");
  try {
    return await inviteMemberCore({ tenantId, userId: user.id }, input);
  } finally {
    revalidateEquipo();
  }
}

export async function cancelInvitation(id: string): Promise<MemberResult> {
  const { tenantId, user } = await requireCapability("member:manage");
  try {
    return await cancelInvitationCore({ tenantId, userId: user.id }, id);
  } finally {
    revalidateEquipo();
  }
}

export async function changeRole(
  targetUserId: string,
  role: string,
): Promise<MemberResult> {
  const { tenantId, user } = await requireCapability("member:manage");
  try {
    return await changeRoleCore({ tenantId, userId: user.id }, targetUserId, role);
  } finally {
    revalidateEquipo();
  }
}

export async function removeMember(targetUserId: string): Promise<MemberResult> {
  const { tenantId, user } = await requireCapability("member:manage");
  try {
    return await removeMemberCore({ tenantId, userId: user.id }, targetUserId);
  } finally {
    revalidateEquipo();
  }
}
