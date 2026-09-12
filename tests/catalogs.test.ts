import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { listCatalog, listCatalogs, catalogLabels } from "@/lib/catalogs/queries";
import { slugifyCode, DEFAULT_CATALOG_ITEMS, CATALOG_KEYS } from "@/lib/catalogs/keys";
import { isKnownCurrency, currencyLabel, CURRENCIES } from "@/lib/currencies";

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

const tenantA = uuidv7();
const tenantB = uuidv7();

let owner: ReturnType<typeof postgres>;

/** Codigo de error de Postgres, recorriendo la cadena de causas. */
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

describe.skipIf(!hasDb)("catalogos", () => {
  beforeAll(async () => {
    owner = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await owner`
      insert into tenants (id, name, slug) values
        (${tenantA}, 'Cat A', ${"cat-a-" + tenantA.slice(0, 8)}),
        (${tenantB}, 'Cat B', ${"cat-b-" + tenantB.slice(0, 8)})
    `;

    // Se siembra el cliente A con los mismos defaults que usa seed-tenant.
    for (const catalogKey of CATALOG_KEYS) {
      for (const [index, item] of DEFAULT_CATALOG_ITEMS[catalogKey].entries()) {
        await owner`
          insert into catalog_items
            (id, tenant_id, catalog_key, code, label, currency, sort_order)
          values (${uuidv7()}, ${tenantA}, ${catalogKey},
                  ${slugifyCode(item.label)}, ${item.label},
                  ${item.currency ?? null}, ${index})
        `;
      }
    }
  });

  afterAll(async () => {
    if (!owner) return;
    await owner`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await owner.end();
  });

  it("siembra los catalogos por defecto en el orden definido", async () => {
    const items = await listCatalog(tenantA, "expense_category");
    expect(items.map((i) => i.label)).toEqual(
      DEFAULT_CATALOG_ITEMS.expense_category.map((i) => i.label),
    );
  });

  it("los metodos de pago traen su moneda", async () => {
    const methods = await listCatalog(tenantA, "payment_method");
    expect(methods.length).toBeGreaterThan(0);
    // Contra la lista, no contra un regex de 3 letras: las stablecoins (USDT,
    // USDC) son de 4, y ese detalle es justo el que rompio esta asercion.
    expect(methods.every((m) => isKnownCurrency(m.currency ?? ""))).toBe(true);

    // Es la moneda que despues se copia a cada transaccion.
    const monedas = new Set(methods.map((m) => m.currency));
    expect(monedas.has("VES")).toBe(true);
    expect(monedas.has("USD")).toBe(true);
    // Los tickers de 4 caracteres tienen que sobrevivir a la columna varchar(10).
    expect(monedas.has("USDT")).toBe(true);
    expect(monedas.has("USDC")).toBe(true);
  });

  it("las categorias NO llevan moneda", async () => {
    const items = await listCatalog(tenantA, "income_category");
    expect(items.every((i) => i.currency === null)).toBe(true);
  });

  it("el code se genera sin acentos, para que el SQL sea legible", async () => {
    const items = await listCatalog(tenantA, "expense_category");
    const logistica = items.find((i) => i.label === "Logística");
    expect(logistica?.code).toBe("logistica");
  });

  it("un item archivado desaparece de los selectores pero sigue resolviendo su etiqueta", async () => {
    const [item] = await listCatalog(tenantA, "income_category");

    await owner`update catalog_items set archived_at = now() where id = ${item.id}`;
    try {
      const activos = await listCatalog(tenantA, "income_category");
      expect(activos.map((i) => i.id)).not.toContain(item.id);

      const conArchivados = await listCatalog(tenantA, "income_category", {
        includeArchived: true,
      });
      expect(conArchivados.map((i) => i.id)).toContain(item.id);

      // Lo que hace que un registro de enero no se vea con un hueco.
      const labels = await catalogLabels(tenantA, "income_category");
      expect(labels.get(item.code)).toBe(item.label);
    } finally {
      await owner`update catalog_items set archived_at = null where id = ${item.id}`;
    }
  });

  it("listCatalogs agrupa varios catalogos en una sola consulta", async () => {
    const grouped = await listCatalogs(tenantA, [
      "income_category",
      "payment_method",
    ]);
    expect(grouped.income_category.length).toBeGreaterThan(0);
    expect(grouped.payment_method.length).toBeGreaterThan(0);
    // Solo devuelve lo pedido, no todos los catalogos del cliente.
    expect(grouped.product_category).toBeUndefined();
  });

  it("el code es inmutable, el label no", async () => {
    const [item] = await listCatalog(tenantA, "product_category");

    // 23001 = restrict_violation, que es lo que lanza el trigger.
    expect(
      await pgErrorCode(
        () => owner`update catalog_items set code = 'otro' where id = ${item.id}`,
      ),
    ).toBe("23001");

    expect(
      await pgErrorCode(
        () =>
          owner`update catalog_items set catalog_key = 'service_category' where id = ${item.id}`,
      ),
    ).toBe("23001");

    // Renombrar si se puede: es el caso de uso normal.
    await owner`update catalog_items set label = 'Renombrada' where id = ${item.id}`;
    const [renamed] = await listCatalog(tenantA, "product_category");
    expect(renamed.label).toBe("Renombrada");
    expect(renamed.code).toBe(item.code);
  });

  it("la moneda es exclusiva de los metodos de pago, en los dos sentidos", async () => {
    // 23514 = check_violation.
    expect(
      await pgErrorCode(
        () => owner`
          insert into catalog_items (id, tenant_id, catalog_key, code, label)
          values (${uuidv7()}, ${tenantA}, 'payment_method', 'sin_moneda', 'Sin moneda')
        `,
      ),
    ).toBe("23514");

    expect(
      await pgErrorCode(
        () => owner`
          insert into catalog_items (id, tenant_id, catalog_key, code, label, currency)
          values (${uuidv7()}, ${tenantA}, 'income_category', 'con_moneda', 'Con moneda', 'USD')
        `,
      ),
    ).toBe("23514");
  });

  it("el mismo code puede existir en catalogos distintos, pero no repetido en uno", async () => {
    // "Consultoría" es a la vez categoria de ingreso y de servicio: valido.
    const ingresos = await listCatalog(tenantA, "income_category");
    const servicios = await listCatalog(tenantA, "service_category");
    expect(ingresos.some((i) => i.code === "consultoria")).toBe(true);
    expect(servicios.some((i) => i.code === "consultoria")).toBe(true);

    // 23505 = unique_violation.
    expect(
      await pgErrorCode(
        () => owner`
          insert into catalog_items (id, tenant_id, catalog_key, code, label)
          values (${uuidv7()}, ${tenantA}, 'income_category', 'consultoria', 'Duplicada')
        `,
      ),
    ).toBe("23505");
  });

  it("un cliente no ve los catalogos de otro", async () => {
    const deA = await listCatalog(tenantA, "income_category");
    const deB = await listCatalog(tenantB, "income_category");

    expect(deA.length).toBeGreaterThan(0);
    // B nunca fue sembrado: tiene que venir vacio, no con lo de A.
    expect(deB).toEqual([]);
  });
});

describe("slugifyCode", () => {
  it("normaliza acentos, espacios y simbolos", () => {
    expect(slugifyCode("Logística")).toBe("logistica");
    expect(slugifyCode("Renta y servicios")).toBe("renta_y_servicios");
    expect(slugifyCode("Pago móvil")).toBe("pago_movil");
    expect(slugifyCode("  Efectivo $  ")).toBe("efectivo");
    expect(slugifyCode("Software / Herramientas")).toBe("software_herramientas");
  });

  it("devuelve vacio si no queda nada utilizable", () => {
    expect(slugifyCode("$$$")).toBe("");
    expect(slugifyCode("   ")).toBe("");
  });

  it("las etiquetas por defecto no producen codes duplicados dentro de un catalogo", () => {
    for (const key of CATALOG_KEYS) {
      const codes = DEFAULT_CATALOG_ITEMS[key].map((i) => slugifyCode(i.label));
      expect(codes.every((c) => c.length > 0)).toBe(true);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });
});

describe("monedas", () => {
  it("reconoce las que usa el negocio", () => {
    expect(isKnownCurrency("USD")).toBe(true);
    expect(isKnownCurrency("VES")).toBe(true);
    expect(isKnownCurrency("EUR")).toBe(true);
  });

  it("normaliza mayusculas y espacios", () => {
    expect(isKnownCurrency("usd")).toBe(true);
    expect(isKnownCurrency("  ves  ")).toBe(true);
  });

  it("rechaza codigos inventados", () => {
    // El caso real que justifica el selector: un typo no da error, parte una
    // moneda en dos y el dashboard muestra dos columnas donde deberia haber una.
    expect(isKnownCurrency("UDS")).toBe(false);
    expect(isKnownCurrency("USDD")).toBe(false);
    expect(isKnownCurrency("")).toBe(false);
  });

  it("no tiene codigos repetidos", () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("todas las monedas de los catalogos por defecto son conocidas", () => {
    // Si alguien agrega un metodo de pago por defecto con una moneda que no
    // esta en la lista, el seed lo crearia pero el formulario no lo podria editar.
    for (const item of DEFAULT_CATALOG_ITEMS.payment_method) {
      expect(item.currency, `moneda de "${item.label}"`).toBeDefined();
      expect(isKnownCurrency(item.currency!), `"${item.currency}" de "${item.label}"`).toBe(true);
    }
  });

  it("muestra el codigo tal cual si no la conoce", () => {
    // Datos historicos de una moneda que se saco de la lista: se muestran igual,
    // no se dejan en blanco.
    expect(currencyLabel("USD")).toBe("USD — Dólar estadounidense");
    expect(currencyLabel("XYZ")).toBe("XYZ");
  });
});
