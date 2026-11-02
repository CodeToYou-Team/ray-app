"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/authz/session";
import {
  archiveResource as archiveResourceCore,
  cancelBooking as cancelBookingCore,
  checkIn as checkInCore,
  checkOut as checkOutCore,
  createBooking as createBookingCore,
  createResource as createResourceCore,
  markNoShow as markNoShowCore,
  registerPayment as registerPaymentCore,
  setServiceBookingUnit as setServiceBookingUnitCore,
  type BookingResult,
  type CheckOutResult,
  type CreateBookingInput,
  type PaymentResult,
  type RegisterPaymentInput,
  type Result,
} from "./register";

/**
 * Server Actions de reservas.
 *
 * Envoltorios finos: exigen el permiso y delegan en register.ts. Un Server
 * Action es un endpoint POST público, así que el permiso va aquí y no en el
 * componente que pinta el botón.
 */

export type {
  BookingResult,
  CheckOutResult,
  CreateBookingInput,
  PaymentResult,
  RegisterPaymentInput,
  Result,
};

function revalidateReservas() {
  revalidatePath("/reservas");
  revalidatePath("/reservas/recursos");
}

export async function createBooking(
  input: CreateBookingInput,
): Promise<BookingResult> {
  const { tenantId, user } = await requireCapability("booking:manage");
  try {
    return await createBookingCore({ tenantId, userId: user.id }, input);
  } finally {
    revalidateReservas();
  }
}

export async function cancelBooking(input: {
  id: string;
  reason?: string;
}): Promise<Result> {
  const { tenantId, user } = await requireCapability("booking:manage");
  try {
    return await cancelBookingCore({ tenantId, userId: user.id }, input);
  } finally {
    revalidateReservas();
  }
}

export async function setServiceBookingUnit(input: {
  serviceId: string;
  unidad: "noche" | "hora" | null;
}): Promise<Result> {
  const { tenantId, user } = await requireCapability("resource:manage");
  try {
    return await setServiceBookingUnitCore({ tenantId, userId: user.id }, input);
  } finally {
    revalidateReservas();
  }
}

export async function createResource(input: {
  serviceId: string;
  name: string;
  notes?: string;
}): Promise<Result<{ id: string }>> {
  const { tenantId, user } = await requireCapability("resource:manage");
  try {
    return await createResourceCore({ tenantId, userId: user.id }, input);
  } finally {
    revalidateReservas();
  }
}

export async function archiveResource(input: { id: string }): Promise<Result> {
  const { tenantId, user } = await requireCapability("resource:manage");
  try {
    return await archiveResourceCore({ tenantId, userId: user.id }, input);
  } finally {
    revalidateReservas();
  }
}

// ---------------------------------------------------------------------------
// Fase 2
// ---------------------------------------------------------------------------

export async function checkIn(input: { id: string }): Promise<Result> {
  const { tenantId, user } = await requireCapability("booking:manage");
  try {
    return await checkInCore({ tenantId, userId: user.id }, input);
  } finally {
    revalidateReservas();
  }
}

export async function checkOut(input: {
  id: string;
  aceptarSaldo?: boolean;
}): Promise<CheckOutResult> {
  const { tenantId, user } = await requireCapability("booking:manage");
  try {
    return await checkOutCore({ tenantId, userId: user.id }, input);
  } finally {
    revalidateReservas();
  }
}

export async function markNoShow(input: { id: string }): Promise<Result> {
  const { tenantId, user } = await requireCapability("booking:manage");
  try {
    return await markNoShowCore({ tenantId, userId: user.id }, input);
  } finally {
    revalidateReservas();
  }
}

/**
 * Cobrar exige `transaction:create`, no `booking:manage`: lo que hace es
 * registrar un ingreso, y ese es el permiso que gobierna los ingresos.
 */
export async function registerPayment(
  input: RegisterPaymentInput,
): Promise<PaymentResult> {
  const { tenantId, user } = await requireCapability("transaction:create");
  try {
    return await registerPaymentCore({ tenantId, userId: user.id }, input);
  } finally {
    revalidateReservas();
    // El cobro es un ingreso: aparece en Finanzas desde ya.
    revalidatePath("/finanzas/ingresos");
    revalidatePath("/finanzas/movimientos");
    revalidatePath("/dashboard");
  }
}
