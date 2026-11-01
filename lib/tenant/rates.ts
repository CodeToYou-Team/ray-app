import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/tenant";
import { exchangeRates } from "@/lib/db/schema";
import { ratePairKey, type RateSuggestion } from "@/lib/finanzas/queries";

/**
 * Tasas vigentes: lo que el dueño declara que está cobrando hoy.
 *
 * Distinto de `lastExchangeRates()`, que deriva de lo ya registrado. Esta es
 * una declaración explícita y por eso gana: si alguien se tomó el trabajo de
 * escribirla, proponerle en su lugar la de la última venta sería ignorarla.
 *
 * Ninguna de las dos toca un monto ya guardado. Solo deciden con qué número
 * llega precargado el formulario.
 */

export interface ConfiguredRate {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  updatedAt: Date;
}

export async function listConfiguredRates(
  tenantId: string,
): Promise<ConfiguredRate[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: exchangeRates.id,
        baseCurrency: exchangeRates.baseCurrency,
        quoteCurrency: exchangeRates.quoteCurrency,
        rate: exchangeRates.rate,
        updatedAt: exchangeRates.updatedAt,
      })
      .from(exchangeRates)
      .where(eq(exchangeRates.tenantId, tenantId))
      .orderBy(asc(exchangeRates.baseCurrency), asc(exchangeRates.quoteCurrency)),
  );
}

/** De dónde salió la tasa que el formulario propone. */
export type RateSource = "configurada" | "ultima";

export interface SuggestedRate extends RateSuggestion {
  source: RateSource;
}

/**
 * Lo que el formulario debe proponer para cada par.
 *
 * La configurada pisa a la derivada. Viaja con su origen para que la pantalla
 * pueda decirlo: "la que tienes fijada" y "la que usaste el 12 de octubre" se
 * aceptan con confianza distinta, y esconderlo haría que una tasa vieja se
 * aplicara sin que nadie la mirara.
 */
export function mergeRateSuggestions(
  ultimas: Record<string, RateSuggestion>,
  configuradas: ConfiguredRate[],
): Record<string, SuggestedRate> {
  const merged: Record<string, SuggestedRate> = {};

  for (const [clave, s] of Object.entries(ultimas)) {
    merged[clave] = { ...s, source: "ultima" };
  }
  for (const c of configuradas) {
    merged[ratePairKey(c.baseCurrency, c.quoteCurrency)] = {
      rate: c.rate,
      // La fecha de la configurada es cuándo se fijó, no la de una operación.
      occurredOn: c.updatedAt.toISOString().slice(0, 10),
      source: "configurada",
    };
  }

  return merged;
}

/** Las dos consultas que necesita una pantalla que vaya a proponer tasas. */
export async function rateSuggestions(
  tenantId: string,
  ultimas: Record<string, RateSuggestion>,
): Promise<Record<string, SuggestedRate>> {
  return mergeRateSuggestions(ultimas, await listConfiguredRates(tenantId));
}

/** Busca una tasa vigente concreta. Devuelve null si no hay ninguna fijada. */
export async function findConfiguredRate(
  tenantId: string,
  base: string,
  quote: string,
): Promise<ConfiguredRate | null> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: exchangeRates.id,
        baseCurrency: exchangeRates.baseCurrency,
        quoteCurrency: exchangeRates.quoteCurrency,
        rate: exchangeRates.rate,
        updatedAt: exchangeRates.updatedAt,
      })
      .from(exchangeRates)
      .where(
        and(
          eq(exchangeRates.tenantId, tenantId),
          eq(exchangeRates.baseCurrency, base),
          eq(exchangeRates.quoteCurrency, quote),
        ),
      ),
  );
  return row ?? null;
}
