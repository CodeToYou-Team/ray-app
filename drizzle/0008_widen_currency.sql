-- ===========================================================================
-- Monedas: char(3) -> varchar(10), con formato validado
-- ===========================================================================
-- Dos motivos:
--
-- 1. Las stablecoins tienen tickers de 4 caracteres (USDT, USDC), no 3. En
--    char(3) simplemente no entran.
-- 2. `char(n)` rellena con espacios a la derecha. Hoy todos los valores miden
--    exactamente 3 asi que no hay relleno, pero es una fuente de sorpresas que
--    no hace falta cargar (comparar 'USD ' con 'USD' segun el contexto).
--
-- El `USING trim(...)` es defensivo: el cast de char a varchar ya quita los
-- blancos finales, pero dejarlo explicito hace que la intencion se lea.

ALTER TABLE "catalog_items"
  ALTER COLUMN "currency" SET DATA TYPE varchar(10) USING trim(trailing from "currency");--> statement-breakpoint
ALTER TABLE "products"
  ALTER COLUMN "currency" SET DATA TYPE varchar(10) USING trim(trailing from "currency");--> statement-breakpoint
ALTER TABLE "services"
  ALTER COLUMN "currency" SET DATA TYPE varchar(10) USING trim(trailing from "currency");--> statement-breakpoint
ALTER TABLE "transactions"
  ALTER COLUMN "currency" SET DATA TYPE varchar(10) USING trim(trailing from "currency");--> statement-breakpoint
ALTER TABLE "tenants"
  ALTER COLUMN "primary_currency" SET DATA TYPE varchar(10) USING trim(trailing from "primary_currency");--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "primary_currency" SET DEFAULT 'USD';--> statement-breakpoint

-- El formato se valida tambien en la base, no solo en los Server Actions.
-- La lista de monedas validas vive en lib/currencies.ts y cambia sin migracion;
-- lo que Postgres garantiza es la FORMA: mayusculas, sin espacios, 3 a 5
-- caracteres. Asi 'usd' o '' no entran por ninguna via.
ALTER TABLE "catalog_items"
  ADD CONSTRAINT "catalog_items_currency_format"
  CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z0-9]{3,5}$');--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_currency_format"
  CHECK ("currency" ~ '^[A-Z0-9]{3,5}$');--> statement-breakpoint
ALTER TABLE "services"
  ADD CONSTRAINT "services_currency_format"
  CHECK ("currency" ~ '^[A-Z0-9]{3,5}$');--> statement-breakpoint
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_currency_format"
  CHECK ("currency" ~ '^[A-Z0-9]{3,5}$');--> statement-breakpoint
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_primary_currency_format"
  CHECK ("primary_currency" ~ '^[A-Z0-9]{3,5}$');
