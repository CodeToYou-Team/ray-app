"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/authz/session";
import {
  editTransaction,
  registerTransaction,
  revertTransaction,
  type CreateTransactionInput,
  type EditTransactionInput,
  type TxResult,
} from "./register";

/**
 * Server Actions de finanzas.
 *
 * Son envoltorios finos: exigen el permiso y delegan en lib/finanzas/register.ts,
 * donde vive la logica de dinero e inventario. La separacion existe para que esa
 * logica se pueda testear sin simular una sesion.
 *
 * Un Server Action es un endpoint POST publico, no una rutina interna: que la UI
 * no pinte el boton no impide que alguien invoque la accion directamente. De ahi
 * que el permiso se exija aqui y no en el componente.
 */

export type { CreateTransactionInput, EditTransactionInput, TxResult };

function revalidateFinanzas() {
  revalidatePath("/finanzas/ingresos");
  revalidatePath("/finanzas/gastos");
  revalidatePath("/finanzas/movimientos");
  revalidatePath("/inventario");
  revalidatePath("/dashboard");
}

export async function createTransaction(
  input: CreateTransactionInput,
): Promise<TxResult> {
  const { tenantId, user } = await requireCapability("transaction:create");
  try {
    return await registerTransaction({ tenantId, userId: user.id }, input);
  } finally {
    revalidateFinanzas();
  }
}

/**
 * Corrige una operacion ya registrada.
 *
 * Exige `transaction:update`, que el rol `staff` no tiene: quien registra en el
 * dia a dia puede equivocarse, pero reescribir lo que ya quedo asentado es cosa
 * del dueño o el encargado.
 */
export async function updateTransaction(
  input: EditTransactionInput,
): Promise<TxResult> {
  const { tenantId, user } = await requireCapability("transaction:update");
  try {
    return await editTransaction({ tenantId, userId: user.id }, input);
  } finally {
    revalidateFinanzas();
  }
}

export async function voidTransaction(input: {
  id: string;
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { tenantId, user } = await requireCapability("transaction:delete");
  try {
    return await revertTransaction({ tenantId, userId: user.id }, input);
  } finally {
    revalidateFinanzas();
  }
}
