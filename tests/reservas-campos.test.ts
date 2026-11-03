import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { archiveField, createField, updateField, upsertFixedOverride } from "@/lib/fields/register";
import { getFields } from "@/lib/fields/queries";
import { createBooking, setResourceLabel, updateBooking } from "@/lib/reservas/register";
import { loadBookingFields } from "@/lib/reservas/page-data";
import { listBookings } from "@/lib/reservas/queries";

/**
 * Columnas personalizadas en la reserva.
 *
 * Lo que hay que fijar: que se validen contra `field_config` igual que en
 * productos (y en la misma transacción que la escritura), que modificar sin
 * mandarlas no las borre, que un campo oculto conserve su valor, que un
 * `catalog` se valide contra la base, y que la búsqueda del listado encuentre
 * por sus valores y no por sus claves.
 */

const hasDb = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL);
const TZ = "America/Caracas";

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const user = uuidv7();
const ctx = { tenantId: tenant, userId: user };

const catServ = uuidv7();
const doble = uuidv7();
const h101 = uuidv7();
const h102 = uuidv7();
const h103 = uuidv7();

const noches = (desde: string, hasta: string) => ({ unidad: "noche" as const, desde, hasta });

async function campo(input: Parameters<typeof createField>[1]): Promise<string> {
  const r = await createField(ctx, input);
  if (!r.ok) throw new Error(`No se pudo crear la columna: ${r.error}`);
  return r.id;
}

async function customDe(id: string): Promise<Record<string, unknown>> {
  const [fila] = await sql<{ custom: Record<string, unknown> }[]>`
    select custom from bookings where id = ${id}`;
  return fila.custom;
}

describe.skipIf(!hasDb)("columnas personalizadas en la reserva", () => {
  let motivoId = "";

  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug, timezone) values (${tenant}, 'Campos', ${"rc-" + tenant.slice(-12)}, ${TZ})`;
    await sql`insert into users (id, email) values (${user}, ${`rc-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label, archived_at) values
      (${catServ},  ${tenant}, 'service_category', 'serv',     'Servicios', null),
      (${uuidv7()}, ${tenant}, 'service_category', 'traslado', 'Traslado',  null),
      (${uuidv7()}, ${tenant}, 'service_category', 'viejo',    'Viejo',     now())`;
    await sql`insert into services (id, tenant_id, name, category_id, price, currency, booking_unit) values
      (${doble}, ${tenant}, 'Doble', ${catServ}, '40.00', 'USD', 'noche')`;
    await sql`insert into resources (id, tenant_id, service_id, name, capacity) values
      (${h101}, ${tenant}, ${doble}, '101', 2),
      (${h102}, ${tenant}, ${doble}, '102', 2),
      (${h103}, ${tenant}, ${doble}, '103', 2)`;

    await campo({ entity: "booking", label: "Placa", type: "text" });
    motivoId = await campo({
      entity: "booking",
      label: "Motivo",
      type: "select",
      options: [{ label: "Turismo" }, { label: "Trabajo" }],
    });
    await campo({ entity: "booking", label: "Huéspedes extra", type: "integer" });
    await campo({
      entity: "booking",
      label: "Origen",
      type: "catalog",
      config: { catalogKey: "service_category" },
    });
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  it("las columnas de la reserva no se mezclan con las de productos", async () => {
    const reserva = await getFields(tenant, "booking");
    expect(reserva.map((f) => f.key)).toEqual([
      // Las fijas primero: son columnas reales de `bookings`.
      "holder_name",
      "holder_document",
      "holder_phone",
      "notes",
      "placa",
      "motivo",
      "huespedes_extra",
      "origen",
    ]);
    expect(reserva.slice(0, 4).every((f) => f.source === "fixed")).toBe(true);
    expect((await getFields(tenant, "product")).some((f) => f.key === "placa")).toBe(false);

    // Lo que llega al formulario separa unas de otras: el JSONB solo lleva
    // las personalizadas.
    const campos = await loadBookingFields(tenant);
    expect(campos.fields.map((f) => f.key)).toEqual(["placa", "motivo", "huespedes_extra", "origen"]);
    expect(campos.fijos.holder_name).toEqual({ label: "Titular", visible: true, enTabla: true });
    // Documento, teléfono y notas no eran columnas del listado y siguen sin serlo.
    expect(campos.fijos.holder_phone).toEqual({ label: "Teléfono", visible: true, enTabla: false });
  });

  it("guarda los valores normalizados y descarta claves desconocidas", async () => {
    const r = await createBooking(ctx, {
      serviceId: doble,
      resourceId: h101,
      rango: noches("2029-01-10", "2029-01-12"),
      holderName: "Pérez",
      custom: {
        placa: "  AB123CD ",
        motivo: "turismo",
        huespedes_extra: "2",
        origen: "traslado",
        inventado: "x",
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(await customDe(r.id)).toEqual({
      placa: "AB123CD",
      motivo: "turismo",
      huespedes_extra: 2,
      origen: "traslado",
    });
  });

  it("rechaza un valor inválido y no crea la reserva", async () => {
    const r = await createBooking(ctx, {
      serviceId: doble,
      resourceId: h101,
      rango: noches("2029-02-10", "2029-02-12"),
      holderName: "Inválida",
      custom: { motivo: "contrabando" },
    });
    expect(r.ok).toBe(false);

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from bookings where tenant_id = ${tenant} and holder_name = 'Inválida'`;
    expect(n).toBe(0);
  });

  it("un catálogo se valida contra la base: inexistente o archivado, no", async () => {
    for (const origen of ["no_existe", "viejo"]) {
      const r = await createBooking(ctx, {
        serviceId: doble,
        resourceId: h101,
        rango: noches("2029-03-10", "2029-03-12"),
        holderName: "Catálogo",
        custom: { origen },
      });
      expect(r.ok, origen).toBe(false);
    }
  });

  it("modificar sin mandar las columnas no las toca; mandándolas, las reemplaza y audita", async () => {
    const creada = await createBooking(ctx, {
      serviceId: doble,
      resourceId: h102,
      rango: noches("2029-04-10", "2029-04-12"),
      holderName: "Gómez",
      custom: { placa: "XY999ZZ", motivo: "trabajo" },
    });
    if (!creada.ok) throw new Error(creada.error);

    // Sin `custom`: un cliente que solo corrige el teléfono no borra la placa.
    const r1 = await updateBooking(ctx, {
      id: creada.id,
      resourceId: h102,
      rango: noches("2029-04-10", "2029-04-12"),
      holderName: "Gómez",
      holderPhone: "0414",
    });
    expect(r1.ok).toBe(true);
    expect(await customDe(creada.id)).toEqual({ placa: "XY999ZZ", motivo: "trabajo" });

    // Con `custom`: reemplaza el conjunto. El motivo vaciado se va.
    const r2 = await updateBooking(ctx, {
      id: creada.id,
      resourceId: h102,
      rango: noches("2029-04-10", "2029-04-12"),
      holderName: "Gómez",
      holderPhone: "0414",
      custom: { placa: "XY111ZZ", motivo: "" },
    });
    expect(r2.ok).toBe(true);
    expect(await customDe(creada.id)).toEqual({ placa: "XY111ZZ" });

    const [audit] = await sql<{ diff: Record<string, { from: unknown; to: unknown }> }[]>`
      select diff from audit_log
      where tenant_id = ${tenant} and entity_id = ${creada.id} and action = 'update'
      order by at desc, id desc limit 1`;
    expect(audit.diff["custom.placa"]).toEqual({ from: "XY999ZZ", to: "XY111ZZ" });
    expect(audit.diff["custom.motivo"]).toEqual({ from: "trabajo", to: null });
  });

  it("un campo oculto no se exige y conserva su valor al modificar", async () => {
    const creada = await createBooking(ctx, {
      serviceId: doble,
      resourceId: h103,
      rango: noches("2029-05-10", "2029-05-12"),
      holderName: "Oculta",
      custom: { placa: "OC000UL", motivo: "turismo" },
    });
    if (!creada.ok) throw new Error(creada.error);

    // Oculto Y obligatorio: el formulario ya no lo muestra.
    expect(
      (await updateField(ctx, motivoId, { label: "Motivo", hidden: true, required: true })).ok,
    ).toBe(true);
    try {
      const r = await updateBooking(ctx, {
        id: creada.id,
        resourceId: h103,
        rango: noches("2029-05-10", "2029-05-12"),
        holderName: "Oculta",
        // Lo que manda el formulario: solo los visibles.
        custom: { placa: "OC111UL" },
      });
      expect(r.ok).toBe(true);
      expect(await customDe(creada.id)).toEqual({ placa: "OC111UL", motivo: "turismo" });
    } finally {
      await updateField(ctx, motivoId, { label: "Motivo", hidden: false, required: false });
    }
  });

  it("archivar una columna conserva el valor en las reservas que no se tocan", async () => {
    const creada = await createBooking(ctx, {
      serviceId: doble,
      resourceId: h101,
      rango: noches("2029-06-10", "2029-06-12"),
      holderName: "Archivada",
      custom: { motivo: "trabajo" },
    });
    if (!creada.ok) throw new Error(creada.error);

    await archiveField(ctx, motivoId, true);
    try {
      expect((await getFields(tenant, "booking")).some((f) => f.key === "motivo")).toBe(false);
      expect((await customDe(creada.id)).motivo).toBe("trabajo");
    } finally {
      await archiveField(ctx, motivoId, false);
    }
  });

  it("el listado busca por los valores de las columnas, no por sus claves", async () => {
    const porValor = await listBookings(tenant, TZ, { q: "ab123" });
    expect(porValor.rows.map((r) => r.holderName)).toEqual(["Pérez"]);
    expect(porValor.rows[0].custom.placa).toBe("AB123CD");

    // "placa" es la clave de todas; no debe traerlas.
    expect((await listBookings(tenant, TZ, { q: "placa" })).rows).toHaveLength(0);
  });

  it("las fijas se renombran y ocultan desde Ajustes; el titular no se oculta", async () => {
    const tel = await upsertFixedOverride(ctx, "booking", "holder_phone", {
      label: "Celular",
      hidden: true,
      showInTable: true,
    });
    const doc = await upsertFixedOverride(ctx, "booking", "holder_document", {
      label: "RIF",
      showInTable: true,
    });
    const titular = await upsertFixedOverride(ctx, "booking", "holder_name", {
      label: "Huésped",
      hidden: true,
    });
    expect(tel.ok && doc.ok && titular.ok).toBe(true);

    try {
      const { fijos } = await loadBookingFields(tenant);
      expect(fijos.holder_name).toEqual({ label: "Huésped", visible: true, enTabla: true });
      expect(fijos.holder_document).toEqual({ label: "RIF", visible: true, enTabla: true });
      // Oculta no sale en el listado aunque esté marcada "En tabla".
      expect(fijos.holder_phone).toEqual({ label: "Celular", visible: false, enTabla: false });
    } finally {
      await sql`delete from field_config where tenant_id = ${tenant} and source = 'fixed'`;
    }
  });

  it("cada servicio dice cómo se llaman sus recursos", async () => {
    expect((await setResourceLabel(ctx, { serviceId: doble, label: "  Cabaña " })).ok).toBe(true);
    const [con] = await sql<{ resource_label: string | null }[]>`
      select resource_label from services where id = ${doble}`;
    expect(con.resource_label).toBe("Cabaña");

    const largo = await setResourceLabel(ctx, { serviceId: doble, label: "x".repeat(41) });
    expect(largo.ok).toBe(false);

    // Vacío vuelve al genérico, guardado como NULL.
    expect((await setResourceLabel(ctx, { serviceId: doble, label: "" })).ok).toBe(true);
    const [sin] = await sql<{ resource_label: string | null }[]>`
      select resource_label from services where id = ${doble}`;
    expect(sin.resource_label).toBeNull();

    const auditado = await sql`
      select 1 from audit_log
      where tenant_id = ${tenant} and entity = 'services' and entity_id = ${doble}
        and diff ? 'resourceLabel'`;
    expect(auditado).toHaveLength(2);
  });
});
