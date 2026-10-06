import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  listMembers,
  listPendingInvitations,
  inviteMember,
  cancelInvitation,
  changeRole,
  removeMember,
  claimInvitation,
} from "@/lib/authz/members";

/**
 * Gestion de miembros e invitaciones.
 *
 * Lo que mas importa aca: que el canje funcione (es lo que hace innecesario el
 * service_role key) y que no se pueda dejar un cliente sin dueño, que es un
 * estado del que no se sale desde la UI.
 */

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const otroTenant = uuidv7();
const dueno = uuidv7();
const segundoDueno = uuidv7();
const empleado = uuidv7();
const ajeno = uuidv7();

const ctx = { tenantId: tenant, userId: dueno };

/**
 * UUIDv7 es ordenado por tiempo: sus primeros caracteres son el timestamp, asi
 * que varios ids generados en el mismo milisegundo comparten prefijo. Hay que
 * tomar la parte aleatoria del final o todos los usuarios terminan con el mismo
 * correo — y entonces "ya forma parte del equipo" acierta cuando no deberia.
 */
const correo = (id: string) => `u-${id.slice(-12)}@test.local`;

describe.skipIf(!hasDb)("miembros e invitaciones", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug) values
      (${tenant},      'Equipo', ${"eq-" + tenant.slice(0, 8)}),
      (${otroTenant},  'Otro',   ${"ot-" + otroTenant.slice(0, 8)})`;
    await sql`insert into users (id, email, full_name) values
      (${dueno},        ${correo(dueno)},        'Dueño'),
      (${segundoDueno}, ${correo(segundoDueno)}, 'Socio'),
      (${empleado},     ${correo(empleado)},     'Empleado'),
      (${ajeno},        ${correo(ajeno)},        'Ajeno')`;
    await sql`insert into memberships (id, user_id, tenant_id, role) values
      (${uuidv7()}, ${dueno}, ${tenant}, 'owner')`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id in (${tenant}, ${otroTenant})`;
    await sql`delete from users where id in (${dueno}, ${segundoDueno}, ${empleado}, ${ajeno})`;
    await sql.end();
  });

  it("lista los miembros y marca cual es uno mismo", async () => {
    const miembros = await listMembers(tenant, dueno);
    expect(miembros.length).toBe(1);
    expect(miembros[0].role).toBe("owner");
    expect(miembros[0].isSelf).toBe(true);
    expect(miembros[0].fullName).toBe("Dueño");
  });

  it("invita por correo y queda pendiente", async () => {
    const r = await inviteMember(ctx, {
      email: `  ${correo(empleado).toUpperCase()}  `,
      role: "staff",
    });
    expect(r.ok).toBe(true);

    const pendientes = await listPendingInvitations(tenant);
    expect(pendientes.length).toBe(1);
    // Normalizado: es la clave con la que se busca al registrarse.
    expect(pendientes[0].email).toBe(correo(empleado));
    expect(pendientes[0].role).toBe("staff");
  });

  it("re-invitar actualiza el rol en vez de duplicar", async () => {
    await inviteMember(ctx, { email: correo(empleado), role: "manager" });

    const pendientes = await listPendingInvitations(tenant);
    expect(pendientes.length).toBe(1);
    expect(pendientes[0].role).toBe("manager");
  });

  it("rechaza un correo invalido", async () => {
    const r = await inviteMember(ctx, { email: "no-es-correo", role: "staff" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("email");
  });

  // -------------------------------------------------------------------------
  // El canje: lo que hace innecesario el service_role key
  // -------------------------------------------------------------------------

  it("al registrarse, la invitacion se canjea por una membresia", async () => {
    const tenantId = await claimInvitation(empleado, correo(empleado));
    expect(tenantId).toBe(tenant);

    const miembros = await listMembers(tenant, dueno);
    const nuevo = miembros.find((m) => m.userId === empleado);
    expect(nuevo?.role).toBe("manager"); // el rol de la ultima invitacion
    expect(nuevo?.isSelf).toBe(false);

    // Y deja de estar pendiente.
    expect(await listPendingInvitations(tenant)).toEqual([]);
  });

  it("el canje no funciona dos veces", async () => {
    expect(await claimInvitation(empleado, correo(empleado))).toBeNull();
  });

  it("sin invitacion, registrarse no da acceso a nada", async () => {
    // Es la propiedad que hace seguro que el registro sea publico.
    expect(await claimInvitation(ajeno, correo(ajeno))).toBeNull();
    const miembros = await listMembers(tenant, dueno);
    expect(miembros.some((m) => m.userId === ajeno)).toBe(false);
  });

  it("no se puede canjear la invitacion de otro correo", async () => {
    await inviteMember(ctx, { email: correo(segundoDueno), role: "owner" });

    // `ajeno` intenta canjear usando SU id pero el correo del invitado.
    // RLS filtra por el correo del usuario autenticado, no por el que se pase.
    expect(await claimInvitation(ajeno, correo(segundoDueno))).toBeNull();

    // La invitacion sigue intacta para su destinatario.
    const pendientes = await listPendingInvitations(tenant);
    expect(pendientes.some((p) => p.email === correo(segundoDueno))).toBe(true);
  });

  it("el destinatario legitimo si la canjea", async () => {
    expect(await claimInvitation(segundoDueno, correo(segundoDueno))).toBe(tenant);
    const miembros = await listMembers(tenant, dueno);
    expect(miembros.find((m) => m.userId === segundoDueno)?.role).toBe("owner");
  });

  // -------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------

  it("cambia el rol de otro miembro", async () => {
    const r = await changeRole(ctx, empleado, "staff");
    expect(r.ok).toBe(true);

    const miembros = await listMembers(tenant, dueno);
    expect(miembros.find((m) => m.userId === empleado)?.role).toBe("staff");
  });

  it("nadie cambia su propio rol", async () => {
    // Si el unico dueño se baja a staff por error, el cliente queda sin quien
    // administre nada y no hay forma de salir desde la UI.
    const r = await changeRole(ctx, dueno, "staff");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/tu propio rol/i);
  });

  it("nadie se quita a si mismo", async () => {
    const r = await removeMember(ctx, dueno);
    expect(r.ok).toBe(false);
  });

  it("siempre tiene que quedar al menos un dueño", async () => {
    // Hoy hay dos: bajar a uno se permite.
    expect((await changeRole(ctx, segundoDueno, "manager")).ok).toBe(true);

    // Ahora queda uno solo. Otro dueño intenta bajar al ultimo.
    const otroCtx = { tenantId: tenant, userId: segundoDueno };
    const r = await changeRole(otroCtx, dueno, "staff");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/al menos un dueño/i);

    // Y tampoco se lo puede quitar.
    const quitar = await removeMember(otroCtx, dueno);
    expect(quitar.ok).toBe(false);
    if (quitar.ok) return;
    expect(quitar.error).toMatch(/al menos un dueño/i);
  });

  it("quita a un miembro sin tocar sus registros historicos", async () => {
    const r = await removeMember(ctx, empleado);
    expect(r.ok).toBe(true);

    const miembros = await listMembers(tenant, dueno);
    expect(miembros.some((m) => m.userId === empleado)).toBe(false);

    // El usuario sigue existiendo; solo perdio el acceso a este cliente.
    const [u] = await sql<{ id: string }[]>`select id from users where id = ${empleado}`;
    expect(u).toBeDefined();
  });

  it("no se puede invitar a quien ya es miembro", async () => {
    const r = await inviteMember(ctx, { email: correo(dueno), role: "staff" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/ya forma parte/i);
  });

  it("cancelar quita la invitacion pendiente", async () => {
    await inviteMember(ctx, { email: "temporal@test.local", role: "staff" });
    const pendientes = await listPendingInvitations(tenant);
    const temporal = pendientes.find((p) => p.email === "temporal@test.local")!;

    expect((await cancelInvitation(ctx, temporal.id)).ok).toBe(true);
    const despues = await listPendingInvitations(tenant);
    expect(despues.some((p) => p.id === temporal.id)).toBe(false);
  });

  it("un cliente no ve los miembros ni las invitaciones de otro", async () => {
    expect(await listMembers(otroTenant, dueno)).toEqual([]);
    expect(await listPendingInvitations(otroTenant)).toEqual([]);
  });
});
