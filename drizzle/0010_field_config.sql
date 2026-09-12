CREATE TYPE "public"."field_entity" AS ENUM('product', 'service');--> statement-breakpoint
CREATE TYPE "public"."field_source" AS ENUM('fixed', 'custom');--> statement-breakpoint
CREATE TYPE "public"."field_type" AS ENUM('text', 'textarea', 'number', 'integer', 'money', 'boolean', 'date', 'select', 'multiselect', 'catalog');--> statement-breakpoint
CREATE TABLE "field_config" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity" "field_entity" NOT NULL,
	"key" text NOT NULL,
	"source" "field_source" NOT NULL,
	"label" text,
	"type" "field_type",
	"required" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"show_in_table" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_config_fixed_is_limited" CHECK ("field_config"."source" = 'custom' or ("field_config"."type" is null and "field_config"."archived_at" is null)),
	CONSTRAINT "field_config_custom_has_type" CHECK ("field_config"."source" = 'fixed' or "field_config"."type" is not null),
	CONSTRAINT "field_config_key_not_blank" CHECK (length(trim("field_config"."key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "field_config" ADD CONSTRAINT "field_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_config_key" ON "field_config" USING btree ("tenant_id","entity","key");--> statement-breakpoint
CREATE INDEX "field_config_listing_idx" ON "field_config" USING btree ("tenant_id","entity","sort_order");