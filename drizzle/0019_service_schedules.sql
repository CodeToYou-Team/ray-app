-- ---------------------------------------------------------------------------
-- Reservas: horarios fijos (turnos) por servicio
-- ---------------------------------------------------------------------------
-- Diseño en docs/plan_arquitectura_v2.md, sección "Reservas".
--
-- Un servicio por hora puede publicar sus turnos: "yoga, martes y jueves de
-- 18:00 a 19:00". Sin turnos se reserva como hasta ahora, en cualquier tramo
-- de 30 minutos; con al menos uno, solo en ellos.
--
-- Los turnos son del SERVICIO y valen para todos sus recursos: las canchas de
-- pádel comparten sus turnos de hora y media, las salas de yoga su horario.
--
-- Nada referencia un turno: la reserva guarda su rango, no el turno con el que
-- se hizo. Por eso cambiar el horario no invalida ninguna reserva hecha, y un
-- turno se puede borrar sin perder historia (lo que pasó está en `bookings`).
CREATE TABLE "service_schedules" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "service_id" uuid NOT NULL,
  -- ISO: 1 = lunes … 7 = domingo. La semana empieza el lunes, como se lee
  -- en español, y es lo que devuelve `extract(isodow)` de Postgres.
  "weekday" smallint NOT NULL,
  "start_time" time NOT NULL,
  "end_time" time NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "service_schedules_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "service_schedules_service_fk"
    FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id"),

  CONSTRAINT "service_schedules_weekday_range" CHECK ("weekday" BETWEEN 1 AND 7),

  -- El mismo día y sin cruzar la medianoche, como una reserva por hora.
  CONSTRAINT "service_schedules_order" CHECK ("end_time" > "start_time"),

  -- En tramos de 30 minutos, como las reservas por hora: un turno de 18:15
  -- no se podría reservar.
  CONSTRAINT "service_schedules_half_hour" CHECK (
    extract(minute FROM "start_time") IN (0, 30) AND extract(second FROM "start_time") = 0
    AND extract(minute FROM "end_time") IN (0, 30) AND extract(second FROM "end_time") = 0
  ),

  -- Dos turnos del mismo servicio el mismo día no se pisan: "18:00–19:00" y
  -- "18:30–19:30" a la vez dejarían la misma sala ofrecida dos veces. Que se
  -- toquen (19:00–20:00 después de 18:00–19:00) sí se puede.
  --
  -- La hora va como `tsrange` sobre una fecha fija porque Postgres no tiene
  -- rango de horas; la fecha no significa nada, solo ancla el rango.
  CONSTRAINT "service_schedules_no_overlap" EXCLUDE USING gist (
    "tenant_id" WITH =,
    "service_id" WITH =,
    "weekday" WITH =,
    tsrange(DATE '2000-01-01' + "start_time", DATE '2000-01-01' + "end_time", '[)') WITH &&
  )
);--> statement-breakpoint

CREATE INDEX "service_schedules_service_idx"
  ON "service_schedules" ("tenant_id", "service_id");--> statement-breakpoint

ALTER TABLE "service_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Sin UPDATE: cambiar un turno es quitarlo y poner otro. Con DELETE: nada lo
-- referencia, y la historia de lo reservado vive en `bookings`.
CREATE POLICY service_schedules_select ON public.service_schedules
  FOR SELECT TO app_user
  USING (tenant_id = public.current_tenant_id());--> statement-breakpoint
CREATE POLICY service_schedules_insert ON public.service_schedules
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint
CREATE POLICY service_schedules_delete ON public.service_schedules
  FOR DELETE TO app_user
  USING (tenant_id = public.current_tenant_id());
