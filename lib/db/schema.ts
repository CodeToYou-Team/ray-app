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
  customType,
  smallint,
  time,
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
  /**
   * Un negocio no se borra: se suspende. Con valor, nadie del negocio entra
   * (requireTenant lo rechaza) y sus datos quedan intactos. Solo lo cambia un
   * admin de la plataforma: un trigger lo impide desde el contexto del cliente
   * (ver 0021_platform_admin.sql).
   */
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
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

// ---------------------------------------------------------------------------
// Administradores de la plataforma
// ---------------------------------------------------------------------------

/**
 * Quien puede dar de alta, editar y suspender negocios.
 *
 * `admin` gestiona negocios. `superadmin` ademas nombra, cambia y quita
 * admins; la base impide que lo haga nadie mas, que quede sin ningun
 * superadmin, y registra cada cambio en platform_audit_log por trigger. Ver
 * 0021_platform_admin.sql y 0022_platform_superadmin.sql.
 */
export const platformAdminLevel = ["admin", "superadmin"] as const;
export type PlatformAdminLevel = (typeof platformAdminLevel)[number];

export const platformAdmins = pgTable(
  "platform_admins",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    level: text("level", { enum: platformAdminLevel }).notNull().default("admin"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "platform_admins_level_check",
      sql`${table.level} in ('admin', 'superadmin')`,
    ),
  ],
);

/**
 * Auditoria de lo que no pertenece a ningun negocio (hoy, los cambios de
 * administradores). La escribe solo un trigger; app_user solo la lee, y solo
 * si es superadmin. `actorId` NULL = el script.
 */
export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: auditAction("action").notNull(),
    actorId: uuid("actor_id"),
    diff: jsonb("diff").$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("platform_audit_log_at_idx").on(table.at)],
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

/**
 * Como se cobra un servicio reservable. NULL en `services.bookingUnit` = el
 * servicio no se reserva y se vende como siempre, como renglon de una venta.
 */
export const bookingUnit = pgEnum("booking_unit", ["noche", "hora"]);
export type BookingUnit = (typeof bookingUnit.enumValues)[number];

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
    /**
     * Presente = el servicio se reserva (una habitacion por noche, una cancha
     * por hora). Ausente = se vende como renglon, como una "Instalacion".
     */
    bookingUnit: bookingUnit("booking_unit"),
    /**
     * Compartido = muchas reservas a la vez hasta llenar la capacidad (la
     * clase, el tour). Exclusivo = una reserva a la vez (la habitacion).
     */
    bookingShared: boolean("booking_shared").notNull().default(false),
    /** Por persona (el tour, 15 c/u) o por reserva (la habitacion, 40 vayan 1 o 3). */
    bookingPerPerson: boolean("booking_per_person").notNull().default(false),
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

/**
 * Tasa VIGENTE por par de monedas: lo que el dueño declara que cobra hoy.
 *
 * No se confunde con `transactions.exchangeRate`, que es la tasa HISTORICA de
 * una operacion concreta y no se vuelve a tocar. Esta solo alimenta la
 * sugerencia del formulario: cambiarla no reescribe nada ya registrado.
 */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    baseCurrency: varchar("base_currency", { length: 10 }).notNull(),
    quoteCurrency: varchar("quote_currency", { length: 10 }).notNull(),
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("exchange_rates_pair_unique").on(
      table.tenantId,
      table.baseCurrency,
      table.quoteCurrency,
    ),
  ],
);

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

    /**
     * Tasa con la que se convirtieron los precios de catalogo, si hubo que
     * convertirlos. NULL cuando los renglones ya estaban en la moneda del pago.
     *
     * Vive en la operacion y no en una tabla de tasas a proposito: es la tasa
     * que regia cuando se vendio, igual que `transaction_items.unit_price` es
     * el precio que regia. Releer una venta de enero tiene que dar siempre el
     * mismo numero, aunque la tasa de hoy sea otra.
     *
     * Dice cuantas unidades de `currency` equivale 1 de `baseCurrency`.
     */
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }),
    /** La moneda en la que estaban los precios antes de convertir. */
    baseCurrency: varchar("base_currency", { length: 10 }),

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

export const fieldEntity = pgEnum("field_entity", ["product", "service", "booking"]);

/**
 * De donde sale un campo.
 *
 *   fixed  -> una columna REAL de la tabla (name, price, sku...). El cliente
 *             puede renombrarla, ocultarla y reordenarla, pero no cambiar su
 *             tipo ni archivarla: son las que cargan la logica de inventario,
 *             los renglones de venta y las alertas.
 *   custom -> una clave dentro de `products.custom` / `services.custom` /
 *             `bookings.custom`.
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
 * Configuracion de las columnas de productos, servicios y reservas.
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

// ---------------------------------------------------------------------------
// Invitaciones
// ---------------------------------------------------------------------------

/**
 * Invitacion pendiente: un correo con un rol asignado de antemano.
 *
 * El flujo evita a proposito la API de administracion de Supabase Auth, que
 * exige el `service_role` key — la misma llave que tiene BYPASSRLS y que todo
 * este diseño trata de mantener fuera del proyecto.
 *
 * En su lugar: el dueño deja el correo apuntado aqui, la persona se registra
 * sola por la pantalla publica, y al entrar la invitacion se canjea por una
 * membresia. El unico correo que se manda es el de confirmacion que ya manda
 * Supabase, asi que no hace falta infraestructura de envio propia.
 *
 * Consecuencia: registrarse NO da acceso a nada. Sin invitacion previa, el
 * usuario queda autenticado pero sin cliente, y la app se lo dice.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Siempre en minusculas: es la clave con la que se busca al registrarse. */
    email: text("email").notNull(),
    role: membershipRole("role").notNull(),
    invitedBy: uuid("invited_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by"),
  },
  (table) => [
    /**
     * Una sola invitacion pendiente por correo y cliente. Las ya aceptadas se
     * quedan como registro de quien invito a quien y cuando.
     */
    uniqueIndex("invitations_pending_key")
      .on(table.tenantId, table.email)
      .where(sql`${table.acceptedAt} is null`),
    index("invitations_email_idx").on(table.email),
    check(
      "invitations_email_lowercase",
      sql`${table.email} = lower(${table.email})`,
    ),
    check("invitations_email_shape", sql`${table.email} like '%@%.%'`),
  ],
);

export type Invitation = typeof invitations.$inferSelect;

// ---------------------------------------------------------------------------
// Reservas
// ---------------------------------------------------------------------------
// Diseño en docs/plan_arquitectura_v2.md, seccion "Reservas". El EXCLUDE que
// impide la doble reserva, las politicas RLS y los CHECK de `period` viven en
// drizzle/0016_bookings.sql: Drizzle no sabe expresarlos.

/**
 * `tstzrange` de Postgres, como texto.
 *
 * Nunca se arma en JavaScript: los bordes se calculan en SQL con
 * `fecha::timestamp AT TIME ZONE tz`, porque Node corre en UTC y "la noche del
 * 10" en Caracas empieza a las 04:00 UTC. Ver lib/reservas/periodo.ts.
 */
const tstzrange = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tstzrange";
  },
});

export const bookingStatus = pgEnum("booking_status", [
  "reservada",
  "en_curso",
  "finalizada",
  "cancelada",
  "no_show",
]);
export type BookingStatus = (typeof bookingStatus.enumValues)[number];

/** La habitacion fisica, la cancha, el equipo. Pertenece a un servicio. */
export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull(),
    name: text("name").notNull(),
    notes: text("notes"),
    /**
     * Exclusivo: cuantas personas caben en UNA reserva (la 101, hasta 3).
     * Compartido: cuantas caben EN TOTAL a la vez (la clase, hasta 15).
     */
    capacity: integer("capacity").notNull().default(1),
    /** Se archivan, nunca se borran: una reserva vieja dice en que habitacion fue. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("resources_tenant_service_id_key").on(
      table.tenantId,
      table.serviceId,
      table.id,
    ),
    foreignKey({
      columns: [table.tenantId, table.serviceId],
      foreignColumns: [services.tenantId, services.id],
      name: "resources_service_fk",
    }),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull(),
    resourceId: uuid("resource_id").notNull(),
    /** Semiabierto [entrada, salida). Solo se escribe con SQL; ver `tstzrange`. */
    period: tstzrange("period").notNull(),
    status: bookingStatus("status").notNull().default("reservada"),
    /** Cuantas personas o cupos ocupa. */
    partySize: integer("party_size").notNull().default(1),
    /**
     * SNAPSHOT del servicio al reservar, como el precio. Ademas, el EXCLUDE
     * necesita `shared` en la propia fila: no puede mirar otra tabla.
     */
    shared: boolean("shared").notNull().default(false),
    perPerson: boolean("per_person").notNull().default(false),
    /** SNAPSHOT del servicio al reservar: si sube la tarifa, esta no cambia. */
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 10 }).notNull(),
    holderName: text("holder_name").notNull(),
    holderDocument: text("holder_document"),
    holderPhone: text("holder_phone"),
    notes: text("notes"),
    /**
     * Columnas personalizadas de la reserva (placa, motivo del viaje), por la
     * clave inmutable del campo. Mismo mecanismo que `products.custom`; la
     * definición está en `field_config` con entity = 'booking'.
     */
    custom: jsonb("custom")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    /** Cuándo llegó de verdad. Presente si y solo si está en curso o finalizada. */
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    /** Cuándo se fue. Presente si y solo si está finalizada. */
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("bookings_tenant_id_key").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.serviceId, table.resourceId],
      foreignColumns: [resources.tenantId, resources.serviceId, resources.id],
      name: "bookings_resource_fk",
    }),
  ],
);

/**
 * Cobros de una reserva: liga una transaccion de ingreso con la reserva a la
 * que abona.
 *
 * El cobro ES el ingreso, registrado el dia que entro el dinero. El check-out
 * no genera una venta aparte: si lo hiciera, el anticipo se contaria dos veces.
 *
 * `appliedAmount` va en la moneda de la RESERVA y se guarda, no se deriva:
 * dividir el monto cobrado en Bs por la tasa no siempre devuelve el numero
 * exacto, y un saldo que queda en 0,01 para siempre no tiene arreglo.
 *
 * Append-only: un cobro equivocado se corrige anulando su transaccion.
 */
export const bookingPayments = pgTable(
  "booking_payments",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").notNull(),
    transactionId: uuid("transaction_id").notNull(),
    appliedAmount: numeric("applied_amount", { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("booking_payments_transaction_unique").on(table.transactionId),
    foreignKey({
      columns: [table.tenantId, table.bookingId],
      foreignColumns: [bookings.tenantId, bookings.id],
      name: "booking_payments_booking_fk",
    }),
    foreignKey({
      columns: [table.tenantId, table.transactionId],
      foreignColumns: [transactions.tenantId, transactions.id],
      name: "booking_payments_transaction_fk",
    }),
  ],
);

/**
 * Turnos de un servicio por hora: "martes de 18:00 a 19:00".
 *
 * Sin turnos, el servicio se reserva en cualquier tramo de 30 minutos; con al
 * menos uno, solo en ellos. Valen para todos los recursos del servicio.
 *
 * Nada los referencia: la reserva guarda su rango, no el turno. Cambiar el
 * horario no invalida lo ya reservado. El EXCLUDE que impide dos turnos
 * solapados el mismo dia vive en drizzle/0019_service_schedules.sql.
 */
export const serviceSchedules = pgTable(
  "service_schedules",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull(),
    /** ISO: 1 = lunes … 7 = domingo. */
    weekday: smallint("weekday").notNull(),
    /** "18:00:00", hora local del negocio. */
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.serviceId],
      foreignColumns: [services.tenantId, services.id],
      name: "service_schedules_service_fk",
    }),
  ],
);
