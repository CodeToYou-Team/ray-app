import {
  pgTable,
  uuid,
  text,
  varchar,
  jsonb,
  integer,
  timestamp,
  uniqueIndex,
  index,
  pgEnum,
  check,
  unique,
  numeric,
  boolean,
  date,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Esquema de base de datos. Ver docs/plan_arquitectura_v2.md.
 *
 * Lo que NO vive aca y va en SQL a mano (drizzle/*.sql):
 *   - El rol `app_user` con NOBYPASSRLS.
 *   - Las politicas RLS y la funcion current_tenant_id().
 *   - Los triggers de inmutabilidad y el espejo de auth.users.
 * Drizzle no modela nada de eso, y drizzle-kit no debe tocarlo.
 */

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  /** Identificador en URLs y para soporte. */
  slug: text("slug").notNull().unique(),
  /**
   * Los reportes por hora (horas pico) se calculan con
   * `occurred_at AT TIME ZONE timezone`. En UTC estarian corridos 4 horas.
   */
  timezone: text("timezone").notNull().default("America/Caracas"),
  /**
   * Moneda que se muestra en grande en los KPI. Es solo presentacion: NO se
   * convierte nada a esta moneda, los totales van separados por moneda.
   */
  primaryCurrency: varchar("primary_currency", { length: 10 })
    .notNull()
    .default("USD"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

/**
 * Espejo de `auth.users`, mantenido por un trigger (ver 0002_auth_mirror.sql).
 *
 * Se tiene tabla propia en lugar de referenciar `auth.users` directamente porque
 * drizzle-kit no administra el schema `auth`, y una FK hacia alli lo confundiria.
 * Ademas nos deja ser dueños de la fila del usuario.
 */
export const users = pgTable("users", {
  /** Mismo id que auth.users.id. */
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  fullName: text("full_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Membresias
// ---------------------------------------------------------------------------

export const membershipRole = pgEnum("membership_role", [
  "owner",
  "manager",
  "staff",
]);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_user_tenant_key").on(table.userId, table.tenantId),
    index("memberships_tenant_idx").on(table.tenantId),
  ],
);

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

export const auditAction = pgEnum("audit_action", [
  "create",
  "update",
  "delete",
  "restore",
]);

/**
 * Append-only. Se inserta en la MISMA transaccion que la escritura que describe.
 *
 * Sin esto no hay forma de responder "el turno de noche dice que registro $200 y
 * el total muestra $150", que en un negocio de efectivo es la pregunta que
 * inevitablemente aparece.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Tabla afectada, ej. 'transactions'. */
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: auditAction("action").notNull(),
    /** Quien lo hizo. Sin FK a users: el log sobrevive al borrado del usuario. */
    actorId: uuid("actor_id"),
    /** Campos que cambiaron: { campo: { from, to } }. */
    diff: jsonb("diff").$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_tenant_entity_idx").on(
      table.tenantId,
      table.entity,
      table.entityId,
    ),
    index("audit_log_tenant_at_idx").on(table.tenantId, table.at),
    // El log no se edita ni se reordena en el tiempo.
    check("audit_log_at_not_future", sql`${table.at} <= now() + interval '1 minute'`),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type MembershipRole = (typeof membershipRole.enumValues)[number];
export type AuditAction = (typeof auditAction.enumValues)[number];

// ---------------------------------------------------------------------------
// Catalogos
// ---------------------------------------------------------------------------

/**
 * Tabla polimorfica para todos los catalogos editables por el cliente:
 * categorias de ingreso y gasto, categorias de producto y servicio, metodos de
 * pago. En la UI se ven como pantallas separadas; en la base son una sola tabla.
 *
 * `catalog_key` es `text` sin enum ni CHECK a proposito: agregar un catalogo
 * nuevo (bancos, proveedores, unidades de medida) tiene que ser una entrada en
 * lib/catalogs/keys.ts, no una migracion. La integridad de verdad — que una
 * categoria de gasto no se pueda usar en un ingreso — la dan las FK compuestas
 * del lado que referencia, no una restriccion sobre esta columna.
 */
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    catalogKey: text("catalog_key").notNull(),
    /**
     * Identidad estable. INMUTABLE: lo garantiza un trigger, no solo el codigo.
     * Renombrar cambia `label`, nunca esto. Si el codigo cambiara, cada registro
     * historico que lo referencia quedaria huerfano.
     */
    code: text("code").notNull(),
    /** Lo que ve el usuario. Editable libremente. */
    label: text("label").notNull(),
    /**
     * Solo para metodos de pago: la moneda en la que entra ese pago. De aca sale
     * el `currency` que se copia a cada transaccion.
     */
    currency: varchar("currency", { length: 10 }),
    sortOrder: integer("sort_order").notNull().default(0),
    /** "Eliminar" archiva. Ver la nota de abajo. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("catalog_items_code_key").on(
      table.tenantId,
      table.catalogKey,
      table.code,
    ),
    /**
     * Redundante con la PK, pero necesario: es el destino de las FK compuestas
     * `(tenant_id, catalog_key, id)` que impiden, por ejemplo, usar una
     * categoria de gasto en un ingreso.
     */
    unique("catalog_items_composite_key").on(
      table.tenantId,
      table.catalogKey,
      table.id,
    ),
    index("catalog_items_listing_idx").on(
      table.tenantId,
      table.catalogKey,
      table.sortOrder,
    ),
    // La moneda es exclusiva de los metodos de pago, en los dos sentidos.
    check(
      "catalog_items_currency_only_for_payment_method",
      sql`(${table.catalogKey} = 'payment_method') = (${table.currency} is not null)`,
    ),
    check("catalog_items_code_not_blank", sql`length(trim(${table.code})) > 0`),
    check("catalog_items_label_not_blank", sql`length(trim(${table.label})) > 0`),
  ],
);

export type CatalogItem = typeof catalogItems.$inferSelect;
export type NewCatalogItem = typeof catalogItems.$inferInsert;

// ---------------------------------------------------------------------------
// Productos y servicios
// ---------------------------------------------------------------------------

/**
 * `custom` guarda los campos personalizados que el cliente define (fase 4),
 * indexado por el slug INMUTABLE del campo: {"marca": "acme", "color": "rojo"}.
 * No por el id del campo — `custom->>'f_7a3e91c2'` haria ilegible cada consulta,
 * cada export y cada sesion de depuracion.
 *
 * Las columnas de aca arriba NO son dinamicas y no deben serlo: son las que
 * cargan la logica de inventario, los renglones de venta y las alertas. Meter
 * `price` al JSONB obliga a `(custom->>'price')::numeric` en todas partes y
 * quita la FK de categoria y el CHECK del precio.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku"),
    /**
     * Obligatoria. Con la columna nullable, la FK compuesta
     * (tenant_id, catalog_key, category_id) no se verifica cuando es NULL
     * — asi que permitirlo abriria un hueco de integridad, no una comodidad.
     */
    categoryId: uuid("category_id").notNull(),
    categoryCatalogKey: text("category_catalog_key")
      .notNull()
      .default("product_category"),
    /** numeric, nunca float: el dinero no se representa exacto en binario. */
    price: numeric("price", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: varchar("currency", { length: 10 }).notNull(),
    minStock: numeric("min_stock", { precision: 14, scale: 3 }),
    isActive: boolean("is_active").notNull().default(true),
    custom: jsonb("custom")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("products_tenant_id_key").on(table.tenantId, table.id),
    uniqueIndex("products_sku_key")
      .on(table.tenantId, table.sku)
      .where(sql`${table.sku} is not null and ${table.deletedAt} is null`),
    index("products_listing_idx")
      .on(table.tenantId, table.name)
      .where(sql`${table.deletedAt} is null`),
    // La categoria tiene que salir del catalogo de productos, no de otro.
    foreignKey({
      columns: [table.tenantId, table.categoryCatalogKey, table.categoryId],
      foreignColumns: [
        catalogItems.tenantId,
        catalogItems.catalogKey,
        catalogItems.id,
      ],
      name: "products_category_fk",
    }),
    check(
      "products_category_catalog",
      sql`${table.categoryCatalogKey} = 'product_category'`,
    ),
    check("products_price_non_negative", sql`${table.price} >= 0`),
  ],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * Obligatoria. Con la columna nullable, la FK compuesta
     * (tenant_id, catalog_key, category_id) no se verifica cuando es NULL
     * — asi que permitirlo abriria un hueco de integridad, no una comodidad.
     */
    categoryId: uuid("category_id").notNull(),
    categoryCatalogKey: text("category_catalog_key")
      .notNull()
      .default("service_category"),
    price: numeric("price", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: varchar("currency", { length: 10 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    custom: jsonb("custom")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("services_tenant_id_key").on(table.tenantId, table.id),
    index("services_listing_idx")
      .on(table.tenantId, table.name)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      columns: [table.tenantId, table.categoryCatalogKey, table.categoryId],
      foreignColumns: [
        catalogItems.tenantId,
        catalogItems.catalogKey,
        catalogItems.id,
      ],
      name: "services_category_fk",
    }),
    check(
      "services_category_catalog",
      sql`${table.categoryCatalogKey} = 'service_category'`,
    ),
    check("services_price_non_negative", sql`${table.price} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Transacciones
// ---------------------------------------------------------------------------

export const transactionType = pgEnum("transaction_type", ["ingreso", "gasto"]);

/**
 * Que clase de operacion es. Es lo que hace que el inventario funcione:
 *   operacion -> suelta, se teclea el monto y no toca stock.
 *   venta     -> lleva renglones; cada producto genera un movimiento negativo.
 *   compra    -> lleva renglones; cada producto genera un movimiento positivo.
 */
export const transactionKind = pgEnum("transaction_kind", [
  "operacion",
  "venta",
  "compra",
]);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    type: transactionType("type").notNull(),
    kind: transactionKind("kind").notNull().default("operacion"),
    concept: text("concept").notNull(),
    occurredOn: date("occurred_on").notNull(),

    categoryId: uuid("category_id").notNull(),
    /** Redundante a proposito: es lo que permite la FK compuesta de abajo. */
    categoryCatalogKey: text("category_catalog_key").notNull(),
    paymentMethodId: uuid("payment_method_id").notNull(),
    paymentCatalogKey: text("payment_catalog_key")
      .notNull()
      .default("payment_method"),

    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /**
     * SNAPSHOT de la moneda del metodo de pago, no un join.
     *
     * Si mañana alguien edita "Pago movil" de VES a USD, las transacciones de
     * enero NO pueden cambiar de significado retroactivamente. Es la clase de
     * bug que no se detecta hasta que los numeros dejan de cuadrar y ya nadie
     * sabe por que.
     */
    currency: varchar("currency", { length: 10 }).notNull(),
    notes: text("notes"),

    /**
     * Idempotencia. Recepcion con wifi malo, doble tap en enviar, y queda un
     * ingreso duplicado imposible de distinguir de dos ventas reales.
     */
    clientRequestId: uuid("client_request_id"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Anular no borra: en una tabla de dinero el borrado duro es negligencia. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("transactions_tenant_id_key").on(table.tenantId, table.id),
    uniqueIndex("transactions_idempotency_key")
      .on(table.tenantId, table.clientRequestId)
      .where(sql`${table.clientRequestId} is not null`),
    index("transactions_listing_idx")
      .on(table.tenantId, table.occurredOn, table.type)
      .where(sql`${table.deletedAt} is null`),
    index("transactions_currency_idx")
      .on(table.tenantId, table.currency, table.occurredOn)
      .where(sql`${table.deletedAt} is null`),

    // La categoria sale del catalogo que corresponde al tipo.
    foreignKey({
      columns: [table.tenantId, table.categoryCatalogKey, table.categoryId],
      foreignColumns: [
        catalogItems.tenantId,
        catalogItems.catalogKey,
        catalogItems.id,
      ],
      name: "transactions_category_fk",
    }),
    foreignKey({
      columns: [table.tenantId, table.paymentCatalogKey, table.paymentMethodId],
      foreignColumns: [
        catalogItems.tenantId,
        catalogItems.catalogKey,
        catalogItems.id,
      ],
      name: "transactions_payment_method_fk",
    }),
    check(
      "transactions_category_matches_type",
      sql`(${table.type} = 'ingreso' and ${table.categoryCatalogKey} = 'income_category')
       or (${table.type} = 'gasto'   and ${table.categoryCatalogKey} = 'expense_category')`,
    ),
    check(
      "transactions_payment_catalog",
      sql`${table.paymentCatalogKey} = 'payment_method'`,
    ),
    // Vender solo puede ser ingreso; comprar insumos solo puede ser gasto.
    check(
      "transactions_kind_matches_type",
      sql`${table.kind} = 'operacion'
       or (${table.type} = 'ingreso' and ${table.kind} = 'venta')
       or (${table.type} = 'gasto'   and ${table.kind} = 'compra')`,
    ),
    check("transactions_amount_non_negative", sql`${table.amount} >= 0`),
  ],
);

export const transactionItemType = pgEnum("transaction_item_type", [
  "product",
  "service",
]);

/** Renglones. Solo para kind 'venta' y 'compra'. */
export const transactionItems = pgTable(
  "transaction_items",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull(),
    itemType: transactionItemType("item_type").notNull(),
    productId: uuid("product_id"),
    serviceId: uuid("service_id"),
    qty: numeric("qty", { precision: 14, scale: 3 }).notNull(),
    /**
     * SNAPSHOT del precio al momento de la operacion. Cambiar el precio del
     * producto el mes que viene no debe alterar la venta del mes pasado.
     */
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("transaction_items_tenant_id_key").on(table.tenantId, table.id),
    index("transaction_items_transaction_idx").on(table.transactionId),
    index("transaction_items_product_idx").on(table.tenantId, table.productId),

    foreignKey({
      columns: [table.tenantId, table.transactionId],
      foreignColumns: [transactions.tenantId, transactions.id],
      name: "transaction_items_transaction_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "transaction_items_product_fk",
    }),
    foreignKey({
      columns: [table.tenantId, table.serviceId],
      foreignColumns: [services.tenantId, services.id],
      name: "transaction_items_service_fk",
    }),
    // Un renglon apunta a un producto o a un servicio, nunca a ambos ni a nada.
    check(
      "transaction_items_exactly_one_target",
      sql`(${table.itemType} = 'product' and ${table.productId} is not null and ${table.serviceId} is null)
       or (${table.itemType} = 'service' and ${table.serviceId} is not null and ${table.productId} is null)`,
    ),
    check("transaction_items_qty_positive", sql`${table.qty} > 0`),
    check("transaction_items_price_non_negative", sql`${table.unitPrice} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export const stockReason = pgEnum("stock_reason", [
  "inicial",
  "compra",
  "venta",
  "ajuste",
  "merma",
  "anulacion",
]);

/**
 * Append-only. **El stock actual es SUM(delta), no una columna que se incrementa.**
 *
 * Una columna `products.stock` mutable es una fabrica de bugs: se dobla al
 * reintentar, se desincroniza al anular, y cuando el conteo fisico no cuadra no
 * hay forma de saber donde se perdio. Con movimientos, "por que dice 14 y hay
 * 12" es una consulta y no una adivinanza.
 *
 * Anular una transaccion NO borra sus movimientos: inserta los compensatorios.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    /** Positivo entra, negativo sale. Nunca cero. */
    delta: numeric("delta", { precision: 14, scale: 3 }).notNull(),
    reason: stockReason("reason").notNull(),
    /** De donde vino, si vino de una operacion. */
    transactionItemId: uuid("transaction_item_id"),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("stock_movements_product_idx").on(
      table.tenantId,
      table.productId,
      table.occurredAt,
    ),
    index("stock_movements_item_idx").on(table.transactionItemId),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "stock_movements_product_fk",
    }),
    check("stock_movements_delta_not_zero", sql`${table.delta} <> 0`),
  ],
);

export type Product = typeof products.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type TransactionItem = typeof transactionItems.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type TransactionType = (typeof transactionType.enumValues)[number];
export type TransactionKind = (typeof transactionKind.enumValues)[number];
export type StockReason = (typeof stockReason.enumValues)[number];

// ---------------------------------------------------------------------------
// Configuracion de columnas (campos personalizados)
// ---------------------------------------------------------------------------

export const fieldEntity = pgEnum("field_entity", ["product", "service"]);

/**
 * De donde sale un campo.
 *
 *   fixed  -> una columna REAL de la tabla (name, price, sku...). El cliente
 *             puede renombrarla, ocultarla y reordenarla, pero no cambiar su
 *             tipo ni archivarla: son las que cargan la logica de inventario,
 *             los renglones de venta y las alertas.
 *   custom -> una clave dentro de `products.custom` / `services.custom`.
 */
export const fieldSource = pgEnum("field_source", ["fixed", "custom"]);

export const fieldType = pgEnum("field_type", [
  "text",
  "textarea",
  "number",
  "integer",
  "money",
  "boolean",
  "date",
  "select",
  "multiselect",
  /** Apunta a un catalogo que el cliente administra. Guarda el `code`. */
  "catalog",
]);

/**
 * Configuracion de las columnas de productos y servicios.
 *
 * Una sola tabla para las columnas fijas y las personalizadas, porque la
 * pantalla que las administra y el codigo que las renderiza son los mismos. Lo
 * que cambia es cuanto se puede editar de cada una.
 */
export const fieldConfig = pgTable(
  "field_config",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entity: fieldEntity("entity").notNull(),
    /**
     * INMUTABLE (lo garantiza un trigger). Para `fixed` es el nombre de la
     * columna real; para `custom` es la clave dentro del JSONB.
     *
     * Es lo que guardan los registros. Renombrar cambia `label`, nunca esto: si
     * cambiara, cada producto que tenga ese campo quedaria apuntando a la nada.
     */
    key: text("key").notNull(),
    source: fieldSource("source").notNull(),
    /** Override del nombre visible. Null = usa el que trae el registro en codigo. */
    label: text("label"),
    /** Solo para `custom`: las fijas traen su tipo del registro en codigo. */
    type: fieldType("type"),
    required: boolean("required").notNull().default(false),
    /** Para select y multiselect: [{code, label, archivedAt}]. */
    options: jsonb("options")
      .$type<{ code: string; label: string; archivedAt?: string }[]>()
      .notNull()
      .default([]),
    /** min, max, step, catalogKey, placeholder, help. */
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    hidden: boolean("hidden").notNull().default(false),
    showInTable: boolean("show_in_table").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Solo `custom` se archiva. Los datos se quedan en el JSONB. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("field_config_key").on(table.tenantId, table.entity, table.key),
    index("field_config_listing_idx").on(
      table.tenantId,
      table.entity,
      table.sortOrder,
    ),
    /**
     * Una columna fija no define su tipo ni se archiva: su tipo vive en el
     * codigo (lib/fields/fixed.ts) y archivarla romperia el inventario.
     */
    check(
      "field_config_fixed_is_limited",
      sql`${table.source} = 'custom' or (${table.type} is null and ${table.archivedAt} is null)`,
    ),
    check(
      "field_config_custom_has_type",
      sql`${table.source} = 'fixed' or ${table.type} is not null`,
    ),
    check("field_config_key_not_blank", sql`length(trim(${table.key})) > 0`),
  ],
);

export type FieldConfigRow = typeof fieldConfig.$inferSelect;
export type FieldEntity = (typeof fieldEntity.enumValues)[number];
export type FieldSource = (typeof fieldSource.enumValues)[number];
export type FieldType = (typeof fieldType.enumValues)[number];
