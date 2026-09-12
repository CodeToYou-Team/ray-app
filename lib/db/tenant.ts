import "server-only";

import { sql } from "drizzle-orm";
import { getDb, type Tx } from "./index";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ejecuta `fn` dentro de una transaccion con `app.current_tenant_id` fijado, que
 * es el valor que leen todas las politicas RLS.
 *
 * Por que una transaccion y no una sesion: con el pooler en modo transaccion, el
 * pooler reserva un backend solo mientras dura la transaccion. Un `SET` de sesion
 * sobrevive al COMMIT y le filtraria el tenant anterior a la siguiente
 * transaccion que agarre ese mismo backend. `set_config(..., true)` (is_local)
 * se revierte en el COMMIT, que es exactamente lo que necesitamos.
 *
 * Por que `set_config` y no `SET LOCAL app.current_tenant_id = ${id}`: `SET` no
 * acepta parametros ligados. Drizzle lo mandaria como bind param y Postgres
 * responderia error de sintaxis; y el "arreglo" evidente — interpolar el string
 * en el SQL — abriria inyeccion SQL justo en la frontera entre clientes.
 *
 * Igual se deja el `eq(tabla.tenantId, tenantId)` en cada consulta ademas de RLS:
 * es cinturon y tirantes, y sin el se pierde el prefijo de los indices compuestos
 * y los planes se degradan aunque RLS haga lo correcto.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`withTenant recibio un tenantId que no es UUID: ${tenantId}`);
  }

  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_tenant_id', ${tenantId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Ejecuta `fn` con el contexto del USUARIO autenticado en vez del cliente.
 *
 * Sirve para una sola cosa: averiguar a que cliente pertenece el usuario, que es
 * el problema de huevo y gallina del arranque de sesion — para usar
 * `withTenant()` hay que saber el tenant, y para saberlo hay que consultar
 * `memberships`, que esta protegida por el tenant.
 *
 * Las politicas que habilita (ver drizzle/0007_user_bootstrap_rls.sql) son de
 * SELECT y solo dejan ver tus propias membresias, los clientes a los que
 * perteneces y tu propia fila de usuario. Cualquier otra lectura y TODA
 * escritura siguen yendo por `withTenant()`.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(userId)) {
    throw new Error(`withUser recibio un userId que no es UUID: ${userId}`);
  }

  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_user_id', ${userId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Verifica que la conexion de la app NO pueda saltarse RLS.
 *
 * Los roles `postgres` y `service_role` de Supabase tienen BYPASSRLS: si el
 * DATABASE_URL apunta a uno de ellos, cada politica que escribamos es decorativa.
 * Lo llama el test de aislamiento y sirve para diagnosticar a mano.
 */
export async function assertRlsEnforced(): Promise<void> {
  const rows = await getDb().execute<{
    current_user: string;
    rolbypassrls: boolean;
  }>(
    sql`select current_user, rolbypassrls
        from pg_roles where rolname = current_user`,
  );

  const row = rows[0];
  if (!row) {
    throw new Error("No se pudo leer el rol actual desde pg_roles.");
  }
  if (row.rolbypassrls) {
    throw new Error(
      `El rol "${row.current_user}" tiene BYPASSRLS, asi que las politicas RLS no ` +
        `se aplican y no hay aislamiento entre clientes. DATABASE_URL debe usar ` +
        `el rol app_user (ver lib/env.ts y drizzle/0001_rls_and_app_role.sql).`,
    );
  }
}
