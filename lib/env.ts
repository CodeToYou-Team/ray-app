import { z } from "zod";

/**
 * Variables de entorno del servidor.
 *
 * Este modulo es la fuente de verdad de que variables necesita la app: no hay
 * `.env.example` en el repo a proposito, para no tener un archivo mas donde se
 * pueda filtrar una credencial por descuido. Los tres strings de conexion salen
 * del boton "Connect" del proyecto en Supabase. Ver docs/setup.md.
 *
 * ---------------------------------------------------------------------------
 * DATABASE_URL — conexion de la APLICACION
 * ---------------------------------------------------------------------------
 * Transaction pooler, puerto 6543, y el usuario tiene que ser `app_user`.
 *
 * NO el rol `postgres` que da el dashboard: `postgres` y `service_role` tienen
 * BYPASSRLS, asi que con ellos TODAS las politicas RLS quedan en nada. No da
 * error ni aviso: te enteras el dia que un cliente ve los datos de otro. El rol
 * lo crea drizzle/0001_rls_and_app_role.sql y lo habilita `pnpm db:bootstrap`.
 *
 * El pooler ademas exige el usuario como `app_user.<project_ref>`, no
 * `app_user` a secas; si falta el sufijo la conexion falla con un error de
 * autenticacion que no explica por que.
 *
 * ---------------------------------------------------------------------------
 * DIRECT_URL — conexion para MIGRACIONES
 * ---------------------------------------------------------------------------
 * Necesita soportar DDL. Lo ideal es el Session pooler o la conexion directa
 * (ambos en 5432), pero ninguna de las dos es alcanzable desde toda red:
 *
 *   - La Direct connection (db.<ref>.supabase.co) es **solo IPv6** en los
 *     proyectos nuevos. Desde una red IPv4 da ENOTFOUND, no timeout, porque el
 *     host ni siquiera tiene registro A.
 *   - El Session pooler puede cortar la conexion con ECONNRESET aunque el
 *     puerto TCP este abierto.
 *
 * Si eso pasa, usa el Transaction pooler (6543) tambien aqui: se verifico que
 * aplica estas migraciones sin problema. Lo que el modo transaccion no soporta
 * es estado de SESION (un `SET` que sobreviva al COMMIT) y prepared statements,
 * y ninguna migracion depende de eso — `withTenant` usa set_config(..., true)
 * justamente para no depender de estado de sesion.
 *
 * ---------------------------------------------------------------------------
 * NEXT_PUBLIC_SUPABASE_* — solo sesiones
 * ---------------------------------------------------------------------------
 * De Project Settings > API. La clave `anon` puede venir en el formato nuevo
 * (`sb_publishable_...`, 46 caracteres) en vez del JWT largo; las dos sirven.
 *
 * Se usan unicamente para autenticacion: la Data API (PostgREST) del proyecto
 * esta desactivada y `createSupabaseServerClient()` devuelve un tipo estrechado
 * a `{ auth }`, asi que leer datos con supabase-js no compila.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
});

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

type ServerEnv = z.infer<typeof serverSchema>;
type PublicEnv = z.infer<typeof publicSchema>;

let cachedServerEnv: ServerEnv | null = null;

/**
 * Se valida de forma perezosa, no al importar el modulo: si se validara al
 * importar, cualquier build o test que no necesite base de datos fallaria solo
 * por no tener las variables puestas.
 */
export function serverEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
  });

  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Variables de entorno del servidor invalidas o faltantes:\n${missing}\n\n` +
        `Crea .env.local con esas variables. Este archivo documenta cada una; ` +
        `docs/setup.md explica de donde sale cada valor.`,
    );
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

export function publicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    // Estas dos se referencian literalmente porque Next las reemplaza en build.
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY " +
        "en .env.local. Salen de Project Settings > API en Supabase.",
    );
  }

  return parsed.data;
}
