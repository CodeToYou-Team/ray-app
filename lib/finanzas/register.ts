import "server-only";

/**
 * Nucleo de registro de operaciones, sin autorizacion.
 *
 * Vive separado de actions.ts por dos motivos: un archivo "use server" solo
 * puede exportar funciones que son Server Actions, y sobre todo porque asi la
 * logica de dinero e inventario — que es la que de verdad hay que probar — se
 * puede testear sin simular una sesion de Supabase.
 *
 * NADIE debe llamar estas funciones directo desde una ruta o un componente: el
 * punto de entrada es actions.ts, que exige el permiso primero.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withTenant } from "@/lib/db/tenant";
import {
  auditLog,
  bookingPayments,
  catalogItems,
  products,
  services,
  stockMovements,
  transactionItems,
  transactions,
} from "@/lib/db/schema";
import {
  convertMoney,
  isMoney,
  isQuantity,
  isRate,
  isZero,
  lineSubtotal,
  normalizeMoney,
  normalizeQuantity,
  normalizeRate,
  negateQuantity,
  subtractQuantity,
  sumMoney,
  sumQuantity,
} from "@/lib/money";
import { faltaDeStock } from "@/lib/inventario/stock";
import { formatQuantity } from "@/lib/format";

export type TxResult =
  | { ok: true; id: string; amount: string; currency: string; duplicate?: true }
  | { ok: false; error: string };

const itemSchema = z.object({
  itemType: z.enum(["product", "service"]),
  refId: z.uuid(),
  qty: z.string().refine(isQuantity, "Cantidad inválida"),
  /**
   * Solo para compras: lo que se PAGO por unidad.
   *
   * En una venta se ignora — ahi el precio sale del catalogo y lo calcula el
   * servidor, porque es el numero que suman los reportes del dueño y no puede
   * venir del navegador. En una compra no hay de donde sacarlo: el precio de
   * venta de un producto no es lo que costo reabastecerlo.
   */
  unitPrice: z.string().optional(),
});

/**
 * Resuelve el precio unitario de un renglon de compra.
 *
 * Se valida aparte del esquema porque solo es obligatorio cuando la operacion
 * es una compra, y eso depende de otro campo.
 */
function precioDeCompra(
  valor: string | undefined,
  nombre: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (!valor || !isMoney(valor)) {
    return {
      ok: false,
      error: `Escribe cuánto costó cada "${nombre}". El precio de venta no sirve: no es lo que pagaste.`,
    };
  }
  const value = normalizeMoney(valor);
  // La base tambien lo rechaza (transaction_items_price_non_negative), pero
  // ahi llegaria como un error de Postgres que no le dice nada a nadie.
  if (value.startsWith("-")) {
    return { ok: false, error: `El precio de compra de "${nombre}" no puede ser negativo.` };
  }
  return { ok: true, value };
}

const inputSchema = z.object({
  type: z.enum(["ingreso", "gasto"]),
  kind: z.enum(["operacion", "venta", "compra"]),
  concept: z.string().trim().min(1, "Escribe un concepto").max(200),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  categoryId: z.uuid("Elige una categoría"),
  paymentMethodId: z.uuid("Elige un método de pago"),
  amount: z.string().optional(),
  items: z.array(itemSchema).optional(),
  /**
   * Cuantas unidades de la moneda del pago equivale 1 de la moneda de los
   * precios. Solo hace falta cuando no coinciden.
   */
  exchangeRate: z.string().optional(),
  notes: z.string().trim().max(1000).optional(),
  /** Generado en el navegador al abrir el formulario. */
  clientRequestId: z.uuid(),
});

export type CreateTransactionInput = z.infer<typeof inputSchema>;

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Los movimientos de stock, ordenados por producto antes de insertarlos.
 *
 * El trigger de stock (drizzle/0023) bloquea la fila de cada producto en el
 * orden en que llegan los movimientos. Dos ventas simultaneas de "A y B" y de
 * "B y A" se bloquearian en cruz y Postgres abortaria una por deadlock. Con el
 * mismo orden siempre, la segunda simplemente espera.
 */
function porProducto<T extends { productId: string }>(movimientos: T[]): T[] {
  return [...movimientos].sort((a, b) => a.productId.localeCompare(b.productId));
}

/**
 * El mensaje para un `ST001`, o null si el error es otro.
 *
 * `motivo` dice que se estaba intentando, porque "no hay stock" significa algo
 * distinto al vender que al anular una compra de la que ya se vendio.
 */
async function mensajeSinStock(
  tenantId: string,
  error: unknown,
  motivo: (producto: string, quedan: string) => string,
): Promise<string | null> {
  const falta = await faltaDeStock(tenantId, error);
  return falta ? motivo(falta.name, formatQuantity(falta.stock)) : null;
}

type Vendible = { name: string; price: string; currency: string };

/**
 * Decide en que moneda estan los precios de catalogo de estos renglones.
 *
 * Todos tienen que estar en la misma: una venta con un producto en USD y otro
 * en VES necesitaria dos tasas, y el total no seria de ninguna de las dos
 * monedas. Se rechaza en vez de inventar un criterio.
 */
function monedaDeLosPrecios(
  refs: Vendible[],
): { ok: true; currency: string | null } | { ok: false; error: string } {
  const monedas = [...new Set(refs.map((r) => r.currency))];
  if (monedas.length === 0) return { ok: true, currency: null };
  if (monedas.length > 1) {
    return {
      ok: false,
      error: `No se pueden mezclar precios en ${monedas.join(" y ")} en una misma operación. Regístralas por separado.`,
    };
  }
  return { ok: true, currency: monedas[0] };
}

/**
 * Resuelve la tasa de cambio de una operacion con renglones.
 *
 * Devuelve `null` cuando los precios ya estan en la moneda del pago, que es el
 * caso normal y no lleva tasa. Cuando no coinciden, la tasa es obligatoria: es
 * justamente el dato que la app no puede inventar — no hay tabla de tasas ni
 * servicio que consultar, y suponer una seria inventar dinero.
 */
function resolverTasa(
  baseCurrency: string | null,
  currency: string,
  raw: string | undefined,
):
  | { ok: true; rate: string | null; baseCurrency: string | null }
  | { ok: false; error: string } {
  if (!baseCurrency || baseCurrency === currency) {
    return { ok: true, rate: null, baseCurrency: null };
  }
  if (!raw || !isRate(raw)) {
    return {
      ok: false,
      error: `Los precios están en ${baseCurrency} y el pago es en ${currency}. Escribe la tasa de cambio que aplicaste.`,
    };
  }
  return { ok: true, rate: normalizeRate(raw), baseCurrency };
}

/** El precio de catalogo de un renglon, ya en la moneda del pago. */
function precioConvertido(ref: Vendible, rate: string | null): string {
  return rate ? convertMoney(ref.price, rate) : normalizeMoney(ref.price);
}

/**
 * Registra un ingreso o un gasto.
 *
 * Todo ocurre en UNA transaccion de base de datos: la transaccion, sus renglones,
 * los movimientos de stock y el evento de auditoria. Si algo falla, no queda
 * media venta registrada con el inventario ya descontado.
 */
export interface ActorContext {
  tenantId: string;
  userId: string;
}

export async function registerTransaction(
  { tenantId, userId }: ActorContext,
  raw: CreateTransactionInput,
): Promise<TxResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const input = parsed.data;

  const conRenglones = input.kind !== "operacion";
  if (conRenglones && (!input.items || input.items.length === 0)) {
    return {
      ok: false,
      error:
        input.kind === "venta"
          ? "Una venta necesita al menos un producto o servicio."
          : "Una compra necesita al menos un producto.",
    };
  }
  if (!conRenglones && input.items?.length) {
    return {
      ok: false,
      error: "Una operación suelta no lleva renglones; su monto se escribe directo.",
    };
  }
  if (!conRenglones && (!input.amount || !isMoney(input.amount))) {
    return { ok: false, error: "Escribe un monto válido." };
  }

  const id = uuidv7();

  try {
    return await withTenant(tenantId, async (tx) => {
      // ----------------------------------------------------------------
      // 1. Metodo de pago -> moneda. SNAPSHOT, no join.
      // ----------------------------------------------------------------
      const [metodo] = await tx
        .select()
        .from(catalogItems)
        .where(
          and(
            eq(catalogItems.id, input.paymentMethodId),
            eq(catalogItems.tenantId, tenantId),
            eq(catalogItems.catalogKey, "payment_method"),
          ),
        );

      if (!metodo) return { ok: false as const, error: "Método de pago no válido." };
      if (metodo.archivedAt) {
        return { ok: false as const, error: `"${metodo.label}" está archivado.` };
      }
      const currency = metodo.currency!;

      // ----------------------------------------------------------------
      // 2. Categoria: tiene que salir del catalogo que corresponde al tipo.
      // ----------------------------------------------------------------
      const categoryCatalogKey =
        input.type === "ingreso" ? "income_category" : "expense_category";

      const [categoria] = await tx
        .select()
        .from(catalogItems)
        .where(
          and(
            eq(catalogItems.id, input.categoryId),
            eq(catalogItems.tenantId, tenantId),
            eq(catalogItems.catalogKey, categoryCatalogKey),
          ),
        );

      if (!categoria) {
        return {
          ok: false as const,
          error: `Esa categoría no existe entre las de ${input.type}.`,
        };
      }
      if (categoria.archivedAt) {
        return { ok: false as const, error: `"${categoria.label}" está archivada.` };
      }

      // ----------------------------------------------------------------
      // 3. Renglones: precios snapshot y monto calculado EN SERVIDOR.
      // ----------------------------------------------------------------
      /** Solo quedan en algo distinto de null si hubo que convertir. */
      let rate: string | null = null;
      let baseCurrency: string | null = null;

      type Linea = {
        id: string;
        itemType: "product" | "service";
        productId: string | null;
        serviceId: string | null;
        qty: string;
        unitPrice: string;
        subtotal: string;
      };

      const lineas: Linea[] = [];
      let amount: string;

      if (conRenglones) {
        const items = input.items!;
        const productIds = items.filter((i) => i.itemType === "product").map((i) => i.refId);
        const serviceIds = items.filter((i) => i.itemType === "service").map((i) => i.refId);

        const catalogoProductos = productIds.length
          ? await tx
              .select()
              .from(products)
              .where(
                and(
                  eq(products.tenantId, tenantId),
                  inArray(products.id, productIds),
                  isNull(products.deletedAt),
                ),
              )
          : [];
        const catalogoServicios = serviceIds.length
          ? await tx
              .select()
              .from(services)
              .where(
                and(
                  eq(services.tenantId, tenantId),
                  inArray(services.id, serviceIds),
                  isNull(services.deletedAt),
                ),
              )
          : [];

        const porId = new Map<string, Vendible>();
        for (const p of catalogoProductos) porId.set(p.id, p);
        for (const s of catalogoServicios) porId.set(s.id, s);

        const refs: Vendible[] = [];
        for (const item of items) {
          const ref = porId.get(item.refId);
          if (!ref) {
            return { ok: false as const, error: "Uno de los renglones ya no existe." };
          }
          refs.push(ref);
        }

        /**
         * La tasa solo entra en juego en una VENTA.
         *
         * En una compra el precio lo escribe quien registra, ya en la moneda
         * del pago, y el del catalogo ni se lee: no hay nada que convertir.
         */
        if (input.kind !== "compra") {
          const moneda = monedaDeLosPrecios(refs);
          if (!moneda.ok) return { ok: false as const, error: moneda.error };

          const resuelta = resolverTasa(moneda.currency, currency, input.exchangeRate);
          if (!resuelta.ok) return { ok: false as const, error: resuelta.error };
          rate = resuelta.rate;
          baseCurrency = resuelta.baseCurrency;
        }

        for (const [i, item] of items.entries()) {
          const ref = refs[i];

          let unitPrice: string;
          if (input.kind === "compra") {
            const precio = precioDeCompra(item.unitPrice, ref.name);
            if (!precio.ok) return { ok: false as const, error: precio.error };
            unitPrice = precio.value;
          } else {
            unitPrice = precioConvertido(ref, rate);
          }

          const qty = normalizeQuantity(item.qty);
          lineas.push({
            id: uuidv7(),
            itemType: item.itemType,
            productId: item.itemType === "product" ? item.refId : null,
            serviceId: item.itemType === "service" ? item.refId : null,
            qty,
            unitPrice,
            subtotal: lineSubtotal(qty, unitPrice),
          });
        }

        // El monto que mande el cliente se descarta: es el numero que suman los
        // reportes del dueño y no puede venir del navegador.
        amount = sumMoney(lineas.map((l) => l.subtotal));
      } else {
        amount = normalizeMoney(input.amount!);
      }

      // ----------------------------------------------------------------
      // 4. Escritura
      // ----------------------------------------------------------------
      await tx.insert(transactions).values({
        id,
        tenantId,
        type: input.type,
        kind: input.kind,
        concept: input.concept,
        occurredOn: input.occurredOn,
        categoryId: input.categoryId,
        categoryCatalogKey,
        paymentMethodId: input.paymentMethodId,
        paymentCatalogKey: "payment_method",
        amount,
        currency,
        exchangeRate: rate,
        baseCurrency,
        notes: input.notes || null,
        clientRequestId: input.clientRequestId,
        createdBy: userId,
      });

      if (lineas.length) {
        await tx.insert(transactionItems).values(
          lineas.map((l) => ({ ...l, tenantId, transactionId: id })),
        );

        // Solo los productos mueven inventario; los servicios no tienen stock.
        const movimientos = lineas
          .filter((l) => l.productId)
          .map((l) => ({
            id: uuidv7(),
            tenantId,
            productId: l.productId!,
            // Vender saca, comprar mete.
            delta: input.kind === "venta" ? negateQuantity(l.qty) : l.qty,
            reason: input.kind === "venta" ? ("venta" as const) : ("compra" as const),
            transactionItemId: l.id,
            occurredAt: new Date(`${input.occurredOn}T12:00:00Z`),
            createdBy: userId,
          }));

        if (movimientos.length) {
          await tx.insert(stockMovements).values(porProducto(movimientos));
        }
      }

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "transactions",
        entityId: id,
        action: "create",
        actorId: userId,
        diff: {
          type: input.type,
          kind: input.kind,
          amount,
          currency,
          concept: input.concept,
          renglones: lineas.length,
        },
      });

      return { ok: true as const, id, amount, currency };
    });
  } catch (error) {
    /**
     * Idempotencia: el mismo client_request_id dos veces NO es un error, es el
     * doble tap en la recepcion con wifi malo. Se devuelve la transaccion que ya
     * quedo registrada, que es lo que el usuario esperaba.
     */
    if (pgCode(error) === "23505") {
      const [existente] = await withTenant(tenantId, (tx) =>
        tx
          .select({
            id: transactions.id,
            amount: transactions.amount,
            currency: transactions.currency,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              eq(transactions.clientRequestId, raw.clientRequestId),
            ),
          ),
      );
      if (existente) return { ok: true, ...existente, duplicate: true };
    }

    const sinStock = await mensajeSinStock(
      tenantId,
      error,
      (producto, quedan) => `No hay suficiente stock de "${producto}": quedan ${quedan}.`,
    );
    if (sinStock) return { ok: false, error: sinStock };

    return { ok: false, error: "No se pudo registrar la operación." };
  }
}

// ---------------------------------------------------------------------------
// Edicion
// ---------------------------------------------------------------------------

const editSchema = inputSchema
  .omit({ clientRequestId: true, type: true, kind: true })
  .extend({ id: z.uuid() });

export type EditTransactionInput = z.infer<typeof editSchema>;

/**
 * Corrige una operacion ya registrada.
 *
 * `type` y `kind` NO se pueden cambiar a proposito. Convertir una venta en una
 * operacion suelta, o un ingreso en un gasto, no es corregir un dato: es otra
 * operacion distinta, y dejarlo haria imposible razonar sobre el inventario.
 * Para eso esta anular y volver a registrar.
 *
 * El inventario se corrige con movimientos COMPENSATORIOS, no reescribiendo los
 * originales. Si una venta decia 2 unidades y en realidad eran 3, entra un
 * movimiento de -1 con motivo de ajuste: el stock queda igual que si se hubiera
 * registrado bien desde el principio, pero el historial muestra que hubo una
 * correccion y cuando.
 */
export async function editTransaction(
  { tenantId, userId }: ActorContext,
  raw: EditTransactionInput,
): Promise<TxResult> {
  const parsed = editSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const input = parsed.data;

  try {
    return await withTenant(tenantId, async (tx) => {
      // FOR UPDATE: corregir y anular a la vez compensarian el inventario dos
      // veces sobre los mismos renglones. Con el bloqueo, la segunda espera y
      // relee el estado que dejo la primera.
      const [actual] = await tx
        .select()
        .from(transactions)
        .where(
          and(eq(transactions.id, input.id), eq(transactions.tenantId, tenantId)),
        )
        .for("update");

      if (!actual) return { ok: false as const, error: "No se encontró esa operación." };
      if (actual.deletedAt) {
        return {
          ok: false as const,
          error: "Esa operación está anulada. Registra una nueva en su lugar.",
        };
      }

      /**
       * Un cobro de reserva no se corrige desde aquí.
       *
       * La reserva guarda cuánto le abonó este cobro en su propia moneda; si
       * aquí cambiara el monto o el método, la transacción diría una cosa y el
       * saldo de la reserva otra. Se anula y se vuelve a cobrar desde la
       * reserva. Un trigger lo impide igual para el dinero; esto da el motivo
       * en palabras antes de llegar ahí.
       */
      const [esCobro] = await tx
        .select({ bookingId: bookingPayments.bookingId })
        .from(bookingPayments)
        .where(
          and(
            eq(bookingPayments.tenantId, tenantId),
            eq(bookingPayments.transactionId, actual.id),
          ),
        );
      if (esCobro) {
        return {
          ok: false as const,
          error:
            "Este cobro pertenece a una reserva. Para corregirlo, anúlalo y vuelve a cobrar desde la reserva.",
        };
      }

      const conRenglones = actual.kind !== "operacion";

      if (conRenglones && (!input.items || input.items.length === 0)) {
        return {
          ok: false as const,
          error:
            actual.kind === "venta"
              ? "Una venta necesita al menos un producto o servicio."
              : "Una compra necesita al menos un producto.",
        };
      }
      if (!conRenglones && (!input.amount || !isMoney(input.amount))) {
        return { ok: false as const, error: "Escribe un monto válido." };
      }

      // ----------------------------------------------------------------
      // 1. Metodo de pago -> moneda (snapshot nuevo)
      // ----------------------------------------------------------------
      const [metodo] = await tx
        .select()
        .from(catalogItems)
        .where(
          and(
            eq(catalogItems.id, input.paymentMethodId),
            eq(catalogItems.tenantId, tenantId),
            eq(catalogItems.catalogKey, "payment_method"),
          ),
        );

      if (!metodo) return { ok: false as const, error: "Método de pago no válido." };
      if (metodo.archivedAt && metodo.id !== actual.paymentMethodId) {
        return { ok: false as const, error: `"${metodo.label}" está archivado.` };
      }
      const currency = metodo.currency!;

      // ----------------------------------------------------------------
      // 2. Categoria, del catalogo que corresponde al tipo original
      // ----------------------------------------------------------------
      const categoryCatalogKey =
        actual.type === "ingreso" ? "income_category" : "expense_category";

      const [categoria] = await tx
        .select()
        .from(catalogItems)
        .where(
          and(
            eq(catalogItems.id, input.categoryId),
            eq(catalogItems.tenantId, tenantId),
            eq(catalogItems.catalogKey, categoryCatalogKey),
          ),
        );

      if (!categoria) {
        return {
          ok: false as const,
          error: `Esa categoría no existe entre las de ${actual.type}.`,
        };
      }
      // Una categoria archivada se admite si ya era la de esta operacion: de lo
      // contrario corregir la fecha de un registro viejo seria imposible.
      if (categoria.archivedAt && categoria.id !== actual.categoryId) {
        return { ok: false as const, error: `"${categoria.label}" está archivada.` };
      }

      // ----------------------------------------------------------------
      // 3. Renglones
      // ----------------------------------------------------------------
      const anteriores = conRenglones
        ? await tx
            .select()
            .from(transactionItems)
            .where(
              and(
                eq(transactionItems.transactionId, input.id),
                eq(transactionItems.tenantId, tenantId),
              ),
            )
        : [];

      let rate: string | null = null;
      let baseCurrency: string | null = null;

      type Linea = {
        id: string;
        itemType: "product" | "service";
        productId: string | null;
        serviceId: string | null;
        qty: string;
        unitPrice: string;
        subtotal: string;
      };

      const lineas: Linea[] = [];
      let amount: string;

      if (conRenglones) {
        const items = input.items!;
        const productIds = items.filter((i) => i.itemType === "product").map((i) => i.refId);
        const serviceIds = items.filter((i) => i.itemType === "service").map((i) => i.refId);

        const catalogoProductos = productIds.length
          ? await tx
              .select()
              .from(products)
              .where(
                and(
                  eq(products.tenantId, tenantId),
                  inArray(products.id, productIds),
                  isNull(products.deletedAt),
                ),
              )
          : [];
        const catalogoServicios = serviceIds.length
          ? await tx
              .select()
              .from(services)
              .where(
                and(
                  eq(services.tenantId, tenantId),
                  inArray(services.id, serviceIds),
                  isNull(services.deletedAt),
                ),
              )
          : [];

        const porId = new Map<string, Vendible>();
        for (const p of catalogoProductos) porId.set(p.id, p);
        for (const s of catalogoServicios) porId.set(s.id, s);

        /**
         * Precio ORIGINAL de los renglones que ya estaban.
         *
         * Corregir "puse 2 unidades y eran 3" no debe revaluar la venta al
         * precio de hoy: el precio congelado es el que regia cuando se vendio.
         * Solo un renglon NUEVO toma el precio actual.
         */
        const precioOriginal = new Map(
          anteriores.map((a) => [a.productId ?? a.serviceId ?? "", a.unitPrice]),
        );

        const refs: Vendible[] = [];
        for (const item of items) {
          const ref = porId.get(item.refId);
          if (!ref) {
            return { ok: false as const, error: "Uno de los renglones ya no existe." };
          }
          if (actual.kind === "compra" && item.itemType === "service") {
            return {
              ok: false as const,
              error:
                "Una compra de insumos solo lleva productos. Para pagar un servicio, registra un gasto suelto.",
            };
          }
          refs.push(ref);
        }

        /**
         * La base de conversion, que al corregir tambien se puede cambiar: que
         * la tasa se tecleara mal es justo una de las cosas que hay que poder
         * arreglar. Si no mandan ninguna, se conserva la que tenia.
         */
        let mismaBase = true;
        if (actual.kind !== "compra") {
          const moneda = monedaDeLosPrecios(refs);
          if (!moneda.ok) return { ok: false as const, error: moneda.error };

          const resuelta = resolverTasa(
            moneda.currency,
            currency,
            input.exchangeRate ?? actual.exchangeRate ?? undefined,
          );
          if (!resuelta.ok) return { ok: false as const, error: resuelta.error };
          rate = resuelta.rate;
          baseCurrency = resuelta.baseCurrency;

          mismaBase =
            rate === (actual.exchangeRate ?? null) &&
            baseCurrency === (actual.baseCurrency ?? null) &&
            currency === actual.currency;
        }

        for (const [i, item] of items.entries()) {
          const ref = refs[i];

          let unitPrice: string;
          if (actual.kind === "compra") {
            // Al corregir una compra el precio se puede cambiar: puede ser
            // justamente lo que estaba mal. El formulario lo manda precargado
            // con el que se registro.
            const precio = precioDeCompra(
              item.unitPrice ?? precioOriginal.get(item.refId),
              ref.name,
            );
            if (!precio.ok) return { ok: false as const, error: precio.error };
            unitPrice = precio.value;
          } else if (mismaBase) {
            // Nada cambio en la conversion: los renglones que ya estaban
            // conservan su precio congelado, y uno nuevo toma el de catalogo.
            unitPrice =
              precioOriginal.get(item.refId) ?? precioConvertido(ref, rate);
          } else {
            /**
             * Cambio la tasa, la moneda base o la del pago.
             *
             * Los precios guardados estaban expresados con la conversion
             * vieja, asi que conservarlos seria dejar numeros que ya no
             * corresponden a nada. Se recalculan todos desde el catalogo con
             * la base nueva. El efecto secundario: si ademas cambio el precio
             * de lista desde que se registro, la correccion lo adopta.
             */
            unitPrice = precioConvertido(ref, rate);
          }

          const qty = normalizeQuantity(item.qty);
          lineas.push({
            id: uuidv7(),
            itemType: item.itemType,
            productId: item.itemType === "product" ? item.refId : null,
            serviceId: item.itemType === "service" ? item.refId : null,
            qty,
            unitPrice,
            subtotal: lineSubtotal(qty, unitPrice),
          });
        }

        amount = sumMoney(lineas.map((l) => l.subtotal));
      } else {
        amount = normalizeMoney(input.amount!);
      }

      // ----------------------------------------------------------------
      // 4. Inventario: solo la DIFERENCIA, como movimiento compensatorio
      // ----------------------------------------------------------------
      if (conRenglones) {
        const antesPorProducto = new Map<string, string>();
        for (const a of anteriores) {
          if (!a.productId) continue;
          antesPorProducto.set(
            a.productId,
            sumQuantity([antesPorProducto.get(a.productId) ?? "0", a.qty]),
          );
        }

        const despuesPorProducto = new Map<string, string>();
        for (const l of lineas) {
          if (!l.productId) continue;
          despuesPorProducto.set(
            l.productId,
            sumQuantity([despuesPorProducto.get(l.productId) ?? "0", l.qty]),
          );
        }

        const compensaciones: ((typeof stockMovements.$inferInsert) & {
          productId: string;
        })[] = [];
        const todos = new Set([...antesPorProducto.keys(), ...despuesPorProducto.keys()]);

        for (const productId of todos) {
          const antes = antesPorProducto.get(productId) ?? "0";
          const despues = despuesPorProducto.get(productId) ?? "0";
          // Cuanto cambio la cantidad vendida/comprada de este producto.
          const cambio = subtractQuantity(despues, antes);
          if (isZero(cambio, 3)) continue;

          compensaciones.push({
            id: uuidv7(),
            tenantId,
            productId,
            // Vender MAS saca mas; comprar MAS mete mas.
            delta: actual.kind === "venta" ? negateQuantity(cambio) : cambio,
            reason: "ajuste",
            note: `Corrección de "${actual.concept}"`,
            occurredAt: new Date(),
            createdBy: userId,
          });
        }

        if (compensaciones.length) {
          await tx.insert(stockMovements).values(porProducto(compensaciones));
        }

        // Los renglones se reemplazan. Los movimientos originales se quedan
        // apuntando a los ids viejos: son hechos historicos, y esa referencia
        // es justamente lo que permite reconstruir que paso.
        await tx
          .delete(transactionItems)
          .where(
            and(
              eq(transactionItems.transactionId, input.id),
              eq(transactionItems.tenantId, tenantId),
            ),
          );

        await tx.insert(transactionItems).values(
          lineas.map((l) => ({ ...l, tenantId, transactionId: input.id })),
        );
      }

      // ----------------------------------------------------------------
      // 5. La transaccion
      // ----------------------------------------------------------------
      await tx
        .update(transactions)
        .set({
          concept: input.concept,
          occurredOn: input.occurredOn,
          categoryId: input.categoryId,
          categoryCatalogKey,
          paymentMethodId: input.paymentMethodId,
          amount,
          currency,
          exchangeRate: rate,
          baseCurrency,
          notes: input.notes || null,
        })
        .where(
          and(eq(transactions.id, input.id), eq(transactions.tenantId, tenantId)),
        );

      const diff: Record<string, unknown> = {};
      if (actual.concept !== input.concept) {
        diff.concept = { from: actual.concept, to: input.concept };
      }
      if (actual.occurredOn !== input.occurredOn) {
        diff.occurredOn = { from: actual.occurredOn, to: input.occurredOn };
      }
      if (actual.amount !== amount) {
        diff.amount = { from: actual.amount, to: amount };
      }
      if (actual.currency !== currency) {
        diff.currency = { from: actual.currency, to: currency };
      }
      if ((actual.exchangeRate ?? null) !== rate) {
        diff.exchangeRate = { from: actual.exchangeRate, to: rate };
      }
      if (actual.categoryId !== input.categoryId) {
        diff.categoryId = { from: actual.categoryId, to: input.categoryId };
      }
      if (actual.paymentMethodId !== input.paymentMethodId) {
        diff.paymentMethodId = {
          from: actual.paymentMethodId,
          to: input.paymentMethodId,
        };
      }

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "transactions",
        entityId: input.id,
        action: "update",
        actorId: userId,
        diff,
      });

      return { ok: true as const, id: input.id, amount, currency };
    });
  } catch (error) {
    const sinStock = await mensajeSinStock(
      tenantId,
      error,
      (producto, quedan) =>
        `No hay suficiente stock de "${producto}" para esa corrección: quedan ${quedan}.`,
    );
    return { ok: false, error: sinStock ?? "No se pudo guardar la corrección." };
  }
}

// ---------------------------------------------------------------------------
// Anular y restaurar
// ---------------------------------------------------------------------------

export type VoidResult = { ok: true } | { ok: false; error: string };

/** Lo que se lee de una operacion para anularla o restaurarla, bloqueada. */
async function bloquearOperacion(
  tx: Tx,
  tenantId: string,
  id: string,
) {
  // FOR UPDATE: dos anulaciones simultaneas leerian las dos "no esta anulada"
  // y repondrian el inventario dos veces. Con el bloqueo, la segunda espera y
  // ve la marca que dejo la primera.
  const [row] = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
    .for("update");
  return row;
}

/** Los renglones con producto de una operacion: los unicos que mueven stock. */
async function renglonesConProducto(
  tx: Tx,
  tenantId: string,
  transactionId: string,
) {
  const renglones = await tx
    .select()
    .from(transactionItems)
    .where(
      and(
        eq(transactionItems.transactionId, transactionId),
        eq(transactionItems.tenantId, tenantId),
      ),
    );
  return renglones.flatMap((l) => (l.productId ? [{ ...l, productId: l.productId }] : []));
}

/**
 * Anula una transaccion.
 *
 * No borra: marca `deleted_at` e inserta los movimientos de stock
 * compensatorios. Los originales se quedan — es lo que deja rastro de que hubo
 * una correccion, y sin eso "por que dice 14 y hay 12" no tiene respuesta.
 *
 * Por eso mismo se puede deshacer con `restoreTransaction`: no se perdio nada.
 */
export async function revertTransaction(
  { tenantId, userId }: ActorContext,
  input: { id: string; reason?: string },
): Promise<VoidResult> {
  const motivo = input.reason?.trim().slice(0, 500) || undefined;

  try {
    return await withTenant(tenantId, async (tx) => {
      const row = await bloquearOperacion(tx, tenantId, input.id);

      if (!row) return { ok: false as const, error: "No se encontró esa operación." };
      if (row.deletedAt) {
        return { ok: false as const, error: "Esa operación ya está anulada." };
      }

      await tx
        .update(transactions)
        .set({ deletedAt: new Date() })
        .where(
          and(eq(transactions.id, input.id), eq(transactions.tenantId, tenantId)),
        );

      const compensatorios = (await renglonesConProducto(tx, tenantId, input.id)).map(
        (l) => ({
          id: uuidv7(),
          tenantId,
          productId: l.productId,
          // Al reves del original: una venta anulada repone, una compra saca.
          delta: row.kind === "venta" ? l.qty : negateQuantity(l.qty),
          reason: "anulacion" as const,
          transactionItemId: l.id,
          note: motivo || `Anulación de ${row.concept}`,
          occurredAt: new Date(),
          createdBy: userId,
        }),
      );

      if (compensatorios.length) {
        await tx.insert(stockMovements).values(porProducto(compensatorios));
      }

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "transactions",
        entityId: input.id,
        action: "delete",
        actorId: userId,
        diff: {
          amount: row.amount,
          currency: row.currency,
          motivo: motivo ?? null,
          movimientosCompensatorios: compensatorios.length,
        },
      });

      return { ok: true as const };
    });
  } catch (error) {
    // Anular una COMPRA saca del inventario lo que entro con ella. Si de eso
    // ya se vendio una parte, el stock quedaria negativo.
    const sinStock = await mensajeSinStock(
      tenantId,
      error,
      (producto, quedan) =>
        `No se puede anular esta compra: de "${producto}" ya se vendió parte y quedan ${quedan}. Anula primero esas ventas o ajusta el inventario.`,
    );
    return { ok: false, error: sinStock ?? "No se pudo anular la operación." };
  }
}

/**
 * Deshace una anulacion.
 *
 * Vuelve a aplicar el efecto original sobre el inventario con movimientos
 * nuevos de motivo `restauracion`: los de la anulacion se quedan, igual que los
 * originales. El historial del producto cuenta las tres cosas en orden — se
 * vendio, se anulo, se restauro — en vez de fingir que la anulacion no paso.
 *
 * Restaurar una venta vuelve a sacar stock, asi que el trigger de stock puede
 * rechazarla si entretanto se vendio lo que ella habia repuesto.
 */
export async function restoreTransaction(
  { tenantId, userId }: ActorContext,
  input: { id: string },
): Promise<VoidResult> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const row = await bloquearOperacion(tx, tenantId, input.id);

      if (!row) return { ok: false as const, error: "No se encontró esa operación." };
      if (!row.deletedAt) {
        return { ok: false as const, error: "Esa operación no está anulada." };
      }

      /**
       * Un cobro de reserva no se restaura desde aqui.
       *
       * Anularlo lo saco del saldo de la reserva, y desde entonces pudo
       * haberse cobrado de nuevo. Restaurarlo sin pasar por cargarReserva()
       * — que bloquea la reserva y mide el saldo — podria cobrarla dos veces.
       */
      const [esCobro] = await tx
        .select({ bookingId: bookingPayments.bookingId })
        .from(bookingPayments)
        .where(
          and(
            eq(bookingPayments.tenantId, tenantId),
            eq(bookingPayments.transactionId, row.id),
          ),
        );
      if (esCobro) {
        return {
          ok: false as const,
          error:
            "Este cobro pertenecía a una reserva. Si hay que volver a cobrarlo, regístralo desde la reserva.",
        };
      }

      await tx
        .update(transactions)
        .set({ deletedAt: null })
        .where(and(eq(transactions.id, row.id), eq(transactions.tenantId, tenantId)));

      const movimientos = (await renglonesConProducto(tx, tenantId, row.id)).map((l) => ({
        id: uuidv7(),
        tenantId,
        productId: l.productId,
        // Igual que el original: la venta vuelve a sacar, la compra a meter.
        delta: row.kind === "venta" ? negateQuantity(l.qty) : l.qty,
        reason: "restauracion" as const,
        transactionItemId: l.id,
        note: `Restauración de ${row.concept}`,
        occurredAt: new Date(),
        createdBy: userId,
      }));

      if (movimientos.length) {
        await tx.insert(stockMovements).values(porProducto(movimientos));
      }

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "transactions",
        entityId: row.id,
        action: "restore",
        actorId: userId,
        diff: {
          amount: row.amount,
          currency: row.currency,
          anuladaEl: row.deletedAt.toISOString(),
          movimientos: movimientos.length,
        },
      });

      return { ok: true as const };
    });
  } catch (error) {
    const sinStock = await mensajeSinStock(
      tenantId,
      error,
      (producto, quedan) =>
        `No se puede restaurar esta venta: de "${producto}" quedan ${quedan}, menos de lo que ella vendió.`,
    );
    return { ok: false, error: sinStock ?? "No se pudo restaurar la operación." };
  }
}
