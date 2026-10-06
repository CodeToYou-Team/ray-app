import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { sql } from "drizzle-orm";
import { withTenant, withUser, assertRlsEnforced } from "@/lib/db/tenant";
import { getDb } from "@/lib/db";

/**
 * Prueba de fuga entre clientes. Es el criterio de salida de la Fase 1.
 *
 * Lo que se verifica no es que la app filtre bien — eso lo hace el codigo — sino
 * que la BASE DE DATOS no devuelva filas de otro cliente **aunque la aplicacion
 * se olvide del filtro**. Por eso las consultas de abajo NO llevan
 * `where tenant_id = ...` a proposito. Si este test pasa con el filtro quitado,
 * RLS es real; si no, es decorativo.
 */

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

const tenantA = uuidv7();
const tenantB = uuidv7();
const userA = uuidv7();
const userB = uuidv7();
const auditA = uuidv7();
const auditB = uuidv7();

/** Conexion como dueño, para sembrar y limpiar (se salta RLS a proposito). */
let owner: ReturnType<typeof postgres>;

/**
 * Codigo de error de Postgres, recorriendo la cadena de causas.
 *
 * Drizzle envuelve los errores del driver en un DrizzleQueryError cuyo mensaje
 * es "Failed query: ...", asi que asertar sobre el texto no sirve. El codigo si:
 * 42501 (insufficient_privilege) es lo que devuelve una violacion de RLS, y es
 * estable entre versiones de Postgres e idiomas del servidor.
 */
async function pgErrorCode(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    let current: unknown = error;
    while (current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string") return code;
      current = (current as { cause?: unknown }).cause;
    }
    return undefined;
  }
}

describe.skipIf(!hasDb)("aislamiento entre clientes (RLS)", () => {
  beforeAll(async () => {
    owner = postgres(process.env.TEST_DIRECT_URL!, { max: 1 });

    await owner`
      insert into tenants (id, name, slug) values
        (${tenantA}, 'Cliente A', ${"test-a-" + tenantA.slice(0, 8)}),
        (${tenantB}, 'Cliente B', ${"test-b-" + tenantB.slice(0, 8)})
    `;
    await owner`
      insert into users (id, email) values
        (${userA}, ${`a-${userA.slice(-12)}@test.local`}),
        (${userB}, ${`b-${userB.slice(-12)}@test.local`})
    `;
    await owner`
      insert into memberships (id, user_id, tenant_id, role) values
        (${uuidv7()}, ${userA}, ${tenantA}, 'owner'),
        (${uuidv7()}, ${userB}, ${tenantB}, 'owner')
    `;
    await owner`
      insert into audit_log (id, tenant_id, entity, entity_id, action, actor_id) values
        (${auditA}, ${tenantA}, 'test', ${uuidv7()}, 'create', ${userA}),
        (${auditB}, ${tenantB}, 'test', ${uuidv7()}, 'create', ${userB})
    `;
  });

  afterAll(async () => {
    if (!owner) return;
    // audit_log, users y memberships caen por ON DELETE CASCADE del tenant,
    // salvo users que no tiene tenant_id.
    await owner`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await owner`delete from users where id in (${userA}, ${userB})`;
    await owner.end();
  });

  it("la conexion de la app NO tiene BYPASSRLS", async () => {
    // Si esto falla, todo lo demas de este archivo es teatro.
    await expect(assertRlsEnforced()).resolves.toBeUndefined();
  });

  it("no lee tenants de otro cliente, sin filtro por tenant_id", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx.execute<{ id: string }>(sql`select id from tenants`),
    );

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(tenantA);
    expect(ids).not.toContain(tenantB);
  });

  it("no lee audit_log de otro cliente, sin filtro por tenant_id", async () => {
    const rows = await withTenant(tenantB, (tx) =>
      tx.execute<{ id: string }>(sql`select id from audit_log`),
    );

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(auditB);
    expect(ids).not.toContain(auditA);
  });

  it("no lee memberships de otro cliente", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx.execute<{ tenant_id: string }>(sql`select tenant_id from memberships`),
    );

    expect(rows.every((r) => r.tenant_id === tenantA)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("no puede insertar en audit_log con el tenant_id de otro cliente", async () => {
    const code = await pgErrorCode(() =>
      withTenant(tenantA, (tx) =>
        tx.execute(sql`
          insert into audit_log (id, tenant_id, entity, entity_id, action)
          values (${uuidv7()}, ${tenantB}, 'test', ${uuidv7()}, 'create')
        `),
      ),
    );

    // 42501 = insufficient_privilege. Si fuera undefined, el insert paso: fuga.
    expect(code).toBe("42501");
  });

  it("el log de auditoria es append-only: no se puede editar ni borrar", async () => {
    // Sin politica de UPDATE/DELETE para app_user, Postgres no falla: no
    // encuentra filas visibles para modificar y afecta cero.
    const updated = await withTenant(tenantA, (tx) =>
      tx.execute(sql`update audit_log set entity = 'hackeado' where id = ${auditA}`),
    );
    expect(updated.count).toBe(0);

    const deleted = await withTenant(tenantA, (tx) =>
      tx.execute(sql`delete from audit_log where id = ${auditA}`),
    );
    expect(deleted.count).toBe(0);

    // Y la fila sigue intacta.
    const [row] = await owner<{ entity: string }[]>`
      select entity from audit_log where id = ${auditA}
    `;
    expect(row.entity).toBe("test");
  });

  it("sin contexto de cliente no se ve nada", async () => {
    // current_tenant_id() devuelve NULL y toda comparacion da falso.
    const rows = await getDb().execute<{ id: string }>(sql`select id from tenants`);
    expect(rows.length).toBe(0);
  });
});

describe("withTenant: validacion de entrada", () => {
  it("rechaza un tenantId que no es UUID", async () => {
    await expect(withTenant("no-soy-un-uuid", async () => 1)).rejects.toThrow(
      /no es UUID/,
    );
  });
});

describe.skipIf(!hasDb)("arranque de sesion: resolver el cliente del usuario", () => {
  /**
   * El bug que este bloque existe para que no vuelva: requireTenant() consulta
   * memberships SIN contexto de cliente, porque todavia no sabe cual es. Con
   * solo las politicas basadas en tenant_id, RLS devolvia cero filas y el login
   * rebotaba a /login sin ningun mensaje.
   */
  let localOwner: ReturnType<typeof postgres>;
  const tA = uuidv7();
  const tB = uuidv7();
  const uA = uuidv7();
  const uB = uuidv7();

  beforeAll(async () => {
    localOwner = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });
    await localOwner`
      insert into tenants (id, name, slug) values
        (${tA}, 'Boot A', ${"boot-a-" + tA.slice(0, 8)}),
        (${tB}, 'Boot B', ${"boot-b-" + tB.slice(0, 8)})`;
    await localOwner`
      insert into users (id, email, full_name) values
        (${uA}, ${`boot-a-${uA.slice(-12)}@test.local`}, 'Ana Boot'),
        (${uB}, ${`boot-b-${uB.slice(-12)}@test.local`}, null)`;
    await localOwner`
      insert into memberships (id, user_id, tenant_id, role) values
        (${uuidv7()}, ${uA}, ${tA}, 'owner'),
        (${uuidv7()}, ${uB}, ${tB}, 'staff')`;
  });

  afterAll(async () => {
    if (!localOwner) return;
    await localOwner`delete from tenants where id in (${tA}, ${tB})`;
    await localOwner`delete from users where id in (${uA}, ${uB})`;
    await localOwner.end();
  });

  it("un usuario resuelve su propio cliente y su rol", async () => {
    const rows = await withUser(uA, (tx) =>
      tx.execute<{ slug: string; role: string; full_name: string | null }>(sql`
        select t.slug, m.role, u.full_name
        from memberships m
        join tenants t on t.id = m.tenant_id
        join users u on u.id = m.user_id
        where m.user_id = ${uA}`),
    );

    expect(rows.length).toBe(1);
    expect(rows[0].role).toBe("owner");
    expect(rows[0].full_name).toBe("Ana Boot");
  });

  it("NO ve las membresias ni los clientes de otro usuario", async () => {
    const membresias = await withUser(uA, (tx) =>
      tx.execute<{ user_id: string }>(sql`select user_id from memberships`),
    );
    expect(membresias.every((r) => r.user_id === uA)).toBe(true);

    const clientes = await withUser(uA, (tx) =>
      tx.execute<{ id: string }>(sql`select id from tenants`),
    );
    const ids = clientes.map((r) => r.id);
    expect(ids).toContain(tA);
    expect(ids).not.toContain(tB);
  });

  it("NO ve la fila de usuario de otro", async () => {
    const rows = await withUser(uA, (tx) =>
      tx.execute<{ id: string }>(sql`select id from users`),
    );
    expect(rows.map((r) => r.id)).toEqual([uA]);
  });

  it("el contexto de usuario no habilita leer datos del cliente", async () => {
    // Es solo para el arranque: los catalogos y todo lo demas siguen exigiendo
    // withTenant(). Si esto devolviera filas, el contexto de usuario seria una
    // puerta trasera al resto del sistema.
    const rows = await withUser(uA, (tx) =>
      tx.execute<{ id: string }>(sql`select id from catalog_items`),
    );
    expect(rows.length).toBe(0);
  });

  it("el contexto de usuario no permite escribir", async () => {
    const code = await pgErrorCode(() =>
      withUser(uA, (tx) =>
        tx.execute(sql`
          insert into memberships (id, user_id, tenant_id, role)
          values (${uuidv7()}, ${uA}, ${tB}, 'owner')`),
      ),
    );
    // 42501 = insufficient_privilege: las politicas de arranque son solo SELECT.
    expect(code).toBe("42501");
  });
});
