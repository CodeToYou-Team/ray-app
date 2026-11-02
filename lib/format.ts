/**
 * Helpers de formato compartidos.
 *
 * Como los totales van separados por moneda y no se convierte nada entre ellas
 * (ver docs/plan_arquitectura_v2.md), `formatMoney` EXIGE la moneda: no hay un
 * formateador de dinero sin moneda, porque no habria forma de que fuera correcto.
 */

/** Locale por defecto. Pasa a ser configurable por cliente cuando exista `tenants`. */
export const DEFAULT_LOCALE = "es-VE";

/**
 * Intl formatea VES como "VES" o "Bs.S" segun el runtime, y ninguno es lo que
 * espera un usuario venezolano. Solo se sobreescriben los casos incomodos.
 */
const NARROW_SYMBOLS: Record<string, string> = {
  VES: "Bs",
};

export interface FormatMoneyOptions {
  locale?: string;
  /** Decimales. Por defecto 2, que es lo correcto para dinero. */
  fractionDigits?: number;
  /** Omite el simbolo y devuelve solo el numero. Util en tablas con la moneda en el encabezado. */
  omitSymbol?: boolean;
}

/**
 * Formatea un monto en su moneda.
 *
 * Acepta `string` porque el dinero viaja como string de extremo a extremo:
 * `numeric` en Postgres, `string` en TypeScript. Un `number` de JS no puede
 * representar exactamente todos los decimales y no debe usarse para dinero.
 * Se acepta `number` solo por los datos mock que todavia quedan.
 */
export function formatMoney(
  amount: string | number,
  currency: string,
  options: FormatMoneyOptions = {},
): string {
  const {
    locale = DEFAULT_LOCALE,
    fractionDigits = 2,
    omitSymbol = false,
  } = options;

  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";

  const code = currency.toUpperCase();

  if (omitSymbol) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  }

  const override = NARROW_SYMBOLS[code];
  if (override) {
    const number = new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
    return `${override} ${number}`;
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/**
 * Formatea una fecha. Para un string de solo fecha ("2026-09-03") se le agrega la
 * hora local a proposito: parsearlo directo lo interpretaria como UTC y en
 * America/Caracas mostraria el dia anterior.
 */
export function formatDate(
  dateStr: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const date = new Date(isDateOnly ? `${dateStr}T00:00:00` : dateStr);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Una cantidad sin los ceros de relleno: "7.000" -> "7", "1.500" -> "1.5".
 * Solo recorta detras del punto, para que "10" no quede en "1".
 */
export function formatQuantity(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

/** Variacion porcentual redondeada. Devuelve 0 si no hay base con la que comparar. */
export function getPercentChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return Math.round(((current - previous) / previous) * 100);
}
