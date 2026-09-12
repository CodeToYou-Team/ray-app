import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// `dotenv/config` solo lee .env. Las credenciales locales viven en .env.local,
// que es donde Next las espera, asi que hay que cargarlo explicitamente.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    /**
     * Conexion para migraciones.
     *
     * Lo ideal es el Session pooler o la conexion directa (5432). En esta red
     * ninguna de las dos es alcanzable: la directa es solo IPv6 (ENOTFOUND) y el
     * Session pooler corta la conexion (ECONNRESET) aunque el puerto este
     * abierto. Se verifico que el Transaction pooler (6543) aplica estas
     * migraciones sin problema — el DDL de Postgres es transaccional y
     * drizzle-kit envuelve cada archivo en una transaccion.
     *
     * La limitacion real del modo transaccion es el estado de SESION (un `SET`
     * que deba sobrevivir al COMMIT) y los prepared statements. Ninguna de las
     * migraciones depende de eso, y `withTenant` usa set_config(..., true)
     * precisamente para no depender de estado de sesion.
     */
    url: process.env.DIRECT_URL ?? "",
  },
  /**
   * CRITICO. Sin esto, drizzle-kit lee TODO el catalogo del proyecto Supabase y
   * genera migraciones que BORRAN los schemas `auth`, `storage` y `realtime`,
   * porque no aparecen en nuestro schema.ts. Esto ha destruido proyectos reales.
   */
  schemaFilter: ["public"],
  strict: true,
  verbose: true,
});
