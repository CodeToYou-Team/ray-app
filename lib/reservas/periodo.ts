import "server-only";

import { sql, type SQL } from "drizzle-orm";
import type { Rango } from "./rango";

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
  return sql`tstzrange(
    (${rango.fecha}::date + ${rango.inicio}::time) AT TIME ZONE ${timezone},
    (${rango.fecha}::date + ${rango.fin}::time) AT TIME ZONE ${timezone},
    '[)'
  )`;
}

/**
 * Los bordes de un `period` guardado, de vuelta en hora LOCAL del negocio.
 *
 * Devuelve "YYYY-MM-DDTHH:MI" sin zona. Al estar todos en la misma zona local,
 * compararlos como texto es correcto, que es lo que hace la cuadrícula para
 * saber qué celda ocupa cada reserva.
 */
export function bordesLocalesSql(
  periodo: unknown,
  timezone: string,
): { inicio: SQL<string>; fin: SQL<string> } {
  return {
    inicio: sql<string>`to_char(lower(${periodo}) AT TIME ZONE ${timezone}, 'YYYY-MM-DD"T"HH24:MI')`,
    fin: sql<string>`to_char(upper(${periodo}) AT TIME ZONE ${timezone}, 'YYYY-MM-DD"T"HH24:MI')`,
  };
}
