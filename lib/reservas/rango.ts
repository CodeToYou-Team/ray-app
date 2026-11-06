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
import { sumarDias as sumarDiasFecha } from "@/lib/fechas";

export type Unidad = "noche" | "hora";

/** Por noche: la fecha de entrada y la de salida, en hora local del negocio. */
export interface RangoNoches {
  unidad: "noche";
  /** YYYY-MM-DD. Primera noche. */
  desde: string;
  /** YYYY-MM-DD. Día de salida: esa noche NO se cobra. */
  hasta: string;
}

/**
 * Por hora: un día, una hora de entrada y una de salida, en hora local del
 * negocio. La salida puede caer otro día (de 22:00 a 10:00 del siguiente):
 * una habitación por horas o por bloques de 12 o 24 horas cruza la
 * medianoche.
 *
 * Forma canónica (`normalizarRango`): sin `fechaFin` si termina el mismo
 * día, y una salida a la medianoche se escribe "24:00" del día anterior, no
 * "00:00" del siguiente. Es la misma forma que devuelve `bordesLocalesSql`,
 * así que comparar como texto lo pedido con lo guardado funciona.
 */
export interface RangoHoras {
  unidad: "hora";
  /** YYYY-MM-DD. Día de entrada. */
  fecha: string;
  /** HH:MM */
  inicio: string;
  /** HH:MM, o "24:00": la medianoche al final de `fechaFin`. */
  fin: string;
  /** YYYY-MM-DD. Día de salida, si no es `fecha`. */
  fechaFin?: string;
}

export type Rango = RangoNoches | RangoHoras;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
/**
 * Una hora de FIN: además de las del día, "24:00", que es la medianoche al
 * final de ESE día. Postgres la acepta tal cual (`fecha + '24:00'::time` es
 * el 00:00 del día siguiente), así que un tramo de 23:00 a 24:00 sigue siendo
 * de una sola fecha y no hace falta pedir dos.
 */
const HORA_FIN = /^(([01]\d|2[0-3]):([0-5]\d)|24:00)$/;

/** El final del día, como hora de fin. */
export const FIN_DEL_DIA = "24:00";

/** Tramo mínimo por hora. Ver `cantidad()`. */
export const TRAMO_MINUTOS = 30;

/** Una reserva por noche no puede pasar de esto. Un año es ya un alquiler. */
export const MAX_NOCHES = 365;

/**
 * Una reserva por horas no puede pasar de esto: una semana. Más ya es una
 * estadía, y se reserva por fechas.
 */
export const MAX_MINUTOS_HORAS = 7 * 24 * 60;

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

// ---------------------------------------------------------------------------
// Tarifas
// ---------------------------------------------------------------------------

/** Espejo de `rate_unit` en la base. Ver drizzle/0025_service_rates.sql. */
export type UnidadTarifa = "hora" | "bloque" | "dia" | "noche" | "semana" | "mes";

/** Lo que hace falta de una tarifa para contar y describir. */
export interface Tarifa {
  unit: UnidadTarifa;
  /** Solo para `bloque`. */
  minutes: number | null;
}

/**
 * Qué tarifas admite cada grano. El grano (`services.booking_unit`) decide si
 * se reserva por fechas o por horas; una tarifa de otro grano dejaría un
 * rango que la cuadrícula no sabe pintar.
 */
export const TARIFAS_DEL_GRANO: Record<Unidad, UnidadTarifa[]> = {
  noche: ["noche", "dia", "semana", "mes"],
  hora: ["hora", "bloque"],
};

/** La tarifa de siempre de un grano: por noche o por hora. */
export function tarifaBase(grano: Unidad): Tarifa {
  return { unit: grano, minutes: null };
}

/** Topes por unidad. Más que esto ya es un alquiler, no una reserva. */
const MAXIMO = { noche: MAX_NOCHES, dia: MAX_NOCHES, semana: 52, mes: 12 } as const;

/**
 * La misma fecha `n` meses después. Si ese mes no tiene el día (31 de enero
 * + 1 mes), cae en el último: 28 o 29 de febrero, igual que `fecha + interval
 * '1 month'` en Postgres.
 */
export function sumarMeses(fecha: string, n: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const indice = y * 12 + (m - 1) + n;
  const anio = Math.floor(indice / 12);
  const mes = indice - anio * 12;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimo);
  return `${String(anio).padStart(4, "0")}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Cuántos meses de calendario hay de `desde` a `hasta`, o null si no son exactos. */
function mesesEntre(desde: string, hasta: string): number | null {
  for (let n = 1; n <= MAXIMO.mes; n++) {
    const fin = sumarMeses(desde, n);
    if (fin === hasta) return n;
    if (fin > hasta) return null;
  }
  return null;
}

/** "4 h", "1,5 h", "30 min". */
export function duracionTexto(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = minutos / 60;
  return `${Number.isInteger(horas) ? horas : horas.toFixed(1).replace(".", ",")} h`;
}

function plural(n: string, uno: string, varios: string): string {
  return n === "1" ? `1 ${uno}` : `${n.replace(".", ",")} ${varios}`;
}

/**
 * Cuántas unidades de la tarifa se cobran, validando el rango de paso.
 *
 * Devuelve `qty` como texto para que entre directo en la aritmética de
 * `lib/money.ts` y se guarde en `bookings.qty`. Sin tarifa, cuenta en la
 * unidad base del grano (noches u horas), que es como se cobraba antes de
 * que existieran las tarifas.
 *
 * El rango por fechas siempre llega con la salida EXCLUSIVA: "por día, del 10
 * al 12" llega como `hasta: 13`. Pasar de días incluidos a esa forma es
 * trabajo del formulario; aquí todas las tarifas por fechas se miden igual.
 */
export function cantidad(rango: Rango, tarifa: Tarifa = tarifaBase(rango.unidad)): Cantidad {
  if (!TARIFAS_DEL_GRANO[rango.unidad].includes(tarifa.unit)) {
    return { ok: false, error: "Esa tarifa no corresponde a cómo se reserva este servicio." };
  }

  if (rango.unidad === "noche") {
    if (!fechaValida(rango.desde) || !fechaValida(rango.hasta)) {
      return { ok: false, error: "Alguna de las dos fechas no es válida." };
    }
    const dias = diaAbsoluto(rango.hasta) - diaAbsoluto(rango.desde);
    if (dias <= 0) {
      return {
        ok: false,
        error:
          tarifa.unit === "noche"
            ? "La salida tiene que ser al menos un día después de la entrada."
            : "El último día no puede ser anterior al primero.",
      };
    }

    if (tarifa.unit === "semana") {
      if (dias % 7 !== 0) {
        return {
          ok: false,
          error: "Por semana, la reserva va en semanas completas: 7, 14 o 21 días.",
        };
      }
      const semanas = dias / 7;
      if (semanas > MAXIMO.semana) {
        return { ok: false, error: `Una reserva no puede pasar de ${MAXIMO.semana} semanas.` };
      }
      const qty = String(semanas);
      return { ok: true, qty, descripcion: plural(qty, "semana", "semanas") };
    }

    if (tarifa.unit === "mes") {
      const meses = mesesEntre(rango.desde, rango.hasta);
      if (meses === null) {
        return {
          ok: false,
          error: `Por mes, la reserva va en meses completos (del 10 al 10), hasta ${MAXIMO.mes}.`,
        };
      }
      const qty = String(meses);
      return { ok: true, qty, descripcion: plural(qty, "mes", "meses") };
    }

    const porNoche = tarifa.unit === "noche";
    if (dias > MAX_NOCHES) {
      return {
        ok: false,
        error: `Una reserva no puede pasar de ${MAX_NOCHES} ${porNoche ? "noches" : "días"}.`,
      };
    }
    const qty = String(dias);
    return {
      ok: true,
      qty,
      descripcion: porNoche ? plural(qty, "noche", "noches") : plural(qty, "día", "días"),
    };
  }

  if (!fechaValida(rango.fecha) || (rango.fechaFin !== undefined && !fechaValida(rango.fechaFin))) {
    return { ok: false, error: "La fecha no es válida." };
  }
  if (!HORA.test(rango.inicio) || !HORA_FIN.test(rango.fin)) {
    return { ok: false, error: "Usa horas con el formato 14:30." };
  }
  const duracion = minutosDelRango(rango);
  if (duracion <= 0) {
    return {
      ok: false,
      error: "La salida tiene que ser después de la entrada.",
    };
  }
  if (duracion > MAX_MINUTOS_HORAS) {
    return {
      ok: false,
      error: "Una reserva por horas no puede pasar de 7 días. Para más, resérvalo por fechas.",
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

  if (tarifa.unit === "bloque") {
    const bloque = tarifa.minutes ?? 0;
    if (bloque <= 0 || duracion % bloque !== 0) {
      return {
        ok: false,
        error: `Esta tarifa va en bloques completos de ${duracionTexto(bloque)}.`,
      };
    }
    const qty = String(duracion / bloque);
    return {
      ok: true,
      qty,
      descripcion: `${plural(qty, "bloque", "bloques")} de ${duracionTexto(bloque)}`,
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

/** "2.000" (como la devuelve `numeric(12,3)`) → "2"; "1.500" → "1.5". */
export function sinCeros(qty: string): string {
  return qty.includes(".") ? qty.replace(/\.?0+$/, "") : qty;
}

/**
 * Cómo se describe una cantidad ya guardada: "3 noches", "2 bloques de 4 h".
 * La misma redacción que `cantidad()`, para una reserva que ya tiene su `qty`
 * ("2.000" en la base).
 */
export function describirCantidad(qty: string, tarifa: Tarifa): string {
  const n = sinCeros(qty);
  switch (tarifa.unit) {
    case "noche":
      return plural(n, "noche", "noches");
    case "dia":
      return plural(n, "día", "días");
    case "semana":
      return plural(n, "semana", "semanas");
    case "mes":
      return plural(n, "mes", "meses");
    case "bloque":
      return `${plural(n, "bloque", "bloques")} de ${duracionTexto(tarifa.minutes ?? 0)}`;
    case "hora":
      return plural(n, "hora", "horas");
  }
}

/** El nombre de una tarifa: el que le dieron, o uno armado con su unidad. */
export function nombreTarifa(t: Tarifa & { label?: string | null }): string {
  if (t.label?.trim()) return t.label.trim();
  switch (t.unit) {
    case "hora":
      return "Por hora";
    case "bloque":
      return `Bloque de ${duracionTexto(t.minutes ?? 0)}`;
    case "dia":
      return "Por día";
    case "noche":
      return "Por noche";
    case "semana":
      return "Por semana";
    case "mes":
      return "Por mes";
  }
}

/** "/ noche", "/ bloque de 4 h": lo que va después del precio. */
export function porUnidad(t: Tarifa): string {
  switch (t.unit) {
    case "bloque":
      return `/ bloque de ${duracionTexto(t.minutes ?? 0)}`;
    case "dia":
      return "/ día";
    default:
      return `/ ${t.unit}`;
  }
}

/**
 * Como se llaman los recursos de un servicio: el nombre que le dio el negocio
 * o, sin nombre, el generico. Antes el formulario decia "Habitacion" a todo lo
 * que se reservaba por noche, fuera un hotel o un camping.
 */
export function recursoLabel(label: string | null | undefined): string {
  return label?.trim() || "Recurso";
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
  const r = normalizarRango(rango);
  return {
    inicio: `${r.fecha}T${r.inicio}`,
    fin: `${diaDeSalida(r)}T${r.fin}`,
  };
}

/** El día en que termina un rango por horas. */
export function diaDeSalida(rango: RangoHoras): string {
  return rango.fechaFin ?? rango.fecha;
}

/** Cuántos minutos dura un rango por horas, aunque cruce días. */
export function minutosDelRango(rango: RangoHoras): number {
  const dias = diaAbsoluto(diaDeSalida(rango)) - diaAbsoluto(rango.fecha);
  return dias * 24 * 60 + minutos(rango.fin) - minutos(rango.inicio);
}

/**
 * La forma canónica de un rango (ver `RangoHoras`). Por noches no cambia.
 * Todo lo que compara, guarda o valida un rango por horas pasa por aquí.
 */
export function normalizarRango<R extends Rango>(rango: R): R {
  if (rango.unidad === "noche") return rango;
  const r = rango as RangoHoras;
  let fechaFin = diaDeSalida(r);
  let fin = r.fin;
  // "00:00" del día siguiente es "24:00" del anterior.
  if (fin === "00:00" && fechaFin > r.fecha) {
    fechaFin = sumarDiasFecha(fechaFin, -1);
    fin = FIN_DEL_DIA;
  }
  const { fechaFin: _, ...base } = r;
  void _;
  return (fechaFin === r.fecha ? { ...base, fin } : { ...base, fin, fechaFin }) as R;
}

/**
 * Dónde termina un tramo de `duracion` minutos que empieza en `fecha` a las
 * `hora`, en forma canónica. Null si la duración no es un número.
 */
export function sumarMinutos(
  fecha: string,
  hora: string,
  duracion: number,
): { fechaFin: string; fin: string } | null {
  if (!Number.isFinite(duracion)) return null;
  const total = minutos(hora) + duracion;
  const dia = 24 * 60;
  // Termina justo a una medianoche: "24:00" del día anterior.
  const dias = total % dia === 0 ? total / dia - 1 : Math.floor(total / dia);
  const resto = total - dias * dia;
  return {
    fechaFin: sumarDiasFecha(fecha, dias),
    fin: `${String(Math.floor(resto / 60)).padStart(2, "0")}:${String(resto % 60).padStart(2, "0")}`,
  };
}

/**
 * Un rango por horas partido en tramos de un solo día: de 22:00 a 10:00 del
 * siguiente son "22:00–24:00" y "00:00–10:00". Para validar el horario, que
 * es por día.
 */
export function tramosPorDia(rango: RangoHoras): RangoHoras[] {
  const r = normalizarRango(rango);
  const salida = diaDeSalida(r);
  const tramos: RangoHoras[] = [];
  for (let f = r.fecha; f <= salida; f = sumarDiasFecha(f, 1)) {
    tramos.push({
      unidad: "hora",
      fecha: f,
      inicio: f === r.fecha ? r.inicio : "00:00",
      fin: f === salida ? r.fin : FIN_DEL_DIA,
    });
  }
  return tramos;
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

/**
 * Las horas en punto y y media de `desde` a `hasta` (en minutos desde las
 * 00:00), ambas incluidas: para elegir horas sin escribirlas. Llega a "24:00",
 * que un `<input type="time">` no puede mostrar.
 */
export function horasEnTramos(desde = 0, hasta = 24 * 60): string[] {
  const horas: string[] = [];
  const inicio = Math.ceil(desde / TRAMO_MINUTOS) * TRAMO_MINUTOS;
  for (let m = inicio; m <= Math.min(hasta, 24 * 60); m += TRAMO_MINUTOS) {
    horas.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return horas;
}

/** "14:30" → 870; "24:00" → 1440. */
export function horaAMinutos(hora: string): number {
  return minutos(hora);
}

/** Si una franja cubre el día entero: de 00:00 a 24:00. */
export function esTodoElDia(franjas: { start: string; end: string }[]): boolean {
  return franjas.length === 1 && franjas[0].start === "00:00" && franjas[0].end === FIN_DEL_DIA;
}

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
  // Un turno es de un día: un tramo que cruza la medianoche no es ninguno.
  if (normalizarRango(rango).fechaFin) return false;
  return turnosDelDia(turnos, rango.fecha).some(
    (t) => t.start === rango.inicio && t.end === rango.fin,
  );
}

/**
 * Qué son los horarios de un servicio. Espejo de `schedule_mode`:
 * - atencion: la franja en la que se atiende; vale cualquier tramo que quepa
 *   entero dentro de una franja de ese día;
 * - turnos: tramos exactos, como `encajaEnTurno`.
 */
export type ModoHorario = "atencion" | "turnos";

/**
 * Si un tramo por hora respeta el horario del servicio.
 *
 * Sin horarios, todo tramo vale. Por atención, el tramo tiene que caber en
 * UNA franja: de 11:00 a 15:00 no vale si se atiende de 08:00 a 12:00 y de
 * 14:00 a 20:00, aunque empiece y termine dentro de alguna.
 */
export function cumpleHorario(modo: ModoHorario, turnos: Turno[], rango: RangoHoras): boolean {
  if (modo === "turnos") return encajaEnTurno(turnos, rango);
  return tramoFueraDeHorario(turnos, rango) === null;
}

/**
 * Por atención, el primer tramo de un día que no cabe en el horario, o null si
 * todos caben. Un rango que cruza la medianoche tiene que caber cada día: el
 * de 22:00 a 10:00 necesita que se atienda hasta las 24:00 y desde las 00:00
 * del siguiente.
 */
export function tramoFueraDeHorario(turnos: Turno[], rango: RangoHoras): RangoHoras | null {
  if (turnos.length === 0) return null;
  for (const tramo of tramosPorDia(rango)) {
    const cabe = turnosDelDia(turnos, tramo.fecha).some(
      (t) => t.start <= tramo.inicio && tramo.fin <= t.end,
    );
    if (!cabe) return tramo;
  }
  return null;
}

/** "de 08:00 a 12:00 y de 14:00 a 20:00": las franjas de un día, para leer. */
export function franjasTexto(delDia: Turno[]): string {
  if (esTodoElDia(delDia)) return "todo el día";
  const partes = delDia.map((t) => `de ${t.start} a ${t.end}`);
  return partes.length <= 1
    ? (partes[0] ?? "")
    : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}
