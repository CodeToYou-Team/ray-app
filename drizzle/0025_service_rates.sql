-- ---------------------------------------------------------------------------
-- Reservas: tarifas por servicio
-- ---------------------------------------------------------------------------
-- Diseño en docs/plan_arquitectura_v2.md, sección "Reservas", fase 6.
--
-- Hasta aquí un servicio reservable tenía UNA forma de cobrarse: su precio
-- por noche o por hora. Ahora tiene tarifas: la cabaña por noche, por semana
-- y por mes; la cancha por hora y por tanda de 4 horas. Cada reserva usa una
-- sola, que elige al reservar y que queda congelada en la reserva.
--
-- La garantía contra la doble reserva no cambia: toda tarifa termina en un
-- `tstzrange`, y el EXCLUDE y el trigger de capacidad no saben de tarifas.

-- hora   = horas en tramos de 30 minutos, se cobra la fracción (1,5 horas).
-- bloque = bloques enteros de `minutes` minutos (la tanda de 4 horas).
-- dia    = días incluidos: del 10 al 12 son 3.
-- noche  = noches: del 10 al 12 son 2, la de salida no se cobra.
-- semana = 7 días exactos cada una.
-- mes    = meses de calendario: del 10 al 10.
CREATE TYPE "rate_unit" AS ENUM ('hora', 'bloque', 'dia', 'noche', 'semana', 'mes');--> statement-breakpoint

CREATE TABLE "service_rates" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "service_id" uuid NOT NULL,
  "unit" "rate_unit" NOT NULL,
  -- Solo para `bloque`: cuánto dura uno. En tramos de 30 minutos, como todo
  -- lo que se reserva por hora, y sin pasar de un día.
  "minutes" integer,
  -- Opcional: "Tanda", "Temporada alta". Sin nombre, la pantalla lo arma con
  -- la unidad ("Por noche", "Bloque de 4 horas").
  "label" text,
  "price" numeric(14, 2) NOT NULL,
  "currency" varchar(10) NOT NULL,
  -- Archivar, nunca borrar: las reservas la referencian.
  "archived_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "service_rates_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "service_rates_service_fk"
    FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id"),
  -- Para la FK compuesta de `bookings`: la tarifa tiene que ser del mismo
  -- servicio que la reserva.
  CONSTRAINT "service_rates_tenant_service_id_key" UNIQUE ("tenant_id", "service_id", "id"),

  CONSTRAINT "service_rates_price_non_negative" CHECK ("price" >= 0),
  CONSTRAINT "service_rates_currency_format" CHECK ("currency" ~ '^[A-Z0-9]{3,5}$'),
  CONSTRAINT "service_rates_minutes_only_block" CHECK (("unit" = 'bloque') = ("minutes" IS NOT NULL)),
  CONSTRAINT "service_rates_minutes_range" CHECK (
    "minutes" IS NULL OR ("minutes" BETWEEN 30 AND 1440 AND "minutes" % 30 = 0)
  ),
  CONSTRAINT "service_rates_label_length" CHECK (
    "label" IS NULL OR length(btrim("label")) BETWEEN 1 AND 60
  )
);--> statement-breakpoint

CREATE INDEX "service_rates_service_idx"
  ON "service_rates" ("tenant_id", "service_id");--> statement-breakpoint

ALTER TABLE "service_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Sin DELETE: se archivan.
CREATE POLICY service_rates_select ON public.service_rates
  FOR SELECT TO app_user
  USING (tenant_id = public.current_tenant_id());--> statement-breakpoint
CREATE POLICY service_rates_insert ON public.service_rates
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint
CREATE POLICY service_rates_update ON public.service_rates
  FOR UPDATE TO app_user
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- La primera tarifa de cada servicio que ya se reservaba: su unidad y su
-- precio de siempre. Incluye los archivados, que pueden tener reservas.
-- ---------------------------------------------------------------------------
INSERT INTO "service_rates" ("id", "tenant_id", "service_id", "unit", "price", "currency")
SELECT gen_random_uuid(), s."tenant_id", s."id", s."booking_unit"::text::"rate_unit", s."price", s."currency"
FROM "services" s
WHERE s."booking_unit" IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- La reserva congela su tarifa, como ya congelaba el precio.
-- ---------------------------------------------------------------------------
ALTER TABLE "bookings"
  ADD COLUMN "rate_id" uuid,
  ADD COLUMN "rate_unit" "rate_unit",
  ADD COLUMN "rate_minutes" integer,
  -- Cuántas unidades de la tarifa se cobran. Se GUARDA: con semanas y meses,
  -- derivarla del período en SQL obligaba a repetir la aritmética de meses en
  -- Postgres, y el 31 de enero + 1 mes no se deshace con age().
  ADD COLUMN "qty" numeric(12, 3);--> statement-breakpoint

-- Las existentes: la tarifa recién creada de su servicio y la cantidad que
-- hasta ahora se derivaba del período (la misma cuenta que hacía totalSql).
UPDATE "bookings" b
SET "rate_id" = r."id",
    "rate_unit" = r."unit",
    "qty" = CASE WHEN r."unit" = 'noche'
      THEN ((upper(b."period") AT TIME ZONE t."timezone")::date
            - (lower(b."period") AT TIME ZONE t."timezone")::date)::numeric
      ELSE round((extract(epoch FROM (upper(b."period") - lower(b."period"))) / 3600)::numeric, 3)
    END
FROM "service_rates" r, "tenants" t
WHERE r."tenant_id" = b."tenant_id"
  AND r."service_id" = b."service_id"
  AND t."id" = b."tenant_id";--> statement-breakpoint

ALTER TABLE "bookings"
  ALTER COLUMN "rate_id" SET NOT NULL,
  ALTER COLUMN "rate_unit" SET NOT NULL,
  ALTER COLUMN "qty" SET NOT NULL,
  ADD CONSTRAINT "bookings_rate_fk"
    FOREIGN KEY ("tenant_id", "service_id", "rate_id")
    REFERENCES "service_rates"("tenant_id", "service_id", "id"),
  ADD CONSTRAINT "bookings_qty_positive" CHECK ("qty" > 0),
  ADD CONSTRAINT "bookings_rate_minutes_only_block" CHECK (
    ("rate_unit" = 'bloque') = ("rate_minutes" IS NOT NULL)
  );
