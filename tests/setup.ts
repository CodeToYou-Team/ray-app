import "dotenv/config";
import { config } from "dotenv";

// .env.local es donde Next espera las credenciales locales, y dotenv/config solo
// lee .env, asi que se carga explicitamente.
config({ path: ".env.local", override: false, quiet: true });

/**
 * Los tests apuntan a TEST_DATABASE_URL / TEST_DIRECT_URL, nunca a la base de
 * desarrollo: escriben y borran filas. Se copian a los nombres que espera
 * lib/env.ts antes de que se importe cualquier modulo de base de datos.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
if (process.env.TEST_DIRECT_URL) {
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL;
}

export const hasTestDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);
