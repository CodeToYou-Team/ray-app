-- ---------------------------------------------------------------------------
-- Tasa vigente por par de monedas
-- ---------------------------------------------------------------------------
-- Complementa, no reemplaza, a `transactions.exchange_rate`. Esa es la tasa
-- HISTÓRICA: la que se aplicó a una operación concreta y no se vuelve a tocar.
-- Esta es la tasa de HOY: lo que el dueño declara que está cobrando, para que
-- el formulario la proponga en vez de hacer teclearla en cada venta.
--
-- Nunca se lee al calcular un monto ya registrado. Si mañana se cambia el
-- valor de acá, ninguna operación vieja cambia de significado — por eso la
-- histórica vive en la transacción y no en esta tabla.
--
-- Sin historial a propósito: cada operación ya guarda la tasa con la que se
-- registró, así que versionar esto no respondería ninguna pregunta nueva.
CREATE TABLE "exchange_rates" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "base_currency" varchar(10) NOT NULL,
  "quote_currency" varchar(10) NOT NULL,
  "rate" numeric(18, 6) NOT NULL,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "exchange_rates_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,

  -- Una sola tasa vigente por par. Dos filas para USD>VES dejarían al
  -- formulario eligiendo en silencio cuál proponer.
  CONSTRAINT "exchange_rates_pair_unique"
    UNIQUE ("tenant_id", "base_currency", "quote_currency"),

  CONSTRAINT "exchange_rates_rate_positive" CHECK ("rate" > 0),
  CONSTRAINT "exchange_rates_distinct_currencies"
    CHECK ("base_currency" <> "quote_currency"),
  CONSTRAINT "exchange_rates_base_format"
    CHECK ("base_currency" ~ '^[A-Z0-9]{3,5}$'),
  CONSTRAINT "exchange_rates_quote_format"
    CHECK ("quote_currency" ~ '^[A-Z0-9]{3,5}$')
);--> statement-breakpoint

ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Sin política, el trigger de "automatic RLS" de Supabase deja la tabla
-- cerrada para todos: es el comportamiento que queremos por defecto, pero acá
-- hace falta el aislamiento normal por cliente.
CREATE POLICY exchange_rates_isolation ON public.exchange_rates
  FOR ALL TO app_user
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint

CREATE TRIGGER exchange_rates_touch_updated_at
  BEFORE UPDATE ON public.exchange_rates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
