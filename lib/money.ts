/**
 * Aritmetica de dinero exacta, sobre strings y BigInt.
 *
 * El dinero viaja como `string` de extremo a extremo: `numeric` en Postgres,
 * `string` en TypeScript. Nunca un `number` de JS — 0.1 + 0.2 no da 0.3, y en
 * una tabla de dinero ese error se acumula hasta que la caja no cuadra y nadie
 * sabe por que.
 *
 * Internamente se trabaja con enteros escalados (centavos, milesimas), que es
 * la unica forma de que las operaciones sean exactas.
 */

const MONEY_RE = /^-?\d{1,12}(\.\d{1,2})?$/;
const QTY_RE = /^-?\d{1,12}(\.\d{1,3})?$/;

/** Zod-compatible: valida un monto con hasta 2 decimales. */
export function isMoney(value: string): boolean {
  return MONEY_RE.test(value.trim());
}

/** Valida una cantidad con hasta 3 decimales. */
export function isQuantity(value: string): boolean {
  return QTY_RE.test(value.trim());
}

/** "12.5" con escala 2 -> 1250n. Lanza si el string no es valido. */
function toScaled(value: string, scale: number): bigint {
  const trimmed = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) throw new Error(`Valor numerico invalido: ${value}`);

  const [, sign, whole, frac = ""] = match;
  if (frac.length > scale) {
    throw new Error(`${value} tiene mas de ${scale} decimales`);
  }

  const padded = frac.padEnd(scale, "0");
  const magnitude = BigInt(whole + padded);
  return sign === "-" ? -magnitude : magnitude;
}

/** 1250n con escala 2 -> "12.50". Siempre con los decimales completos. */
function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : "";
  return `${negative ? "-" : ""}${whole}${frac}`;
}

/** Normaliza a 2 decimales: "12.5" -> "12.50", "12" -> "12.00". */
export function normalizeMoney(value: string): string {
  return fromScaled(toScaled(value, 2), 2);
}

/** Normaliza a 3 decimales. */
export function normalizeQuantity(value: string): string {
  return fromScaled(toScaled(value, 3), 3);
}

/**
 * qty (3 decimales) x precio (2 decimales), redondeado a 2 decimales.
 *
 * El redondeo es half-up sobre el valor absoluto, que es lo que espera
 * cualquiera mirando una factura, y lo que hace `round()` de Postgres — asi el
 * CHECK `subtotal = round(qty * unit_price, 2)` coincide con lo que calculamos
 * aca y no rechaza filas correctas.
 */
export function lineSubtotal(qty: string, unitPrice: string): string {
  const q = toScaled(qty, 3); // x1000
  const p = toScaled(unitPrice, 2); // x100
  const product = q * p; // x100000

  const negative = product < 0n;
  const magnitude = negative ? -product : product;

  // De 1e5 a 1e2: dividir entre 1000 con redondeo half-up.
  const divisor = 1000n;
  const rounded = (magnitude + divisor / 2n) / divisor;

  return fromScaled(negative ? -rounded : rounded, 2);
}

/** Suma montos con 2 decimales. Exacta. */
export function sumMoney(values: string[]): string {
  const total = values.reduce((acc, v) => acc + toScaled(v, 2), 0n);
  return fromScaled(total, 2);
}

/** Resta exacta de montos con 2 decimales. */
export function subtractMoney(a: string, b: string): string {
  return fromScaled(toScaled(a, 2) - toScaled(b, 2), 2);
}

/** Suma cantidades con 3 decimales. */
export function sumQuantity(values: string[]): string {
  const total = values.reduce((acc, v) => acc + toScaled(v, 3), 0n);
  return fromScaled(total, 3);
}

/** Resta exacta de cantidades con 3 decimales. */
export function subtractQuantity(a: string, b: string): string {
  return fromScaled(toScaled(a, 3) - toScaled(b, 3), 3);
}

/** Niega una cantidad: la salida de stock de una venta. */
export function negateQuantity(value: string): string {
  return fromScaled(-toScaled(value, 3), 3);
}

/** Compara dos montos. Devuelve -1, 0 o 1. */
export function compareMoney(a: string, b: string): number {
  const x = toScaled(a, 2);
  const y = toScaled(b, 2);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isZero(value: string, scale = 2): boolean {
  return toScaled(value, scale) === 0n;
}
