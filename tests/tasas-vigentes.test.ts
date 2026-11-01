import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  listConfiguredRates,
  findConfiguredRate,
  mergeRateSuggestions,
  type ConfiguredRate,
} from "@/lib/tenant/rates";
import { type RateSuggestion } from "@/lib/finanzas/queries";
import { withTenant } from "@/lib/db/tenant";
import { exchangeRates } from "@/lib/db/schema";

/**
 * Tasas vigentes: lo que el dueño declara que cobra hoy.
 *
 * Lo que de verdad hay que fijar acá es la precedencia (la configurada pisa a
 * la derivada) y que esta tabla NO toque ninguna operación ya registrada.
 */

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

const tenant = uuidv7();
const otro = uuidv7();
const user = uuidv7();

// -----------------------------------------------------------------------
// La mezcla es pura: se prueba sin base.
// -----------------------------------------------------------------------

const rate = (
  base: string,
  quote: string,
  valor: string,
  dia = "2026-05-01",
): ConfiguredRate => ({
  id: uuidv7(),
  baseCurrency: base,
  quoteCurrency: quote,
  rate: valor,
  updatedAt: new Date(`${dia}T12:00:00Z`),
});

describe("qué tasa se propone", () => {
  const ultimas: Record<string, RateSuggestion> = {
    "USD>VES": { rate: "41.500000", occurredOn: "2026-03-10" },
    "USD>COP": { rate: "4100.000000", occurredOn: "2026-02-10" },
  };

  it("sin nada fijado, propone la última que se usó", () => {
    const m = mergeRateSuggestions(ultimas, []);
    expect(m["USD>VES"]).toMatchObject({ rate: "41.500000", source: "ultima" });
    expect(m["USD>COP"].source).toBe("ultima");
  });

  it("la configurada pisa a la derivada", () => {
    // Si alguien se tomó el trabajo de fijarla, proponerle la de la última
    // venta sería ignorar lo que declaró.
    const m = mergeRateSuggestions(ultimas, [rate("USD", "VES", "45.000000")]);
    expect(m["USD>VES"]).toMatchObject({
      rate: "45.000000",
      source: "configurada",
    });
    // El par que no se fijó sigue saliendo de lo registrado.
    expect(m["USD>COP"].source).toBe("ultima");
  });

  it("una configurada de un par nunca usado también se propone", () => {
    const m = mergeRateSuggestions(ultimas, [rate("EUR", "VES", "48.000000")]);
    expect(m["EUR>VES"]).toMatchObject({
      rate: "48.000000",
      source: "configurada",
    });
  });

  it("el origen viaja con la tasa, para poder decirlo en pantalla", () => {
    // "la que tienes fijada" y "la que usaste en marzo" se aceptan con
    // confianza distinta: esconder cuál es haría que una vieja se aplicara sin
    // que nadie la mirara.
    const m = mergeRateSuggestions(ultimas, [rate("USD", "VES", "45.000000")]);
    expect(new Set(Object.values(m).map((s) => s.source))).toEqual(
      new Set(["configurada", "ultima"]),
    );
  });

  it("sin datos de ningún lado, no hay sugerencia", () => {
    expect(mergeRateSuggestions({}, [])).toEqual({});
  });
});

// -----------------------------------------------------------------------
// Persistencia y aislamiento.
// -----------------------------------------------------------------------

let sql: ReturnType<typeof postgres>;

describe.skipIf(!hasDb)("tasas vigentes en la base", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug) values
      (${tenant}, 'V', ${"v-" + tenant.slice(-12)}),
      (${otro},   'W', ${"w-" + otro.slice(-12)})`;
    await sql`insert into users (id, email) values (${user}, ${`v-${user.slice(-12)}@test.local`})`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id in (${tenant}, ${otro})`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  const insertar = (
    tenantId: string,
    base: string,
    quote: string,
    valor: string,
  ) =>
    sql`insert into exchange_rates (id, tenant_id, base_currency, quote_currency, rate, updated_by)
        values (${uuidv7()}, ${tenantId}, ${base}, ${quote}, ${valor}, ${user})`;

  it("guarda y lee una tasa", async () => {
    await insertar(tenant, "USD", "VES", "45.000000");

    const todas = await listConfiguredRates(tenant);
    expect(todas).toHaveLength(1);
    expect(todas[0]).toMatchObject({
      baseCurrency: "USD",
      quoteCurrency: "VES",
      rate: "45.000000",
    });

    const una = await findConfiguredRate(tenant, "USD", "VES");
    expect(una?.rate).toBe("45.000000");
    expect(await findConfiguredRate(tenant, "USD", "COP")).toBeNull();
  });

  it("no admite dos tasas vigentes para el mismo par", async () => {
    // Dos filas para USD>VES dejarían al formulario eligiendo en silencio.
    const code = await pgErrorCode(() => insertar(tenant, "USD", "VES", "46.000000"));
    expect(code).toBe("23505");
  });

  it("volver a guardar el mismo par reemplaza, no duplica", async () => {
    // Es lo que hace `saveExchangeRate`: un upsert contra el único compuesto
    // de tres columnas. Si el target estuviera mal, en vez de reemplazar
    // reventaría con 23505 — o peor, dejaría dos filas y el formulario
    // elegiría en silencio cuál proponer.
    const upsert = (valor: string) =>
      withTenant(tenant, (tx) =>
        tx
          .insert(exchangeRates)
          .values({
            id: uuidv7(),
            tenantId: tenant,
            baseCurrency: "USD",
            quoteCurrency: "VES",
            rate: valor,
            updatedBy: user,
          })
          .onConflictDoUpdate({
            target: [
              exchangeRates.tenantId,
              exchangeRates.baseCurrency,
              exchangeRates.quoteCurrency,
            ],
            set: { rate: valor, updatedBy: user, updatedAt: new Date() },
          }),
      );

    await upsert("47.250000");
    await upsert("48.500000");

    const usdVes = (await listConfiguredRates(tenant)).filter(
      (r) => r.baseCurrency === "USD" && r.quoteCurrency === "VES",
    );
    expect(usdVes).toHaveLength(1);
    expect(usdVes[0].rate).toBe("48.500000");

    // Se deja como estaba para las pruebas que siguen.
    await upsert("45.000000");
  });

  it("no admite una tasa cero o negativa", async () => {
    expect(await pgErrorCode(() => insertar(tenant, "EUR", "VES", "0"))).toBe("23514");
    expect(await pgErrorCode(() => insertar(tenant, "EUR", "COP", "-5"))).toBe("23514");
  });

  it("no admite cambiar una moneda por sí misma", async () => {
    expect(await pgErrorCode(() => insertar(tenant, "USD", "USD", "1"))).toBe("23514");
  });

  it("un cliente no ve las tasas de otro", async () => {
    await insertar(otro, "USD", "VES", "99.000000");
    expect(await listConfiguredRates(tenant)).toHaveLength(1);
    expect(await findConfiguredRate(tenant, "USD", "VES")).toMatchObject({
      rate: "45.000000",
    });
  });

  it("borrar un cliente se lleva sus tasas", async () => {
    const efimero = uuidv7();
    await sql`insert into tenants (id, name, slug) values (${efimero}, 'X', ${"x-" + efimero.slice(-12)})`;
    await insertar(efimero, "USD", "VES", "50.000000");
    await sql`delete from tenants where id = ${efimero}`;

    const quedan =
      await sql`select count(*)::int as n from exchange_rates where tenant_id = ${efimero}`;
    expect(quedan[0].n).toBe(0);
  });
});

/** El codigo de Postgres, buscandolo en la cadena de causas que envuelve Drizzle. */
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
