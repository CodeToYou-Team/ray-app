import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { diaDeSalida, normalizarRango, type Rango } from "./rango";

/**
 * El rango de una reserva, convertido a instantes reales. Solo servidor.
 *
 * La regla que manda en este archivo: **los bordes del rango se calculan en
 * SQL, nunca en JavaScript.** Node corre en UTC; "la noche del 10" en Caracas
 * empieza a las 04:00 UTC. Armar el timestamp con `new Date("2026-11-10")`
 * corre todas las reservas cuatro horas sin que ningún test de "2 noches" lo
 * note, y aparece semanas después cuando una reserva de madrugada cae en el
 * día equivocado.
 *
 * La aritmética que NO depende de la zona (cuántas noches, cuántas horas) vive
 * en ./rango.ts, que también usa el navegador.
 */

/**
 * El `tstzrange` de la reserva, como expresión SQL.
 *
 * `fecha::timestamp AT TIME ZONE tz` interpreta la fecha como hora local del
 * negocio y la convierte al instante real. Lo hace Postgres, que conoce las
 * reglas de cada zona, incluido el horario de verano de los clientes que lo
 * tengan.
 *
 * Semiabierto `[)`: salir el 12 y entrar el 12 no chocan.
 */
export function periodoSql(rango: Rango, timezone: string): SQL {
  if (rango.unidad === "noche") {
    return sql`tstzrange(
      (${rango.desde}::date)::timestamp AT TIME ZONE ${timezone},
      (${rango.hasta}::date)::timestamp AT TIME ZONE ${timezone},
      '[)'
    )`;
  }
  // La salida puede ser otro día (de 22:00 a 10:00 del siguiente).
  const r = normalizarRango(rango);
  return sql`tstzrange(
    (${r.fecha}::date + ${r.inicio}::time) AT TIME ZONE ${timezone},
    (${diaDeSalida(r)}::date + ${r.fin}::time) AT TIME ZONE ${timezone},
    '[)'
  )`;
}

/**
 * Los bordes de un `period` guardado, de vuelta en hora LOCAL del negocio.
 *
 * Devuelve "YYYY-MM-DDTHH:MI" sin zona. Al estar todos en la misma zona local,
 * compararlos como texto es correcto, que es lo que hace la cuadrícula para
 * saber qué celda ocupa cada reserva.
 *
 * Una reserva POR HORAS que termina a una medianoche se devuelve con fin
 * "<día anterior>T24:00", no "<ese día>T00:00": es la forma canónica de
 * `normalizarRango` (rango.ts), así que "¿cambiaron las horas?" compara igual,
 * la cuadrícula no la pinta en un día que no ocupa, y "24:00" sigue ordenando
 * después de "23:30" como texto. Por eso hace falta `rateUnit`: una reserva
 * por noches también termina a las 00:00 y esa sí es del día de salida.
 */
export function bordesLocalesSql(
  periodo: unknown,
  timezone: string,
  rateUnit: unknown,
): { inicio: SQL<string>; fin: SQL<string> } {
  const desde = sql`lower(${periodo}) AT TIME ZONE ${timezone}`;
  const hasta = sql`upper(${periodo}) AT TIME ZONE ${timezone}`;
  return {
    inicio: sql<string>`to_char(${desde}, 'YYYY-MM-DD"T"HH24:MI')`,
    fin: sql<string>`CASE
      WHEN ${rateUnit} IN ('hora', 'bloque')
        AND (${hasta})::time = time '00:00'
        AND (${hasta})::date > (${desde})::date
      THEN to_char((${hasta})::date - 1, 'YYYY-MM-DD') || 'T24:00'
      ELSE to_char(${hasta}, 'YYYY-MM-DD"T"HH24:MI')
    END`,
  };
}

/**
 * Si una reserva es por fechas o por horas, sacado de SU tarifa congelada
 * (`bookings.rate_unit`), no del servicio. El servicio puede cambiar de grano
 * cuando ya no tiene reservas pendientes; las de antes siguen siendo lo que
 * fueron y se tienen que seguir leyendo así.
 */
export function unidadDeReservaSql(rateUnit: unknown): SQL<"noche" | "hora"> {
  return sql<"noche" | "hora">`(CASE WHEN ${rateUnit} IN ('hora', 'bloque') THEN 'hora' ELSE 'noche' END)`;
}

/**
 * Una reserva PENDIENTE: en curso, o reservada y sin terminar. Es lo que
 * impide archivar un recurso o un servicio, y cambiar cómo se reserva un
 * servicio. Un solo predicado para las dos cosas (`contarPendientes` y lo que
 * muestra la página del servicio), así la pantalla y el servidor no discrepan.
 *
 * NO cuentan las canceladas, las no presentadas, las finalizadas, ni las
 * reservadas cuyo rango ya pasó.
 */
export function reservaPendienteSql(status: unknown, periodo: unknown): SQL<boolean> {
  return sql<boolean>`(${status} = 'en_curso' OR (${status} = 'reservada' AND upper(${periodo}) > now()))`;
}
