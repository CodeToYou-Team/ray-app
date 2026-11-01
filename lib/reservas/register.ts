import "server-only";

/**
 * Núcleo de reservas, sin autorización.
 *
 * Igual que lib/finanzas/register.ts: vive separado de actions.ts para que la
 * lógica se pueda probar sin simular una sesión de Supabase. NADIE debe
 * llamar estas funciones desde una ruta o un componente: el punto de entrada
 * es actions.ts, que exige el permiso primero.
 */
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { withTenant } from "@/lib/db/tenant";
import {
  auditLog,
  bookings,
  resources,
  services,
  tenants,
} from "@/lib/db/schema";
import { lineSubtotal, normalizeMoney } from "@/lib/money";
import { periodoSql } from "./periodo";
import { cantidad, type Rango } from "./rango";

export interface ActorContext {
  tenantId: string;
  userId: string;
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** El código de Postgres, buscándolo en la cadena de causas que envuelve Drizzle. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Reservas
// ---------------------------------------------------------------------------

const rangoSchema = z.discriminatedUnion("unidad", [
  z.object({
    unidad: z.literal("noche"),
    desde: z.string(),
    hasta: z.string(),
  }),
  z.object({
    unidad: z.literal("hora"),
    fecha: z.string(),
    inicio: z.string(),
    fin: z.string(),
  }),
]);

const bookingSchema = z.object({
  serviceId: z.uuid("Elige qué se reserva"),
  resourceId: z.uuid("Elige el recurso"),
  rango: rangoSchema,
  holderName: z.string().trim().min(1, "Escribe a nombre de quién va").max(200),
  holderDocument: z.string().trim().max(50).optional(),
  holderPhone: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type CreateBookingInput = z.infer<typeof bookingSchema>;

export type BookingResult = Result<{
  id: string;
  qty: string;
  unitPrice: string;
  total: string;
  currency: string;
}>;

/**
 * Crea una reserva.
 *
 * Lo que impide la doble reserva NO está en esta función: es el EXCLUDE de
 * `bookings`. Acá se podría consultar "¿está libre?" antes de insertar, pero
 * entre esa consulta y el INSERT otra recepcionista puede tomar la misma
 * habitación. El motor no tiene ese hueco, así que se inserta directo y, si
 * choca, se traduce el error.
 *
 * De paso, eso hace que el doble clic no duplique: la segunda reserva se
 * solapa con la primera y Postgres la rechaza.
 */
export async function createBooking(
  { tenantId, userId }: ActorContext,
  raw: CreateBookingInput,
): Promise<BookingResult> {
  const parsed = bookingSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const input = parsed.data;

  try {
    return await withTenant(tenantId, async (tx) => {
      const [servicio] = await tx
        .select()
        .from(services)
        .where(
          and(
            eq(services.id, input.serviceId),
            eq(services.tenantId, tenantId),
            isNull(services.deletedAt),
          ),
        );

      if (!servicio) return { ok: false as const, error: "Ese servicio ya no existe." };
      if (!servicio.bookingUnit) {
        return {
          ok: false as const,
          error: `"${servicio.name}" no se reserva. Actívalo en Reservas › Recursos.`,
        };
      }
      // El rango tiene que venir en la unidad del servicio: una habitación por
      // noche no se reserva "de 14:00 a 16:00".
      if (input.rango.unidad !== servicio.bookingUnit) {
        return {
          ok: false as const,
          error: `"${servicio.name}" se reserva por ${servicio.bookingUnit}.`,
        };
      }

      const [recurso] = await tx
        .select()
        .from(resources)
        .where(
          and(
            eq(resources.id, input.resourceId),
            eq(resources.tenantId, tenantId),
            eq(resources.serviceId, servicio.id),
          ),
        );

      if (!recurso) {
        return { ok: false as const, error: `Ese recurso no es de "${servicio.name}".` };
      }
      if (recurso.archivedAt) {
        return { ok: false as const, error: `"${recurso.name}" está archivado.` };
      }

      const unidades = cantidad(input.rango as Rango);
      if (!unidades.ok) return { ok: false as const, error: unidades.error };

      // La zona del negocio sale de la base, no de la sesión ni del servidor:
      // es la única fuente que no puede estar desactualizada.
      const [{ timezone }] = await tx
        .select({ timezone: tenants.timezone })
        .from(tenants)
        .where(eq(tenants.id, tenantId));

      // Snapshot de precio y moneda: si mañana sube la tarifa, esta reserva no.
      const unitPrice = normalizeMoney(servicio.price);
      const id = uuidv7();

      await tx.insert(bookings).values({
        id,
        tenantId,
        serviceId: servicio.id,
        resourceId: recurso.id,
        period: periodoSql(input.rango as Rango, timezone),
        unitPrice,
        currency: servicio.currency,
        holderName: input.holderName,
        holderDocument: input.holderDocument || null,
        holderPhone: input.holderPhone || null,
        notes: input.notes || null,
        createdBy: userId,
      });

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "bookings",
        entityId: id,
        action: "create",
        actorId: userId,
        diff: {
          recurso: recurso.name,
          rango: input.rango,
          titular: input.holderName,
        },
      });

      return {
        ok: true as const,
        id,
        qty: unidades.qty,
        unitPrice,
        total: lineSubtotal(unidades.qty, unitPrice),
        currency: servicio.currency,
      };
    });
  } catch (error) {
    // 23P01 = exclusion_violation: el EXCLUDE de `bookings`. Es el caso
    // esperado, no un fallo: alguien ya tiene ese recurso en esas fechas.
    if (pgCode(error) === "23P01") {
      return {
        ok: false,
        error: "Ese recurso ya tiene una reserva que se cruza con esas fechas.",
      };
    }
    return { ok: false, error: "No se pudo guardar la reserva." };
  }
}

/**
 * Cancela una reserva.
 *
 * No borra: marca el estado y la fecha. Al quedar `cancelada`, el EXCLUDE deja
 * de contarla y el recurso se libera para esas fechas.
 */
export async function cancelBooking(
  { tenantId, userId }: ActorContext,
  input: { id: string; reason?: string },
): Promise<Result> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const [actual] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, input.id), eq(bookings.tenantId, tenantId)));

      if (!actual) return { ok: false as const, error: "No se encontró esa reserva." };
      if (actual.status === "cancelada") {
        return { ok: false as const, error: "Esa reserva ya está cancelada." };
      }
      // En la fase 1 solo existe `reservada`. Cuando haya check-in, una
      // estadía en curso o terminada no se "cancela": se cierra o se anula su
      // cobro, que es otra operación.
      if (actual.status !== "reservada") {
        return {
          ok: false as const,
          error: "Solo se puede cancelar una reserva que todavía no empezó.",
        };
      }

      await tx
        .update(bookings)
        .set({
          status: "cancelada",
          cancelledAt: new Date(),
          cancelReason: input.reason?.trim() || null,
        })
        .where(and(eq(bookings.id, input.id), eq(bookings.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "bookings",
        entityId: input.id,
        action: "update",
        actorId: userId,
        diff: {
          status: { from: actual.status, to: "cancelada" },
          motivo: input.reason?.trim() || null,
        },
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo cancelar la reserva." };
  }
}

// ---------------------------------------------------------------------------
// Recursos y servicios reservables
// ---------------------------------------------------------------------------

/**
 * Activa, cambia o quita la unidad de reserva de un servicio.
 *
 * Solo si el servicio no tiene reservas, de ningún estado. Pasar de "por
 * noche" a "por hora" dejaría las reservas existentes con una cantidad que ya
 * no significa lo mismo; y quitarla dejaría reservas de un servicio que "no se
 * reserva". Si hace falta, se crea otro servicio.
 */
export async function setServiceBookingUnit(
  { tenantId, userId }: ActorContext,
  input: { serviceId: string; unidad: "noche" | "hora" | null },
): Promise<Result> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const [servicio] = await tx
        .select()
        .from(services)
        .where(
          and(
            eq(services.id, input.serviceId),
            eq(services.tenantId, tenantId),
            isNull(services.deletedAt),
          ),
        );
      if (!servicio) return { ok: false as const, error: "Ese servicio ya no existe." };
      if (servicio.bookingUnit === input.unidad) return { ok: true as const };

      const [{ n }] = await tx
        .select({ n: count() })
        .from(bookings)
        .where(
          and(eq(bookings.tenantId, tenantId), eq(bookings.serviceId, servicio.id)),
        );
      if (n > 0) {
        return {
          ok: false as const,
          error: `"${servicio.name}" ya tiene reservas. Para reservar de otra forma, crea otro servicio.`,
        };
      }

      await tx
        .update(services)
        .set({ bookingUnit: input.unidad })
        .where(and(eq(services.id, servicio.id), eq(services.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "services",
        entityId: servicio.id,
        action: "update",
        actorId: userId,
        diff: { bookingUnit: { from: servicio.bookingUnit, to: input.unidad } },
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo guardar el cambio." };
  }
}

const resourceSchema = z.object({
  serviceId: z.uuid(),
  name: z.string().trim().min(1, "Escribe un nombre, como 101 o Cancha 2").max(100),
  notes: z.string().trim().max(500).optional(),
});

export async function createResource(
  { tenantId, userId }: ActorContext,
  raw: z.infer<typeof resourceSchema>,
): Promise<Result<{ id: string }>> {
  const parsed = resourceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  try {
    return await withTenant(tenantId, async (tx) => {
      const [servicio] = await tx
        .select()
        .from(services)
        .where(
          and(
            eq(services.id, input.serviceId),
            eq(services.tenantId, tenantId),
            isNull(services.deletedAt),
          ),
        );
      if (!servicio) return { ok: false as const, error: "Ese servicio ya no existe." };
      if (!servicio.bookingUnit) {
        return {
          ok: false as const,
          error: `Activa primero "${servicio.name}" como reservable.`,
        };
      }

      const id = uuidv7();
      await tx.insert(resources).values({
        id,
        tenantId,
        serviceId: servicio.id,
        name: input.name,
        notes: input.notes || null,
      });

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "resources",
        entityId: id,
        action: "create",
        actorId: userId,
        diff: { name: input.name, servicio: servicio.name },
      });

      return { ok: true as const, id };
    });
  } catch (error) {
    // El índice único de nombre activo por cliente.
    if (pgCode(error) === "23505") {
      return {
        ok: false,
        error: `Ya hay un recurso activo que se llama "${input.name}".`,
      };
    }
    return { ok: false, error: "No se pudo crear el recurso." };
  }
}

/**
 * Archiva un recurso.
 *
 * Solo si no tiene reservas activas que todavía no terminaron: archivar la 101
 * con huéspedes llegando la semana que viene los dejaría con una reserva de
 * una habitación que ya no aparece en ninguna pantalla.
 *
 * "Que no terminaron" importa: en la fase 1 no hay check-out, así que toda
 * estadía pasada se queda en `reservada` para siempre. Contar solo el estado
 * haría imposible archivar cualquier habitación que se haya usado alguna vez.
 */
export async function archiveResource(
  { tenantId, userId }: ActorContext,
  input: { id: string },
): Promise<Result> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const [recurso] = await tx
        .select()
        .from(resources)
        .where(and(eq(resources.id, input.id), eq(resources.tenantId, tenantId)));
      if (!recurso) return { ok: false as const, error: "No se encontró ese recurso." };
      if (recurso.archivedAt) return { ok: true as const };

      const [{ n }] = await tx
        .select({ n: count() })
        .from(bookings)
        .where(
          and(
            eq(bookings.tenantId, tenantId),
            eq(bookings.resourceId, recurso.id),
            ne(bookings.status, "cancelada"),
            ne(bookings.status, "no_show"),
            ne(bookings.status, "finalizada"),
            sql`upper(${bookings.period}) > now()`,
          ),
        );
      if (n > 0) {
        return {
          ok: false as const,
          error: `"${recurso.name}" tiene reservas pendientes. Cancélalas o espera a que terminen.`,
        };
      }

      await tx
        .update(resources)
        .set({ archivedAt: new Date() })
        .where(and(eq(resources.id, recurso.id), eq(resources.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "resources",
        entityId: recurso.id,
        action: "delete",
        actorId: userId,
        diff: { name: recurso.name, archivado: true },
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo archivar el recurso." };
  }
}
