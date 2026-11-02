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

import { lineSubtotal, multiplyQuantity } from "@/lib/money";

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

// Viven en lib/fechas.ts porque Finanzas también las necesita; se reexportan
// para no mover todos los imports de Reservas.
export { hoyEn, sumarDias } from "@/lib/fechas";

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

/**
 * El total de una reserva.
 *
 * Por reserva: unidades × precio (la habitación, 2 noches × 40, vayan 1 o 3).
 * Por persona: unidades × personas × precio (el tour, 1 día × 3 × 15).
 *
 * Una sola multiplicación con un solo redondeo, en vez de redondear el
 * subtotal por persona y después multiplicar: así el total coincide con el
 * que calcularía cualquiera con la calculadora.
 */
export function totalReserva(input: {
  qty: string;
  partySize: number;
  perPerson: boolean;
  unitPrice: string;
}): string {
  const unidades = input.perPerson
    ? multiplyQuantity(input.qty, input.partySize)
    : input.qty;
  return lineSubtotal(unidades, input.unitPrice);
}

/**
 * La mayor ocupación (en personas) dentro de un rango, contando reservas que
 * se cruzan con él.
 *
 * Mismo criterio que el trigger de capacidad: la ocupación solo sube donde
 * empieza una reserva, así que basta mirarla en el inicio del rango y en cada
 * inicio de otra reserva que caiga dentro. Compara texto porque los bordes
 * vienen todos en hora local del negocio.
 *
 * Es para mostrar "quedan 3 cupos" antes de enviar. La palabra final la tiene
 * el trigger, con la fila del recurso bloqueada.
 */
export function ocupacionMaxima(
  pedido: { inicio: string; fin: string },
  reservas: { inicio: string; fin: string; partySize: number }[],
): number {
  const dentro = reservas.filter((r) => seCruzan(pedido, r));
  const puntos = [
    pedido.inicio,
    ...dentro.map((r) => r.inicio).filter((p) => p > pedido.inicio && p < pedido.fin),
  ];
  let pico = 0;
  for (const p of puntos) {
    const ocupado = dentro
      .filter((r) => r.inicio <= p && p < r.fin)
      .reduce((acc, r) => acc + r.partySize, 0);
    pico = Math.max(pico, ocupado);
  }
  return pico;
}

// ---------------------------------------------------------------------------
// Horarios fijos
// ---------------------------------------------------------------------------

/** Un turno publicado de un servicio por hora. Horas locales "HH:MM". */
export interface Turno {
  id: string;
  /** ISO: 1 = lunes … 7 = domingo. */
  weekday: number;
  start: string;
  end: string;
}

/** Índice 0 = lunes (ISO 1). */
export const DIAS_SEMANA = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
] as const;

/** "los lunes", "los sábados": para mensajes como "no tiene turnos los domingos". */
export function losDias(weekday: number): string {
  const dia = DIAS_SEMANA[weekday - 1];
  // "lunes", "martes"… ya terminan en s; "sábado" y "domingo" no.
  return `los ${dia.endsWith("s") ? dia : `${dia}s`}`;
}

/**
 * El día de la semana ISO (1 = lunes) de una fecha LOCAL escrita.
 *
 * Sale de la fecha, no de un instante: una clase a las 21:00 de un martes en
 * Caracas ya es miércoles en UTC. Calcularlo desde el timestamp en el servidor
 * (que corre en UTC) la mandaría al día equivocado.
 */
export function diaSemanaIso(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Los turnos de un día concreto, en orden. */
export function turnosDelDia(turnos: Turno[], fecha: string): Turno[] {
  const dia = diaSemanaIso(fecha);
  return turnos
    .filter((t) => t.weekday === dia)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Si un tramo por hora coincide con un turno publicado.
 *
 * Sin turnos, todo tramo vale (el servicio se reserva libre). Con turnos, solo
 * uno exactamente igual: misma fecha de la semana, misma hora de inicio y fin.
 */
export function encajaEnTurno(turnos: Turno[], rango: RangoHoras): boolean {
  if (turnos.length === 0) return true;
  return turnosDelDia(turnos, rango.fecha).some(
    (t) => t.start === rango.inicio && t.end === rango.fin,
  );
}
