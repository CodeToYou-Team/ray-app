import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";

/**
 * Reglas de dominio de transacciones, renglones e inventario.
 *
 * Se ejercitan como dueño de la base, saltando RLS a proposito: lo que se prueba
 * aca no es el aislamiento entre clientes (eso es tenant-isolation.test.ts) sino
 * que las reglas del negocio esten hechas cumplir por POSTGRES y no solo por el
 * codigo de la aplicacion. Si una regla solo vive en un Server Action, un script
 * o un bug la saltan sin que nadie se entere.
 */

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const user = uuidv7();

const cat = {
  ingreso: uuidv7(),
  gasto: uuidv7(),
  producto: uuidv7(),
  servicio: uuidv7(),
};
const pay = { usd: uuidv7(), ves: uuidv7() };
const productId = uuidv7();
const serviceId = uuidv7();

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

/** Crea una transaccion base y devuelve su id. */
async function nuevaTransaccion(overrides: Record<string, unknown> = {}) {
  const id = uuidv7();
  const row = {
    id,
    tenant_id: tenant,
    type: "ingreso",
    kind: "operacion",
    concept: "Prueba",
    occurred_on: "2026-09-11",
    category_id: cat.ingreso,
    category_catalog_key: "income_category",
    payment_method_id: pay.usd,
    payment_catalog_key: "payment_method",
    amount: "100.00",
    currency: "USD",
    created_by: user,
    ...overrides,
  };
  await sql`insert into transactions ${sql(row)}`;
  return id;
}

async function stockDe(id: string): Promise<number> {
  const [r] = await sql<{ stock: string }[]>`
    select coalesce(sum(delta), 0)::text as stock
    from stock_movements where tenant_id = ${tenant} and product_id = ${id}
  `;
  return Number(r.stock);
}

describe.skipIf(!hasDb)("transacciones e inventario", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug) values (${tenant}, 'TX', ${"tx-" + tenant.slice(0, 8)})`;
    await sql`insert into users (id, email) values (${user}, ${`tx-${user.slice(-12)}@test.local`})`;

    await sql`
      insert into catalog_items (id, tenant_id, catalog_key, code, label, currency) values
        (${cat.ingreso},  ${tenant}, 'income_category',   'ventas',   'Ventas',    null),
        (${cat.gasto},    ${tenant}, 'expense_category',  'insumos',  'Insumos',   null),
        (${cat.producto}, ${tenant}, 'product_category',  'general',  'General',   null),
        (${cat.servicio}, ${tenant}, 'service_category',  'general',  'General',   null),
        (${pay.usd},      ${tenant}, 'payment_method',    'efec_usd', 'Efectivo USD', 'USD'),
        (${pay.ves},      ${tenant}, 'payment_method',    'pago_movil','Pago móvil',  'VES')
    `;

    await sql`
      insert into products (id, tenant_id, name, category_id, price, currency)
      values (${productId}, ${tenant}, 'Monitor', ${cat.producto}, '150.00', 'USD')
    `;
    await sql`
      insert into services (id, tenant_id, name, category_id, price, currency)
      values (${serviceId}, ${tenant}, 'Instalación', ${cat.servicio}, '40.00', 'USD')
    `;
    // Stock inicial.
    await sql`
      insert into stock_movements (id, tenant_id, product_id, delta, reason, occurred_at, created_by)
      values (${uuidv7()}, ${tenant}, ${productId}, 10, 'inicial', now(), ${user})
    `;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  // -------------------------------------------------------------------------
  // Coherencia de categoria y tipo
  // -------------------------------------------------------------------------

  it("un gasto no puede usar una categoria de ingreso", async () => {
    // El caso que motiva toda la FK compuesta de la tabla polimorfica.
    const code = await pgErrorCode(() =>
      nuevaTransaccion({
        type: "gasto",
        category_id: cat.ingreso,
        category_catalog_key: "income_category",
      }),
    );
    expect(code).toBe("23514");
  });

  it("una categoria no puede venir de otro catalogo aunque el tipo cuadre", async () => {
    // 23503 = foreign_key_violation: 'general' existe, pero en product_category.
    const code = await pgErrorCode(() =>
      nuevaTransaccion({
        category_id: cat.producto,
        category_catalog_key: "income_category",
      }),
    );
    expect(code).toBe("23503");
  });

  it("el metodo de pago tiene que salir del catalogo de metodos de pago", async () => {
    const code = await pgErrorCode(() =>
      nuevaTransaccion({ payment_method_id: cat.ingreso }),
    );
    expect(code).toBe("23503");
  });

  // -------------------------------------------------------------------------
  // Tipo de operacion
  // -------------------------------------------------------------------------

  it("vender solo puede ser ingreso y comprar solo puede ser gasto", async () => {
    expect(
      await pgErrorCode(() => nuevaTransaccion({ type: "gasto", kind: "venta", category_id: cat.gasto, category_catalog_key: "expense_category" })),
    ).toBe("23514");

    expect(
      await pgErrorCode(() => nuevaTransaccion({ type: "ingreso", kind: "compra" })),
    ).toBe("23514");
  });

  it("una operacion suelta no admite renglones", async () => {
    const tx = await nuevaTransaccion({ kind: "operacion" });
    const code = await pgErrorCode(
      () => sql`
        insert into transaction_items
          (id, tenant_id, transaction_id, item_type, product_id, qty, unit_price, subtotal)
        values (${uuidv7()}, ${tenant}, ${tx}, 'product', ${productId}, 1, '150.00', '150.00')
      `,
    );
    expect(code).toBe("23514");
  });

  it("una compra de insumos no admite servicios", async () => {
    const tx = await nuevaTransaccion({
      type: "gasto",
      kind: "compra",
      category_id: cat.gasto,
      category_catalog_key: "expense_category",
    });
    const code = await pgErrorCode(
      () => sql`
        insert into transaction_items
          (id, tenant_id, transaction_id, item_type, service_id, qty, unit_price, subtotal)
        values (${uuidv7()}, ${tenant}, ${tx}, 'service', ${serviceId}, 1, '40.00', '40.00')
      `,
    );
    expect(code).toBe("23514");
  });

  // -------------------------------------------------------------------------
  // Renglones
  // -------------------------------------------------------------------------

  it("el subtotal tiene que ser qty * precio unitario", async () => {
    const tx = await nuevaTransaccion({ kind: "venta" });

    // Si un renglon miente, el monto de la transaccion miente, y eso no se
    // detecta hasta que alguien cuadra la caja a mano.
    expect(
      await pgErrorCode(
        () => sql`
          insert into transaction_items
            (id, tenant_id, transaction_id, item_type, product_id, qty, unit_price, subtotal)
          values (${uuidv7()}, ${tenant}, ${tx}, 'product', ${productId}, 3, '150.00', '400.00')
        `,
      ),
    ).toBe("23514");

    // Con el subtotal correcto pasa.
    await sql`
      insert into transaction_items
        (id, tenant_id, transaction_id, item_type, product_id, qty, unit_price, subtotal)
      values (${uuidv7()}, ${tenant}, ${tx}, 'product', ${productId}, 3, '150.00', '450.00')
    `;
  });

  it("un renglon apunta a un producto o a un servicio, nunca a ambos ni a nada", async () => {
    const tx = await nuevaTransaccion({ kind: "venta" });

    expect(
      await pgErrorCode(
        () => sql`
          insert into transaction_items
            (id, tenant_id, transaction_id, item_type, product_id, service_id, qty, unit_price, subtotal)
          values (${uuidv7()}, ${tenant}, ${tx}, 'product', ${productId}, ${serviceId}, 1, '10.00', '10.00')
        `,
      ),
    ).toBe("23514");

    expect(
      await pgErrorCode(
        () => sql`
          insert into transaction_items
            (id, tenant_id, transaction_id, item_type, qty, unit_price, subtotal)
          values (${uuidv7()}, ${tenant}, ${tx}, 'product', 1, '10.00', '10.00')
        `,
      ),
    ).toBe("23514");
  });

  // -------------------------------------------------------------------------
  // Stock
  // -------------------------------------------------------------------------

  it("el stock es la suma de los movimientos", async () => {
    expect(await stockDe(productId)).toBe(10);

    await sql`
      insert into stock_movements (id, tenant_id, product_id, delta, reason, occurred_at, created_by)
      values (${uuidv7()}, ${tenant}, ${productId}, -3, 'venta', now(), ${user})
    `;
    expect(await stockDe(productId)).toBe(7);

    await sql`
      insert into stock_movements (id, tenant_id, product_id, delta, reason, occurred_at, created_by)
      values (${uuidv7()}, ${tenant}, ${productId}, 5, 'compra', now(), ${user})
    `;
    expect(await stockDe(productId)).toBe(12);
  });

  it("anular repone el stock con un movimiento compensatorio, sin borrar el original", async () => {
    const antes = await stockDe(productId);
    const movimiento = uuidv7();

    await sql`
      insert into stock_movements (id, tenant_id, product_id, delta, reason, occurred_at, created_by)
      values (${movimiento}, ${tenant}, ${productId}, -4, 'venta', now(), ${user})
    `;
    expect(await stockDe(productId)).toBe(antes - 4);

    await sql`
      insert into stock_movements (id, tenant_id, product_id, delta, reason, occurred_at, created_by, note)
      values (${uuidv7()}, ${tenant}, ${productId}, 4, 'anulacion', now(), ${user}, 'anula venta')
    `;
    expect(await stockDe(productId)).toBe(antes);

    // El original sigue ahi: es lo que deja rastro de que hubo una correccion.
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from stock_movements where id = ${movimiento}
    `;
    expect(n).toBe(1);
  });

  it("un movimiento de stock no se puede editar", async () => {
    const [mov] = await sql<{ id: string }[]>`
      select id from stock_movements where tenant_id = ${tenant} limit 1
    `;
    // 23001 = restrict_violation, del trigger append-only.
    expect(
      await pgErrorCode(
        () => sql`update stock_movements set delta = 999 where id = ${mov.id}`,
      ),
    ).toBe("23001");
  });

  it("un movimiento no puede tener delta cero", async () => {
    expect(
      await pgErrorCode(
        () => sql`
          insert into stock_movements (id, tenant_id, product_id, delta, reason, occurred_at, created_by)
          values (${uuidv7()}, ${tenant}, ${productId}, 0, 'ajuste', now(), ${user})
        `,
      ),
    ).toBe("23514");
  });

  // -------------------------------------------------------------------------
  // Dinero e idempotencia
  // -------------------------------------------------------------------------

  it("la moneda de la transaccion es un snapshot: editar el metodo de pago no la cambia", async () => {
    const tx = await nuevaTransaccion({
      payment_method_id: pay.ves,
      currency: "VES",
      amount: "3650.00",
    });

    // Alguien corrige el metodo de pago meses despues.
    await sql`update catalog_items set currency = 'USD' where id = ${pay.ves}`;
    try {
      const [row] = await sql<{ currency: string; amount: string }[]>`
        select currency, amount from transactions where id = ${tx}
      `;
      // La transaccion de antes sigue siendo en Bs. Si esto fallara, el
      // historico cambiaria de significado retroactivamente.
      expect(row.currency).toBe("VES");
      expect(row.amount).toBe("3650.00");
    } finally {
      await sql`update catalog_items set currency = 'VES' where id = ${pay.ves}`;
    }
  });

  it("la clave de idempotencia impide el doble registro", async () => {
    const clave = uuidv7();
    await nuevaTransaccion({ client_request_id: clave });

    // 23505 = unique_violation. Es el doble tap en la recepcion con wifi malo.
    expect(
      await pgErrorCode(() => nuevaTransaccion({ client_request_id: clave })),
    ).toBe("23505");
  });

  it("el monto no puede ser negativo", async () => {
    expect(await pgErrorCode(() => nuevaTransaccion({ amount: "-1.00" }))).toBe(
      "23514",
    );
  });

  it("anular una transaccion no la borra", async () => {
    const tx = await nuevaTransaccion();
    await sql`update transactions set deleted_at = now() where id = ${tx}`;

    const [row] = await sql<{ deleted_at: Date | null }[]>`
      select deleted_at from transactions where id = ${tx}
    `;
    expect(row.deleted_at).not.toBeNull();
  });
});
