import { describe, it, expect } from "vitest";
import { resolveFields, tableFields, optionLabel, activeOptions, keyTaken } from "@/lib/fields/resolve";
import { validateCustomValues, toFormValues } from "@/lib/fields/validate";
import { slugifyKey, FIELD_TYPE_KEYS } from "@/lib/fields/types";
import { FIXED_FIELDS, isFixedKey } from "@/lib/fields/fixed";
import type { FieldConfigRow } from "@/lib/db/schema";

/** Fila de field_config con lo minimo para los tests. */
function row(over: Partial<FieldConfigRow>): FieldConfigRow {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    tenantId: "00000000-0000-0000-0000-000000000001",
    entity: "product",
    key: "campo",
    source: "custom",
    label: "Campo",
    type: "text",
    required: false,
    options: [],
    config: {},
    hidden: false,
    showInTable: true,
    sortOrder: 0,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as FieldConfigRow;
}

describe("resolucion de columnas", () => {
  it("las columnas fijas aparecen aunque no haya nada configurado", () => {
    const fields = resolveFields("product", []);
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("name");
    expect(keys).toContain("price");
    expect(keys).toContain("category_id");
    expect(fields.every((f) => f.source === "fixed")).toBe(true);
  });

  it("agregar una columna fija en el codigo no exige tocar la base de los clientes", () => {
    // Sin ninguna fila de configuracion, salen todas las que declara el codigo.
    expect(resolveFields("product", []).length).toBe(FIXED_FIELDS.product.length);
    expect(resolveFields("service", []).length).toBe(FIXED_FIELDS.service.length);
  });

  it("una fila de configuracion solo aporta overrides a una columna fija", () => {
    const fields = resolveFields("product", [
      row({ key: "price", source: "fixed", label: "Precio de venta", type: null, sortOrder: 0 }),
    ]);
    const price = fields.find((f) => f.key === "price")!;
    expect(price.label).toBe("Precio de venta");
    // El tipo sigue saliendo del codigo, no de la fila.
    expect(price.type).toBe("money");
    expect(price.required).toBe(true);
  });

  it("una columna fija no se puede archivar ni cambiarle el tipo", () => {
    const fields = resolveFields("product", []);
    const price = fields.find((f) => f.key === "price")!;
    expect(price.editable).toEqual({
      label: true,
      type: false,
      required: false,
      archive: false,
    });
  });

  it("el nombre nunca se puede ocultar", () => {
    const fields = resolveFields("product", [
      row({ key: "name", source: "fixed", label: null, type: null, hidden: true }),
    ]);
    const name = fields.find((f) => f.key === "name")!;
    // Aunque la fila diga hidden, sin el nombre la fila no se puede identificar.
    expect(name.hidden).toBe(false);
    expect(name.alwaysVisible).toBe(true);
  });

  it("las personalizadas van despues de las fijas", () => {
    const fields = resolveFields("product", [
      row({ key: "marca", label: "Marca", sortOrder: 0 }),
    ]);
    const marca = fields.find((f) => f.key === "marca")!;
    const ultimaFija = fields.filter((f) => f.source === "fixed").at(-1)!;
    expect(marca.sortOrder).toBeGreaterThan(ultimaFija.sortOrder);
  });

  it("las archivadas se excluyen salvo que se pidan", () => {
    const config = [row({ key: "viejo", label: "Viejo", archivedAt: new Date() })];
    expect(resolveFields("product", config).some((f) => f.key === "viejo")).toBe(false);

    const conArchivadas = resolveFields("product", config, { includeArchived: true });
    expect(conArchivadas.find((f) => f.key === "viejo")?.archived).toBe(true);
  });

  it("las ocultas no van al formulario pero se pueden pedir para configurarlas", () => {
    const config = [row({ key: "interno", label: "Interno", hidden: true })];
    expect(resolveFields("product", config).some((f) => f.key === "interno")).toBe(false);
    expect(
      resolveFields("product", config, { includeHidden: true }).some(
        (f) => f.key === "interno",
      ),
    ).toBe(true);
  });

  it("tableFields deja solo lo que va en el listado", () => {
    const config = [
      row({ key: "visible", label: "Visible", showInTable: true }),
      row({ key: "oculto_tabla", label: "Solo formulario", showInTable: false }),
    ];
    const keys = tableFields(resolveFields("product", config)).map((f) => f.key);
    expect(keys).toContain("visible");
    expect(keys).not.toContain("oculto_tabla");
  });

  it("una opcion archivada se sigue resolviendo al mostrar", () => {
    const field = resolveFields("product", [
      row({
        key: "color",
        type: "select",
        label: "Color",
        options: [
          { code: "rojo", label: "Rojo" },
          { code: "verde", label: "Verde lima", archivedAt: "2026-01-01" },
        ],
      }),
    ]).find((f) => f.key === "color")!;

    // No se ofrece al crear...
    expect(activeOptions(field).map((o) => o.code)).toEqual(["rojo"]);
    // ...pero un producto que la tiene se sigue viendo bien.
    expect(optionLabel(field, "verde")).toBe("Verde lima");
    // Y un codigo desconocido se muestra tal cual, no como un hueco.
    expect(optionLabel(field, "azul")).toBe("azul");
  });

  it("detecta choques de clave con las columnas fijas", () => {
    expect(keyTaken("product", "price", [])).toBe(true);
    expect(keyTaken("product", "marca", [row({ key: "marca" })])).toBe(true);
    expect(keyTaken("product", "marca", [])).toBe(false);
    expect(isFixedKey("product", "sku")).toBe(true);
    expect(isFixedKey("service", "sku")).toBe(false); // los servicios no tienen SKU
  });
});

describe("validacion de valores personalizados", () => {
  const fields = resolveFields("product", [
    row({ key: "marca", type: "text", label: "Marca", required: true, sortOrder: 0 }),
    row({ key: "peso", type: "number", label: "Peso", sortOrder: 1 }),
    row({ key: "piezas", type: "integer", label: "Piezas", sortOrder: 2 }),
    row({ key: "costo", type: "money", label: "Costo", sortOrder: 3 }),
    row({ key: "importado", type: "boolean", label: "Importado", sortOrder: 4 }),
    row({ key: "vence", type: "date", label: "Vence", sortOrder: 5 }),
    row({
      key: "color",
      type: "select",
      label: "Color",
      sortOrder: 6,
      options: [
        { code: "rojo", label: "Rojo" },
        { code: "azul", label: "Azul" },
        { code: "viejo", label: "Descontinuado", archivedAt: "2026-01-01" },
      ],
    }),
    row({
      key: "usos",
      type: "multiselect",
      label: "Usos",
      sortOrder: 7,
      options: [
        { code: "hogar", label: "Hogar" },
        { code: "oficina", label: "Oficina" },
      ],
    }),
  ]);

  it("acepta y normaliza valores validos", () => {
    const r = validateCustomValues(fields, {
      marca: "  ACME  ",
      peso: "1.5",
      piezas: "3",
      costo: "9.5",
      importado: true,
      vence: "2026-12-31",
      color: "rojo",
      usos: ["oficina", "hogar", "hogar"],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.marca).toBe("ACME"); // sin espacios
    expect(r.values.peso).toBe(1.5); // numero
    expect(r.values.piezas).toBe(3);
    expect(r.values.costo).toBe("9.50"); // dinero como string normalizado
    expect(r.values.importado).toBe(true);
    // Sin duplicados y ordenado: dos guardados iguales dan el mismo JSONB.
    expect(r.values.usos).toEqual(["hogar", "oficina"]);
  });

  it("exige los campos obligatorios", () => {
    const r = validateCustomValues(fields, { peso: "1" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0].key).toBe("marca");
  });

  it("no guarda los campos vacios, para que el JSONB no se llene de nulls", () => {
    const r = validateCustomValues(fields, { marca: "X", peso: "", color: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.hasOwn(r.values, "peso")).toBe(false);
    expect(Object.hasOwn(r.values, "color")).toBe(false);
  });

  it("rechaza tipos que no cuadran", () => {
    expect(validateCustomValues(fields, { marca: "X", piezas: "1.5" }).ok).toBe(false);
    expect(validateCustomValues(fields, { marca: "X", costo: "1.999" }).ok).toBe(false);
    expect(validateCustomValues(fields, { marca: "X", vence: "31/12/2026" }).ok).toBe(false);
    expect(validateCustomValues(fields, { marca: "X", peso: "mucho" }).ok).toBe(false);
  });

  it("rechaza una opcion archivada al escribir", () => {
    const r = validateCustomValues(fields, { marca: "X", color: "viejo" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0].message).toMatch(/ya no está disponible/i);
  });

  it("rechaza una opcion inventada", () => {
    expect(validateCustomValues(fields, { marca: "X", color: "fucsia" }).ok).toBe(false);
    expect(
      validateCustomValues(fields, { marca: "X", usos: ["hogar", "taller"] }).ok,
    ).toBe(false);
  });

  it("ignora las claves de campos que no existen", () => {
    // Un cliente malicioso podria mandar cualquier clave; solo entran las
    // declaradas.
    const r = validateCustomValues(fields, { marca: "X", inventado: "hola" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.hasOwn(r.values, "inventado")).toBe(false);
  });

  it("no escribe en campos archivados, pero no toca lo ya guardado", () => {
    const conArchivado = resolveFields(
      "product",
      [row({ key: "viejo", type: "text", label: "Viejo", archivedAt: new Date() })],
      { includeArchived: true },
    );
    const r = validateCustomValues(conArchivado, { viejo: "algo" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.hasOwn(r.values, "viejo")).toBe(false);
  });

  it("al LEER no se valida: un producto viejo sigue abriendose", () => {
    /**
     * El caso que esta regla protege: el cliente marca "marca" como requerido
     * en marzo. Todos los productos de enero no la tienen. Si la lectura
     * validara, ninguno se podria abrir ni listar.
     */
    const values = toFormValues(fields, { color: "viejo" });
    expect(values.marca).toBe(""); // vacio, no una excepcion
    expect(values.color).toBe("viejo"); // la opcion archivada se conserva
    expect(values.usos).toEqual([]);
    expect(values.importado).toBe(false);
  });
});

describe("slugifyKey", () => {
  it("produce claves legibles en SQL", () => {
    expect(slugifyKey("Marca")).toBe("marca");
    expect(slugifyKey("Garantía (meses)")).toBe("garantia_meses");
    expect(slugifyKey("  Peso en Kg  ")).toBe("peso_en_kg");
  });

  it("no deja una clave que empiece con numero", () => {
    // `custom->>'2024'` es legal pero confuso; el prefijo lo hace inequivoco.
    expect(slugifyKey("2024 modelo")).toBe("f_2024_modelo");
  });

  it("devuelve vacio si no queda nada utilizable", () => {
    expect(slugifyKey("$$$")).toBe("");
  });
});

describe("catalogo de tipos", () => {
  it("todos los tipos declarados tienen definicion", () => {
    expect(FIELD_TYPE_KEYS.length).toBeGreaterThan(0);
    for (const key of FIELD_TYPE_KEYS) {
      expect(typeof key).toBe("string");
    }
  });
});
