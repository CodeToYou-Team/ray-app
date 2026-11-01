/**
 * El rango de una reserva: cómo se pide y cuánto se cobra.
 *
 * Todo lo de este archivo es aritmética sobre fechas y horas LOCALES ya
 * escritas como texto, y no depende de ninguna zona horaria: del 10 al 12 son
 * dos noches en Caracas y en Tokio. Por eso lo puede usar el navegador para la
 * vista previa del total.
 *
 * Lo que SÍ depende de la zona —convertir "la noche del 10" en un instante
 * real— vive en ./periodo.ts y lo hace Postgres. Ver la nota de ese archivo.
 */

export type Unidad = "noche" | "hora";

/** Por noche: la fecha de entrada y la de salida, en hora local del negocio. */
export interface RangoNoches {
  unidad: "noche";
  /** YYYY-MM-DD. Primera noche. */
  desde: string;
  /** YYYY-MM-DD. Día de salida: esa noche NO se cobra. */
  hasta: string;
}

/** Por hora: un día y un tramo, en hora local del negocio. */
export interface RangoHoras {
  unidad: "hora";
  /** YYYY-MM-DD */
  fecha: string;
  /** HH:MM */
  inicio: string;
  /** HH:MM */
  fin: string;
}

export type Rango = RangoNoches | RangoHoras;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Tramo mínimo por hora. Ver `cantidad()`. */
export const TRAMO_MINUTOS = 30;

/** Una reserva por noche no puede pasar de esto. Un año es ya un alquiler. */
export const MAX_NOCHES = 365;

/** Días desde el 1970-01-01 de una fecha escrita, sin pasar por ninguna zona. */
function diaAbsoluto(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Valida que la fecha exista de verdad: "2026-02-30" tiene la forma pero no. */
export function fechaValida(fecha: string): boolean {
  if (!FECHA.test(fecha)) return false;
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return (
    t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
  );
}

function minutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

export type Cantidad =
  | { ok: true; qty: string; descripcion: string }
  | { ok: false; error: string };

/**
 * Cuántas unidades se cobran, validando el rango de paso.
 *
 * Devuelve `qty` como texto para que entre directo en la aritmética de
 * `lib/money.ts` (y, en la fase 2, en `transaction_items.qty`).
 */
export function cantidad(rango: Rango): Cantidad {
  if (rango.unidad === "noche") {
    if (!fechaValida(rango.desde) || !fechaValida(rango.hasta)) {
      return { ok: false, error: "Alguna de las dos fechas no es válida." };
    }
    const noches = diaAbsoluto(rango.hasta) - diaAbsoluto(rango.desde);
    if (noches <= 0) {
      return {
        ok: false,
        error: "La salida tiene que ser al menos un día después de la entrada.",
      };
    }
    if (noches > MAX_NOCHES) {
      return { ok: false, error: `Una reserva no puede pasar de ${MAX_NOCHES} noches.` };
    }
    return {
      ok: true,
      qty: String(noches),
      descripcion: noches === 1 ? "1 noche" : `${noches} noches`,
    };
  }

  if (!fechaValida(rango.fecha)) {
    return { ok: false, error: "La fecha no es válida." };
  }
  if (!HORA.test(rango.inicio) || !HORA.test(rango.fin)) {
    return { ok: false, error: "Usa horas con el formato 14:30." };
  }
  const duracion = minutos(rango.fin) - minutos(rango.inicio);
  // Un tramo que cruza la medianoche (22:00 a 01:00) queda fuera de la fase 1:
  // habría que pedir dos fechas, y la mayoría de canchas y salas cierran antes.
  if (duracion <= 0) {
    return {
      ok: false,
      error: "La hora de fin tiene que ser después de la de inicio, el mismo día.",
    };
  }
  // En tramos de 30 minutos: cubre la cancha de hora y media sin abrir la
  // puerta a duraciones de 17 minutos que nadie cobra.
  if (duracion % TRAMO_MINUTOS !== 0) {
    return {
      ok: false,
      error: `La duración tiene que ir en tramos de ${TRAMO_MINUTOS} minutos.`,
    };
  }
  // Exacto: con tramos de 30 minutos solo salen enteros o ,5, que la
  // aritmética de cantidades (3 decimales) representa sin pérdida.
  const horas = duracion / 60;
  const qty = Number.isInteger(horas) ? String(horas) : horas.toFixed(1);
  return {
    ok: true,
    qty,
    descripcion: horas === 1 ? "1 hora" : `${qty.replace(".", ",")} horas`,
  };
}

/** La unidad, como se dice en pantalla. */
export function unidadLabel(unidad: Unidad): string {
  return unidad === "noche" ? "por noche" : "por hora";
}

/** Suma días a una fecha escrita, sin pasar por ninguna zona horaria. */
export function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** La fecha de hoy en la zona del negocio, no en la del servidor ni la del navegador. */
export function hoyEn(timezone: string): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Si dos rangos LOCALES se cruzan, comparando texto.
 *
 * Solo para la vista previa del formulario ("esta habitación ya está ocupada
 * esos días"). La palabra final la tiene el EXCLUDE de la base: esto solo
 * evita ofrecer lo que ya se sabe ocupado.
 */
export function seCruzan(
  a: { inicio: string; fin: string },
  b: { inicio: string; fin: string },
): boolean {
  // Semiabiertos [inicio, fin): tocarse en el borde no es cruzarse.
  return a.inicio < b.fin && b.inicio < a.fin;
}

/** Los bordes locales de un rango, en el mismo formato que devuelve la base. */
export function bordesLocales(rango: Rango): { inicio: string; fin: string } {
  if (rango.unidad === "noche") {
    return { inicio: `${rango.desde}T00:00`, fin: `${rango.hasta}T00:00` };
  }
  return {
    inicio: `${rango.fecha}T${rango.inicio}`,
    fin: `${rango.fecha}T${rango.fin}`,
  };
}
