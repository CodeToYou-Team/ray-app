import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  changeAdminLevel,
  getPlatformAdminLevel,
  grantAdmin,
  listAdminHistory,
  listAdmins,
  revokeAdmin,
} from "@/lib/admin/admins";
import { withPlatformAdmin } from "@/lib/db/tenant";
import { platformAuditLog } from "@/lib/db/schema";

/**
 * Superadmin y gestion de administradores.
 *
 * Lo que mas importa aca es que las garantias vivan en la base y no solo en la
 * app: un admin comun no escribe en platform_admins aunque llame al nucleo sin
 * pasar por la accion, nunca queda la plataforma sin superadmin (tampoco con
 * dos cambios a la vez), y cada cambio deja rastro aunque lo haga el script.
 */

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

let sql: ReturnType<typeof postgres>;

const superA = uuidv7();
const superB = uuidv7();
const comun = uuidv7();
const nuevo = uuidv7();
const todos = [superA, superB, comun, nuevo];

// Ver AGENTS.md: los UUIDv7 del mismo milisegundo comparten prefijo.
const correo = (id: string) => `sa-${id.slice(-12)}@test.local`;

/** Superadmins del test que siguen arriba. */
async function superadminsCount(): Promise<number> {
  const [{ n }] = await sql`
    select count(*)::int as n from platform_admins
    where level = 'superadmin' and user_id in ${sql(todos)}`;
  return n;
}

/**
 * Superadmins reales que ya estaban en la base. Si TEST_DATABASE_URL apunta a
 * la base de desarrollo, ahi esta la cuenta de quien desarrolla, y la regla de
 * "al menos uno" es global: con ella presente, ningun superadmin del test es
 * nunca el ultimo. Los tests no tocan esas filas fuera de una transaccion que
 * siempre se deshace.
 */
let ajenos: string[] = [];

describe.skipIf(!hasDb)("superadmin y administradores", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into users (id, email, full_name) values
      (${superA}, ${correo(superA)}, 'Super A'),
      (${superB}, ${correo(superB)}, 'Super B'),
      (${comun},  ${correo(comun)},  'Común'),
      (${nuevo},  ${correo(nuevo)},  'Nuevo')`;
    // Como lo haria el script: con el rol dueño, sin GUC de admin.
    await sql`insert into platform_admins (user_id, level) values
      (${superA}, 'superadmin'),
      (${superB}, 'superadmin'),
      (${comun},  'admin')`;

    ajenos = (
      await sql<{ user_id: string }[]>`
        select user_id from platform_admins
        where level = 'superadmin' and user_id not in ${sql(todos)}`
    ).map((r) => r.user_id);
  });

  afterAll(async () => {
    if (!sql) return;
    // Borrar la cuenta entera es la excepcion del trigger: se puede aunque sea
    // el ultimo superadmin.
    await sql`delete from users where id in ${sql(todos)}`;
    await sql`delete from platform_audit_log where entity_id in ${sql(todos)}`;
    await sql.end();
  });

  it("distingue los niveles", async () => {
    expect(await getPlatformAdminLevel(superA)).toBe("superadmin");
    expect(await getPlatformAdminLevel(comun)).toBe("admin");
    expect(await getPlatformAdminLevel(nuevo)).toBeNull();
  });

  it("el superadmin ve a todos; el admin comun solo a si mismo", async () => {
    const vistosPorSuper = (await listAdmins(superA)).map((a) => a.userId);
    expect(vistosPorSuper).toEqual(expect.arrayContaining([superA, superB, comun]));

    const vistosPorComun = await listAdmins(comun);
    expect(vistosPorComun.map((a) => a.userId)).toEqual([comun]);
    expect(vistosPorComun[0].isSelf).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Escritura: solo superadmin, y lo impone la base
  // -------------------------------------------------------------------------

  it("un admin comun no puede nombrar, cambiar ni quitar, aunque llame al nucleo", async () => {
    const nombrar = await grantAdmin(comun, { email: correo(nuevo), level: "admin" });
    expect(nombrar.ok).toBe(false);
    expect(await getPlatformAdminLevel(nuevo)).toBeNull();

    const subirse = await changeAdminLevel(comun, superB, "admin");
    expect(subirse.ok).toBe(false);

    const quitar = await revokeAdmin(comun, superA);
    expect(quitar.ok).toBe(false);

    expect(await getPlatformAdminLevel(superA)).toBe("superadmin");
    expect(await getPlatformAdminLevel(superB)).toBe("superadmin");
  });

  it("el superadmin nombra a alguien con cuenta", async () => {
    const r = await grantAdmin(superA, {
      email: `  ${correo(nuevo).toUpperCase()} `,
      level: "admin",
    });
    expect(r.ok).toBe(true);
    expect(await getPlatformAdminLevel(nuevo)).toBe("admin");
  });

  it("no nombra a quien no tiene cuenta ni a quien ya es admin", async () => {
    const sinCuenta = await grantAdmin(superA, {
      email: "nadie-registrado@test.local",
      level: "admin",
    });
    expect(sinCuenta.ok === false && sinCuenta.field).toBe("email");

    const repetido = await grantAdmin(superA, { email: correo(nuevo), level: "superadmin" });
    expect(repetido.ok).toBe(false);
    // Y no lo sube de nivel de paso.
    expect(await getPlatformAdminLevel(nuevo)).toBe("admin");
  });

  it("nadie se cambia ni se quita a si mismo desde la app", async () => {
    expect((await changeAdminLevel(superA, superA, "admin")).ok).toBe(false);
    expect((await revokeAdmin(superA, superA)).ok).toBe(false);
    expect(await getPlatformAdminLevel(superA)).toBe("superadmin");
  });

  it("cambia el nivel y quita", async () => {
    expect((await changeAdminLevel(superA, nuevo, "superadmin")).ok).toBe(true);
    expect(await getPlatformAdminLevel(nuevo)).toBe("superadmin");

    expect((await revokeAdmin(superA, nuevo)).ok).toBe(true);
    expect(await getPlatformAdminLevel(nuevo)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Siempre queda al menos un superadmin
  // -------------------------------------------------------------------------

  it("no deja quitar al ultimo superadmin", async () => {
    // Todo dentro de una transaccion del rol dueño (el del script) que termina
    // en error y se deshace: los superadmins ajenos se bajan solo ahi adentro
    // para que A sea de verdad el ultimo, y nadie fuera llega a verlo.
    const error = await sql
      .begin(async (tx) => {
        if (ajenos.length > 0) {
          await tx`update platform_admins set level = 'admin' where user_id in ${tx(ajenos)}`;
        }
        await tx`update platform_admins set level = 'admin' where user_id = ${superB}`;
        await tx`delete from platform_admins where user_id = ${superA}`;
      })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ code: "PA001" });

    // Lo mismo bajandolo de nivel en vez de borrarlo.
    const bajar = await sql
      .begin(async (tx) => {
        if (ajenos.length > 0) {
          await tx`update platform_admins set level = 'admin' where user_id in ${tx(ajenos)}`;
        }
        await tx`update platform_admins set level = 'admin' where user_id = ${superB}`;
        await tx`update platform_admins set level = 'admin' where user_id = ${superA}`;
      })
      .catch((e: unknown) => e);

    expect(bajar).toMatchObject({ code: "PA001" });

    // Se deshizo todo, tambien lo de los ajenos.
    expect(await superadminsCount()).toBe(2);
    if (ajenos.length > 0) {
      const [{ n }] = await sql`
        select count(*)::int as n from platform_admins
        where level = 'superadmin' and user_id in ${sql(ajenos)}`;
      expect(n).toBe(ajenos.length);
    }
  });

  it("dos superadmins que se bajan el uno al otro a la vez no dejan a ninguno", async (ctx) => {
    // Necesita que A y B sean los unicos superadmins de verdad, en filas
    // confirmadas: dos conexiones distintas no ven una transaccion abierta.
    if (ajenos.length > 0) {
      ctx.skip(
        "Hay superadmins reales en esta base: TEST_DATABASE_URL apunta a una base con datos de desarrollo.",
      );
    }

    expect(await superadminsCount()).toBe(2);

    const resultados = await Promise.all([
      changeAdminLevel(superA, superB, "admin"),
      changeAdminLevel(superB, superA, "admin"),
    ]);

    expect(resultados.filter((r) => r.ok).length).toBe(1);
    expect(await superadminsCount()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Auditoria
  // -------------------------------------------------------------------------

  it("registra cada cambio con quien lo hizo, tambien el del script", async () => {
    const historial = await listAdminHistory(superA, 100);
    const deNuevo = historial.filter((h) => h.email === correo(nuevo));

    // Nombrado (create), subido (update) y quitado (delete), todos por A.
    expect(deNuevo.map((h) => h.action).sort()).toEqual(["create", "delete", "update"]);
    expect(deNuevo.every((h) => h.actorEmail === correo(superA))).toBe(true);
    expect(deNuevo.find((h) => h.action === "update")?.diff.level).toEqual({
      from: "admin",
      to: "superadmin",
    });

    // El alta de "comun" fue con el rol dueño: actor NULL.
    const delScript = historial.find(
      (h) => h.email === correo(comun) && h.action === "create",
    );
    expect(delScript?.actorEmail).toBeNull();
  });

  it("el historial solo lo ve un superadmin, y la app no puede escribirlo", async () => {
    expect(await listAdminHistory(comun)).toEqual([]);

    await expect(
      withPlatformAdmin(superA, (tx) =>
        tx.insert(platformAuditLog).values({
          entity: "platform_admins",
          entityId: superA,
          action: "create",
          actorId: superA,
        }),
      ),
    ).rejects.toThrow();
  });
});
