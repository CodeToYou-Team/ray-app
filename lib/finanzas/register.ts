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
import { withTenant } from "@/lib/db/tenant";
import {
  auditLog,
  catalogItems,
  products,
  services,
  stockMovements,
  transactionItems,
  transactions,
} from "@/lib/db/schema";
import {
  isMoney,
  isQuantity,
  isZero,
  lineSubtotal,
  normalizeMoney,
  normalizeQuantity,
  negateQuantity,
  subtractQuantity,
  sumMoney,
  sumQuantity,
} from "@/lib/money";

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

        const porId = new Map<string, { name: string; price: string; currency: string }>();
        for (const p of catalogoProductos) porId.set(p.id, p);
        for (const s of catalogoServicios) porId.set(s.id, s);

        for (const item of items) {
          const ref = porId.get(item.refId);
          if (!ref) {
            return { ok: false as const, error: "Uno de los renglones ya no existe." };
          }

          /**
           * En una VENTA, la moneda del renglon tiene que coincidir con la del
           * pago: el precio sale del catalogo, viene denominado en la moneda
           * del producto, y como NO se convierte entre monedas, sumar un
           * producto en USD dentro de una venta cobrada en Bs daria un total
           * sin significado — el numero saldria, pero no seria dinero.
           *
           * En una COMPRA no aplica: el precio lo escribe quien registra, en la
           * moneda del pago, y el precio de venta del catalogo ni se lee. Que
           * un producto se venda en Bs no impide pagarle al proveedor en USD.
           */
          let unitPrice: string;
          if (input.kind === "compra") {
            const precio = precioDeCompra(item.unitPrice, ref.name);
            if (!precio.ok) return { ok: false as const, error: precio.error };
            unitPrice = precio.value;
          } else {
            if (ref.currency !== currency) {
              return {
                ok: false as const,
                error: `"${ref.name}" tiene precio en ${ref.currency} y el pago es en ${currency}. Los montos no se convierten entre monedas.`,
              };
            }
            unitPrice = normalizeMoney(ref.price);
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

        if (movimientos.length) await tx.insert(stockMovements).values(movimientos);
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

    return { ok: false, error: "No se pudo registrar la operación." };
  }
}

/**
 * Anula una transaccion.
 *
 * No borra: marca `deleted_at` e inserta los movimientos de stock
 * compensatorios. Los originales se quedan — es lo que deja rastro de que hubo
 * una correccion, y sin eso "por que dice 14 y hay 12" no tiene respuesta.
 */
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
      const [actual] = await tx
        .select()
        .from(transactions)
        .where(
          and(eq(transactions.id, input.id), eq(transactions.tenantId, tenantId)),
        );

      if (!actual) return { ok: false as const, error: "No se encontró esa operación." };
      if (actual.deletedAt) {
        return {
          ok: false as const,
          error: "Esa operación está anulada. Registra una nueva en su lugar.",
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

        const porId = new Map<string, { name: string; price: string; currency: string }>();
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
          } else {
            if (ref.currency !== currency) {
              return {
                ok: false as const,
                error: `"${ref.name}" tiene precio en ${ref.currency} y el pago es en ${currency}. Los montos no se convierten entre monedas.`,
              };
            }
            unitPrice = normalizeMoney(
              precioOriginal.get(item.refId) ?? ref.price,
            );
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

        const compensaciones: (typeof stockMovements.$inferInsert)[] = [];
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
          await tx.insert(stockMovements).values(compensaciones);
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
  } catch {
    return { ok: false, error: "No se pudo guardar la corrección." };
  }
}

export async function revertTransaction(
  { tenantId, userId }: ActorContext,
  input: { id: string; reason?: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(transactions)
        .where(
          and(eq(transactions.id, input.id), eq(transactions.tenantId, tenantId)),
        );

      if (!row) return { ok: false, error: "No se encontró esa operación." };
      if (row.deletedAt) return { ok: false, error: "Esa operación ya está anulada." };

      await tx
        .update(transactions)
        .set({ deletedAt: new Date() })
        .where(
          and(eq(transactions.id, input.id), eq(transactions.tenantId, tenantId)),
        );

      const renglones = await tx
        .select()
        .from(transactionItems)
        .where(
          and(
            eq(transactionItems.transactionId, input.id),
            eq(transactionItems.tenantId, tenantId),
          ),
        );

      const compensatorios = renglones
        .filter((l) => l.productId)
        .map((l) => ({
          id: uuidv7(),
          tenantId,
          productId: l.productId!,
          // Al reves del original: una venta anulada repone, una compra saca.
          delta: row.kind === "venta" ? l.qty : negateQuantity(l.qty),
          reason: "anulacion" as const,
          transactionItemId: l.id,
          note: input.reason || `Anulación de ${row.concept}`,
          occurredAt: new Date(),
          createdBy: userId,
        }));

      if (compensatorios.length) {
        await tx.insert(stockMovements).values(compensatorios);
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
          motivo: input.reason ?? null,
          movimientosCompensatorios: compensatorios.length,
        },
      });

      return { ok: true };
    });

    return result;
  } catch {
    return { ok: false, error: "No se pudo anular la operación." };
  }
}
