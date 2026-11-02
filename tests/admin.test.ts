import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { eq } from "drizzle-orm";
import { isPlatformAdmin } from "@/lib/admin/admins";
import {
  createTenant,
  emailBlockedElsewhere,
  listTenants,
  setTenantSuspended,
  updateTenant,
} from "@/lib/admin/tenants";
import { changeRole, claimInvitation } from "@/lib/authz/members";
import { withPlatformAdmin, withTenant, withUser } from "@/lib/db/tenant";
import { platformAdmins, tenants } from "@/lib/db/schema";

/**
 * Administracion de la plataforma.
 *
 * Lo que mas importa aca: que el contexto de admin solo se abra para quien esta
 * en platform_admins, que la app no pueda crear admins, y que la suspension no
 * se la pueda levantar el propio negocio.
 */

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

let sql: ReturnType<typeof postgres>;

const admin = uuidv7();
const noAdmin = uuidv7();
const dueno = uuidv7();
const nuevoDueno = uuidv7();
const tenant = uuidv7();
const otroTenant = uuidv7();

// Ver AGENTS.md: los UUIDv7 del mismo milisegundo comparten prefijo.
const correo = (id: string) => `adm-${id.slice(-12)}@test.local`;
const slug = (id: string, prefijo: string) => `${prefijo}-${id.slice(-12)}`;

const slugNuevo = slug(uuidv7(), "nuevo");
const creados: string[] = [];

describe.skipIf(!hasDb)("administracion de negocios", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug) values
      (${tenant},     'Existente', ${slug(tenant, "ex")}),
      (${otroTenant}, 'Con invitación', ${slug(otroTenant, "inv")})`;
    await sql`insert into users (id, email, full_name) values
      (${admin},   ${correo(admin)},   'Admin'),
      (${noAdmin}, ${correo(noAdmin)}, 'Cualquiera'),
      (${dueno},   ${correo(dueno)},   'Dueño')`;
    await sql`insert into memberships (id, user_id, tenant_id, role) values
      (${uuidv7()}, ${dueno}, ${tenant}, 'owner')`;
    await sql`insert into invitations (id, tenant_id, email, role, invited_by) values
      (${uuidv7()}, ${otroTenant}, ${correo(noAdmin)}, 'staff', ${dueno})`;
    await sql`insert into platform_admins (user_id) values (${admin})`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id in ${sql([tenant, otroTenant, ...creados])}`;
    await sql`delete from users where id in (${admin}, ${noAdmin}, ${dueno}, ${nuevoDueno})`;
    // El trigger de 0022 registra el alta y la baja del admin del test.
    await sql`delete from platform_audit_log where entity_id = ${admin}`;
    await sql.end();
  });

  // -------------------------------------------------------------------------
  // Quien es admin
  // -------------------------------------------------------------------------

  it("reconoce al admin y a nadie mas", async () => {
    expect(await isPlatformAdmin(admin)).toBe(true);
    expect(await isPlatformAdmin(noAdmin)).toBe(false);
  });

  it("fijar el GUC con un id que no es admin no abre nada", async () => {
    expect(await listTenants(noAdmin)).toEqual([]);
  });

  it("la app no puede crear admins, ni con contexto de cliente ni de usuario", async () => {
    await expect(
      withTenant(tenant, (tx) => tx.insert(platformAdmins).values({ userId: noAdmin })),
    ).rejects.toThrow();
    await expect(
      withUser(noAdmin, (tx) => tx.insert(platformAdmins).values({ userId: noAdmin })),
    ).rejects.toThrow();
    // Ni el propio admin puede nombrar a otro.
    await expect(
      withPlatformAdmin(admin, (tx) =>
        tx.insert(platformAdmins).values({ userId: noAdmin }),
      ),
    ).rejects.toThrow();
  });

  it("el contexto de usuario de un admin no ve otros negocios", async () => {
    // Las politicas de admin leen su propio GUC, no app.current_user_id: el
    // arranque de sesion normal de un admin no amplia nada.
    const vistos = await withUser(admin, (tx) =>
      tx.select({ id: tenants.id }).from(tenants),
    );
    expect(vistos).toEqual([]);
  });

  it("lista los negocios con su dueño", async () => {
    const todos = await listTenants(admin);
    const existente = todos.find((t) => t.id === tenant);
    expect(existente?.owners).toEqual([correo(dueno)]);
    expect(existente?.memberCount).toBe(1);
    expect(existente?.suspendedAt).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Alta
  // -------------------------------------------------------------------------

  it("crea el negocio con catalogos y una invitacion de dueño", async () => {
    const r = await createTenant(admin, {
      name: "  Hotel Nuevo  ",
      slug: slugNuevo,
      ownerEmail: `  ${correo(nuevoDueno).toUpperCase()} `,
      timezone: "America/Bogota",
      primaryCurrency: "usd",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    creados.push(r.tenantId);

    const [row] = await sql`
      select name, timezone, primary_currency from tenants where id = ${r.tenantId}`;
    expect(row).toMatchObject({
      name: "Hotel Nuevo",
      timezone: "America/Bogota",
      primary_currency: "USD",
    });

    const [{ n }] = await sql`
      select count(*)::int as n from catalog_items where tenant_id = ${r.tenantId}`;
    expect(n).toBeGreaterThan(0);

    const resumen = (await listTenants(admin)).find((t) => t.id === r.tenantId);
    expect(resumen?.owners).toEqual([]);
    expect(resumen?.pendingOwners).toEqual([correo(nuevoDueno)]);
  });

  it("el dueño se registra despues y queda como dueño", async () => {
    // Lo que haria el trigger de auth al registrarse.
    await sql`insert into users (id, email) values (${nuevoDueno}, ${correo(nuevoDueno)})`;

    const tenantId = await claimInvitation(nuevoDueno, correo(nuevoDueno));
    expect(tenantId).toBe(creados[0]);

    const resumen = (await listTenants(admin)).find((t) => t.id === creados[0]);
    expect(resumen?.owners).toEqual([correo(nuevoDueno)]);
    expect(resumen?.pendingOwners).toEqual([]);
  });

  it("rechaza un dueño que ya pertenece a otro negocio", async () => {
    const r = await createTenant(admin, {
      name: "Otro",
      slug: slug(uuidv7(), "otro"),
      ownerEmail: correo(dueno),
      timezone: "America/Caracas",
      primaryCurrency: "USD",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("ownerEmail");
    expect(r.error).toContain("Existente");
  });

  it("rechaza un dueño con una invitacion pendiente en otro negocio", async () => {
    expect(await emailBlockedElsewhere(admin, correo(noAdmin), null)).toContain(
      "Con invitación",
    );
    // En el mismo negocio de la invitacion no hay conflicto.
    expect(await emailBlockedElsewhere(admin, correo(noAdmin), otroTenant)).toBeNull();
  });

  it("rechaza un slug repetido", async () => {
    const r = await createTenant(admin, {
      name: "Repetido",
      slug: slugNuevo,
      ownerEmail: `libre-${uuidv7().slice(-12)}@test.local`,
      timezone: "America/Caracas",
      primaryCurrency: "USD",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("slug");
  });

  it("rechaza una zona horaria o una moneda desconocidas", async () => {
    const base = {
      name: "Mal",
      slug: slug(uuidv7(), "mal"),
      ownerEmail: `libre-${uuidv7().slice(-12)}@test.local`,
    };
    const tz = await createTenant(admin, {
      ...base,
      timezone: "America/Caraca",
      primaryCurrency: "USD",
    });
    expect(tz.ok === false && tz.field).toBe("timezone");

    const moneda = await createTenant(admin, {
      ...base,
      timezone: "America/Caracas",
      primaryCurrency: "XYZ",
    });
    expect(moneda.ok === false && moneda.field).toBe("primaryCurrency");
  });

  // -------------------------------------------------------------------------
  // Edicion y suspension
  // -------------------------------------------------------------------------

  it("edita los datos y deja rastro en la auditoria", async () => {
    const r = await updateTenant(admin, tenant, {
      name: "Existente Renombrado",
      timezone: "America/Caracas",
      primaryCurrency: "EUR",
    });
    expect(r.ok).toBe(true);

    const [row] = await sql`select name, primary_currency from tenants where id = ${tenant}`;
    expect(row).toMatchObject({ name: "Existente Renombrado", primary_currency: "EUR" });

    const [log] = await sql`
      select actor_id, diff from audit_log
      where tenant_id = ${tenant} and entity = 'tenants' and action = 'update'
      order by at desc limit 1`;
    expect(log.actor_id).toBe(admin);
    expect(log.diff).toMatchObject({
      via: "admin",
      name: { from: "Existente", to: "Existente Renombrado" },
    });
  });

  it("suspende y reactiva", async () => {
    expect((await setTenantSuspended(admin, tenant, true)).ok).toBe(true);
    let [row] = await sql`select suspended_at from tenants where id = ${tenant}`;
    expect(row.suspended_at).not.toBeNull();

    expect((await setTenantSuspended(admin, tenant, false)).ok).toBe(true);
    [row] = await sql`select suspended_at from tenants where id = ${tenant}`;
    expect(row.suspended_at).toBeNull();
  });

  it("el propio negocio no puede levantarse la suspension", async () => {
    await setTenantSuspended(admin, tenant, true);

    await expect(
      withTenant(tenant, (tx) =>
        tx.update(tenants).set({ suspendedAt: null }).where(eq(tenants.id, tenant)),
      ),
    ).rejects.toThrow();

    // Pero el resto de su fila sigue siendo suya: la moneda la cambia el dueño.
    await withTenant(tenant, (tx) =>
      tx.update(tenants).set({ primaryCurrency: "USD" }).where(eq(tenants.id, tenant)),
    );
    const [row] = await sql`
      select primary_currency, suspended_at from tenants where id = ${tenant}`;
    expect(row.primary_currency).toBe("USD");
    expect(row.suspended_at).not.toBeNull();

    await setTenantSuspended(admin, tenant, false);
  });

  it("un no-admin no puede suspender aunque fije el GUC", async () => {
    const r = await setTenantSuspended(noAdmin, tenant, true);
    expect(r.ok).toBe(false);
    const [row] = await sql`select suspended_at from tenants where id = ${tenant}`;
    expect(row.suspended_at).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Rescate: el admin usa el mismo nucleo de equipo que el dueño
  // -------------------------------------------------------------------------

  it("el admin tampoco puede dejar un negocio sin dueño", async () => {
    const r = await changeRole({ tenantId: tenant, userId: admin }, dueno, "staff");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("al menos un dueño");
  });
});
