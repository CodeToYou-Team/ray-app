/**
 * Fechas de calendario del negocio, como "YYYY-MM-DD".
 *
 * La regla: **"hoy" es el hoy del negocio** (`tenants.timezone`), no el del
 * servidor ni el UTC. Node corre en UTC, y `new Date().toISOString()` en
 * Caracas da el día siguiente a partir de las 20:00: una venta de las 21:00
 * quedaba fechada mañana y "este mes" cambiaba de mes cuatro horas antes.
 *
 * Todo lo demás es aritmética sobre el texto de la fecha, sin zona horaria, así
 * que el navegador también puede importar este archivo.
 */

/** La fecha de hoy en la zona del negocio, no en la del servidor ni la del navegador. */
export function hoyEn(timezone: string): string {
  return fechaEn(new Date(), timezone);
}

/** Qué día era un instante en la zona del negocio. */
export function fechaEn(instante: Date, timezone: string): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

/** Suma días a una fecha escrita, sin pasar por ninguna zona horaria. */
export function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * Primer y último día del mes de `fecha`, desplazado `offset` meses.
 *
 * `Date.UTC` solo se usa como calculadora de calendario: entra un día escrito y
 * sale otro día escrito, sin que ninguna zona horaria lo mueva.
 */
export function mesDe(fecha: string, offset = 0): { from: string; to: string } {
  const [y, m] = fecha.split("-").map(Number);
  const inicio = new Date(Date.UTC(y, m - 1 + offset, 1));
  // El día 0 del mes siguiente es el último de este.
  const fin = new Date(Date.UTC(y, m + offset, 0));
  return {
    from: inicio.toISOString().slice(0, 10),
    to: fin.toISOString().slice(0, 10),
  };
}
