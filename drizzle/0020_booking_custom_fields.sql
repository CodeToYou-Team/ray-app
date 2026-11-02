-- ---------------------------------------------------------------------------
-- Reservas: columnas personalizadas
-- ---------------------------------------------------------------------------
-- Diseño en docs/plan_arquitectura_v2.md, sección "Reservas", fase 5.
--
-- El mismo mecanismo que productos y servicios: la definición vive en
-- `field_config` (entity = 'booking') y el valor en un JSONB `custom` de la
-- propia reserva, indexado por la clave inmutable del campo. La placa del
-- vehículo o el motivo del viaje son datos de la reserva, no del titular ni del
-- servicio.
--
-- Las reservas no tienen columnas fijas en `field_config`: nombre, documento,
-- teléfono y notas son del formulario y no se renombran desde Ajustes.
--
-- ADD VALUE no se puede usar en la misma transacción que lo agrega; esta
-- migración solo lo agrega.
ALTER TYPE "public"."field_entity" ADD VALUE IF NOT EXISTS 'booking';--> statement-breakpoint

ALTER TABLE "bookings"
  ADD COLUMN "custom" jsonb DEFAULT '{}'::jsonb NOT NULL;
