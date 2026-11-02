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
import { type Tx } from "@/lib/db";
import { withTenant } from "@/lib/db/tenant";
import {
  auditLog,
  bookingPayments,
  bookings,
  catalogItems,
  resources,
  services,
  tenants,
  transactions,
  type BookingStatus,
} from "@/lib/db/schema";
import {
  compareMoney,
  convertMoney,
  isMoney,
  isRate,
  isZero,
  lineSubtotal,
  normalizeMoney,
  normalizeRate,
  subtractMoney,
  sumMoney,
} from "@/lib/money";
import { bordesLocalesSql, periodoSql } from "./periodo";
import { cantidad, hoyEn, type Rango } from "./rango";

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

// ---------------------------------------------------------------------------
// Fase 2: check-in, check-out, no-show y cobros
// ---------------------------------------------------------------------------

interface ReservaCargada {
  id: string;
  status: BookingStatus;
  currency: string;
  unitPrice: string;
  holderName: string;
  resourceName: string;
  /** Hora LOCAL del negocio. */
  inicio: string;
  fin: string;
  timezone: string;
  /** Si en la zona del negocio ya es el día de llegada (o después). */
  empezo: boolean;
  /** Si ya pasó el final del rango. */
  termino: boolean;
  total: string;
  pagado: string;
  saldo: string;
}

/**
 * Carga una reserva BLOQUEANDO su fila (`FOR UPDATE`), con su total y saldo.
 *
 * El bloqueo es lo que hace seguros los cobros: dos recepcionistas cobrando
 * el saldo de la misma reserva a la vez leerían ambas "faltan 80" y cobrarían
 * 160. Con la fila bloqueada, la segunda espera a que la primera termine y,
 * al leer, ya ve el saldo nuevo. Lo mismo para check-in y check-out: dos
 * check-out simultáneos no pueden dejar dos marcas de salida.
 */
async function cargarReserva(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<ReservaCargada | null> {
  const [{ timezone }] = await tx
    .select({ timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, tenantId));

  const bordes = bordesLocalesSql(bookings.period, timezone);

  const [b] = await tx
    .select({
      id: bookings.id,
      status: bookings.status,
      serviceId: bookings.serviceId,
      resourceId: bookings.resourceId,
      currency: bookings.currency,
      unitPrice: bookings.unitPrice,
      holderName: bookings.holderName,
      inicio: bordes.inicio,
      fin: bordes.fin,
      // La comparación de días se hace en la zona del negocio: a las 22:00 en
      // Caracas el servidor ya está en el día siguiente.
      empezo: sql<boolean>`(now() AT TIME ZONE ${timezone})::date >= (lower(${bookings.period}) AT TIME ZONE ${timezone})::date`,
      termino: sql<boolean>`now() >= upper(${bookings.period})`,
    })
    .from(bookings)
    .where(and(eq(bookings.id, id), eq(bookings.tenantId, tenantId)))
    .for("update");

  if (!b) return null;

  const [extra] = await tx
    .select({ unidad: services.bookingUnit, resourceName: resources.name })
    .from(resources)
    .innerJoin(
      services,
      and(eq(services.id, resources.serviceId), eq(services.tenantId, resources.tenantId)),
    )
    .where(and(eq(resources.id, b.resourceId), eq(resources.tenantId, tenantId)));

  const unidad = extra?.unidad ?? "noche";
  const rango: Rango =
    unidad === "noche"
      ? { unidad, desde: b.inicio.slice(0, 10), hasta: b.fin.slice(0, 10) }
      : {
          unidad,
          fecha: b.inicio.slice(0, 10),
          inicio: b.inicio.slice(11, 16),
          fin: b.fin.slice(11, 16),
        };
  const c = cantidad(rango);
  const total = lineSubtotal(c.ok ? c.qty : "0", b.unitPrice);

  // Solo cuentan los cobros cuya transacción sigue viva: anular el cobro en
  // Finanzas lo saca del saldo, que es justamente la forma de corregirlo.
  const aplicados = await tx
    .select({ monto: bookingPayments.appliedAmount })
    .from(bookingPayments)
    .innerJoin(
      transactions,
      and(
        eq(transactions.id, bookingPayments.transactionId),
        eq(transactions.tenantId, bookingPayments.tenantId),
      ),
    )
    .where(
      and(
        eq(bookingPayments.tenantId, tenantId),
        eq(bookingPayments.bookingId, b.id),
        isNull(transactions.deletedAt),
      ),
    );
  const pagado = sumMoney(aplicados.map((a) => a.monto));

  return {
    id: b.id,
    status: b.status,
    currency: b.currency,
    unitPrice: b.unitPrice,
    holderName: b.holderName,
    resourceName: extra?.resourceName ?? "",
    inicio: b.inicio,
    fin: b.fin,
    timezone,
    empezo: b.empezo,
    termino: b.termino,
    total,
    pagado,
    saldo: subtractMoney(total, pagado),
  };
}

function fechaLegible(inicioLocal: string): string {
  const [y, m, d] = inicioLocal.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Check-in: el huésped llegó.
 *
 * Desde el día de llegada (en la zona del negocio) y antes de que termine el
 * rango. Hacer check-in de la reserva de la semana que viene es casi siempre
 * tocar la fila equivocada; y si ya terminó, lo que corresponde es cobrar o
 * marcar que no vino.
 */
export async function checkIn(
  { tenantId, userId }: ActorContext,
  input: { id: string },
): Promise<Result> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const r = await cargarReserva(tx, tenantId, input.id);
      if (!r) return { ok: false as const, error: "No se encontró esa reserva." };

      if (r.status === "en_curso") {
        return { ok: false as const, error: "Ya se hizo el check-in de esta reserva." };
      }
      if (r.status !== "reservada") {
        return {
          ok: false as const,
          error: "Solo se hace check-in de una reserva que está pendiente.",
        };
      }
      if (!r.empezo) {
        return {
          ok: false as const,
          error: `La llegada es el ${fechaLegible(r.inicio)}. Todavía no se puede hacer check-in.`,
        };
      }
      if (r.termino) {
        return {
          ok: false as const,
          error: "Esta reserva ya terminó. Cobra lo pendiente o márcala como no presentada.",
        };
      }

      await tx
        .update(bookings)
        .set({ status: "en_curso", checkedInAt: new Date() })
        .where(and(eq(bookings.id, r.id), eq(bookings.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "bookings",
        entityId: r.id,
        action: "update",
        actorId: userId,
        diff: { status: { from: "reservada", to: "en_curso" } },
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo registrar la llegada." };
  }
}

export type CheckOutResult =
  | { ok: true; saldo: string }
  | { ok: false; error: string; saldo?: string };

/**
 * Check-out: el huésped se fue.
 *
 * Con saldo pendiente NO sale por descuido: hace falta `aceptarSaldo`, que la
 * pantalla solo manda después de que alguien confirmó "sale debiendo". Es una
 * decisión (un cliente corporativo que paga a fin de mes), no un olvido, y se
 * exige en el servidor porque el botón no es la única forma de llamar esto.
 *
 * El check-out NO genera una venta: los cobros ya son el ingreso. Generar una
 * venta por el total contaría el anticipo dos veces.
 *
 * Tampoco acorta la reserva si se va antes: el rango y el total quedan como
 * se reservaron. Liberar las noches no usadas es una decisión de tarifa
 * (¿se le devuelve?) que queda para después.
 */
export async function checkOut(
  { tenantId, userId }: ActorContext,
  input: { id: string; aceptarSaldo?: boolean },
): Promise<CheckOutResult> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const r = await cargarReserva(tx, tenantId, input.id);
      if (!r) return { ok: false as const, error: "No se encontró esa reserva." };

      if (r.status === "finalizada") {
        return { ok: false as const, error: "Esta reserva ya tiene su salida registrada." };
      }
      if (r.status !== "en_curso") {
        return {
          ok: false as const,
          error: "Primero hay que registrar la llegada (check-in).",
        };
      }

      const debe = compareMoney(r.saldo, "0") > 0;
      if (debe && !input.aceptarSaldo) {
        return {
          ok: false as const,
          error: `Queda un saldo de ${r.saldo} ${r.currency}. Cóbralo o confirma que sale con saldo pendiente.`,
          saldo: r.saldo,
        };
      }

      await tx
        .update(bookings)
        .set({ status: "finalizada", checkedOutAt: new Date() })
        .where(and(eq(bookings.id, r.id), eq(bookings.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "bookings",
        entityId: r.id,
        action: "update",
        actorId: userId,
        diff: {
          status: { from: "en_curso", to: "finalizada" },
          // Si salió debiendo, que quede dicho con nombre y apellido de quién
          // lo aceptó (actorId) y por cuánto.
          saldoAlSalir: r.saldo,
        },
      });

      return { ok: true as const, saldo: r.saldo };
    });
  } catch {
    return { ok: false, error: "No se pudo registrar la salida." };
  }
}

/**
 * No se presentó.
 *
 * Solo desde el día de llegada: antes no se sabe. Libera el recurso (el
 * EXCLUDE deja de contarla) y conserva los cobros: quedarse con el anticipo
 * de quien no vino es justamente para lo que se cobra un anticipo.
 */
export async function markNoShow(
  { tenantId, userId }: ActorContext,
  input: { id: string },
): Promise<Result> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const r = await cargarReserva(tx, tenantId, input.id);
      if (!r) return { ok: false as const, error: "No se encontró esa reserva." };

      if (r.status !== "reservada") {
        return {
          ok: false as const,
          error: "Solo se marca como no presentada una reserva pendiente.",
        };
      }
      if (!r.empezo) {
        return {
          ok: false as const,
          error: `La llegada es el ${fechaLegible(r.inicio)}. Todavía no se sabe si viene.`,
        };
      }

      await tx
        .update(bookings)
        .set({ status: "no_show" })
        .where(and(eq(bookings.id, r.id), eq(bookings.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "bookings",
        entityId: r.id,
        action: "update",
        actorId: userId,
        diff: { status: { from: "reservada", to: "no_show" }, pagado: r.pagado },
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo marcar la reserva." };
  }
}

const paymentSchema = z.object({
  bookingId: z.uuid(),
  /** En la moneda de la RESERVA: "abona 100 USD", aunque pague en Bs. */
  monto: z.string().trim().refine(isMoney, "Escribe un monto válido"),
  paymentMethodId: z.uuid("Elige un método de pago"),
  categoryId: z.uuid("Elige una categoría"),
  /** Solo si el método cobra en otra moneda que la de la reserva. */
  exchangeRate: z.string().optional(),
  notes: z.string().trim().max(1000).optional(),
  /** Generado al abrir el formulario: el doble clic no cobra dos veces. */
  clientRequestId: z.uuid(),
});

export type RegisterPaymentInput = z.infer<typeof paymentSchema>;

export type PaymentResult =
  | {
      ok: true;
      transactionId: string;
      amount: string;
      currency: string;
      saldo: string;
      duplicate?: true;
    }
  | { ok: false; error: string };

/**
 * Cobra (todo o parte de) una reserva.
 *
 * El cobro ES el ingreso: una transacción normal, de la fecha en que entró el
 * dinero, que aparece en los reportes como cualquier otra. Además queda ligada
 * a la reserva con lo que le abona en la moneda de la reserva.
 *
 * Si la reserva es en USD y se cobra en Bs, se escribe cuánto abona en USD y
 * la tasa; la transacción queda en Bs, con la tasa guardada como en una venta.
 *
 * No se puede cobrar más que el saldo: un vuelto mal calculado no puede dejar
 * la reserva "pagada de más" en silencio.
 */
export async function registerPayment(
  { tenantId, userId }: ActorContext,
  raw: RegisterPaymentInput,
): Promise<PaymentResult> {
  const parsed = paymentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  try {
    return await withTenant(tenantId, async (tx) => {
      const r = await cargarReserva(tx, tenantId, input.bookingId);
      if (!r) return { ok: false as const, error: "No se encontró esa reserva." };

      if (r.status === "cancelada" || r.status === "no_show") {
        return {
          ok: false as const,
          error: "No se cobra una reserva cancelada o no presentada.",
        };
      }

      const monto = normalizeMoney(input.monto);
      if (compareMoney(monto, "0") <= 0) {
        return { ok: false as const, error: "El cobro tiene que ser mayor que cero." };
      }
      if (isZero(r.saldo)) {
        return { ok: false as const, error: "Esta reserva ya está pagada completa." };
      }
      if (compareMoney(monto, r.saldo) > 0) {
        return {
          ok: false as const,
          error: `El cobro pasa del saldo, que es ${r.saldo} ${r.currency}.`,
        };
      }

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
      if (!metodo || !metodo.currency) {
        return { ok: false as const, error: "Método de pago no válido." };
      }
      if (metodo.archivedAt) {
        return { ok: false as const, error: `"${metodo.label}" está archivado.` };
      }

      const [categoria] = await tx
        .select()
        .from(catalogItems)
        .where(
          and(
            eq(catalogItems.id, input.categoryId),
            eq(catalogItems.tenantId, tenantId),
            eq(catalogItems.catalogKey, "income_category"),
          ),
        );
      if (!categoria) {
        return { ok: false as const, error: "Esa categoría no existe entre las de ingreso." };
      }
      if (categoria.archivedAt) {
        return { ok: false as const, error: `"${categoria.label}" está archivada.` };
      }

      // Misma moneda: el cobro es el abono. Otra: se convierte con la tasa
      // tecleada, igual que una venta de catálogo en USD cobrada en Bs.
      const currency = metodo.currency;
      let amount = monto;
      let exchangeRate: string | null = null;
      let baseCurrency: string | null = null;
      if (currency !== r.currency) {
        if (!input.exchangeRate || !isRate(input.exchangeRate)) {
          return {
            ok: false as const,
            error: `La reserva es en ${r.currency} y el pago en ${currency}. Escribe la tasa que aplicaste.`,
          };
        }
        exchangeRate = normalizeRate(input.exchangeRate);
        baseCurrency = r.currency;
        amount = convertMoney(monto, exchangeRate);
      }

      const transactionId = uuidv7();
      await tx.insert(transactions).values({
        id: transactionId,
        tenantId,
        type: "ingreso",
        kind: "operacion",
        concept: `Reserva ${r.resourceName} · ${r.holderName}`,
        // El día en que entró el dinero, en la zona del negocio.
        occurredOn: hoyEn(r.timezone),
        categoryId: categoria.id,
        categoryCatalogKey: "income_category",
        paymentMethodId: metodo.id,
        paymentCatalogKey: "payment_method",
        amount,
        currency,
        exchangeRate,
        baseCurrency,
        notes: input.notes || null,
        clientRequestId: input.clientRequestId,
        createdBy: userId,
      });

      await tx.insert(bookingPayments).values({
        id: uuidv7(),
        tenantId,
        bookingId: r.id,
        transactionId,
        appliedAmount: monto,
      });

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "transactions",
        entityId: transactionId,
        action: "create",
        actorId: userId,
        diff: {
          reserva: r.id,
          abona: `${monto} ${r.currency}`,
          cobrado: `${amount} ${currency}`,
          tasa: exchangeRate,
        },
      });

      return {
        ok: true as const,
        transactionId,
        amount,
        currency,
        saldo: subtractMoney(r.saldo, monto),
      };
    });
  } catch (error) {
    // El mismo client_request_id dos veces: el doble clic. Se devuelve el
    // cobro que ya quedó, que es lo que la persona esperaba.
    if (pgCode(error) === "23505") {
      const [existente] = await withTenant(tenantId, (tx) =>
        tx
          .select({
            transactionId: transactions.id,
            amount: transactions.amount,
            currency: transactions.currency,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              eq(transactions.clientRequestId, input.clientRequestId),
            ),
          ),
      );
      if (existente) {
        const saldo = await withTenant(tenantId, async (tx) => {
          const r = await cargarReserva(tx, tenantId, input.bookingId);
          return r?.saldo ?? "0.00";
        });
        return { ok: true, ...existente, saldo, duplicate: true };
      }
    }
    return { ok: false, error: "No se pudo registrar el cobro." };
  }
}
