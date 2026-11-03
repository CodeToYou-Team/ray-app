import "server-only";

/**
 * Núcleo de reservas, sin autorización.
 *
 * Igual que lib/finanzas/register.ts: vive separado de actions.ts para que la
 * lógica se pueda probar sin simular una sesión de Supabase. NADIE debe
 * llamar estas funciones desde una ruta o un componente: el punto de entrada
 * es actions.ts, que exige el permiso primero.
 */
import { and, count, eq, isNull, ne, or, sql } from "drizzle-orm";
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
  serviceRates,
  serviceSchedules,
  services,
  tenants,
  transactions,
  type BookingStatus,
  type RateUnit,
} from "@/lib/db/schema";
import { isKnownCurrency } from "@/lib/currencies";
import {
  compareMoney,
  convertMoney,
  isMoney,
  isRate,
  isZero,
  normalizeMoney,
  normalizeRate,
  subtractMoney,
  sumMoney,
} from "@/lib/money";
import { validateCustomIn } from "@/lib/fields/queries";
import type { CustomValues } from "@/lib/fields/validate";
import { bordesLocalesSql, periodoSql } from "./periodo";
import {
  bordesLocales,
  cantidad,
  cumpleHorario,
  diaSemanaIso,
  franjasTexto,
  hoyEn,
  losDias,
  nombreTarifa,
  sinCeros,
  tarifaBase,
  totalReserva,
  turnosDelDia,
  DIAS_SEMANA,
  TARIFAS_DEL_GRANO,
  type Rango,
  type RangoHoras,
  type Tarifa,
  type ModoHorario,
  type Turno,
  type Unidad,
} from "./rango";

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
// Reservas pendientes
// ---------------------------------------------------------------------------

/**
 * Cuántas reservas PENDIENTES tiene un recurso o un servicio.
 *
 * Pendiente es lo que todavía va a necesitar a alguien en la recepción:
 * - en curso: el huésped está adentro. Cuenta SIEMPRE, aunque su rango ya
 *   haya vencido: quien se quedó más de lo previsto sigue ahí hasta que se
 *   registre su salida;
 * - reservada y sin terminar: alguien va a llegar.
 *
 * NO cuentan las canceladas, las no presentadas, las finalizadas, ni las
 * reservadas cuyo rango ya pasó. Estas últimas son estadías de antes de que
 * existiera el check-out, o llegadas que nadie registró: contarlas haría
 * imposible archivar cualquier cosa que se haya reservado alguna vez.
 *
 * Es la regla para archivar un recurso o un servicio: archivar algo con
 * reservas pendientes las dejaría fuera de la cuadrícula, sin dónde
 * registrar la llegada, cobrar ni dar la salida.
 */
export async function contarPendientes(
  tx: Tx,
  tenantId: string,
  de: { resourceId: string } | { serviceId: string },
): Promise<number> {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        "resourceId" in de
          ? eq(bookings.resourceId, de.resourceId)
          : eq(bookings.serviceId, de.serviceId),
        or(
          eq(bookings.status, "en_curso"),
          and(
            eq(bookings.status, "reservada"),
            sql`upper(${bookings.period}) > now()`,
          ),
        ),
      ),
    );
  return n;
}

// ---------------------------------------------------------------------------
// Horarios fijos
// ---------------------------------------------------------------------------

/** "18:00:00" de Postgres → "18:00". */
function hhmm(t: string): string {
  return t.slice(0, 5);
}

/** Los turnos publicados de un servicio. */
async function turnosDe(tx: Tx, tenantId: string, serviceId: string): Promise<Turno[]> {
  const rows = await tx
    .select({
      id: serviceSchedules.id,
      weekday: serviceSchedules.weekday,
      start: serviceSchedules.startTime,
      end: serviceSchedules.endTime,
    })
    .from(serviceSchedules)
    .where(
      and(eq(serviceSchedules.tenantId, tenantId), eq(serviceSchedules.serviceId, serviceId)),
    );
  return rows.map((r) => ({ ...r, start: hhmm(r.start), end: hhmm(r.end) }));
}

/**
 * Si el tramo pedido respeta el horario del servicio: cabe en una franja de
 * atención, o es exactamente uno de sus turnos (`cumpleHorario`).
 *
 * En la aplicación y no en un trigger, a propósito: a diferencia de la doble
 * reserva o los cupos, aquí no hay carrera que cerrar. Es validar un dato de
 * entrada, como que el tramo vaya en medias horas.
 *
 * El día de la semana sale de la FECHA local, no del instante: la clase de las
 * 21:00 del martes en Caracas ya es miércoles en UTC.
 */
async function validarTurno(
  tx: Tx,
  tenantId: string,
  servicio: { id: string; name: string; scheduleMode: ModoHorario },
  rango: RangoHoras,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const turnos = await turnosDe(tx, tenantId, servicio.id);
  if (cumpleHorario(servicio.scheduleMode, turnos, rango)) return { ok: true };

  const delDia = turnosDelDia(turnos, rango.fecha);
  const dia = diaSemanaIso(rango.fecha);
  if (servicio.scheduleMode === "atencion") {
    return {
      ok: false,
      error:
        delDia.length === 0
          ? `"${servicio.name}" no atiende ${losDias(dia)}.`
          : `"${servicio.name}" atiende el ${DIAS_SEMANA[dia - 1]} ${franjasTexto(delDia)}: el tramo tiene que caber entero en una de esas horas.`,
    };
  }
  if (delDia.length === 0) {
    return {
      ok: false,
      error: `"${servicio.name}" no tiene turnos ${losDias(dia)}.`,
    };
  }
  return {
    ok: false,
    error: `"${servicio.name}" se reserva en sus turnos. El ${DIAS_SEMANA[dia - 1]} hay: ${delDia
      .map((t) => `${t.start}–${t.end}`)
      .join(", ")}.`,
  };
}

// ---------------------------------------------------------------------------
// Tarifas
// ---------------------------------------------------------------------------

interface TarifaFila extends Tarifa {
  id: string;
  label: string | null;
  price: string;
  currency: string;
}

/** Las tarifas activas de un servicio, en el orden en que se crearon. */
async function tarifasActivas(tx: Tx, tenantId: string, serviceId: string): Promise<TarifaFila[]> {
  return tx
    .select({
      id: serviceRates.id,
      unit: serviceRates.unit,
      minutes: serviceRates.minutes,
      label: serviceRates.label,
      price: serviceRates.price,
      currency: serviceRates.currency,
    })
    .from(serviceRates)
    .where(
      and(
        eq(serviceRates.tenantId, tenantId),
        eq(serviceRates.serviceId, serviceId),
        isNull(serviceRates.archivedAt),
      ),
    )
    .orderBy(serviceRates.createdAt);
}

/**
 * La tarifa con la que se reserva. Si el servicio tiene una sola activa no
 * hace falta elegirla; con varias, sí: adivinar cuál quería la recepcionista
 * sería cobrar algo que nadie eligió.
 */
async function elegirTarifa(
  tx: Tx,
  tenantId: string,
  servicio: { id: string; name: string },
  rateId: string | undefined,
): Promise<{ ok: true; tarifa: TarifaFila } | { ok: false; error: string }> {
  const activas = await tarifasActivas(tx, tenantId, servicio.id);
  if (rateId) {
    const tarifa = activas.find((t) => t.id === rateId);
    return tarifa
      ? { ok: true, tarifa }
      : { ok: false, error: "Esa tarifa ya no está disponible. Elige otra." };
  }
  if (activas.length === 1) return { ok: true, tarifa: activas[0] };
  if (activas.length === 0) {
    return {
      ok: false,
      error: `"${servicio.name}" no tiene tarifas. Agrégale una en Servicios › Recursos.`,
    };
  }
  return { ok: false, error: "Elige una tarifa." };
}

/**
 * Deja al servicio con tarifas de su grano: archiva las que no corresponden
 * (un "por hora" en un servicio que pasó a reservarse por fechas) y, si no
 * queda ninguna, crea la de siempre con el precio del servicio. Solo se llama
 * al cambiar el grano, que exige que el servicio no tenga reservas.
 */
async function asegurarTarifas(
  tx: Tx,
  tenantId: string,
  userId: string,
  servicio: { id: string; price: string; currency: string },
  grano: Unidad,
): Promise<void> {
  const activas = await tarifasActivas(tx, tenantId, servicio.id);
  const sobran = activas.filter((t) => !TARIFAS_DEL_GRANO[grano].includes(t.unit));
  for (const t of sobran) {
    await tx
      .update(serviceRates)
      .set({ archivedAt: new Date() })
      .where(and(eq(serviceRates.id, t.id), eq(serviceRates.tenantId, tenantId)));
  }
  if (activas.length > sobran.length) return;

  const base = tarifaBase(grano);
  await tx.insert(serviceRates).values({
    id: uuidv7(),
    tenantId,
    serviceId: servicio.id,
    unit: base.unit,
    price: normalizeMoney(servicio.price),
    currency: servicio.currency,
    createdBy: userId,
  });
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
  /** Con una sola tarifa activa se puede omitir. Ver `elegirTarifa()`. */
  rateId: z.uuid("Elige una tarifa").optional(),
  rango: rangoSchema,
  holderName: z.string().trim().min(1, "Escribe a nombre de quién va").max(200),
  /** Cuántas personas o cupos ocupa. Por defecto, una. */
  personas: z.number().int("Las personas van en números enteros").min(1, "Al menos una persona").optional(),
  holderDocument: z.string().trim().max(50).optional(),
  holderPhone: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(1000).optional(),
  /**
   * Columnas personalizadas de la reserva, por la clave inmutable del campo.
   * Se validan contra `field_config` (entity = 'booking'), no contra un
   * esquema fijo.
   */
  custom: z.record(z.string(), z.unknown()).optional(),
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
      // "Disponible para vender" apagado: lo mismo que en las ventas, no se
      // ofrece de nuevo. Lo que ya estaba reservado sigue su curso (llegada,
      // cobros, salida); esto solo cierra la puerta a reservas nuevas.
      if (!servicio.isActive) {
        return {
          ok: false as const,
          error: `"${servicio.name}" no está disponible para vender. Actívalo en Servicios para aceptar reservas.`,
        };
      }
      if (!servicio.bookingUnit) {
        return {
          ok: false as const,
          error: `"${servicio.name}" no se reserva. Actívalo en Servicios › Recursos.`,
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

      // Que el grupo quepa. En un compartido, además, que queden cupos: eso lo
      // decide el trigger con la fila del recurso bloqueada, porque aquí
      // contar "quedan 2" y después insertar tiene el hueco de siempre.
      const personas = input.personas ?? 1;
      if (personas > recurso.capacity) {
        return {
          ok: false as const,
          error: servicio.bookingShared
            ? `"${recurso.name}" tiene ${recurso.capacity} cupos en total.`
            : `"${recurso.name}" admite hasta ${recurso.capacity} ${recurso.capacity === 1 ? "persona" : "personas"}.`,
        };
      }

      const elegida = await elegirTarifa(tx, tenantId, servicio, input.rateId);
      if (!elegida.ok) return { ok: false as const, error: elegida.error };
      const tarifa = elegida.tarifa;

      const unidades = cantidad(input.rango as Rango, tarifa);
      if (!unidades.ok) return { ok: false as const, error: unidades.error };

      if (input.rango.unidad === "hora") {
        const turno = await validarTurno(tx, tenantId, servicio, input.rango);
        if (!turno.ok) return { ok: false as const, error: turno.error };
      }

      const custom = await validateCustomIn(tx, tenantId, "booking", input.custom);
      if (!custom.ok) return { ok: false as const, error: custom.error };

      // La zona del negocio sale de la base, no de la sesión ni del servidor:
      // es la única fuente que no puede estar desactualizada.
      const [{ timezone }] = await tx
        .select({ timezone: tenants.timezone })
        .from(tenants)
        .where(eq(tenants.id, tenantId));

      // Snapshot de la tarifa: si mañana sube, o se archiva, esta reserva no
      // cambia. La cantidad también se guarda (ver bookings.qty).
      const unitPrice = normalizeMoney(tarifa.price);
      const id = uuidv7();

      await tx.insert(bookings).values({
        id,
        tenantId,
        serviceId: servicio.id,
        resourceId: recurso.id,
        period: periodoSql(input.rango as Rango, timezone),
        partySize: personas,
        // Copiados del servicio, como el precio: si mañana el tour pasa a
        // cobrarse por grupo, esta reserva conserva cómo se calculó.
        shared: servicio.bookingShared,
        perPerson: servicio.bookingPerPerson,
        unitPrice,
        currency: tarifa.currency,
        rateId: tarifa.id,
        rateUnit: tarifa.unit,
        rateMinutes: tarifa.minutes,
        qty: unidades.qty,
        holderName: input.holderName,
        holderDocument: input.holderDocument || null,
        holderPhone: input.holderPhone || null,
        notes: input.notes || null,
        custom: custom.values,
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
          tarifa: nombreTarifa(tarifa),
          rango: input.rango,
          titular: input.holderName,
          personas,
          ...(Object.keys(custom.values).length > 0 ? { custom: custom.values } : {}),
        },
      });

      return {
        ok: true as const,
        id,
        qty: unidades.qty,
        unitPrice,
        total: totalReserva({
          qty: unidades.qty,
          partySize: personas,
          perPerson: servicio.bookingPerPerson,
          unitPrice,
        }),
        currency: tarifa.currency,
      };
    });
  } catch (error) {
    const code = pgCode(error);
    // 23P01 = exclusion_violation: el EXCLUDE de `bookings`. Es el caso
    // esperado, no un fallo: alguien ya tiene ese recurso en esas fechas.
    if (code === "23P01") {
      return {
        ok: false,
        error: "Ese recurso ya tiene una reserva que se cruza con esas fechas.",
      };
    }
    // RS001: el trigger de capacidad. Otra vez lo esperado, no un fallo.
    if (code === "RS001") {
      return {
        ok: false,
        error: "No quedan cupos suficientes en ese horario.",
      };
    }
    if (code === "RS002") {
      return { ok: false, error: "El grupo no cabe en ese recurso." };
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
 * Cómo se reserva un servicio: unidad, si es compartido y si cobra por persona.
 *
 * La UNIDAD y el MODO (exclusivo o compartido) solo cambian si el servicio no
 * tiene reservas, de ningún estado:
 * - pasar de "por noche" a "por hora" dejaría reservas cuya cantidad ya no
 *   significa lo mismo;
 * - pasar de exclusivo a compartido mezclaría en un mismo recurso reservas
 *   que no se pueden solapar con otras que sí, y ninguna de las dos garantías
 *   cubriría el cruce entre ellas.
 *
 * El COBRO por persona sí se puede cambiar en cualquier momento: cada reserva
 * guardó cómo se calculaba la suya.
 */
export async function configureServiceBooking(
  { tenantId, userId }: ActorContext,
  input: {
    serviceId: string;
    unidad: "noche" | "hora" | null;
    compartido?: boolean;
    porPersona?: boolean;
  },
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

      // Sin unidad, el servicio no se reserva: compartido y por persona no
      // significan nada (y la base lo exige con un CHECK).
      const unidad = input.unidad;
      const compartido = unidad ? (input.compartido ?? servicio.bookingShared) : false;
      const porPersona = unidad ? (input.porPersona ?? servicio.bookingPerPerson) : false;

      const cambiaForma =
        unidad !== servicio.bookingUnit || compartido !== servicio.bookingShared;
      const cambiaCobro = porPersona !== servicio.bookingPerPerson;
      if (!cambiaForma && !cambiaCobro) return { ok: true as const };

      // Los turnos son de servicios por hora: dejarlos colgando de uno por
      // noche sería configuración que no hace nada y confunde al volver.
      if (servicio.bookingUnit === "hora" && unidad !== "hora") {
        const turnos = await turnosDe(tx, tenantId, servicio.id);
        if (turnos.length > 0) {
          return {
            ok: false as const,
            error: `"${servicio.name}" tiene horarios fijos. Quítalos primero para cambiar cómo se reserva.`,
          };
        }
      }

      if (cambiaForma) {
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
      }

      await tx
        .update(services)
        .set({
          bookingUnit: unidad,
          bookingShared: compartido,
          bookingPerPerson: porPersona,
        })
        .where(and(eq(services.id, servicio.id), eq(services.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "services",
        entityId: servicio.id,
        action: "update",
        actorId: userId,
        diff: {
          bookingUnit: { from: servicio.bookingUnit, to: unidad },
          bookingShared: { from: servicio.bookingShared, to: compartido },
          bookingPerPerson: { from: servicio.bookingPerPerson, to: porPersona },
        },
      });

      // Recién reservable, o con otro grano: sin tarifas no se podría
      // reservar, y las del grano anterior no sirven.
      if (unidad && unidad !== servicio.bookingUnit) {
        await asegurarTarifas(tx, tenantId, userId, servicio, unidad);
      }

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo guardar el cambio." };
  }
}

const resourceLabelSchema = z.object({
  serviceId: z.uuid(),
  /** Vacio = volver al generico. */
  label: z.string().trim().max(40, "Usa un nombre corto, como Habitación o Cancha"),
});

/**
 * Como se llaman los recursos de un servicio en pantalla: "Habitación",
 * "Cancha", "Cabaña". Solo cambia lo que se lee; no toca reservas ni recursos,
 * así que se puede cambiar aunque el servicio ya tenga reservas.
 */
export async function setResourceLabel(
  { tenantId, userId }: ActorContext,
  raw: z.infer<typeof resourceLabelSchema>,
): Promise<Result> {
  const parsed = resourceLabelSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nombre inválido." };
  }
  const label = parsed.data.label || null;

  try {
    return await withTenant(tenantId, async (tx) => {
      const [servicio] = await tx
        .select({ id: services.id, resourceLabel: services.resourceLabel })
        .from(services)
        .where(
          and(
            eq(services.id, parsed.data.serviceId),
            eq(services.tenantId, tenantId),
            isNull(services.deletedAt),
          ),
        );
      if (!servicio) return { ok: false as const, error: "Ese servicio ya no existe." };
      if (servicio.resourceLabel === label) return { ok: true as const };

      await tx
        .update(services)
        .set({ resourceLabel: label })
        .where(and(eq(services.id, servicio.id), eq(services.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "services",
        entityId: servicio.id,
        action: "update",
        actorId: userId,
        diff: { resourceLabel: { from: servicio.resourceLabel, to: label } },
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo guardar el nombre." };
  }
}

const RATE_UNITS = ["hora", "bloque", "dia", "noche", "semana", "mes"] as const satisfies readonly RateUnit[];

const precioSchema = z.string().refine(isMoney, "Precio inválido");
const monedaSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isKnownCurrency, "Moneda no disponible");
const nombreTarifaSchema = z
  .string()
  .trim()
  .max(60, "Usa un nombre corto, como Temporada alta")
  .optional();

const addRateSchema = z.object({
  serviceId: z.uuid(),
  unit: z.enum(RATE_UNITS),
  /** Solo para `bloque`. */
  minutes: z.number().int().optional(),
  label: nombreTarifaSchema,
  price: precioSchema,
  currency: monedaSchema,
});

/**
 * Agrega una tarifa a un servicio reservable: "por semana, 230 USD", "tanda
 * de 4 horas, 35 USD". Tiene que ser del grano del servicio.
 */
export async function addRate(
  { tenantId, userId }: ActorContext,
  raw: z.infer<typeof addRateSchema>,
): Promise<Result<{ id: string }>> {
  const parsed = addRateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  const minutes = input.unit === "bloque" ? (input.minutes ?? 0) : null;
  if (minutes !== null && (minutes < 30 || minutes > 1440 || minutes % 30 !== 0)) {
    return {
      ok: false,
      error: "Un bloque dura de 30 minutos a 24 horas, en tramos de 30 minutos.",
    };
  }

  try {
    return await withTenant(tenantId, async (tx) => {
      const [servicio] = await tx
        .select({ id: services.id, name: services.name, grano: services.bookingUnit })
        .from(services)
        .where(
          and(
            eq(services.id, input.serviceId),
            eq(services.tenantId, tenantId),
            isNull(services.deletedAt),
          ),
        );
      if (!servicio) return { ok: false as const, error: "Ese servicio ya no existe." };
      if (!servicio.grano) {
        return { ok: false as const, error: `"${servicio.name}" no se reserva.` };
      }
      if (!TARIFAS_DEL_GRANO[servicio.grano].includes(input.unit)) {
        return {
          ok: false as const,
          error:
            servicio.grano === "hora"
              ? `"${servicio.name}" se reserva por horas: sus tarifas van por hora o por bloques.`
              : `"${servicio.name}" se reserva por fechas: sus tarifas van por día, noche, semana o mes.`,
        };
      }

      const id = uuidv7();
      const label = input.label || null;
      await tx.insert(serviceRates).values({
        id,
        tenantId,
        serviceId: servicio.id,
        unit: input.unit,
        minutes,
        label,
        price: normalizeMoney(input.price),
        currency: input.currency,
        createdBy: userId,
      });

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "service_rates",
        entityId: id,
        action: "create",
        actorId: userId,
        diff: {
          servicio: servicio.name,
          tarifa: nombreTarifa({ unit: input.unit, minutes, label }),
          precio: normalizeMoney(input.price),
          moneda: input.currency,
        },
      });

      return { ok: true as const, id };
    });
  } catch {
    return { ok: false, error: "No se pudo guardar la tarifa." };
  }
}

const updateRateSchema = z.object({
  id: z.uuid(),
  label: nombreTarifaSchema,
  price: precioSchema,
  currency: monedaSchema,
});

/**
 * Cambia el precio, la moneda o el nombre de una tarifa. Solo afecta a las
 * reservas nuevas: las hechas copiaron los suyos. La unidad y los minutos no
 * se cambian; para eso se archiva y se crea otra.
 */
export async function updateRate(
  { tenantId, userId }: ActorContext,
  raw: z.infer<typeof updateRateSchema>,
): Promise<Result> {
  const parsed = updateRateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  try {
    return await withTenant(tenantId, async (tx) => {
      const [antes] = await tx
        .select()
        .from(serviceRates)
        .where(and(eq(serviceRates.id, input.id), eq(serviceRates.tenantId, tenantId)));
      if (!antes || antes.archivedAt) {
        return { ok: false as const, error: "Esa tarifa ya no existe." };
      }

      const despues = {
        label: input.label || null,
        price: normalizeMoney(input.price),
        currency: input.currency,
      };
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      if (despues.label !== antes.label) diff.nombre = { from: antes.label, to: despues.label };
      if (compareMoney(despues.price, antes.price) !== 0) {
        diff.precio = { from: normalizeMoney(antes.price), to: despues.price };
      }
      if (despues.currency !== antes.currency) {
        diff.moneda = { from: antes.currency, to: despues.currency };
      }
      if (Object.keys(diff).length === 0) return { ok: true as const };

      await tx
        .update(serviceRates)
        .set(despues)
        .where(and(eq(serviceRates.id, antes.id), eq(serviceRates.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "service_rates",
        entityId: antes.id,
        action: "update",
        actorId: userId,
        diff,
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo guardar la tarifa." };
  }
}

/**
 * Archiva una tarifa: deja de ofrecerse, y las reservas que la usaron siguen
 * igual. Un servicio reservable no se queda sin tarifas: no se podría
 * reservar, y no diría por qué.
 */
export async function archiveRate(
  { tenantId, userId }: ActorContext,
  raw: { id: string },
): Promise<Result> {
  const parsed = z.object({ id: z.uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Tarifa inválida." };

  try {
    return await withTenant(tenantId, async (tx) => {
      const [tarifa] = await tx
        .select({
          id: serviceRates.id,
          serviceId: serviceRates.serviceId,
          unit: serviceRates.unit,
          minutes: serviceRates.minutes,
          label: serviceRates.label,
          archivedAt: serviceRates.archivedAt,
          servicio: services.name,
          grano: services.bookingUnit,
        })
        .from(serviceRates)
        .innerJoin(
          services,
          and(eq(services.id, serviceRates.serviceId), eq(services.tenantId, serviceRates.tenantId)),
        )
        .where(and(eq(serviceRates.id, parsed.data.id), eq(serviceRates.tenantId, tenantId)))
        // La fila del servicio: dos archivos simultáneos de sus dos últimas
        // tarifas no pueden pasar los dos el "queda otra".
        .for("update", { of: services });
      if (!tarifa) return { ok: false as const, error: "Esa tarifa ya no existe." };
      if (tarifa.archivedAt) return { ok: true as const };

      const otras = (await tarifasActivas(tx, tenantId, tarifa.serviceId)).filter(
        (t) => t.id !== tarifa.id,
      );
      if (tarifa.grano && otras.length === 0) {
        return {
          ok: false as const,
          error: `Es la única tarifa de "${tarifa.servicio}". Agrega otra antes de archivarla.`,
        };
      }

      await tx
        .update(serviceRates)
        .set({ archivedAt: new Date() })
        .where(and(eq(serviceRates.id, tarifa.id), eq(serviceRates.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "service_rates",
        entityId: tarifa.id,
        action: "delete",
        actorId: userId,
        diff: { servicio: tarifa.servicio, tarifa: nombreTarifa(tarifa) },
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo archivar la tarifa." };
  }
}

const capacidadSchema = z
  .number()
  .int("La capacidad va en números enteros")
  .min(1, "La capacidad tiene que ser al menos 1")
  .max(10000);

const resourceSchema = z.object({
  serviceId: z.uuid(),
  name: z.string().trim().min(1, "Escribe un nombre, como 101 o Cancha 2").max(100),
  notes: z.string().trim().max(500).optional(),
  capacity: capacidadSchema.optional(),
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
        capacity: input.capacity ?? 1,
      });

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "resources",
        entityId: id,
        action: "create",
        actorId: userId,
        diff: { name: input.name, servicio: servicio.name, capacidad: input.capacity ?? 1 },
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
 * Solo si no tiene reservas pendientes (ver `contarPendientes`): archivar la
 * 101 con huéspedes llegando la semana que viene, o con uno adentro, los
 * dejaría con una reserva de una habitación que ya no aparece en ninguna
 * pantalla.
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

      const n = await contarPendientes(tx, tenantId, { resourceId: recurso.id });
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
  serviceId: string;
  resourceId: string;
  unidad: "noche" | "hora";
  /** La tarifa congelada al reservar. */
  tarifa: Tarifa;
  qty: string;
  shared: boolean;
  perPerson: boolean;
  partySize: number;
  currency: string;
  unitPrice: string;
  holderName: string;
  holderDocument: string | null;
  holderPhone: string | null;
  notes: string | null;
  custom: CustomValues;
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
      rateUnit: bookings.rateUnit,
      rateMinutes: bookings.rateMinutes,
      qty: bookings.qty,
      partySize: bookings.partySize,
      perPerson: bookings.perPerson,
      shared: bookings.shared,
      holderName: bookings.holderName,
      holderDocument: bookings.holderDocument,
      holderPhone: bookings.holderPhone,
      notes: bookings.notes,
      custom: bookings.custom,
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
  // La cantidad se guardó al reservar con la tarifa de entonces; no se vuelve
  // a derivar del período.
  const total = totalReserva({
    qty: b.qty,
    partySize: b.partySize,
    perPerson: b.perPerson,
    unitPrice: b.unitPrice,
  });

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
    serviceId: b.serviceId,
    resourceId: b.resourceId,
    unidad,
    tarifa: { unit: b.rateUnit, minutes: b.rateMinutes },
    qty: sinCeros(b.qty),
    shared: b.shared,
    perPerson: b.perPerson,
    partySize: b.partySize,
    currency: b.currency,
    unitPrice: b.unitPrice,
    holderName: b.holderName,
    holderDocument: b.holderDocument,
    holderPhone: b.holderPhone,
    notes: b.notes,
    custom: b.custom ?? {},
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

/**
 * Cambia la capacidad de un recurso.
 *
 * Subirla siempre se puede. Bajarla, solo hasta lo que ya está comprometido
 * en reservas que no terminaron: si la clase del martes ya tiene 12
 * inscritos, no puede pasar a tener 10 cupos y dejar a dos sin lugar en
 * silencio.
 *
 * Bloquea la fila del recurso, igual que el trigger que valida las reservas
 * compartidas: así una inscripción no puede colarse entre "cuento los
 * comprometidos" y "bajo la capacidad".
 */
export async function updateResourceCapacity(
  { tenantId, userId }: ActorContext,
  input: { id: string; capacity: number },
): Promise<Result> {
  const cap = capacidadSchema.safeParse(input.capacity);
  if (!cap.success) return { ok: false, error: cap.error.issues[0].message };
  const nueva = cap.data;

  try {
    return await withTenant(tenantId, async (tx) => {
      const [recurso] = await tx
        .select({
          id: resources.id,
          name: resources.name,
          capacity: resources.capacity,
          shared: services.bookingShared,
        })
        .from(resources)
        .innerJoin(
          services,
          and(eq(services.id, resources.serviceId), eq(services.tenantId, resources.tenantId)),
        )
        .where(and(eq(resources.id, input.id), eq(resources.tenantId, tenantId)))
        .for("update", { of: resources });

      if (!recurso) return { ok: false as const, error: "No se encontró ese recurso." };
      if (recurso.capacity === nueva) return { ok: true as const };

      if (nueva < recurso.capacity) {
        const pendientes = await tx
          .select({
            desde: sql<number>`extract(epoch from lower(${bookings.period}))`,
            hasta: sql<number>`extract(epoch from upper(${bookings.period}))`,
            personas: bookings.partySize,
          })
          .from(bookings)
          .where(
            and(
              eq(bookings.tenantId, tenantId),
              eq(bookings.resourceId, recurso.id),
              ne(bookings.status, "cancelada"),
              ne(bookings.status, "no_show"),
              sql`upper(${bookings.period}) > now()`,
            ),
          );

        const comprometido = recurso.shared
          ? picoDeOcupacion(pendientes)
          : Math.max(0, ...pendientes.map((p) => p.personas));

        if (nueva < comprometido) {
          return {
            ok: false as const,
            error: recurso.shared
              ? `"${recurso.name}" ya tiene momentos con ${comprometido} cupos ocupados. No se puede bajar a ${nueva}.`
              : `"${recurso.name}" tiene una reserva para ${comprometido} personas. No se puede bajar a ${nueva}.`,
          };
        }
      }

      await tx
        .update(resources)
        .set({ capacity: nueva })
        .where(and(eq(resources.id, recurso.id), eq(resources.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "resources",
        entityId: recurso.id,
        action: "update",
        actorId: userId,
        diff: { capacity: { from: recurso.capacity, to: nueva } },
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo cambiar la capacidad." };
  }
}

/**
 * El pico de ocupación de un conjunto de reservas: la mayor cantidad de
 * personas a la vez. Mismo criterio que el trigger: la ocupación solo sube
 * donde empieza una reserva, así que basta mirar cada inicio.
 */
export function picoDeOcupacion(
  reservas: { desde: number; hasta: number; personas: number }[],
): number {
  let pico = 0;
  for (const punto of reservas) {
    let ocupado = 0;
    for (const r of reservas) {
      // Semiabierto: [desde, hasta).
      if (Number(r.desde) <= Number(punto.desde) && Number(punto.desde) < Number(r.hasta)) {
        ocupado += r.personas;
      }
    }
    pico = Math.max(pico, ocupado);
  }
  return pico;
}

// ---------------------------------------------------------------------------
// Modificar una reserva
// ---------------------------------------------------------------------------

/**
 * Igualdad de dos valores personalizados. Son escalares o listas ya ordenadas
 * por `validateCustomValues`, así que comparar su JSON basta.
 */
function mismoValor(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const updateSchema = z.object({
  id: z.uuid(),
  resourceId: z.uuid("Elige el recurso"),
  rango: rangoSchema,
  personas: z
    .number()
    .int("Las personas van en números enteros")
    .min(1, "Al menos una persona")
    .optional(),
  holderName: z.string().trim().min(1, "Escribe a nombre de quién va").max(200),
  holderDocument: z.string().trim().max(50).optional(),
  holderPhone: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(1000).optional(),
  /**
   * Ausente = no se tocan. Presente = reemplaza el conjunto entero, igual que
   * en productos: mezclar dejaría para siempre las claves de campos
   * archivados. Los ocultos conservan su valor (ver `validateCustomIn`).
   */
  custom: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateBookingInput = z.infer<typeof updateSchema>;

export type UpdateBookingResult =
  | { ok: true; total: string; saldo: string }
  | { ok: false; error: string };

/**
 * Modifica una reserva: recurso, fechas, personas, datos del titular y
 * columnas personalizadas.
 *
 * Solo una reservada o en curso. Una en curso no puede mover su entrada: el
 * huésped ya llegó, y esa hora quedó registrada. Sí puede extender o acortar
 * la salida, cambiar de habitación o corregir cuántos son.
 *
 * El SERVICIO no cambia: pasar de Doble a Suite cambia el precio, la unidad y
 * el modo, y eso es otra reserva (se cancela esta y se hace la nueva).
 *
 * El precio por unidad queda CONGELADO, como en una venta corregida: cambiar
 * "eran 2 noches, son 3" no revalúa la estadía a la tarifa de hoy. Lo que se
 * recalcula es la cantidad.
 *
 * La doble reserva y los cupos los sigue garantizando la base al modificar:
 * el EXCLUDE y el trigger de capacidad también corren en UPDATE, y ninguno se
 * compara con la propia reserva.
 *
 * Si el nuevo total queda por debajo de lo ya cobrado, se rechaza: eso es
 * decidir una devolución, y se hace anulando un cobro, no en silencio.
 */
export async function updateBooking(
  { tenantId, userId }: ActorContext,
  raw: UpdateBookingInput,
): Promise<UpdateBookingResult> {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;
  const rango = input.rango as Rango;

  try {
    return await withTenant(tenantId, async (tx) => {
      // Bloqueada: un cobro simultáneo no puede colarse entre "leo lo
      // pagado" y "cambio el total".
      const r = await cargarReserva(tx, tenantId, input.id);
      if (!r) return { ok: false as const, error: "No se encontró esa reserva." };

      if (r.status !== "reservada" && r.status !== "en_curso") {
        return {
          ok: false as const,
          error: "Solo se modifica una reserva pendiente o en curso.",
        };
      }
      if (rango.unidad !== r.unidad) {
        return { ok: false as const, error: `Esta reserva va por ${r.unidad}.` };
      }

      // Con la tarifa congelada: modificar no cambia de "por noche" a "por
      // semana"; eso es otro precio, y se hace cancelando y reservando.
      const unidades = cantidad(rango, r.tarifa);
      if (!unidades.ok) return { ok: false as const, error: unidades.error };

      const nuevos = bordesLocales(rango);

      // El horario solo se exige si cambian las horas. Una reserva hecha con
      // el horario de antes tiene que poder corregir su teléfono aunque su
      // turno ya no exista: cambiar el horario no invalida lo ya reservado.
      const cambiaRango = nuevos.inicio !== r.inicio || nuevos.fin !== r.fin;
      if (rango.unidad === "hora" && cambiaRango) {
        const [servicio] = await tx
          .select({ id: services.id, name: services.name, scheduleMode: services.scheduleMode })
          .from(services)
          .where(and(eq(services.id, r.serviceId), eq(services.tenantId, tenantId)));
        const turno = await validarTurno(tx, tenantId, servicio, rango);
        if (!turno.ok) return { ok: false as const, error: turno.error };
      }

      if (r.status === "en_curso" && nuevos.inicio !== r.inicio) {
        return {
          ok: false as const,
          error:
            "Ya llegó: la entrada no se puede mover. Sí se puede cambiar la salida, el recurso y las personas.",
        };
      }

      const [recurso] = await tx
        .select()
        .from(resources)
        .where(
          and(
            eq(resources.id, input.resourceId),
            eq(resources.tenantId, tenantId),
            eq(resources.serviceId, r.serviceId),
          ),
        );
      if (!recurso) {
        return {
          ok: false as const,
          error: "Ese recurso no es del mismo servicio. Para cambiar de servicio, cancela y crea otra reserva.",
        };
      }
      // Quedarse en un recurso que se archivó después se admite; mudarse a
      // uno archivado, no.
      if (recurso.archivedAt && recurso.id !== r.resourceId) {
        return { ok: false as const, error: `"${recurso.name}" está archivado.` };
      }

      const personas = input.personas ?? r.partySize;
      if (personas > recurso.capacity) {
        return {
          ok: false as const,
          error: r.shared
            ? `"${recurso.name}" tiene ${recurso.capacity} cupos en total.`
            : `"${recurso.name}" admite hasta ${recurso.capacity} ${recurso.capacity === 1 ? "persona" : "personas"}.`,
        };
      }

      const total = totalReserva({
        qty: unidades.qty,
        partySize: personas,
        perPerson: r.perPerson,
        unitPrice: r.unitPrice,
      });
      if (compareMoney(total, r.pagado) < 0) {
        return {
          ok: false as const,
          error: `Con este cambio el total queda en ${total} ${r.currency}, y ya se cobraron ${r.pagado}. Para devolver la diferencia, anula un cobro en Finanzas y vuelve a cobrar lo que corresponda.`,
        };
      }

      // Lo que cambió, para la auditoría.
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      if (nuevos.inicio !== r.inicio || nuevos.fin !== r.fin) {
        diff.rango = { from: { inicio: r.inicio, fin: r.fin }, to: nuevos };
      }
      if (recurso.id !== r.resourceId) {
        diff.recurso = { from: r.resourceName, to: recurso.name };
      }
      if (personas !== r.partySize) diff.personas = { from: r.partySize, to: personas };
      const holderDocument = input.holderDocument || null;
      const holderPhone = input.holderPhone || null;
      const notes = input.notes || null;
      if (input.holderName !== r.holderName) {
        diff.titular = { from: r.holderName, to: input.holderName };
      }
      if (holderDocument !== r.holderDocument) {
        diff.documento = { from: r.holderDocument, to: holderDocument };
      }
      if (holderPhone !== r.holderPhone) diff.telefono = { from: r.holderPhone, to: holderPhone };
      if (notes !== r.notes) diff.notas = { from: r.notes, to: notes };

      let custom = r.custom;
      if (input.custom !== undefined) {
        const validado = await validateCustomIn(tx, tenantId, "booking", input.custom, r.custom);
        if (!validado.ok) return { ok: false as const, error: validado.error };
        custom = validado.values;
        for (const key of new Set([...Object.keys(r.custom), ...Object.keys(custom)])) {
          if (!mismoValor(r.custom[key], custom[key])) {
            diff[`custom.${key}`] = { from: r.custom[key] ?? null, to: custom[key] ?? null };
          }
        }
      }
      if (total !== r.total) diff.total = { from: r.total, to: total };

      if (Object.keys(diff).length === 0) {
        return { ok: true as const, total, saldo: r.saldo };
      }

      await tx
        .update(bookings)
        .set({
          resourceId: recurso.id,
          period: periodoSql(rango, r.timezone),
          qty: unidades.qty,
          partySize: personas,
          holderName: input.holderName,
          holderDocument,
          holderPhone,
          notes,
          custom,
        })
        .where(and(eq(bookings.id, r.id), eq(bookings.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "bookings",
        entityId: r.id,
        action: "update",
        actorId: userId,
        diff,
      });

      return { ok: true as const, total, saldo: subtractMoney(total, r.pagado) };
    });
  } catch (error) {
    const code = pgCode(error);
    if (code === "23P01") {
      return {
        ok: false,
        error: "Ese recurso ya tiene otra reserva que se cruza con esas fechas.",
      };
    }
    if (code === "RS001") {
      return { ok: false, error: "No quedan cupos suficientes en ese horario." };
    }
    if (code === "RS002") {
      return { ok: false, error: "El grupo no cabe en ese recurso." };
    }
    return { ok: false, error: "No se pudo guardar el cambio." };
  }
}

// ---------------------------------------------------------------------------
// Publicar y quitar turnos
// ---------------------------------------------------------------------------

const HORA_EN_PUNTO = /^([01]\d|2[0-3]):(00|30)$/;

const scheduleSchema = z.object({
  serviceId: z.uuid(),
  /** ISO, 1 = lunes. Se crea un turno por cada día elegido. */
  dias: z
    .array(z.number().int().min(1).max(7))
    .min(1, "Elige al menos un día"),
  inicio: z.string().regex(HORA_EN_PUNTO, "La hora de inicio va en punto o y media, como 18:00 o 18:30"),
  fin: z.string().regex(HORA_EN_PUNTO, "La hora de fin va en punto o y media, como 19:00 o 19:30"),
});

/**
 * Publica un turno en uno o varios días: "martes y jueves, 18:00 a 19:00".
 *
 * Todo o nada: si el turno del jueves se cruza con otro, tampoco se crea el
 * del martes, para no dejar el horario a medias sin que se note.
 */
export async function addSchedule(
  { tenantId, userId }: ActorContext,
  raw: z.infer<typeof scheduleSchema>,
): Promise<Result<{ creados: number }>> {
  const parsed = scheduleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  if (input.fin <= input.inicio) {
    return {
      ok: false,
      error: "La hora de fin tiene que ser después de la de inicio, el mismo día.",
    };
  }
  const dias = [...new Set(input.dias)].sort();

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
      if (servicio.bookingUnit !== "hora") {
        return {
          ok: false as const,
          error: "Los horarios fijos son para servicios que se reservan por hora.",
        };
      }

      await tx.insert(serviceSchedules).values(
        dias.map((weekday) => ({
          id: uuidv7(),
          tenantId,
          serviceId: servicio.id,
          weekday,
          startTime: input.inicio,
          endTime: input.fin,
          createdBy: userId,
        })),
      );

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "services",
        entityId: servicio.id,
        action: "update",
        actorId: userId,
        diff: { turnoAgregado: { dias, inicio: input.inicio, fin: input.fin } },
      });

      return { ok: true as const, creados: dias.length };
    });
  } catch (error) {
    // 23P01: el EXCLUDE de turnos solapados el mismo día.
    if (pgCode(error) === "23P01") {
      return {
        ok: false,
        error: "Ese turno se cruza con otro del mismo día. Revisa el horario de esos días.",
      };
    }
    return { ok: false, error: "No se pudo guardar el turno." };
  }
}

/**
 * Qué son los horarios de un servicio: la franja en la que se atiende o
 * turnos exactos. No toca ninguna reserva (nada referencia un horario) y no
 * cambia los horarios publicados: la misma fila "martes de 08:00 a 20:00"
 * pasa a leerse de otra forma.
 */
export async function setScheduleMode(
  { tenantId, userId }: ActorContext,
  raw: { serviceId: string; modo: ModoHorario },
): Promise<Result> {
  const parsed = z
    .object({ serviceId: z.uuid(), modo: z.enum(["atencion", "turnos"]) })
    .safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { serviceId, modo } = parsed.data;

  try {
    return await withTenant(tenantId, async (tx) => {
      const [servicio] = await tx
        .select({ id: services.id, name: services.name, antes: services.scheduleMode })
        .from(services)
        .where(
          and(eq(services.id, serviceId), eq(services.tenantId, tenantId), isNull(services.deletedAt)),
        );
      if (!servicio) return { ok: false as const, error: "Ese servicio ya no existe." };
      if (servicio.antes === modo) return { ok: true as const };

      await tx
        .update(services)
        .set({ scheduleMode: modo })
        .where(and(eq(services.id, servicio.id), eq(services.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "services",
        entityId: servicio.id,
        action: "update",
        actorId: userId,
        diff: { scheduleMode: { from: servicio.antes, to: modo } },
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo guardar el cambio." };
  }
}

/**
 * Quita un turno. No toca ninguna reserva: las hechas en ese turno siguen
 * como estaban, solo que ya no se ofrecen nuevas.
 */
export async function removeSchedule(
  { tenantId, userId }: ActorContext,
  input: { id: string },
): Promise<Result> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const [turno] = await tx
        .select()
        .from(serviceSchedules)
        .where(and(eq(serviceSchedules.id, input.id), eq(serviceSchedules.tenantId, tenantId)));
      if (!turno) return { ok: false as const, error: "No se encontró ese turno." };

      await tx
        .delete(serviceSchedules)
        .where(and(eq(serviceSchedules.id, turno.id), eq(serviceSchedules.tenantId, tenantId)));

      await tx.insert(auditLog).values({
        id: uuidv7(),
        tenantId,
        entity: "services",
        entityId: turno.serviceId,
        action: "update",
        actorId: userId,
        diff: {
          turnoQuitado: {
            dia: turno.weekday,
            inicio: hhmm(turno.startTime),
            fin: hhmm(turno.endTime),
          },
        },
      });

      return { ok: true as const };
    });
  } catch {
    return { ok: false, error: "No se pudo quitar el turno." };
  }
}
