-- ---------------------------------------------------------------------------
-- Tasa de cambio por operación
-- ---------------------------------------------------------------------------
-- Hasta ahora un producto solo se podía vender en la moneda de su precio: si
-- el catálogo estaba en USD, no había forma de cobrar en bolívares. Eso no es
-- como opera un negocio acá.
--
-- La tasa se guarda EN LA OPERACIÓN, no en una tabla de tasas. Es un dato de
-- la operación, igual que el precio congelado del renglón: la que regía cuando
-- se vendió, no la de hoy. No hay consulta a ningún servicio ni histórico de
-- tasas que mantener, y volver a leer una venta vieja da siempre el mismo
-- número.
--
-- Esto NO reabre la conversión entre monedas. Los totales se siguen llevando
-- separados por moneda y no se suman entre sí: la tasa convierte los precios
-- del catálogo al momento de registrar, y de ahí en adelante la operación vive
-- en una sola moneda, la del pago.
ALTER TABLE "transactions"
  ADD COLUMN "exchange_rate" numeric(18, 6),
  ADD COLUMN "base_currency" varchar(10);--> statement-breakpoint

COMMENT ON COLUMN "transactions"."exchange_rate" IS
  'Cuántas unidades de currency equivale 1 de base_currency. NULL si no hubo conversión.';--> statement-breakpoint

COMMENT ON COLUMN "transactions"."base_currency" IS
  'Moneda en la que estaban los precios de catálogo antes de convertir. NULL si no hubo conversión.';--> statement-breakpoint

-- Las dos juntas o ninguna. Una tasa sin decir de qué moneda sale no significa
-- nada, y una moneda base sin tasa no permite rehacer la cuenta.
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_rate_pair" CHECK (
    ("exchange_rate" IS NULL AND "base_currency" IS NULL)
    OR ("exchange_rate" IS NOT NULL AND "base_currency" IS NOT NULL)
  );--> statement-breakpoint

-- Cero o negativa no es una tasa: daría un monto cero o negativo sin que nadie
-- lo haya pedido.
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_rate_positive"
  CHECK ("exchange_rate" IS NULL OR "exchange_rate" > 0);--> statement-breakpoint

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_base_currency_format"
  CHECK ("base_currency" IS NULL OR "base_currency" ~ '^[A-Z0-9]{3,5}$');--> statement-breakpoint

-- Convertir de una moneda a ella misma no es convertir. Si llegara a pasar,
-- sería un error de la app registrando ruido que después nadie sabe leer.
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_rate_needs_other_currency"
  CHECK ("base_currency" IS NULL OR "base_currency" <> "currency");
