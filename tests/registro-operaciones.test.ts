import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import {
  editTransaction,
  registerTransaction,
  revertTransaction,
} from "@/lib/finanzas/register";
import { getStock, listMovements } from "@/lib/inventario/stock";
import {
  totalsByCurrency,
  listTransactions,
  lastPurchasePrices,
} from "@/lib/finanzas/queries";

/**
 * Registro de operaciones de punta a punta, contra la base real.
 *
 * Es la prueba que mas importa de la fase: verifica que el monto lo calcule el
 * servidor, que los precios se congelen, que el inventario se mueva en la misma
 * transaccion y que anular reponga sin borrar.
 */

const hasDb = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL,
);

let sql: ReturnType<typeof postgres>;

const tenant = uuidv7();
const user = uuidv7();
const ctx = { tenantId: tenant, userId: user };

const catIngreso = uuidv7();
const catGasto = uuidv7();
const catProd = uuidv7();
const catServ = uuidv7();
const payUsd = uuidv7();
const payVes = uuidv7();
const monitor = uuidv7();
const teclado = uuidv7();
const instalacion = uuidv7();
const productoEnBs = uuidv7();

const base = {
  concept: "Prueba",
  occurredOn: "2026-09-11",
  paymentMethodId: payUsd,
};

describe.skipIf(!hasDb)("registro de operaciones", () => {
  beforeAll(async () => {
    sql = postgres(process.env.TEST_DIRECT_URL!, { max: 1, prepare: false });

    await sql`insert into tenants (id, name, slug) values (${tenant}, 'Reg', ${"reg-" + tenant.slice(0, 8)})`;
    await sql`insert into users (id, email) values (${user}, ${`reg-${user.slice(-12)}@test.local`})`;
    await sql`insert into catalog_items (id, tenant_id, catalog_key, code, label, currency) values
      (${catIngreso}, ${tenant}, 'income_category',  'ventas',  'Ventas',  null),
      (${catGasto},   ${tenant}, 'expense_category', 'insumos', 'Insumos', null),
      (${catProd},    ${tenant}, 'product_category', 'general', 'General', null),
      (${catServ},    ${tenant}, 'service_category', 'general', 'General', null),
      (${payUsd},     ${tenant}, 'payment_method',   'efec',    'Efectivo USD', 'USD'),
      (${payVes},     ${tenant}, 'payment_method',   'pm',      'Pago móvil',   'VES')`;
    await sql`insert into products (id, tenant_id, name, category_id, price, currency) values
      (${monitor},        ${tenant}, 'Monitor', ${catProd}, '150.00', 'USD'),
      (${teclado},        ${tenant}, 'Teclado', ${catProd}, '25.50',  'USD'),
      (${productoEnBs},   ${tenant}, 'Cable',   ${catProd}, '90.00',  'VES')`;
    await sql`insert into services (id, tenant_id, name, category_id, price, currency) values
      (${instalacion}, ${tenant}, 'Instalación', ${catServ}, '40.00', 'USD')`;
    // Stock inicial del monitor.
    await sql`insert into stock_movements (id, tenant_id, product_id, delta, reason, occurred_at, created_by)
              values (${uuidv7()}, ${tenant}, ${monitor}, 20, 'inicial', now(), ${user})`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from tenants where id = ${tenant}`;
    await sql`delete from users where id = ${user}`;
    await sql.end();
  });

  // -------------------------------------------------------------------------
  // Operacion suelta
  // -------------------------------------------------------------------------

  it("registra una operacion suelta con el monto tecleado", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "125.5",
      clientRequestId: uuidv7(),
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Normalizado a dos decimales.
    expect(r.amount).toBe("125.50");
    expect(r.currency).toBe("USD");
  });

  it("la moneda sale del metodo de pago, no del formulario", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      paymentMethodId: payVes,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "3650.00",
      clientRequestId: uuidv7(),
    });

    expect(r.ok && r.currency).toBe("VES");
  });

  it("rechaza una operacion suelta con renglones", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "10.00",
      items: [{ itemType: "product", refId: monitor, qty: "1" }],
      clientRequestId: uuidv7(),
    });

    expect(r.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Venta
  // -------------------------------------------------------------------------

  it("calcula el monto de una venta en el servidor y descuenta inventario", async () => {
    const antes = Number(await getStock(tenant, monitor));

    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [
        { itemType: "product", refId: monitor, qty: "2" }, // 300.00
        { itemType: "product", refId: teclado, qty: "3" }, // 76.50
        { itemType: "service", refId: instalacion, qty: "1" }, // 40.00
      ],
      clientRequestId: uuidv7(),
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amount).toBe("416.50");

    // El servicio no mueve inventario; el monitor si.
    expect(Number(await getStock(tenant, monitor))).toBe(antes - 2);
  });

  it("ignora el monto que mande el cliente en una venta", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      // Un cliente malicioso podria mandar cualquier cosa aca.
      amount: "1.00",
      items: [{ itemType: "product", refId: monitor, qty: "1" }],
      clientRequestId: uuidv7(),
    });

    expect(r.ok && r.amount).toBe("150.00");
  });

  it("congela el precio: cambiarlo despues no altera la venta anterior", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [{ itemType: "product", refId: teclado, qty: "2" }],
      clientRequestId: uuidv7(),
    });
    expect(r.ok && r.amount).toBe("51.00");
    if (!r.ok) return;

    await sql`update products set price = '999.00' where id = ${teclado}`;
    try {
      const [fila] = await sql<{ amount: string; unit_price: string }[]>`
        select t.amount, i.unit_price
        from transactions t join transaction_items i on i.transaction_id = t.id
        where t.id = ${r.id}`;
      expect(fila.amount).toBe("51.00");
      expect(fila.unit_price).toBe("25.50");
    } finally {
      await sql`update products set price = '25.50' where id = ${teclado}`;
    }
  });

  it("rechaza mezclar monedas entre el pago y los renglones", async () => {
    // Sumar un producto en Bs dentro de una venta cobrada en USD daria un
    // numero que no es dinero, porque no se convierte nada.
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [{ itemType: "product", refId: productoEnBs, qty: "1" }],
      clientRequestId: uuidv7(),
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no se convierten|VES|USD/i);
  });

  it("rechaza una venta sin renglones", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [],
      clientRequestId: uuidv7(),
    });
    expect(r.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Compra
  // -------------------------------------------------------------------------

  it("una compra suma al inventario y vale lo que costo, no lo que se vende", async () => {
    const antes = Number(await getStock(tenant, monitor));

    const r = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      // El monitor se vende a 150; al proveedor se le paga 110.
      items: [
        { itemType: "product", refId: monitor, qty: "5", unitPrice: "110.00" },
      ],
      clientRequestId: uuidv7(),
    });

    // 5 x 110. NO 750: cobrar el precio de venta inflaba el gasto con un
    // numero que nadie pago.
    expect(r.ok && r.amount).toBe("550.00");
    expect(Number(await getStock(tenant, monitor))).toBe(antes + 5);
  });

  it("una compra sin precio no se registra", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      items: [{ itemType: "product", refId: monitor, qty: "5" }],
      clientRequestId: uuidv7(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/cuánto costó/i);
  });

  it("una compra con precio negativo no se registra", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      items: [
        { itemType: "product", refId: monitor, qty: "1", unitPrice: "-10.00" },
      ],
      clientRequestId: uuidv7(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/negativo/i);
  });

  it("se puede comprar un producto que se vende en otra moneda", async () => {
    // El cable tiene precio de venta en VES; al proveedor se le paga en USD.
    // No hay conversion: el costo se teclea directo en la moneda del pago.
    const r = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      paymentMethodId: payUsd,
      items: [
        { itemType: "product", refId: productoEnBs, qty: "2", unitPrice: "3.50" },
      ],
      clientRequestId: uuidv7(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amount).toBe("7.00");
    expect(r.currency).toBe("USD");
  });

  it("una venta sigue tomando el precio del catalogo, no el que manden", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      // Un precio inventado en el renglon de una venta se ignora: es el numero
      // que suman los reportes del dueño y no puede venir del navegador.
      items: [
        { itemType: "product", refId: monitor, qty: "1", unitPrice: "1.00" },
      ],
      clientRequestId: uuidv7(),
    });
    expect(r.ok && r.amount).toBe("150.00");
  });

  it("una compra no admite servicios", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      items: [
        { itemType: "service", refId: instalacion, qty: "1", unitPrice: "40.00" },
      ],
      clientRequestId: uuidv7(),
    });
    expect(r.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Coherencia y validaciones
  // -------------------------------------------------------------------------

  it("rechaza una categoria que no corresponde al tipo", async () => {
    const r = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "operacion",
      categoryId: catIngreso, // categoria de INGRESO en un gasto
      amount: "10.00",
      clientRequestId: uuidv7(),
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza usar un metodo de pago archivado", async () => {
    await sql`update catalog_items set archived_at = now() where id = ${payVes}`;
    try {
      const r = await registerTransaction(ctx, {
        ...base,
        paymentMethodId: payVes,
        type: "ingreso",
        kind: "operacion",
        categoryId: catIngreso,
        amount: "10.00",
        clientRequestId: uuidv7(),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/archivado/i);
    } finally {
      await sql`update catalog_items set archived_at = null where id = ${payVes}`;
    }
  });

  // -------------------------------------------------------------------------
  // Idempotencia
  // -------------------------------------------------------------------------

  it("el doble tap devuelve la misma operacion, no un error ni un duplicado", async () => {
    const clave = uuidv7();
    const input = {
      ...base,
      type: "ingreso" as const,
      kind: "venta" as const,
      categoryId: catIngreso,
      items: [{ itemType: "product" as const, refId: monitor, qty: "1" }],
      clientRequestId: clave,
    };

    const stockAntes = Number(await getStock(tenant, monitor));
    const primera = await registerTransaction(ctx, input);
    const segunda = await registerTransaction(ctx, input);

    expect(primera.ok).toBe(true);
    expect(segunda.ok).toBe(true);
    if (!primera.ok || !segunda.ok) return;

    // Misma transaccion, marcada como duplicada.
    expect(segunda.id).toBe(primera.id);
    expect(segunda.duplicate).toBe(true);
    // Y el inventario se movio UNA sola vez.
    expect(Number(await getStock(tenant, monitor))).toBe(stockAntes - 1);
  });

  // -------------------------------------------------------------------------
  // Anulacion
  // -------------------------------------------------------------------------

  it("anular repone el inventario sin borrar los movimientos originales", async () => {
    const stockInicial = Number(await getStock(tenant, monitor));

    const venta = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [{ itemType: "product", refId: monitor, qty: "4" }],
      clientRequestId: uuidv7(),
    });
    expect(venta.ok).toBe(true);
    if (!venta.ok) return;
    expect(Number(await getStock(tenant, monitor))).toBe(stockInicial - 4);

    const movimientosAntes = (await listMovements(tenant, monitor)).length;

    const anulada = await revertTransaction(ctx, {
      id: venta.id,
      reason: "Cliente devolvió",
    });
    expect(anulada.ok).toBe(true);

    // Stock repuesto...
    expect(Number(await getStock(tenant, monitor))).toBe(stockInicial);
    // ...con un movimiento NUEVO, no borrando el viejo.
    const movimientos = await listMovements(tenant, monitor);
    expect(movimientos.length).toBe(movimientosAntes + 1);
    expect(movimientos[0].reason).toBe("anulacion");
    expect(movimientos[0].note).toBe("Cliente devolvió");
  });

  it("una operacion anulada no cuenta en los totales ni en el listado", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "5000.00",
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    const conLaOperacion = await totalsByCurrency(tenant, {
      type: "ingreso",
      currency: "USD",
    });
    await revertTransaction(ctx, { id: tx.id });
    const sinLaOperacion = await totalsByCurrency(tenant, {
      type: "ingreso",
      currency: "USD",
    });

    expect(Number(conLaOperacion[0].total) - Number(sinLaOperacion[0].total)).toBe(
      5000,
    );

    const { rows } = await listTransactions(tenant, { perPage: 100 });
    expect(rows.map((r) => r.id)).not.toContain(tx.id);
  });

  it("no se puede anular dos veces", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "10.00",
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    expect((await revertTransaction(ctx, { id: tx.id })).ok).toBe(true);
    const segunda = await revertTransaction(ctx, { id: tx.id });
    expect(segunda.ok).toBe(false);
    expect(segunda.error).toMatch(/ya está anulada/i);
  });

  // -------------------------------------------------------------------------
  // Auditoria
  // -------------------------------------------------------------------------

  it("cada operacion deja su rastro en el log de auditoria", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "77.00",
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    const [evento] = await sql<{ action: string; diff: Record<string, unknown>; actor_id: string }[]>`
      select action, diff, actor_id from audit_log
      where entity = 'transactions' and entity_id = ${tx.id}`;

    expect(evento.action).toBe("create");
    expect(evento.actor_id).toBe(user);
    expect(evento.diff.amount).toBe("77.00");
  });

  // -------------------------------------------------------------------------
  // Correccion de una operacion ya registrada
  // -------------------------------------------------------------------------

  it("corrige el monto de una operacion suelta", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "operacion",
      categoryId: catGasto,
      amount: "30.00",
      concept: "Papeleria",
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    const r = await editTransaction(ctx, {
      id: tx.id,
      concept: "Papelería y tinta",
      occurredOn: "2026-09-12",
      categoryId: catGasto,
      paymentMethodId: payUsd,
      amount: "47.25",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amount).toBe("47.25");

    const [fila] = await sql`select * from transactions where id = ${tx.id}`;
    expect(fila.concept).toBe("Papelería y tinta");
    expect(fila.occurred_on.toISOString().slice(0, 10)).toBe("2026-09-12");
    expect(fila.amount).toBe("47.25");
  });

  it("cambiar de metodo de pago cambia la moneda del registro", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "100.00",
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;
    expect(tx.currency).toBe("USD");

    // Se registro en el metodo equivocado: era pago movil, en bolivares.
    const r = await editTransaction(ctx, {
      id: tx.id,
      concept: "Prueba",
      occurredOn: "2026-09-11",
      categoryId: catIngreso,
      paymentMethodId: payVes,
      amount: "100.00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // El monto NO se convierte: se corrige en que moneda estaba, nada mas.
    expect(r.currency).toBe("VES");
  });

  it("conserva el precio congelado de un renglon que ya estaba", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [{ itemType: "product", refId: monitor, qty: "2" }],
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;
    expect(tx.amount).toBe("300.00");

    // El monitor sube de precio DESPUES de la venta.
    await sql`update products set price = '175.00' where id = ${monitor}`;

    try {
      // Se corrige la cantidad: eran 3, no 2.
      const r = await editTransaction(ctx, {
        id: tx.id,
        concept: "Prueba",
        occurredOn: "2026-09-11",
        categoryId: catIngreso,
        paymentMethodId: payUsd,
        items: [{ itemType: "product", refId: monitor, qty: "3" }],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      // 3 x 150, el precio con que se vendio. NO 3 x 175: corregir una cantidad
      // mal tecleada no revalua la venta al precio de hoy.
      expect(r.amount).toBe("450.00");

      const renglones =
        await sql`select unit_price from transaction_items where transaction_id = ${tx.id}`;
      expect(renglones).toHaveLength(1);
      expect(renglones[0].unit_price).toBe("150.00");
    } finally {
      await sql`update products set price = '150.00' where id = ${monitor}`;
    }
  });

  it("un renglon NUEVO si toma el precio actual del catalogo", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [{ itemType: "product", refId: monitor, qty: "1" }],
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    // Se olvido cargar el teclado.
    const r = await editTransaction(ctx, {
      id: tx.id,
      concept: "Prueba",
      occurredOn: "2026-09-11",
      categoryId: catIngreso,
      paymentMethodId: payUsd,
      items: [
        { itemType: "product", refId: monitor, qty: "1" },
        { itemType: "product", refId: teclado, qty: "2" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amount).toBe("201.00"); // 150 + 2 x 25.50
  });

  it("ajusta el inventario con un movimiento compensatorio, sin tocar el original", async () => {
    const antes = await getStock(tenant, monitor);

    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [{ itemType: "product", refId: monitor, qty: "2" }],
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;
    expect(Number(await getStock(tenant, monitor))).toBe(Number(antes) - 2);

    // Eran 5, no 2.
    const r = await editTransaction(ctx, {
      id: tx.id,
      concept: "Prueba",
      occurredOn: "2026-09-11",
      categoryId: catIngreso,
      paymentMethodId: payUsd,
      items: [{ itemType: "product", refId: monitor, qty: "5" }],
    });
    expect(r.ok).toBe(true);

    // El stock queda como si se hubiera registrado bien desde el principio.
    expect(Number(await getStock(tenant, monitor))).toBe(Number(antes) - 5);

    // Pero el original sigue ahi: es lo que responde "por que dice 15 y conte 15
    // pero la venta decia 2". Nunca se reescribe un movimiento.
    const movimientos = await listMovements(tenant, monitor, 10);
    const venta = movimientos.find((m) => m.reason === "venta");
    const ajuste = movimientos.find((m) => m.reason === "ajuste");
    expect(venta?.delta).toBe("-2.000");
    expect(ajuste?.delta).toBe("-3.000");
  });

  it("quitar un renglon devuelve lo que se habia descontado", async () => {
    const antes = await getStock(tenant, monitor);

    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [
        { itemType: "product", refId: monitor, qty: "1" },
        { itemType: "service", refId: instalacion, qty: "1" },
      ],
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    // El monitor no era de esta venta, solo la instalación.
    const r = await editTransaction(ctx, {
      id: tx.id,
      concept: "Prueba",
      occurredOn: "2026-09-11",
      categoryId: catIngreso,
      paymentMethodId: payUsd,
      items: [{ itemType: "service", refId: instalacion, qty: "1" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amount).toBe("40.00");
    expect(Number(await getStock(tenant, monitor))).toBe(Number(antes));
  });

  it("una compra corregida hacia abajo saca del inventario", async () => {
    const antes = await getStock(tenant, teclado);

    const tx = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      items: [
        { itemType: "product", refId: teclado, qty: "10", unitPrice: "20.00" },
      ],
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;
    expect(Number(await getStock(tenant, teclado))).toBe(Number(antes) + 10);

    // Llegaron 6, no 10.
    const r = await editTransaction(ctx, {
      id: tx.id,
      concept: "Prueba",
      occurredOn: "2026-09-11",
      categoryId: catGasto,
      paymentMethodId: payUsd,
      items: [
        { itemType: "product", refId: teclado, qty: "6", unitPrice: "20.00" },
      ],
    });
    expect(r.ok).toBe(true);
    expect(Number(await getStock(tenant, teclado))).toBe(Number(antes) + 6);
  });

  it("corregir una compra deja cambiar el precio pagado", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      items: [
        { itemType: "product", refId: teclado, qty: "4", unitPrice: "20.00" },
      ],
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;
    expect(tx.amount).toBe("80.00");

    // La factura decia 22.75, no 20. A diferencia de una venta, aqui el precio
    // SI se corrige: es un dato que se tecleo y pudo teclearse mal.
    const r = await editTransaction(ctx, {
      id: tx.id,
      concept: "Prueba",
      occurredOn: "2026-09-11",
      categoryId: catGasto,
      paymentMethodId: payUsd,
      items: [
        { itemType: "product", refId: teclado, qty: "4", unitPrice: "22.75" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amount).toBe("91.00");
  });

  it("corregir una compra sin mandar precio conserva el que tenia", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      items: [
        { itemType: "product", refId: teclado, qty: "2", unitPrice: "17.00" },
      ],
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    // Solo se corrige la cantidad. El costo no se reinventa con el precio de
    // venta del catalogo: se queda el que se pago.
    const r = await editTransaction(ctx, {
      id: tx.id,
      concept: "Prueba",
      occurredOn: "2026-09-11",
      categoryId: catGasto,
      paymentMethodId: payUsd,
      items: [{ itemType: "product", refId: teclado, qty: "3" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amount).toBe("51.00"); // 3 x 17, no 3 x 25.50
  });

  it("no se puede corregir una operacion anulada", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "operacion",
      categoryId: catIngreso,
      amount: "12.00",
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;
    expect((await revertTransaction(ctx, { id: tx.id })).ok).toBe(true);

    const r = await editTransaction(ctx, {
      id: tx.id,
      concept: "Prueba",
      occurredOn: "2026-09-11",
      categoryId: catIngreso,
      paymentMethodId: payUsd,
      amount: "99.00",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/anulada/i);
  });

  it("no se puede mezclar monedas al corregir", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [{ itemType: "product", refId: monitor, qty: "1" }],
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    // El monitor tiene precio en USD; el pago movil cobra en VES.
    const r = await editTransaction(ctx, {
      id: tx.id,
      concept: "Prueba",
      occurredOn: "2026-09-11",
      categoryId: catIngreso,
      paymentMethodId: payVes,
      items: [{ itemType: "product", refId: monitor, qty: "1" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no se convierten/i);
  });

  it("una venta no se puede quedar sin renglones", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "ingreso",
      kind: "venta",
      categoryId: catIngreso,
      items: [{ itemType: "product", refId: monitor, qty: "1" }],
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    const r = await editTransaction(ctx, {
      id: tx.id,
      concept: "Prueba",
      occurredOn: "2026-09-11",
      categoryId: catIngreso,
      paymentMethodId: payUsd,
      items: [],
    });
    expect(r.ok).toBe(false);
  });

  it("corregir deja el rastro en la bitacora", async () => {
    const tx = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "operacion",
      categoryId: catGasto,
      amount: "5.00",
      concept: "Antes",
      clientRequestId: uuidv7(),
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    await editTransaction(ctx, {
      id: tx.id,
      concept: "Después",
      occurredOn: "2026-09-11",
      categoryId: catGasto,
      paymentMethodId: payUsd,
      amount: "8.00",
    });

    const [evento] = await sql`select * from audit_log
      where entity = 'transactions' and entity_id = ${tx.id} and action = 'update'`;
    expect(evento).toBeTruthy();
    expect(evento.diff.concept).toEqual({ from: "Antes", to: "Después" });
    expect(evento.diff.amount).toEqual({ from: "5.00", to: "8.00" });
  });

  // -------------------------------------------------------------------------
  // Sugerencia de precio para la proxima compra
  // -------------------------------------------------------------------------

  it("sugiere lo ultimo que se pago, no el precio de venta", async () => {
    const producto = uuidv7();
    await sql`insert into products (id, tenant_id, name, category_id, price, currency)
              values (${producto}, ${tenant}, 'Mouse', ${catProd}, '45.00', 'USD')`;

    // Dos compras: la de marzo es la mas reciente aunque se cargue despues.
    await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      occurredOn: "2026-03-01",
      items: [
        { itemType: "product", refId: producto, qty: "1", unitPrice: "31.00" },
      ],
      clientRequestId: uuidv7(),
    });
    await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      occurredOn: "2026-01-15",
      items: [
        { itemType: "product", refId: producto, qty: "1", unitPrice: "28.00" },
      ],
      clientRequestId: uuidv7(),
    });

    const costos = await lastPurchasePrices(tenant);
    // La de marzo, aunque la de enero se registro de ultima. Y no 45.00, que es
    // lo que se cobra, no lo que cuesta.
    expect(costos[producto]).toBe("31.00");
  });

  it("un producto que nunca se compro no tiene sugerencia", async () => {
    const costos = await lastPurchasePrices(tenant);
    expect(costos[instalacion]).toBeUndefined();
  });

  it("una compra anulada deja de ser la referencia", async () => {
    const producto = uuidv7();
    await sql`insert into products (id, tenant_id, name, category_id, price, currency)
              values (${producto}, ${tenant}, 'Hub', ${catProd}, '60.00', 'USD')`;

    await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      occurredOn: "2026-02-01",
      items: [
        { itemType: "product", refId: producto, qty: "1", unitPrice: "40.00" },
      ],
      clientRequestId: uuidv7(),
    });
    const mala = await registerTransaction(ctx, {
      ...base,
      type: "gasto",
      kind: "compra",
      categoryId: catGasto,
      occurredOn: "2026-04-01",
      items: [
        { itemType: "product", refId: producto, qty: "1", unitPrice: "999.00" },
      ],
      clientRequestId: uuidv7(),
    });
    expect(mala.ok).toBe(true);
    if (!mala.ok) return;

    expect((await lastPurchasePrices(tenant))[producto]).toBe("999.00");

    await revertTransaction(ctx, { id: mala.id });

    // Anulada deja de contar: si no, un error anulado seguiria precargando el
    // formulario de la proxima compra.
    expect((await lastPurchasePrices(tenant))[producto]).toBe("40.00");
  });
});
