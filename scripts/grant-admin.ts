/**
 * Da (o quita) acceso a la administracion de la plataforma (/admin).
 *
 * Uso:
 *   pnpm admin:grant --email yo@empresa.com            # admin
 *   pnpm admin:grant --email yo@empresa.com --super    # superadmin (o subirlo)
 *   pnpm admin:grant --email yo@empresa.com --revoke
 *
 * El usuario tiene que haberse registrado antes en Supabase Auth: el trigger de
 * drizzle/0002_auth_mirror.sql lo copia a public.users y este script lo busca
 * por email. No necesita pertenecer a ningun negocio.
 *
 * Desde la app, solo un superadmin nombra admins (/admin/administradores). Este
 * script es para el primero, o para recuperar el acceso si no queda ninguno a
 * mano: corre con el rol dueño (DIRECT_URL), que no pasa por RLS. Lo que la
 * base impone igual vale aqui: no deja quitar al ultimo superadmin, y el
 * trigger de 0022 registra el cambio en platform_audit_log con actor NULL.
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
const level = process.argv.includes("--super") ? "superadmin" : "admin";

if (!email) {
  console.error(
    "Falta el correo.\n\n  pnpm admin:grant --email yo@empresa.com [--super | --revoke]\n",
  );
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
    let borrados;
    try {
      borrados = await sql`
        delete from platform_admins where user_id = ${user.id} returning user_id
      `;
    } catch (error) {
      if ((error as { code?: string }).code === "PA001") {
        console.error(
          `\n  ${user.email} es el ultimo superadmin. Nombra otro antes de quitarlo.\n`,
        );
        process.exit(1);
      }
      throw error;
    }
    console.log(
      borrados.length > 0
        ? `\n  ${user.email} ya no es administrador.\n`
        : `\n  ${user.email} no era administrador.\n`,
    );
  } else {
    const [antes] = await sql<{ level: string }[]>`
      select level from platform_admins where user_id = ${user.id}
    `;

    if (!antes) {
      await sql`insert into platform_admins (user_id, level) values (${user.id}, ${level})`;
      console.log(`\n  ${user.email} ahora es ${level}. Entra en /admin.\n`);
    } else if (level === "superadmin" && antes.level !== "superadmin") {
      // Sin --super no se baja a nadie: eso se hace desde la app, donde se ve.
      await sql`update platform_admins set level = 'superadmin' where user_id = ${user.id}`;
      console.log(`\n  ${user.email} paso de ${antes.level} a superadmin.\n`);
    } else {
      console.log(`\n  ${user.email} ya era ${antes.level}.\n`);
    }
  }
} finally {
  await sql.end();
}
