-- ---------------------------------------------------------------------------
-- Reservas: horario de atención o turnos exactos
-- ---------------------------------------------------------------------------
-- Diseño en docs/plan_arquitectura_v2.md, sección "Reservas", fase 7.
--
-- Los horarios de un servicio por horas (`service_schedules`) significaban
-- una sola cosa: turnos exactos. La clase de 18:00 a 19:00 se reserva entera
-- o no se reserva. Para una cancha eso obliga a publicar 08–09, 08–10,
-- 09–10… todas las combinaciones.
--
-- Ahora cada servicio dice qué son sus horarios:
--   atencion = la franja en la que se atiende: se reserva cualquier tramo
--              que quepa dentro (en medias horas, o en bloques de su tarifa);
--   turnos   = los tramos exactos de siempre: la clase, el tour.
--
-- La tabla de horarios no cambia: un turno y una franja tienen la misma forma
-- (día, inicio, fin), y el EXCLUDE que impide que se pisen vale para ambos.
CREATE TYPE "schedule_mode" AS ENUM ('atencion', 'turnos');--> statement-breakpoint

ALTER TABLE "services"
  ADD COLUMN "schedule_mode" "schedule_mode" DEFAULT 'atencion' NOT NULL;--> statement-breakpoint

-- Los que ya publicaron turnos siguen funcionando como hasta hoy.
UPDATE "services" s
SET "schedule_mode" = 'turnos'
WHERE EXISTS (
  SELECT 1 FROM "service_schedules" h
  WHERE h."tenant_id" = s."tenant_id" AND h."service_id" = s."id"
);
