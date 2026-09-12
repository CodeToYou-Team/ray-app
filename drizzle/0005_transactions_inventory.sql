-- PRIMERO: la clave compuesta que referencian products, services y
-- transactions tiene que existir antes que sus FK.
-- La 0003 la creo como indice unico. Pasa a ser CONSTRAINT porque
-- drizzle-kit emite los CREATE INDEX *despues* de los ALTER TABLE que agregan
-- las FK, y una FK cuyo destino es un indice que todavia no existe falla con
-- "there is no unique constraint matching given keys". Las constraints van
-- dentro del CREATE TABLE, asi que siempre existen a tiempo.
DROP INDEX IF EXISTS "catalog_items_composite_key";--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_composite_key" UNIQUE("tenant_id","catalog_key","id");--> statement-breakpoint
CREATE TYPE "public"."stock_reason" AS ENUM('inicial', 'compra', 'venta', 'ajuste', 'merma', 'anulacion');--> statement-breakpoint
CREATE TYPE "public"."transaction_item_type" AS ENUM('product', 'service');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM('operacion', 'venta', 'compra');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('ingreso', 'gasto');--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"category_id" uuid,
	"category_catalog_key" text DEFAULT 'product_category' NOT NULL,
	"price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" char(3) NOT NULL,
	"min_stock" numeric(14, 3),
	"is_active" boolean DEFAULT true NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "products_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "products_category_catalog" CHECK ("products"."category_catalog_key" = 'product_category'),
	CONSTRAINT "products_price_non_negative" CHECK ("products"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"category_catalog_key" text DEFAULT 'service_category' NOT NULL,
	"price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" char(3) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "services_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "services_category_catalog" CHECK ("services"."category_catalog_key" = 'service_category'),
	CONSTRAINT "services_price_non_negative" CHECK ("services"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"delta" numeric(14, 3) NOT NULL,
	"reason" "stock_reason" NOT NULL,
	"transaction_item_id" uuid,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_delta_not_zero" CHECK ("stock_movements"."delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "transaction_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"item_type" "transaction_item_type" NOT NULL,
	"product_id" uuid,
	"service_id" uuid,
	"qty" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_items_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "transaction_items_exactly_one_target" CHECK (("transaction_items"."item_type" = 'product' and "transaction_items"."product_id" is not null and "transaction_items"."service_id" is null)
       or ("transaction_items"."item_type" = 'service' and "transaction_items"."service_id" is not null and "transaction_items"."product_id" is null)),
	CONSTRAINT "transaction_items_qty_positive" CHECK ("transaction_items"."qty" > 0),
	CONSTRAINT "transaction_items_price_non_negative" CHECK ("transaction_items"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "transaction_type" NOT NULL,
	"kind" "transaction_kind" DEFAULT 'operacion' NOT NULL,
	"concept" text NOT NULL,
	"occurred_on" date NOT NULL,
	"category_id" uuid NOT NULL,
	"category_catalog_key" text NOT NULL,
	"payment_method_id" uuid NOT NULL,
	"payment_catalog_key" text DEFAULT 'payment_method' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"notes" text,
	"client_request_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "transactions_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "transactions_category_matches_type" CHECK (("transactions"."type" = 'ingreso' and "transactions"."category_catalog_key" = 'income_category')
       or ("transactions"."type" = 'gasto'   and "transactions"."category_catalog_key" = 'expense_category')),
	CONSTRAINT "transactions_payment_catalog" CHECK ("transactions"."payment_catalog_key" = 'payment_method'),
	CONSTRAINT "transactions_kind_matches_type" CHECK ("transactions"."kind" = 'operacion'
       or ("transactions"."type" = 'ingreso' and "transactions"."kind" = 'venta')
       or ("transactions"."type" = 'gasto'   and "transactions"."kind" = 'compra')),
	CONSTRAINT "transactions_amount_non_negative" CHECK ("transactions"."amount" >= 0)
);
--> statement-breakpoint
-- (drizzle-kit vuelve a emitir aqui el DROP INDEX del indice viejo; ya se
--  hizo arriba, y repetirlo ahora fallaria porque la constraint que lo
--  reemplaza depende de ese indice.)
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_fk" FOREIGN KEY ("tenant_id","category_catalog_key","category_id") REFERENCES "public"."catalog_items"("tenant_id","catalog_key","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_category_fk" FOREIGN KEY ("tenant_id","category_catalog_key","category_id") REFERENCES "public"."catalog_items"("tenant_id","catalog_key","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transaction_fk" FOREIGN KEY ("tenant_id","transaction_id") REFERENCES "public"."transactions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_service_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."services"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_fk" FOREIGN KEY ("tenant_id","category_catalog_key","category_id") REFERENCES "public"."catalog_items"("tenant_id","catalog_key","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_method_fk" FOREIGN KEY ("tenant_id","payment_catalog_key","payment_method_id") REFERENCES "public"."catalog_items"("tenant_id","catalog_key","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_key" ON "products" USING btree ("tenant_id","sku") WHERE "products"."sku" is not null and "products"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "products_listing_idx" ON "products" USING btree ("tenant_id","name") WHERE "products"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "services_listing_idx" ON "services" USING btree ("tenant_id","name") WHERE "services"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "stock_movements_product_idx" ON "stock_movements" USING btree ("tenant_id","product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stock_movements_item_idx" ON "stock_movements" USING btree ("transaction_item_id");--> statement-breakpoint
CREATE INDEX "transaction_items_transaction_idx" ON "transaction_items" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_items_product_idx" ON "transaction_items" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_idempotency_key" ON "transactions" USING btree ("tenant_id","client_request_id") WHERE "transactions"."client_request_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_listing_idx" ON "transactions" USING btree ("tenant_id","occurred_on","type") WHERE "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "transactions_currency_idx" ON "transactions" USING btree ("tenant_id","currency","occurred_on") WHERE "transactions"."deleted_at" is null;--> statement-breakpoint
