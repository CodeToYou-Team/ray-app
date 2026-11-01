-- ---------------------------------------------------------------------------
-- Reservas, fase 1: recursos, reservas y la garantía contra la doble reserva
-- ---------------------------------------------------------------------------
-- Diseño completo en docs/plan_arquitectura_v2.md, sección "Reservas".
--
-- Lo genérico no es "habitación": es un recurso que se ocupa en exclusiva
-- durante un rango de tiempo. Habitaciones, canchas, salas, equipos, citas.

-- btree_gist da operadores de igualdad sobre uuid dentro de un índice GiST,
-- que es lo que necesita el EXCLUDE de abajo para combinar "mismo cliente,
-- mismo recurso" con "rangos que se solapan".
--
-- En Supabase las extensiones van al esquema `extensions`; en un Postgres
-- normal ese esquema no existe y se instala donde caiga. Las clases de
-- operador por defecto se resuelven sin mirar el search_path, así que el
-- EXCLUDE funciona igual en los dos casos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  END IF;
END
$$;--> statement-breakpoint

CREATE TYPE "booking_unit" AS ENUM ('noche', 'hora');--> statement-breakpoint

-- Todos los estados desde ya, aunque la fase 1 solo use `reservada` y
-- `cancelada`: agregar valores a un enum dentro de la transacción de una
-- migración no deja usarlos en esa misma transacción, y el predicado del
-- EXCLUDE tiene que nombrarlos.
CREATE TYPE "booking_status" AS ENUM (
  'reservada', 'en_curso', 'finalizada', 'cancelada', 'no_show'
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Servicios reservables
-- ---------------------------------------------------------------------------
-- NULL = el servicio se vende como siempre, como renglón de una venta. Es
-- opcional por servicio: una "Instalación" no ocupa nada por un tiempo.
ALTER TABLE "services" ADD COLUMN "booking_unit" "booking_unit";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Recursos: la habitación física, la cancha, el equipo
-- ---------------------------------------------------------------------------
CREATE TABLE "resources" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "service_id" uuid NOT NULL,
  "name" text NOT NULL,
  "notes" text,
  -- Se archivan, nunca se borran: una reserva vieja tiene que seguir diciendo
  -- en qué habitación fue.
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "resources_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,

  -- Compuesta: un recurso no puede colgar del servicio de otro cliente.
  CONSTRAINT "resources_service_fk"
    FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id"),

  -- Lo que referencia `bookings` para atar reserva, recurso y servicio.
  CONSTRAINT "resources_tenant_service_id_key"
    UNIQUE ("tenant_id", "service_id", "id"),

  CONSTRAINT "resources_name_not_blank" CHECK (length(btrim("name")) > 0)
);--> statement-breakpoint

-- "101" es una sola habitación aunque se venda como Doble o como Suite: el
-- nombre es único por cliente, no por servicio. Solo entre los activos, para
-- que archivar la vieja 101 deje crear otra.
CREATE UNIQUE INDEX "resources_name_active_idx"
  ON "resources" ("tenant_id", lower("name"))
  WHERE "archived_at" IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reservas
-- ---------------------------------------------------------------------------
CREATE TABLE "bookings" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  -- Redundante con resources.service_id a propósito: pasar a "un recurso,
  -- varios servicios" (la misma cancha por hora o por día) no tiene que
  -- obligar a tocar esta tabla.
  "service_id" uuid NOT NULL,
  "resource_id" uuid NOT NULL,

  -- Semiabierto [entrada, salida): salir el 12 y entrar el 12 no chocan.
  "period" tstzrange NOT NULL,
  "status" "booking_status" DEFAULT 'reservada' NOT NULL,

  -- SNAPSHOT del servicio al reservar, igual que un renglón de venta: si
  -- mañana sube la tarifa, una reserva hecha hoy no cambia.
  "unit_price" numeric(14, 2) NOT NULL,
  "currency" varchar(10) NOT NULL,

  "holder_name" text NOT NULL,
  "holder_document" text,
  "holder_phone" text,
  "notes" text,

  "cancelled_at" timestamp with time zone,
  "cancel_reason" text,

  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "bookings_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,

  -- Ata los tres: el recurso tiene que ser de ese servicio y de ese cliente.
  CONSTRAINT "bookings_resource_fk"
    FOREIGN KEY ("tenant_id", "service_id", "resource_id")
    REFERENCES "resources"("tenant_id", "service_id", "id"),

  -- Ni vacío ni infinito: una reserva "desde siempre" o de duración cero no
  -- describe nada que se pueda cobrar.
  CONSTRAINT "bookings_period_bounded" CHECK (
    NOT isempty("period") AND NOT lower_inf("period") AND NOT upper_inf("period")
  ),
  CONSTRAINT "bookings_period_half_open" CHECK (
    lower_inc("period") AND NOT upper_inc("period")
  ),

  CONSTRAINT "bookings_price_non_negative" CHECK ("unit_price" >= 0),
  CONSTRAINT "bookings_currency_format" CHECK ("currency" ~ '^[A-Z0-9]{3,5}$'),
  CONSTRAINT "bookings_holder_not_blank" CHECK (length(btrim("holder_name")) > 0),

  -- Cancelada si y solo si tiene fecha de cancelación. Un estado que dice una
  -- cosa y una fecha que dice otra es justo lo que nadie sabe leer después.
  CONSTRAINT "bookings_cancel_consistent" CHECK (
    ("status" = 'cancelada') = ("cancelled_at" IS NOT NULL)
  ),

  -- LA GARANTÍA. Dos reservas activas del mismo recurso no pueden solaparse.
  -- La impide el motor, no la aplicación: ni un doble clic ni dos
  -- recepcionistas reservando a la vez se la pueden saltar.
  --
  -- Una cancelada o un no-show liberan el recurso: si no, una reserva caída
  -- dejaría la habitación bloqueada para siempre.
  CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
    "tenant_id" WITH =,
    "resource_id" WITH =,
    "period" WITH &&
  ) WHERE ("status" NOT IN ('cancelada', 'no_show'))
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE "resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Sin política de DELETE en ninguna de las dos: un recurso se archiva y una
-- reserva se cancela. Borrarlas dejaría reservas sin habitación, o cobros sin
-- la reserva que los explica.
CREATE POLICY resources_select ON public.resources
  FOR SELECT TO app_user
  USING (tenant_id = public.current_tenant_id());--> statement-breakpoint
CREATE POLICY resources_insert ON public.resources
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint
CREATE POLICY resources_update ON public.resources
  FOR UPDATE TO app_user
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint

CREATE POLICY bookings_select ON public.bookings
  FOR SELECT TO app_user
  USING (tenant_id = public.current_tenant_id());--> statement-breakpoint
CREATE POLICY bookings_insert ON public.bookings
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint
CREATE POLICY bookings_update ON public.bookings
  FOR UPDATE TO app_user
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint

CREATE TRIGGER resources_touch_updated_at
  BEFORE UPDATE ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint

CREATE TRIGGER bookings_touch_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
