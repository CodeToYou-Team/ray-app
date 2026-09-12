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
import { isMoney, isQuantity, lineSubtotal, normalizeMoney, normalizeQuantity, negateQuantity, sumMoney } from "@/lib/money";

export type TxResult =
  | { ok: true; id: string; amount: string; currency: string; duplicate?: true }
  | { ok: false; error: string };

const itemSchema = z.object({
  itemType: z.enum(["product", "service"]),
  refId: z.uuid(),
  qty: z.string().refine(isQuantity, "Cantidad inválida"),
});

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
           * La moneda del renglon tiene que coincidir con la del pago.
           *
           * Como NO se convierte entre monedas, sumar un producto con precio en
           * USD dentro de una venta cobrada en Bs daria un total sin significado
           * — el numero saldria, pero no seria dinero.
           */
          if (ref.currency !== currency) {
            return {
              ok: false as const,
              error: `"${ref.name}" tiene precio en ${ref.currency} y el pago es en ${currency}. Los montos no se convierten entre monedas.`,
            };
          }

          const qty = normalizeQuantity(item.qty);
          const unitPrice = normalizeMoney(ref.price);
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
