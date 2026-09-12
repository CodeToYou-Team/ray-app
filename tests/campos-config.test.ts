import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  createField,
  updateField,
  archiveField,
  upsertFixedOverride,
} from "@/lib/fields/register";
import { getFields } from "@/lib/fields/queries";
import { registerProduct, updateProduct } from "@/lib/productos/register";
import { listProducts } from "@/lib/productos/queries";

/**
 * Configuracion de columnas contra la base real.
 *
 * Lo que mas importa aca es que las reglas que hacen SEGURO dejar que el cliente
 * edite su propio esquema se cumplan de verdad: clave y tipo inmutables,
 * opciones que se archivan en vez de borrarse, y datos viejos que se siguen
 * pudiendo abrir.
 */

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const user = uuidv7();
const ctx = { tenantId: tenant, userId: user };
const catProd = uuidv7();

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

describe.skipIf(!hasDb)("configuracion de columnas", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });
    await sql`insert into tenants (id, name, slug) values (${tenant}, 'Fields', ${"f-" + tenant.slice(0, 8)})`;
    await sql`insert into users (id, email) values (${user}, ${`f-${user.slice(0, 8)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label)
              values (${catProd}, ${tenant}, 'product_category', 'general', 'General')`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  it("crea una columna personalizada y aparece junto a las fijas", async () => {
    const r = await createField(ctx, {
      entity: "product",
      label: "Marca",
      type: "text",
      required: false,
    });
    expect(r.ok).toBe(true);

    const fields = await getFields(tenant, "product");
    const marca = fields.find((f) => f.key === "marca");
    expect(marca?.source).toBe("custom");
    expect(marca?.label).toBe("Marca");
    // Y las fijas siguen ahi.
    expect(fields.some((f) => f.key === "price" && f.source === "fixed")).toBe(true);
  });

  it("una columna personalizada no puede chocar con una fija", async () => {
    const r = await createField(ctx, {
      entity: "product",
      label: "Price",
      type: "text",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/choca/i);
  });

  it("rechaza dos columnas con el mismo nombre", async () => {
    const r = await createField(ctx, {
      entity: "product",
      label: "marca",
      type: "text",
    });
    expect(r.ok).toBe(false);
  });

  it("un select necesita al menos una opcion", async () => {
    const r = await createField(ctx, {
      entity: "product",
      label: "Sin opciones",
      type: "select",
      options: [],
    });
    expect(r.ok).toBe(false);
  });

  it("guarda valores personalizados en el producto", async () => {
    await createField(ctx, {
      entity: "product",
      label: "Color",
      type: "select",
      options: [
        { code: "rojo", label: "Rojo" },
        { code: "azul", label: "Azul" },
      ],
    });

    const p = await registerProduct(ctx, {
      name: "Camisa",
      categoryId: catProd,
      price: "20.00",
      currency: "USD",
      custom: { marca: "ACME", color: "rojo" },
    });
    expect(p.ok).toBe(true);
    if (!p.ok) return;

    const [fila] = await sql<{ custom: Record<string, unknown> }[]>`
      select custom from products where id = ${p.id}`;
    expect(fila.custom.marca).toBe("ACME");
    expect(fila.custom.color).toBe("rojo");
  });

  it("rechaza un valor que no esta entre las opciones", async () => {
    const p = await registerProduct(ctx, {
      name: "Mal color",
      categoryId: catProd,
      price: "10.00",
      currency: "USD",
      custom: { color: "fucsia" },
    });
    expect(p.ok).toBe(false);
  });

  it("ignora claves que no corresponden a ninguna columna", async () => {
    const p = await registerProduct(ctx, {
      name: "Con basura",
      categoryId: catProd,
      price: "10.00",
      currency: "USD",
      custom: { inventado: "x", marca: "ACME" },
    });
    expect(p.ok).toBe(true);
    if (!p.ok) return;

    const [fila] = await sql<{ custom: Record<string, unknown> }[]>`
      select custom from products where id = ${p.id}`;
    expect(Object.hasOwn(fila.custom, "inventado")).toBe(false);
    expect(fila.custom.marca).toBe("ACME");
  });

  it("la clave es inmutable en la base, no solo en el codigo", async () => {
    const [fila] = await sql<{ id: string }[]>`
      select id from field_config where tenant_id = ${tenant} and key = 'marca'`;

    // 23001 = restrict_violation, del trigger.
    expect(
      await pgErrorCode(
        () => sql`update field_config set key = 'otra' where id = ${fila.id}`,
      ),
    ).toBe("23001");
  });

  it("el tipo es inmutable: cambiarlo dejaria los datos sin poder leerse", async () => {
    const [fila] = await sql<{ id: string }[]>`
      select id from field_config where tenant_id = ${tenant} and key = 'marca'`;

    expect(
      await pgErrorCode(
        () => sql`update field_config set type = 'number' where id = ${fila.id}`,
      ),
    ).toBe("23001");
  });

  it("renombrar cambia la etiqueta y conserva los datos", async () => {
    const [fila] = await sql<{ id: string }[]>`
      select id from field_config where tenant_id = ${tenant} and key = 'marca'`;

    const r = await updateField(ctx, fila.id, { label: "Fabricante" });
    expect(r.ok).toBe(true);

    const fields = await getFields(tenant, "product");
    const campo = fields.find((f) => f.key === "marca")!;
    expect(campo.label).toBe("Fabricante");
    expect(campo.key).toBe("marca"); // la clave no se movio

    // Y el producto sigue mostrando su valor.
    const productos = await listProducts(tenant);
    const camisa = productos.find((p) => p.name === "Camisa");
    expect(camisa).toBeDefined();
  });

  it("quitar una opcion la ARCHIVA, no la borra", async () => {
    const [fila] = await sql<{ id: string }[]>`
      select id from field_config where tenant_id = ${tenant} and key = 'color'`;

    // Se manda la lista sin "rojo".
    await updateField(ctx, fila.id, {
      label: "Color",
      options: [{ code: "azul", label: "Azul" }],
    });

    const campo = (await getFields(tenant, "product")).find((f) => f.key === "color")!;
    const rojo = campo.options.find((o) => o.code === "rojo");

    // Sigue existiendo, archivada: el producto que la tiene se sigue viendo.
    expect(rojo).toBeDefined();
    expect(rojo!.archivedAt).toBeTruthy();
    expect(campo.options.find((o) => o.code === "azul")?.archivedAt).toBeUndefined();
  });

  it("una columna archivada deja de escribirse pero el dato viejo no se toca", async () => {
    const nueva = await createField(ctx, {
      entity: "product",
      label: "Temporal",
      type: "text",
    });
    expect(nueva.ok).toBe(true);
    if (!nueva.ok) return;

    const p = await registerProduct(ctx, {
      name: "Con temporal",
      categoryId: catProd,
      price: "10.00",
      currency: "USD",
      custom: { temporal: "valor viejo" },
    });
    expect(p.ok).toBe(true);
    if (!p.ok) return;

    await archiveField(ctx, nueva.id, true);

    // Ya no se ofrece...
    expect((await getFields(tenant, "product")).some((f) => f.key === "temporal")).toBe(false);
    // ...pero el dato sigue en la fila.
    const [antes] = await sql<{ custom: Record<string, unknown> }[]>`
      select custom from products where id = ${p.id}`;
    expect(antes.custom.temporal).toBe("valor viejo");
  });

  it("una columna fija no se puede archivar", async () => {
    const r = await upsertFixedOverride(ctx, "product", "price", {
      label: "Precio de venta",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const archivar = await archiveField(ctx, r.id, true);
    expect(archivar.ok).toBe(false);
    if (archivar.ok) return;
    expect(archivar.error).toMatch(/no se archivan/i);
  });

  it("renombrar una columna fija no cambia su tipo ni su obligatoriedad", async () => {
    const campo = (await getFields(tenant, "product")).find((f) => f.key === "price")!;
    expect(campo.label).toBe("Precio de venta"); // renombrada en el test anterior
    expect(campo.type).toBe("money"); // sale del codigo, no de la fila
    expect(campo.required).toBe(true);
    expect(campo.editable.type).toBe(false);
    expect(campo.editable.archive).toBe(false);
  });

  it("el nombre no se puede ocultar aunque se pida", async () => {
    const r = await upsertFixedOverride(ctx, "product", "name", {
      label: "Nombre",
      hidden: true,
    });
    expect(r.ok).toBe(true);

    const campo = (await getFields(tenant, "product", { includeHidden: true })).find(
      (f) => f.key === "name",
    )!;
    expect(campo.hidden).toBe(false);
  });

  it("agregar un campo requerido NO rompe los productos que ya existian", async () => {
    /**
     * La regla que hace viable que el cliente edite su propio esquema: al
     * escribir se valida estricto, al leer nunca. Sin esto, marcar un campo
     * como requerido volveria imposible de abrir todo el historico.
     */
    const nueva = await createField(ctx, {
      entity: "product",
      label: "Obligatorio nuevo",
      type: "text",
      required: true,
    });
    expect(nueva.ok).toBe(true);

    // Todos los productos anteriores se siguen listando.
    const productos = await listProducts(tenant);
    expect(productos.length).toBeGreaterThan(0);

    // Pero un producto NUEVO si lo exige.
    const r = await registerProduct(ctx, {
      name: "Sin el obligatorio",
      categoryId: catProd,
      price: "10.00",
      currency: "USD",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/obligatorio/i);
  });

  it("al editar, los campos archivados se pierden y eso es lo que significa archivar", async () => {
    const productos = await listProducts(tenant);
    const conTemporal = productos.find((p) => p.name === "Con temporal")!;

    await updateProduct(ctx, conTemporal.id, {
      name: "Con temporal",
      categoryId: catProd,
      price: "10.00",
      currency: "USD",
      custom: { marca: "ACME", obligatorio_nuevo: "x" },
    });

    const [fila] = await sql<{ custom: Record<string, unknown> }[]>`
      select custom from products where id = ${conTemporal.id}`;
    // El JSONB se reemplaza entero: sin esto acumularia claves fantasma que
    // nadie ve ni puede borrar.
    expect(Object.hasOwn(fila.custom, "temporal")).toBe(false);
    expect(fila.custom.marca).toBe("ACME");
  });

  it("un cliente no ve la configuracion de columnas de otro", async () => {
    const otro = uuidv7();
    await sql`insert into tenants (id, name, slug) values (${otro}, 'Otro', ${"o-" + otro.slice(0, 8)})`;
    try {
      const fields = await getFields(otro, "product");
      // Solo las fijas, que salen del codigo. Ninguna personalizada del otro.
      expect(fields.every((f) => f.source === "fixed")).toBe(true);
    } finally {
      await sql`delete from tenants where id = ${otro}`;
    }
  });
});
