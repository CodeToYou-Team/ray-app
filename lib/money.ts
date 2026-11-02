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

/**
 * Tasa de cambio: hasta 6 decimales y siempre positiva.
 *
 * Seis porque con monedas muy devaluadas la tasa inversa necesita esa
 * precision (1 VES = 0.002577 USD), y porque es la escala con la que publican
 * las tasas oficiales. Negativa o cero no es una tasa: daria un monto negativo
 * o cero sin que nadie lo pidiera.
 */
const RATE_RE = /^\d{1,12}(\.\d{1,6})?$/;

/** Zod-compatible: valida un monto con hasta 2 decimales. */
export function isMoney(value: string): boolean {
  return MONEY_RE.test(value.trim());
}

/** Valida una cantidad con hasta 3 decimales. */
export function isQuantity(value: string): boolean {
  return QTY_RE.test(value.trim());
}

/** Valida una tasa de cambio: hasta 6 decimales, mayor que cero. */
export function isRate(value: string): boolean {
  const trimmed = value.trim();
  return RATE_RE.test(trimmed) && toScaled(trimmed, 6) > 0n;
}

/** Normaliza una tasa a 6 decimales: "40" -> "40.000000". */
export function normalizeRate(value: string): string {
  return fromScaled(toScaled(value, 6), 6);
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

/**
 * Aplica una tasa de cambio a un monto. 2 decimales, redondeo half-up.
 *
 * Es la unica conversion entre monedas que hace la app, y solo con la tasa que
 * tecleo quien registro la operacion: no hay tabla de tasas ni consulta a
 * ningun servicio. Los totales se siguen llevando separados por moneda y nunca
 * se suman entre si — esto convierte el precio de catalogo de un renglon al
 * momento de registrarlo, nada mas.
 *
 * El redondeo es half-up y coincide con `round(x, 2)` de Postgres (verificado
 * en tests/money.test.ts). Aqui no lo exige ningun CHECK — el precio convertido
 * es solo lo que se guarda en `unit_price` — pero redondear igual que el resto
 * de la aritmetica es lo que hace que el total que se muestra antes de guardar
 * sea el mismo que queda guardado.
 */
export function convertMoney(amount: string, rate: string): string {
  const a = toScaled(amount, 2); // x100
  const r = toScaled(rate, 6); // x1e6
  if (r <= 0n) throw new Error(`Tasa de cambio invalida: ${rate}`);

  const product = a * r; // x1e8
  const negative = product < 0n;
  const magnitude = negative ? -product : product;

  // De 1e8 a 1e2: dividir entre 1e6 con redondeo half-up.
  const divisor = 1_000_000n;
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

/**
 * Multiplica una cantidad por un entero, exacto: 1,5 horas × 4 personas = 6.
 *
 * Solo enteros a propósito: el factor es un conteo (personas, cupos), y
 * aceptar decimales abriría la puerta a "2,7 personas".
 */
export function multiplyQuantity(value: string, factor: number): string {
  if (!Number.isInteger(factor)) {
    throw new Error(`El factor tiene que ser entero: ${factor}`);
  }
  return fromScaled(toScaled(value, 3) * BigInt(factor), 3);
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
