/**
 * Diagnostico de la conexion de la app.
 *
 *   pnpm db:check
 *
 * Responde la unica pregunta que importa despues de configurar Supabase: la
 * conexion de DATABASE_URL, puede saltarse RLS o no. Si puede, el aislamiento
 * entre clientes no existe.
 */
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "Falta DATABASE_URL en .env.local. Ver lib/env.ts y docs/setup.md.",
  );
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });

try {
  const [role] = await sql<{ current_user: string; rolbypassrls: boolean }[]>`
    select current_user, rolbypassrls from pg_roles where rolname = current_user
  `;

  const [{ version }] = await sql<{ version: string }[]>`
    select current_setting('server_version') as version
  `;

  // app_user no tiene permisos sobre el schema `drizzle`, asi que esto suele
  // fallar y no significa que falten migraciones. Se distingue "cero" de
  // "no visible" para no asustar a nadie a re-migrar.
  let appliedLabel = "no visible desde este rol (normal para app_user)";
  try {
    const applied = await sql<{ hash: string }[]>`
      select hash from drizzle.__drizzle_migrations order by created_at
    `;
    appliedLabel = `${applied.length} aplicadas`;
  } catch {
    /* se queda el label por defecto */
  }

  const policies = await sql<{ tablename: string; policyname: string }[]>`
    select tablename, policyname from pg_policies
    where schemaname = 'public' order by tablename, policyname
  `;

  console.log(`
  Postgres     ${version}
  Usuario      ${role.current_user}
  Migraciones  ${appliedLabel}
  Politicas    ${policies.length} en el schema public`);

  for (const p of policies) {
    console.log(`               ${p.tablename}.${p.policyname}`);
  }

  if (role.rolbypassrls) {
    console.error(`
  ✖ El rol "${role.current_user}" tiene BYPASSRLS.

    Las politicas RLS NO se aplican y no hay aislamiento entre clientes.
    DATABASE_URL tiene que usar el rol app_user, no postgres ni service_role.
    Ver docs/setup.md paso 3.
`);
    process.exit(1);
  }

  if (policies.length === 0) {
    console.error(`
  ✖ No hay ninguna politica RLS. Falta correr "pnpm db:migrate".
`);
    process.exit(1);
  }

  console.log(`
  ✓ El rol no puede saltarse RLS y hay politicas activas.

    Esto verifica la configuracion, no el comportamiento. Para probar que de
    verdad no hay fuga entre clientes hace falta "pnpm test" con
    TEST_DATABASE_URL puesta (docs/setup.md paso 5).
`);
} finally {
  await sql.end();
}
