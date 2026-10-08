"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireCapability } from "@/lib/authz/session";
import { withTenant } from "@/lib/db/tenant";
import { tenants } from "@/lib/db/schema";
import { isKnownCurrency } from "@/lib/currencies";

/**
 * Configuración del negocio.
 *
 * Por ahora solo la moneda por defecto, que es la que hacía falta para que
 * vender en otra moneda tenga contra qué compararse.
 */

export type SettingsResult = { ok: true } | { ok: false; error: string };

/**
 * Cambia la moneda por defecto del negocio.
 *
 * NO toca ni una transacción ya registrada. Cada operación guarda su moneda
 * como snapshot a propósito: si cambiar este ajuste reescribiera el pasado,
 * los totales de meses cerrados cambiarían de significado solos. Lo único que
 * hace es decidir qué se propone por defecto de aquí en adelante.
 */
export async function setPrimaryCurrency(currency: string): Promise<SettingsResult> {
  const { tenantId } = await requireCapability("tenant:manage");

  const code = currency.trim().toUpperCase();
  // La lista es cerrada: un código mal escrito no da error, parte una moneda en
  // dos en silencio y nadie se entera hasta que las cuentas no cuadran.
  if (!isKnownCurrency(code)) {
    return { ok: false, error: "Esa moneda no está en la lista." };
  }

  try {
    await withTenant(tenantId, (tx) =>
      tx
        .update(tenants)
        .set({ primaryCurrency: code })
        .where(eq(tenants.id, tenantId)),
    );
  } catch {
    return { ok: false, error: "No se pudo guardar la moneda." };
  }

  revalidatePath("/ajustes/negocio");
  revalidatePath("/productos");
  revalidatePath("/dashboard");
  return { ok: true };
}
