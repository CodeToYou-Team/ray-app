/**
 * Alta de un cliente y su primer usuario dueño.
 *
 * Uso:
 *   pnpm seed:tenant --name "Hotel X" --slug hotel-x --email dueno@hotel.com
 *   pnpm seed:tenant --name "Hotel X" --slug hotel-x --email dueno@hotel.com \
 *                    --timezone America/Caracas --currency USD
 *
 * El usuario tiene que haberse registrado antes en Supabase Auth: el trigger de
 * drizzle/0002_auth_mirror.sql lo copia a public.users y este script lo busca por
 * email. Es idempotente: correrlo dos veces no duplica nada.
 *
 * Corre con el rol dueño (DIRECT_URL) y SQL directo a proposito. Es una operacion
 * administrativa: no hay cliente activo todavia, asi que no puede pasar por
 * withTenant ni por las politicas RLS.
 */
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { config } from "dotenv";
import {
  CATALOG_KEYS,
  DEFAULT_CATALOG_ITEMS,
  slugifyCode,
} from "../lib/catalogs/keys.ts";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const name = arg("name");
const slug = arg("slug");
const email = arg("email");
const timezone = arg("timezone") ?? "America/Caracas";
const currency = (arg("currency") ?? "USD").toUpperCase();

if (!name || !slug || !email) {
  console.error(
    'Faltan argumentos.\n\n  pnpm seed:tenant --name "Hotel X" --slug hotel-x --email dueno@hotel.com\n',
  );
  process.exit(1);
}

if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error(`El slug "${slug}" debe ser minusculas, numeros y guiones.`);
  process.exit(1);
}

if (!/^[A-Z]{3}$/.test(currency)) {
  console.error(`La moneda "${currency}" debe ser un codigo ISO de 3 letras.`);
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
        `Registralo primero en Supabase Auth (Authentication > Users, o desde la\n` +
        `pantalla de registro de la app). El trigger sync_user_from_auth_trigger lo\n` +
        `copia solo.`,
    );
    process.exit(1);
  }

  const tenantId = uuidv7();

  const [tenant] = await sql<{ id: string; name: string; created: boolean }[]>`
    insert into tenants (id, name, slug, timezone, primary_currency)
    values (${tenantId}, ${name}, ${slug}, ${timezone}, ${currency})
    on conflict (slug) do update
      set name = excluded.name,
          timezone = excluded.timezone,
          primary_currency = excluded.primary_currency,
          updated_at = now()
    returning id, name, (xmax = 0) as created
  `;

  const [membership] = await sql<{ role: string; created: boolean }[]>`
    insert into memberships (id, user_id, tenant_id, role)
    values (${uuidv7()}, ${user.id}, ${tenant.id}, 'owner')
    on conflict (user_id, tenant_id) do update
      set role = 'owner'
    returning role, (xmax = 0) as created
  `;

  // Catalogos por defecto. ON CONFLICT DO NOTHING lo hace idempotente y respeta
  // lo que el cliente ya haya editado: re-correr el seed no pisa sus cambios ni
  // resucita lo que archivo.
  let seeded = 0;
  for (const catalogKey of CATALOG_KEYS) {
    const items = DEFAULT_CATALOG_ITEMS[catalogKey];
    for (const [index, item] of items.entries()) {
      const inserted = await sql`
        insert into catalog_items
          (id, tenant_id, catalog_key, code, label, currency, sort_order)
        values (
          ${uuidv7()}, ${tenant.id}, ${catalogKey},
          ${slugifyCode(item.label)}, ${item.label},
          ${item.currency ?? null}, ${index}
        )
        on conflict (tenant_id, catalog_key, code) do nothing
        returning id
      `;
      seeded += inserted.length;
    }
  }

  console.log(
    [
      "",
      `  Cliente     ${tenant.name}  (${slug})`,
      `  id          ${tenant.id}`,
      `  zona        ${timezone}`,
      `  moneda      ${currency}   ${"<- solo presentacion, no se convierte nada"}`,
      `  dueño       ${user.email}  (${membership.created ? "membresia creada" : "membresia ya existia"})`,
      `  catalogos   ${seeded} items sembrados${seeded === 0 ? " (ya estaban)" : ""}`,
      `  ${tenant.created ? "Cliente creado." : "El cliente ya existia; se actualizaron sus datos."}`,
      "",
    ].join("\n"),
  );
} finally {
  await sql.end();
}
