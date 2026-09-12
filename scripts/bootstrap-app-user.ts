/**
 * Habilita el rol `app_user` y arma el DATABASE_URL de la app.
 *
 *   pnpm db:bootstrap
 *
 * Que hace:
 *   1. Genera una password aleatoria para app_user.
 *   2. Corre ALTER ROLE app_user WITH LOGIN PASSWORD, via DIRECT_URL (rol dueño).
 *   3. Reescribe DATABASE_URL en .env.local apuntando a app_user por el pooler.
 *
 * La password nunca se imprime: queda solo en .env.local (que esta en
 * .gitignore) y en Postgres.
 *
 * El detalle que este script existe para resolver: el pooler de Supabase
 * (Supavisor) exige que el usuario venga como `<rol>.<project_ref>`, no como
 * `<rol>`. Con DATABASE_URL="postgresql://app_user@...pooler..." la conexion
 * falla con un error de autenticacion que no dice por que.
 */
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config } from "dotenv";

const ENV_PATH = ".env.local";

if (!existsSync(ENV_PATH)) {
  console.error(
    `No existe ${ENV_PATH}. Crealo con las variables que documenta lib/env.ts;\n` +
      `docs/setup.md explica de donde sale cada valor.`,
  );
  process.exit(1);
}

config({ path: ENV_PATH, quiet: true });

const directUrl = process.env.DIRECT_URL;
const pooledUrl = process.env.DATABASE_URL;

if (!directUrl) {
  console.error(`Falta DIRECT_URL en ${ENV_PATH} (Project Settings > Database > Direct connection, puerto 5432).`);
  process.exit(1);
}
if (!pooledUrl) {
  console.error(`Falta DATABASE_URL en ${ENV_PATH} (Project Settings > Database > Connection pooling, puerto 6543).`);
  process.exit(1);
}

/** Deriva la URL de app_user desde la del pooler que da Supabase. */
function buildAppUserUrl(pooled: string, password: string): string {
  const url = new URL(pooled);

  if (!url.port || url.port === "5432") {
    console.warn(
      `  ! DATABASE_URL usa el puerto ${url.port || "(ninguno)"}. Deberia ser 6543 (el pooler).\n` +
        `    Con la conexion directa se agotan las conexiones del proyecto.`,
    );
  }

  // Supavisor espera "<rol>.<project_ref>". El usuario que da Supabase es
  // "postgres.<ref>", asi que se reemplaza solo la parte del rol.
  const currentUser = decodeURIComponent(url.username);
  const dotIndex = currentUser.indexOf(".");
  const projectRef = dotIndex === -1 ? null : currentUser.slice(dotIndex + 1);

  if (!projectRef) {
    console.warn(
      `  ! El usuario de DATABASE_URL es "${currentUser}", sin el sufijo ".<project_ref>"\n` +
        `    que pide el pooler. Se usa "app_user" tal cual; si la conexion falla,\n` +
        `    revisa que copiaste el string de "Connection pooling".`,
    );
    url.username = "app_user";
  } else {
    url.username = `app_user.${projectRef}`;
  }

  url.password = password;
  return url.toString();
}

const password = randomBytes(24).toString("base64url");
const sql = postgres(directUrl, { max: 1 });

try {
  const [role] = await sql<{ rolbypassrls: boolean }[]>`
    select rolbypassrls from pg_roles where rolname = 'app_user'
  `;

  if (!role) {
    console.error(
      `El rol app_user no existe todavia. Corre "pnpm db:migrate" primero:\n` +
        `lo crea drizzle/0001_rls_and_app_role.sql.`,
    );
    process.exit(1);
  }

  if (role.rolbypassrls) {
    // No deberia pasar nunca, pero si pasara todo el modelo de seguridad se cae.
    console.error(
      "app_user tiene BYPASSRLS. Corrigelo antes de seguir:\n" +
        "  ALTER ROLE app_user NOBYPASSRLS;",
    );
    process.exit(1);
  }

  // ALTER ROLE ... PASSWORD no acepta parametros ligados, asi que la password va
  // interpolada. Es seguro porque randomBytes().toString("base64url") solo
  // produce [A-Za-z0-9_-]: no hay comillas que puedan escapar del literal. Se
  // verifica en vez de asumirlo.
  if (!/^[A-Za-z0-9_-]+$/.test(password)) {
    throw new Error("La password generada tiene caracteres inesperados; se aborta.");
  }
  await sql.unsafe(`ALTER ROLE app_user WITH LOGIN PASSWORD '${password}'`);

  const appUrl = buildAppUserUrl(pooledUrl, password);

  const original = readFileSync(ENV_PATH, "utf8");
  const line = `DATABASE_URL="${appUrl}"`;
  const updated = /^DATABASE_URL=.*$/m.test(original)
    ? original.replace(/^DATABASE_URL=.*$/m, line)
    : `${original.trimEnd()}\n${line}\n`;
  writeFileSync(ENV_PATH, updated);

  const safeUser = new URL(appUrl).username;
  console.log(`
  ✓ app_user habilitado y ${ENV_PATH} actualizado.

    usuario   ${safeUser}
    password  (generada, guardada solo en ${ENV_PATH})

    Siguiente:  pnpm db:check
`);
} finally {
  await sql.end();
}
