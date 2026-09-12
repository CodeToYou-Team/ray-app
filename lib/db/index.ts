import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { serverEnv } from "@/lib/env";

/**
 * Conexion a Postgres. Solo servidor — el import de "server-only" hace que
 * importar este modulo desde el cliente sea un error de build.
 *
 * No se exporta un `db` suelto a proposito: cada consulta con datos de un cliente
 * tiene que pasar por `withTenant()` de ./tenant.ts, que abre la transaccion y
 * fija el GUC que leen las politicas RLS. Un `db` global seria justo el atajo que
 * salta ese paso sin que nadie lo note.
 */

type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as {
  __rayPgClient?: Sql;
};

function client(): Sql {
  // Se reusa entre recargas de HMR en dev; si no, cada guardado abre un pool nuevo
  // y se agotan las conexiones del proyecto de Supabase.
  if (!globalForDb.__rayPgClient) {
    globalForDb.__rayPgClient = postgres(serverEnv().DATABASE_URL, {
      /**
       * Obligatorio con el pooler de Supabase (Supavisor / PgBouncer en modo
       * transaccion). Con prepared statements activos aparece de forma
       * intermitente "prepared statement does not exist", porque la sentencia se
       * prepara en un backend y se ejecuta en otro.
       */
      prepare: false,
      max: 10,
      idle_timeout: 20,
    });
  }
  return globalForDb.__rayPgClient;
}

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** Uso interno y para tablas globales sin `tenant_id`. */
export function getDb() {
  if (!cachedDb) {
    cachedDb = drizzle(client(), { schema });
  }
  return cachedDb;
}

export type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
