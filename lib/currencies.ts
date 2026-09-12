/**
 * Monedas que la app conoce.
 *
 * La lista es cerrada a proposito. El codigo de moneda no es una etiqueta: es lo
 * que agrupa los totales, y como NO se convierte nada entre monedas, un valor
 * mal escrito no da error — parte una moneda en dos en silencio. "USD" y "usd"
 * serian dos columnas distintas en el dashboard y nadie se enteraria hasta que
 * las cuentas no cuadren.
 *
 * Agregar una moneda es una linea aca. No hace falta migracion: la base guarda
 * `char(3)` y no valida contra esta lista.
 */
export interface CurrencyDef {
  code: string;
  /** Nombre que ve el usuario. */
  name: string;
  /** Simbolo corto para las listas. */
  symbol: string;
}

/** Las del dia a dia, arriba en el selector. */
export const PRIMARY_CURRENCIES: CurrencyDef[] = [
  { code: "USD", name: "Dólar estadounidense", symbol: "$" },
  { code: "VES", name: "Bolívar", symbol: "Bs" },
  { code: "EUR", name: "Euro", symbol: "€" },
];

/**
 * Stablecoins. Van SEPARADAS de USD a proposito, aunque esten ancladas a el:
 * son medios de pago distintos, se liquidan distinto y tienen comisiones
 * propias. Como los totales no se convierten entre monedas, tenerlas aparte es
 * justo lo que permite responder "cuanto entro por Zelle y cuanto por USDT".
 *
 * Ojo: sus codigos son de 4 caracteres, no 3 como los ISO 4217. Por eso las
 * columnas de moneda son varchar(10) y no char(3).
 */
export const STABLECOINS: CurrencyDef[] = [
  { code: "USDT", name: "Tether", symbol: "₮" },
  { code: "USDC", name: "USD Coin", symbol: "$" },
];

/** El resto, por si un cliente opera en otro mercado. */
export const OTHER_CURRENCIES: CurrencyDef[] = [
  { code: "COP", name: "Peso colombiano", symbol: "$" },
  { code: "BRL", name: "Real brasileño", symbol: "R$" },
  { code: "PEN", name: "Sol peruano", symbol: "S/" },
  { code: "CLP", name: "Peso chileno", symbol: "$" },
  { code: "ARS", name: "Peso argentino", symbol: "$" },
  { code: "MXN", name: "Peso mexicano", symbol: "$" },
  { code: "GBP", name: "Libra esterlina", symbol: "£" },
];

export const CURRENCIES: CurrencyDef[] = [
  ...PRIMARY_CURRENCIES,
  ...STABLECOINS,
  ...OTHER_CURRENCIES,
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function isKnownCurrency(code: string): boolean {
  return BY_CODE.has(code.trim().toUpperCase());
}

/**
 * Busca una moneda por codigo. Devuelve undefined si no esta en la lista — pasa
 * con datos historicos de una moneda que despues se saco, y hay que mostrarlos
 * igual en vez de dejar un hueco.
 */
export function findCurrency(code: string): CurrencyDef | undefined {
  return BY_CODE.get(code.trim().toUpperCase());
}

/** "USD" -> "USD — Dólar estadounidense". Para selectores y detalles. */
export function currencyLabel(code: string): string {
  const found = findCurrency(code);
  return found ? `${found.code} — ${found.name}` : code;
}
