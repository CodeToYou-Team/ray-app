import "server-only";

import type { MembershipRole } from "@/lib/db/schema";
import { roleHas } from "@/lib/authz/roles";
import { listCatalogs } from "@/lib/catalogs/queries";
import { lastExchangeRates } from "@/lib/finanzas/queries";
import { rateSuggestions } from "@/lib/tenant/rates";
import { catalogOptionsFor, getFields } from "@/lib/fields/queries";
import { customFields } from "@/lib/fields/resolve";
import type { CobroConfig } from "@/components/reservas/booking-payment";
import type { BookingFields, CampoFijo, CamposFijos } from "@/components/reservas/types";

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

const CAMPOS_FIJOS: CampoFijo[] = ["holder_name", "holder_document", "holder_phone", "notes"];

/**
 * Las columnas de la reserva: las mismas para el formulario, el detalle y el
 * listado, que es lo que impide que una pantalla muestre un campo que la otra
 * no deja escribir.
 */
export async function loadBookingFields(tenantId: string): Promise<BookingFields> {
  // Con las ocultas: de una fija oculta hace falta saber que lo está.
  const todas = await getFields(tenantId, "booking", { includeHidden: true });
  const fields = customFields(todas).filter((f) => !f.hidden);

  const fijos = Object.fromEntries(
    CAMPOS_FIJOS.map((key) => {
      const f = todas.find((c) => c.source === "fixed" && c.key === key);
      if (!f) throw new Error(`Columna fija de reserva sin declarar: ${key}`);
      return [key, { label: f.label, visible: !f.hidden, enTabla: !f.hidden && f.showInTable }];
    }),
  ) as CamposFijos;

  return { fijos, fields, catalogos: await catalogOptionsFor(tenantId, fields) };
}
