import "server-only";

import type { MembershipRole } from "@/lib/db/schema";
import { roleHas } from "@/lib/authz/roles";
import { listCatalogs } from "@/lib/catalogs/queries";
import { lastExchangeRates } from "@/lib/finanzas/queries";
import { rateSuggestions } from "@/lib/tenant/rates";
import { catalogOptionsFor, getFields } from "@/lib/fields/queries";
import { customFields } from "@/lib/fields/resolve";
import type { CobroConfig } from "@/components/reservas/booking-payment";
import type { BookingFields } from "@/components/reservas/types";

/**
 * Lo que hace falta para cobrar una reserva: métodos de pago, categorías de
 * ingreso y tasas sugeridas.
 *
 * Lo comparten Disponibilidad y el Listado, porque el detalle de una reserva
 * (y su botón Cobrar) es el mismo en las dos pantallas.
 *
 * Cobrar es registrar un ingreso: sin `transaction:create` no se carga nada,
 * y el detalle no ofrece el botón.
 */
export async function loadCobroConfig(
  tenantId: string,
  role: MembershipRole,
): Promise<CobroConfig | null> {
  if (!roleHas(role, "transaction:create")) return null;

  const [catalogos, tasas] = await Promise.all([
    listCatalogs(tenantId, ["income_category", "payment_method"]),
    lastExchangeRates(tenantId).then((u) => rateSuggestions(tenantId, u)),
  ]);

  return {
    paymentMethods: (catalogos.payment_method ?? []).map((m) => ({
      id: m.id,
      label: m.label,
      currency: m.currency ?? "",
    })),
    categories: (catalogos.income_category ?? []).map((c) => ({
      id: c.id,
      label: c.label,
    })),
    tasas,
  };
}

/**
 * Las columnas personalizadas de la reserva: las mismas para el formulario,
 * el detalle y el listado, que es lo que impide que una pantalla muestre un
 * campo que la otra no deja escribir.
 */
export async function loadBookingFields(tenantId: string): Promise<BookingFields> {
  const fields = customFields(await getFields(tenantId, "booking"));
  return { fields, catalogos: await catalogOptionsFor(tenantId, fields) };
}
