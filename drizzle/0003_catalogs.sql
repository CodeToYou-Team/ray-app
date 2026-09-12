CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"catalog_key" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"currency" char(3),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_currency_only_for_payment_method" CHECK (("catalog_items"."catalog_key" = 'payment_method') = ("catalog_items"."currency" is not null)),
	CONSTRAINT "catalog_items_code_not_blank" CHECK (length(trim("catalog_items"."code")) > 0),
	CONSTRAINT "catalog_items_label_not_blank" CHECK (length(trim("catalog_items"."label")) > 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_code_key" ON "catalog_items" USING btree ("tenant_id","catalog_key","code");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_composite_key" ON "catalog_items" USING btree ("tenant_id","catalog_key","id");--> statement-breakpoint
CREATE INDEX "catalog_items_listing_idx" ON "catalog_items" USING btree ("tenant_id","catalog_key","sort_order");