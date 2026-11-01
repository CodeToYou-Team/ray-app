"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { requireCapability } from "@/lib/authz/session";
import { withTenant } from "@/lib/db/tenant";
import { exchangeRates, tenants } from "@/lib/db/schema";
import { isKnownCurrency } from "@/lib/currencies";
import { isRate, normalizeRate } from "@/lib/money";

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

/** Las pantallas donde se propone una tasa al registrar. */
function revalidateRates() {
  revalidatePath("/ajustes/negocio");
  revalidatePath("/finanzas/ingresos");
  revalidatePath("/finanzas/gastos");
  revalidatePath("/finanzas/movimientos");
}

/**
 * Fija (o actualiza) la tasa vigente de un par de monedas.
 *
 * NO reescribe ninguna operación. Cada una guarda la tasa con la que se
 * registró: esto solo decide con qué número llega precargado el formulario de
 * aquí en adelante. Si cambiar este valor moviera montos ya asentados, los
 * totales de meses cerrados cambiarían solos.
 */
export async function saveExchangeRate(input: {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
}): Promise<SettingsResult> {
  const { tenantId, user } = await requireCapability("tenant:manage");

  const base = input.baseCurrency.trim().toUpperCase();
  const quote = input.quoteCurrency.trim().toUpperCase();

  if (!isKnownCurrency(base) || !isKnownCurrency(quote)) {
    return { ok: false, error: "Alguna de las dos monedas no está en la lista." };
  }
  if (base === quote) {
    return {
      ok: false,
      error: "Una moneda no se cambia por sí misma. Elige dos distintas.",
    };
  }
  if (!isRate(input.rate)) {
    return {
      ok: false,
      error: "La tasa tiene que ser mayor que cero, con hasta 6 decimales.",
    };
  }

  const rate = normalizeRate(input.rate);

  try {
    await withTenant(tenantId, (tx) =>
      tx
        .insert(exchangeRates)
        .values({
          id: uuidv7(),
          tenantId,
          baseCurrency: base,
          quoteCurrency: quote,
          rate,
          updatedBy: user.id,
        })
        // Hay una sola tasa vigente por par: volver a guardar el mismo par la
        // reemplaza en vez de dejar dos filas y que el formulario elija en
        // silencio cuál proponer.
        .onConflictDoUpdate({
          target: [
            exchangeRates.tenantId,
            exchangeRates.baseCurrency,
            exchangeRates.quoteCurrency,
          ],
          set: { rate, updatedBy: user.id, updatedAt: new Date() },
        }),
    );
  } catch {
    return { ok: false, error: "No se pudo guardar la tasa." };
  }

  revalidateRates();
  return { ok: true };
}

/**
 * Quita una tasa vigente.
 *
 * Se borra de verdad, a diferencia de los catálogos: acá no hay histórico que
 * preservar porque cada operación ya guarda la tasa con la que se registró.
 * Sin tasa fijada, el formulario vuelve a proponer la última que se usó.
 */
export async function deleteExchangeRate(id: string): Promise<SettingsResult> {
  const { tenantId } = await requireCapability("tenant:manage");

  try {
    await withTenant(tenantId, (tx) =>
      tx
        .delete(exchangeRates)
        .where(
          and(eq(exchangeRates.id, id), eq(exchangeRates.tenantId, tenantId)),
        ),
    );
  } catch {
    return { ok: false, error: "No se pudo quitar la tasa." };
  }

  revalidateRates();
  return { ok: true };
}
