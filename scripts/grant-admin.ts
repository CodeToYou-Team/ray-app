/**
 * Da (o quita) acceso a la administracion de la plataforma (/admin).
 *
 * Uso:
 *   pnpm admin:grant --email yo@empresa.com
 *   pnpm admin:grant --email yo@empresa.com --revoke
 *
 * El usuario tiene que haberse registrado antes en Supabase Auth: el trigger de
 * drizzle/0002_auth_mirror.sql lo copia a public.users y este script lo busca
 * por email. No necesita pertenecer a ningun negocio.
 *
 * Es la UNICA forma de crear un admin, a proposito: app_user no puede escribir
 * en platform_admins (ver 0021_platform_admin.sql), asi que ninguna pantalla ni
 * Server Action puede dar este acceso. Corre con el rol dueño (DIRECT_URL).
 */
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const email = arg("email");
const revoke = process.argv.includes("--revoke");

if (!email) {
  console.error("Falta el correo.\n\n  pnpm admin:grant --email yo@empresa.com [--revoke]\n");
  process.exit(1);
}

const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
  console.error("Falta DIRECT_URL en .env.local. Ver lib/env.ts y docs/setup.md.");
  process.exit(1);
}

const sql = postgres(directUrl, { max: 1 });

try {
  const [user] = await sql<{ id: string; email: string }[]>`
    select id, email from users where lower(email) = lower(${email}) limit 1
  `;

  if (!user) {
    console.error(
      `No existe un usuario con email ${email} en public.users.\n\n` +
        `Registralo primero (pantalla /registro de la app, o Authentication >\n` +
        `Users en Supabase). El trigger sync_user_from_auth_trigger lo copia solo.`,
    );
    process.exit(1);
  }

  if (revoke) {
    const borrados = await sql`
      delete from platform_admins where user_id = ${user.id} returning user_id
    `;
    console.log(
      borrados.length > 0
        ? `\n  ${user.email} ya no es administrador.\n`
        : `\n  ${user.email} no era administrador.\n`,
    );
  } else {
    const creados = await sql`
      insert into platform_admins (user_id) values (${user.id})
      on conflict (user_id) do nothing
      returning user_id
    `;
    console.log(
      creados.length > 0
        ? `\n  ${user.email} ahora es administrador. Entra en /admin.\n`
        : `\n  ${user.email} ya era administrador.\n`,
    );
  }
} finally {
  await sql.end();
}
