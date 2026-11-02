import "server-only";

import type { MembershipRole } from "@/lib/db/schema";
import { roleHas } from "@/lib/authz/roles";
import { listCatalogs } from "@/lib/catalogs/queries";
import { lastExchangeRates } from "@/lib/finanzas/queries";
import { rateSuggestions } from "@/lib/tenant/rates";
import type { CobroConfig } from "@/components/reservas/booking-payment";

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
