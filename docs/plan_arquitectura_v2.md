# Plan de Arquitectura v2: Esquema fijo + catálogos + campos personalizados

> **Reemplaza a [`plan_arquitectura_multitenant.md`](./plan_arquitectura_multitenant.md)** (v1), que
> sigue siendo la referencia válida para todo lo de infraestructura: las trampas de Supabase,
> el rol `NOBYPASSRLS`, `withTenant`, y las correcciones al documento original. Este documento
> solo desarrolla lo que cambió. Fecha: septiembre 2026.

## Por qué hay un v2

El v1 diseñaba un **motor no-code genérico**: el cliente creaba tablas y campos arbitrarios
desde la UI, y todo vivía en un contenedor universal (`entities` / `entity_fields` /
`entity_records`). Estimado: 7–9 semanas.

El alcance real es mucho más chico. La app tiene un dominio fijo — transacciones, productos,
servicios, inventario — y lo que varía por cliente son **dos cosas distintas que se estaban
mezclando en una sola idea de "dinamismo"**:

| Lo que se pidió | Lo que realmente es | Dinamismo de esquema |
| :--- | :--- | :--- |
| Categorías de ingreso/gasto editables | Catálogo (tabla relacional con CRUD) | Ninguno |
| Métodos de pago editables, con moneda | Catálogo con un atributo propio | Ninguno |
| Categorías de producto/servicio editables | Catálogo | Ninguno |
| Columnas extra en productos/servicios | Campos personalizados | **Sí, y solo aquí** |

Separar esas dos cosas es lo que hace el proyecto viable: **cuatro de los cinco
requerimientos no necesitan ningún motor dinámico.** Son tablas normales. El JSONB queda
confinado a un solo lugar bien delimitado.

Estimado nuevo: **~3½–4 semanas.**

### Decisiones confirmadas

| Decisión | Elección |
| :--- | :--- |
| Multi-tenant, Supabase, RLS | Se mantiene igual que en v1 |
| Estructura visual actual | Se mantiene (con las salvedades de la sección de monedas) |
| Catálogos en la DB | Una tabla polimórfica `catalog_items` |
| Campos personalizados | Solo en productos y servicios |
| Monedas | **Totales separados por moneda, sin conversión** |
| Tipo de operación en ingresos/gastos | Nuevo: operación suelta · venta de productos · compra de insumos |

---

## Respuestas directas a las dos dudas

### "¿Cómo se guardan las opciones de un campo con opciones?"

Depende de si la opción es solo una etiqueta o una cosa con vida propia. Esta es la regla que
decide, y es la misma que explica por qué método de pago sí merece tabla y "color" no:

> **JSONB dentro de la definición del campo** si la opción es solo una etiqueta, no tiene
> atributos propios y nunca se reporta ni se filtra por sí sola. Ejemplos: color, talla,
> material, acabado.
>
> **Tabla aparte** (un catálogo) si la opción tiene atributos propios, se relaciona con otras
> cosas, o necesitas agrupar/reportar por ella como entidad. Ejemplos: método de pago (tiene
> moneda), categoría (aparece en reportes), proveedor (tiene RIF y teléfono).

Y los dos casos se conectan: un campo personalizado puede ser de tipo `catalog` y apuntar a un
catálogo que el cliente administra. Así, si "Proveedor" empieza siendo un `select` simple y
después necesita teléfono, se convierte en catálogo sin rediseñar nada.

**En ambos casos se guarda el `code` estable, no la etiqueta.** `"pago_movil"`, no
`"Pago móvil"`. Si guardas etiquetas, el primer rename huerfaniza todo el histórico.

### "¿Cómo se guardan los valores si las columnas son dinámicas? ¿Un JSON con el valor por id de propiedad?"

Un JSONB sí — **pero indexado por el slug estable del campo, no por su id.**

```jsonc
// products.custom
{ "marca": "acme", "color": "rojo", "peso_kg": "1.250", "garantia_meses": 12 }
```

No `{"f_7a3e91c2": "acme"}`. El id como clave hace ilegible cada query SQL, cada export y cada
sesión de debugging (`custom->>'f_7a3e91c2'`), y la seguridad que el id pretendía comprar ya la
da gratis la regla de que **el slug es inmutable para siempre** — un rename cambia solo la
etiqueta visible, nunca la clave.

**Y explícitamente no EAV** (una fila por valor, que era la otra lectura de tu pregunta):

| | Una fila por valor (EAV) | JSONB en la fila |
| :--- | :--- | :--- |
| Listar 50 productos × 8 campos | 400 filas a pivotear en la app | 50 filas |
| Traer un producto completo | pivot o N joins | un `SELECT` |
| Tipos | todo `text`, se pierde el tipado | numérico sigue siendo numérico en el JSON |
| Editar un producto | borrar + insertar N filas | un `UPDATE` |

EAV solo gana cuando los campos son ilimitados y muy dispersos a escala masiva. Con cientos o
miles de productos por cliente, JSONB gana en todo.

---

## Esquema de base de datos

Todo lleva `tenant_id` y política RLS, con el patrón `withTenant` del v1.

### 1. Catálogos — una tabla, integridad real

```sql
CREATE TABLE catalog_items (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  catalog_key  text NOT NULL,     -- 'income_category' | 'expense_category'
                                  -- 'product_category' | 'service_category' | 'payment_method'
  code         text NOT NULL,     -- slug INMUTABLE (trigger), la identidad estable
  label        text NOT NULL,     -- editable libremente
  currency     char(3),           -- SOLO para payment_method
  sort_order   int  NOT NULL DEFAULT 0,
  archived_at  timestamptz,       -- "eliminar" = archivar
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, catalog_key, code),
  UNIQUE (tenant_id, catalog_key, id),          -- necesario para las FK compuestas
  CHECK  (catalog_key <> 'payment_method' OR currency IS NOT NULL),
  CHECK  (catalog_key =  'payment_method' OR currency IS NULL)
);
```

La objeción obvia a una tabla polimórfica es que se pierde la integridad: nada impediría meter
una categoría de gasto en un ingreso. **Se resuelve con FK compuesta**, y queda enforced por la
base, no por código:

```sql
-- en transactions
category_catalog_key text NOT NULL,   -- redundante a propósito
FOREIGN KEY (tenant_id, category_catalog_key, category_id)
  REFERENCES catalog_items (tenant_id, catalog_key, id)
```

Esa columna redundante es el precio de la tabla única, y es un precio bajo: dos columnas de
overhead a cambio de un CRUD, un set de server actions y una política RLS para los cinco
catálogos — y agregar un sexto (bancos, proveedores, unidades de medida) es una fila de
configuración, no una migración.

**"Eliminar" no elimina.** El botón dice Eliminar y hace `archived_at = now()`:
- Las FK van con `ON DELETE RESTRICT`. Borrar de verdad una categoría con transacciones
  rompería la FK o dejaría huérfano el histórico.
- Archivada: desaparece de los selectores nuevos, sigue mostrándose en los registros viejos y
  en los reportes de meses anteriores.

Los catálogos por defecto de cada cliente nuevo se siembran desde los arrays que hoy están en
`lib/mock-data.ts` (`incomeCategories`, `expenseCategories`, `productCategories`,
`serviceCategories`) más los métodos de pago típicos.

### 2. Transacciones — con tipo de operación

Este es el requerimiento nuevo y el que más cambia el diseño: un ingreso/gasto puede ser una
operación suelta, una **venta de productos** o una **compra de insumos**, y las dos últimas son
las que mueven inventario.

```sql
CREATE TABLE transactions (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  type          text NOT NULL CHECK (type IN ('ingreso','gasto')),
  kind          text NOT NULL CHECK (kind IN ('operacion','venta','compra')),
  concept       text NOT NULL,
  occurred_on   date NOT NULL,

  category_id           uuid NOT NULL,
  category_catalog_key  text NOT NULL,
  payment_method_id     uuid NOT NULL,
  payment_catalog_key   text NOT NULL DEFAULT 'payment_method'
                        CHECK (payment_catalog_key = 'payment_method'),

  amount        numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency      char(3) NOT NULL,        -- SNAPSHOT del método de pago
  notes         text,

  client_request_id uuid,                -- idempotencia
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,             -- soft delete

  -- el catálogo de categoría tiene que corresponder al tipo
  CHECK ((type='ingreso' AND category_catalog_key='income_category')
      OR (type='gasto'   AND category_catalog_key='expense_category')),
  -- venta solo puede ser ingreso; compra solo puede ser gasto
  CHECK (kind='operacion'
      OR (type='ingreso' AND kind='venta')
      OR (type='gasto'   AND kind='compra')),

  FOREIGN KEY (tenant_id, category_catalog_key, category_id)
    REFERENCES catalog_items (tenant_id, catalog_key, id),
  FOREIGN KEY (tenant_id, payment_catalog_key, payment_method_id)
    REFERENCES catalog_items (tenant_id, catalog_key, id)
);
```

**`currency` es un snapshot, no un join.** La moneda se copia del método de pago en el momento
de guardar y nunca se vuelve a leer del catálogo. Si mañana alguien edita "Pago móvil" de VES a
USD, las transacciones de enero **no** pueden cambiar de significado retroactivamente. Mismo
principio que aplica a `unit_price` abajo. Es la clase de bug que no se detecta hasta que los
números dejan de cuadrar y nadie sabe por qué.

### 3. Renglones — solo para venta y compra

```sql
CREATE TABLE transaction_items (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  item_type      text NOT NULL CHECK (item_type IN ('product','service')),
  product_id     uuid,
  service_id     uuid,
  qty            numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_price     numeric(14,2) NOT NULL,   -- SNAPSHOT al momento de la operación
  subtotal       numeric(14,2) NOT NULL,   -- qty * unit_price, recalculado en servidor

  CHECK ((item_type='product' AND product_id IS NOT NULL AND service_id IS NULL)
      OR (item_type='service' AND service_id IS NOT NULL AND product_id IS NULL))
);
```

Reglas que aplica el servidor en la misma transacción:
- `kind='operacion'` → cero renglones, `amount` se teclea directo.
- `kind='venta'` → uno o más renglones (productos y/o servicios), y `amount` **se calcula** como
  la suma de subtotales. El valor que manda el cliente se descarta.
- `kind='compra'` → solo productos (un gasto por un servicio recibido es un `gasto` +
  `operacion`, no una compra de insumos).
- `unit_price` se copia del producto al crear el renglón. Cambiar el precio del producto el mes
  que viene no debe alterar la venta del mes pasado.

### 4. Stock — derivado de movimientos, nunca una columna mutable

```sql
CREATE TABLE stock_movements (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL,
  product_id          uuid NOT NULL,
  delta               numeric(14,3) NOT NULL CHECK (delta <> 0),  -- + entra, - sale
  reason              text NOT NULL CHECK (reason IN ('inicial','compra','venta','ajuste','merma')),
  transaction_item_id uuid,       -- de dónde vino, si vino de una operación
  note                text,
  occurred_at         timestamptz NOT NULL,
  created_by          uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

**El stock actual es `SUM(delta)`, no un entero que se incrementa.** Una columna
`products.stock` mutable es una fábrica de bugs: se dobla al reintentar, se desincroniza al
borrar una transacción, y cuando el conteo físico no cuadra no hay forma de saber dónde se
perdió. Con movimientos append-only, "¿por qué dice 14 y hay 12?" es una consulta.

Cada renglón de producto en una venta genera un movimiento negativo, y en una compra uno
positivo, **en la misma transacción de base de datos** que la escritura del ingreso/gasto.
Anular una transacción (soft delete) inserta los movimientos compensatorios; no borra los
originales.

A esta escala sumar en cada lectura es gratis. Si algún día pesa, se agrega una tabla de caché
mantenida por trigger — pero derivada primero, cacheada después, nunca al revés.

### 5. Productos y servicios + los campos personalizados

```sql
-- products
id, tenant_id, name, sku, category_id, category_catalog_key,
price numeric(14,2), currency char(3), min_stock numeric(14,3), is_active boolean,
custom jsonb NOT NULL DEFAULT '{}'::jsonb,       -- <-- los campos personalizados
created_at, updated_at, deleted_at

-- services: igual, sin min_stock ni stock
```

### 6. Configuración de columnas — fijas y personalizadas en una sola tabla

Sobre el punto 5 de tu lista ("las que ya están ahorita como por defecto pero que tú puedas
crear las que necesites"), hay una distinción que importa: **las columnas actuales NO deben
volverse dinámicas.** `price`, `sku`, `category_id`, `min_stock` son las que cargan la lógica de
inventario, los renglones de venta y las alertas. Meterlas al JSONB te obliga a
`(custom->>'price')::numeric` en todas partes y te quita la FK de categoría y el `CHECK` del
precio.

Lo que sí se puede, y da la misma sensación de que "las de por defecto también se editan": el
cliente puede **renombrar, ocultar y reordenar** las columnas fijas, aunque el almacenamiento
siga siendo tipado. Una sola tabla cubre los dos casos:

```sql
CREATE TABLE field_config (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  entity        text NOT NULL CHECK (entity IN ('product','service')),
  key           text NOT NULL,        -- INMUTABLE (trigger). Para 'fixed' es el nombre de la columna real
  source        text NOT NULL CHECK (source IN ('fixed','custom')),

  label         text,                 -- override para fixed; nombre para custom
  type          text CHECK (type IN ('text','textarea','number','integer','money',
                                     'boolean','date','select','multiselect','catalog')),
  required      boolean NOT NULL DEFAULT false,
  options       jsonb   NOT NULL DEFAULT '[]'::jsonb,   -- [{code,label,sortOrder,archivedAt}]
  config        jsonb   NOT NULL DEFAULT '{}'::jsonb,   -- {min,max,step,catalogKey,help,placeholder}

  hidden        boolean NOT NULL DEFAULT false,
  show_in_table boolean NOT NULL DEFAULT true,
  sort_order    int     NOT NULL DEFAULT 0,
  archived_at   timestamptz,

  UNIQUE (tenant_id, entity, key),
  -- las columnas fijas no definen su propio tipo ni se archivan
  CHECK (source='custom' OR (type IS NULL AND archived_at IS NULL))
);
```

Para `source='fixed'`, el tipo y las validaciones vienen de un registro en código, no de la DB:

```ts
// lib/fields/fixed.ts
export const FIXED_FIELDS = {
  product: [
    { key: "name",        type: "text",    required: true,  label: "Nombre" },
    { key: "sku",         type: "text",    required: false, label: "SKU" },
    { key: "category_id", type: "catalog", required: true,  label: "Categoría",
      config: { catalogKey: "product_category" } },
    { key: "price",       type: "money",   required: true,  label: "Precio" },
    { key: "min_stock",   type: "number",  required: false, label: "Stock mínimo" },
    { key: "is_active",   type: "boolean", required: false, label: "Activo" },
  ],
  service: [ /* ... */ ],
} as const;
```

Una sola función mezcla las dos listas y de ahí sale todo — el formulario, las columnas de la
tabla y el esquema de validación:

```ts
// lib/fields/resolve.ts
export function resolveFields(entity: Entity, config: FieldConfigRow[]): ResolvedField[]
// aplica overrides sobre FIXED_FIELDS, agrega las custom no archivadas, ordena por sort_order
```

**Una nota sobre consistencia:** en las columnas reales una referencia a catálogo se guarda como
`uuid` con FK (`products.category_id`). Dentro del JSONB se guarda el `code`, porque el JSONB no
admite FK y ahí la legibilidad gana. No es un descuido: cada uno es lo correcto en su contexto,
y la validación contra el catálogo se hace en el servidor en los dos casos.

### Renderizar y filtrar columnas personalizadas

La tabla de productos pinta las columnas fijas visibles más una por cada campo personalizado con
`show_in_table`, ordenadas por `sort_order`. Los valores salen de `custom->>'key'` y se formatean
según el tipo. Ordenar y filtrar por una columna personalizada es `ORDER BY custom->>'key'` (y
`(custom->>'key')::numeric` para números) — perfectamente bien con cientos o miles de productos.
Índice de expresión solo si alguna vez se mide lento.

---

## Monedas: la consecuencia de "separados por moneda"

Elegiste no consolidar con tasa, y el motivo es sólido: con una tasa que se mueve todos los
días, un total convertido es un número que cambia de significado según cuándo lo mires.

Pero hay que decir con claridad **dónde eso choca con "la estructura visual se mantiene"**,
porque el dashboard actual muestra un solo número por KPI:

- **Los 4 KPI cards se quedan, pero cambian por dentro.** Cada uno muestra la moneda principal
  del cliente en grande y las otras en una línea secundaria (`Bs 4.500 · €80`). Se conserva la
  retícula de 4 tarjetas, que es lo que querías preservar.
- **`RevenueChart` y `ExpensesPieChart` necesitan un selector de moneda.** Un gráfico que mezcla
  Bs y USD en el mismo eje no significa nada. Lo más barato y honesto es un selector de moneda
  a nivel de página que filtra todo lo de abajo.
- **Los totales de la tabla de transacciones van por moneda**, no un total único.
- `tenants.primary_currency char(3)` decide cuál va en grande y en qué orden se listan las
  demás. Es solo presentación, no conversión.

Y la puerta queda abierta sin costo: como cada transacción guarda `amount` + `currency`, el día
que quieras consolidar solo hay que agregar la tabla de tasas y tres columnas
(`amount_base`, `rate`, `rate_date`) más un backfill. Nada del diseño lo impide.

---

## Qué se hereda del v1 y qué muere

**Se mantiene tal cual** (detalle completo en [v1](./plan_arquitectura_multitenant.md)):
- Supabase + Drizzle server-side, `schemaFilter: ["public"]`, URL pooled con `prepare: false`
  para la app y directa para migraciones.
- **El rol `app_user` con `NOBYPASSRLS`** y el test de fuga cross-tenant como criterio de
  salida. Sigue siendo lo más importante de todo el plan.
- `withTenant()` con `select set_config('app.current_tenant_id', $1, true)` — nunca
  `SET LOCAL x = $1`, que no acepta parámetros.
- `tenants` / `users` / `memberships` + `CAPABILITIES` en código, no en tablas.
- Log de auditoría append-only, soft delete, `client_request_id` para idempotencia.
- Dinero como `numeric` en PG y `string` en TS. Nunca `z.coerce.number()`.
- Lecturas por RSC, escrituras por Server Actions con su propio `requireCapability()`.
  Autorización nunca en `proxy.ts`.
- Filtrado, orden y paginación en el servidor desde `searchParams`.
- La Fase 0 completa: `pnpm lint` roto, los 4 layouts duplicados, el mapa `routeTitles`,
  los imports `zod/v4`.
- Las reglas de evolución, ahora aplicadas a catálogos y `field_config`: **la `key`/`code` es
  inmutable, las opciones se archivan y no se borran, nada se elimina de verdad, validación
  estricta al escribir y laxa al leer.**

**Muere, y es la razón por la que el estimado baja a la mitad:**
- El contenedor universal `entities` / `entity_fields` / `entity_records`.
- Las columnas promovidas, `promote.ts` y el trigger de reproyección — ya no hacen falta porque
  ahora hay columnas reales.
- Todo el aparato del BCV: `exchange_rates`, el cron, el scraper, el override manual, la alerta
  de obsolescencia, el tipo compuesto `money` con tasa persistida.
- El sistema de plantillas (`TemplatePlugin`, el registry, los plugins de Nivel 3) y el motor de
  reportes genérico.
- El builder de entidades arbitrarias. Queda solo el editor de columnas de producto/servicio.
- El evaluador de condiciones declarativas (`Cond`, `visibleWhen`/`enabledWhen`). El único
  formulario con lógica condicional es el de transacciones (según `kind` se muestra el monto o
  el editor de renglones), y siendo un formulario fijo eso son dos `if` en React, no un motor.

**Sobre las URLs:** el v1 recomendaba `/t/[tenantSlug]/...`. Sigue siendo la opción correcta
(hace honestas las claves de caché y hace trivial la impersonación para soporte), y ahora es
barato porque estás pre-lanzamiento. Si prefieres conservar las URLs actuales, la mitigación es
explícita: no usar `"use cache"` sobre datos de tenant nunca, y hacer la impersonación con una
cookie firmada de admin.

---

## Reservas: recurso + rango de tiempo

> Esta sección reemplaza al borrador original ("el punto de extensión"). Las decisiones
> de abajo se tomaron en octubre-noviembre de 2026, antes de empezar la fase 1.

Lo genérico no es "habitación": es **un recurso que se ocupa en exclusiva durante un rango
de tiempo**. Lo mismo sirve para habitaciones, canchas, salas, consultorios, equipos en
alquiler y citas con una persona (la persona es el recurso).

**No se resuelve con columnas personalizadas.** Un campo "fecha de entrada" se puede
guardar, pero no puede impedir que la habitación 101 se reserve dos veces la misma noche.

### El modelo

| Concepto | En el hotel | Tabla |
|---|---|---|
| Servicio | "Habitación doble, 40 USD/noche" | `services` + `booking_unit` |
| Recurso | La habitación física 101 | `resources` (nueva) |
| Reserva | La 101, del 10 al 12, a nombre de Pérez | `bookings` (nueva) |
| Cobro | 2 noches × 40 USD, en Bs a la tasa del día | `transactions` (fase 2) |

- **Un servicio es reservable si tiene `booking_unit`** (`noche` u `hora`). Sin ella se
  vende como siempre, como renglón de una venta. Es opcional por servicio.
- **Cada recurso pertenece a un servicio.** La 101 es una "Doble".
- **La reserva guarda `service_id` y `resource_id`**, atados por una FK compuesta a
  `resources (tenant_id, service_id, id)`. Hoy es redundante; existe para que pasar a
  "un recurso, varios servicios" (la misma cancha por hora o por día) no obligue a tocar
  `bookings`.
- **La reserva no es una venta.** Se puede reservar sin pagar. El cobro llega en la fase 2
  como transacciones ligadas, y al salir se genera la venta con `qty = noches`,
  reutilizando precio congelado, tasa de cambio y reportes.
- **La reserva congela precio y moneda del servicio** al crearse, igual que un renglón de
  venta: si mañana sube la tarifa, una reserva hecha hoy no cambia.

### La garantía

```sql
EXCLUDE USING gist (tenant_id WITH =, resource_id WITH =, period WITH &&)
  WHERE (status NOT IN ('cancelada', 'no_show'))
```

Dos reservas activas del mismo recurso no pueden solaparse. La impide Postgres, no la app:
ni un doble clic ni dos recepcionistas a la vez se lo pueden saltar.

### Tiempo

- **`period` es un `tstzrange` semiabierto `[entrada, salida)`**, para que salir el 12 y
  entrar el 12 no choquen.
- **Por noche, los bordes son la medianoche LOCAL del cliente** (`tenants.timezone`), no
  la hora real de check-in. La disponibilidad es por noche; la hora a la que llega el
  huésped es un dato operativo que se registra al hacer check-in (fase 2). Así no hace
  falta configurar horarios para saber qué está libre.
- **La conversión a timestamp se hace en SQL** (`fecha::timestamp AT TIME ZONE tz`), no
  en JavaScript. "La noche del 10" en Caracas empieza a las 04:00 UTC; calcularlo en el
  servidor de Node, que corre en UTC, corre las reservas de día sin que nadie lo note.
- **Por hora, en tramos de 30 minutos.** Cubre canchas de hora y media sin abrir la puerta
  a duraciones de 17 minutos que nadie cobra.

### Lo que la fase 1 NO cubre (a propósito)

- **Cupos** (clase de 15 personas, tour de 40 plazas, "una doble cualquiera"). Ahí sí pueden
  coincidir varias reservas y la que sobra no. No se expresa con `EXCLUDE`: hace falta
  contar con bloqueo. Para capacidades chicas sirve modelar "Plaza 1..15" como recursos.
- **Dos recursos por reserva** (masaje: terapeuta y cabina).
- **Reservas recurrentes** (la cancha todos los martes).
- **Tarifas por temporada o por persona.**

### Fases

1. **Recursos, reservas y disponibilidad.** Qué servicios se reservan, sus recursos, crear
   y cancelar reservas, y la cuadrícula recursos × días.
2. **Check-in / check-out y cobro.** Estados `en_curso` y `finalizada`, anticipos y saldo
   pendiente, venta generada al salir.
3. **Columnas personalizadas en la reserva**, con el mismo mecanismo que productos y
   servicios.

---

## Estructura de archivos

```
app/
  (app)/                             # UN layout (hoy hay 4 byte-idénticos)
    layout.tsx
    dashboard/page.tsx
    finanzas/{ingresos,gastos,movimientos,calendario,reportes,historial}/page.tsx
    productos/…  inventario/…        # rutas actuales, ahora con datos reales
    ajustes/
      catalogos/page.tsx             # CRUD de los 5 catálogos (una pantalla por catálogo)
      columnas/page.tsx              # field_config de productos y servicios
proxy.ts                             # solo redirects, NUNCA authz

lib/
  db/       index.ts  schema.ts  tenant.ts (withTenant)  migrate.ts
  catalogs/ queries.ts  actions.ts  keys.ts        # CATALOG_KEYS + labels
  fields/   fixed.ts  resolve.ts  zod-builder.ts   # esquema fijo + custom en uno
  finanzas/ queries.ts  actions.ts                 # transacciones + renglones + stock, una tx
  inventario/stock.ts                              # SUM(delta), estado, alertas
  authz/    session.ts  membership.ts  roles.ts
  money.ts  format.ts  showcase/mock-data.ts

components/
  catalogs/ catalog-table.tsx  catalog-item-dialog.tsx
  fields/   field-renderer.tsx  field-config-editor.tsx
            inputs/{text,number,money,select,catalog,boolean,date}-input.tsx
  finanzas/ transaction-form-dialog.tsx    # + kind + método de pago + renglones
            transaction-items-editor.tsx
            transaction-table.tsx          # paginada en servidor
  productos/product-table.tsx              # columnas dinámicas
  layout/header.tsx                        # sin routeTitles

drizzle/    migraciones, incl. SQL a mano para RLS y triggers de inmutabilidad
scripts/    seed-tenant.ts                 # catálogos por defecto de un cliente nuevo
```

---

## Fases

**Fase 0 — desbloquear (½ día).** Igual que en v1: reinstalar `eslint` + `eslint-config-next`
(el script `lint` existe pero las deps se quitaron en `71f9b95`, así que hoy falla), agregar
`typecheck`, colapsar los 4 layouts, borrar `routeTitles`, normalizar `zod/v4` → `zod`,
actualizar `AGENTS.md` (dice Next 16.2.2, es 16.3.2).

**Fase 1 — cimientos (~3 días).** Supabase + Drizzle + RLS + auth. **Criterio de salida: el test
que prueba que el tenant A no lee al B con el filtro de aplicación quitado a propósito.**
Tablas: tenants, users, memberships, audit_log.

**Fase 2 — catálogos (~3 días).** `catalog_items` con las FK compuestas y el trigger de
inmutabilidad del `code`. CRUD genérico parametrizado por `catalog_key`. `scripts/seed-tenant.ts`
con los defaults sacados de `mock-data.ts`. Cablear los selectores de categoría y método de pago
del formulario de transacciones a datos reales.

**Fase 3 — transacciones, renglones e inventario (~1 semana).** Es la fase más pesada y la que
carga el requerimiento nuevo.
- `transactions` + `transaction_items` + `stock_movements`.
- Selector de tipo de operación en el formulario; editor de renglones para venta/compra.
- `amount` calculado en servidor para venta/compra; renglones + movimientos de stock en **una
  sola transacción de DB** con su evento de auditoría.
- Stock como `SUM(delta)`; reconstruir las vistas de inventario y las alertas sobre eso.
- Anulación con movimientos compensatorios.

**Fase 4 — campos personalizados (~1 semana).** `field_config` + `FIXED_FIELDS` +
`resolveFields` + `buildZodSchema` compartido cliente/servidor. `field-renderer` y los inputs por
tipo. Columnas dinámicas en las tablas de productos y servicios. Pantalla `ajustes/columnas`:
agregar, renombrar, reordenar, ocultar, archivar — **nunca cambiar el tipo de un campo con datos.**

**Fase 5 — monedas y endurecer (~3 días).** KPI cards y gráficos por moneda con su selector.
Sentry, rate limiting en las actions, export de datos del cliente.

---

## Verificación

**Fase 1**
```
SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user;   -- false
Sembrar tenants A y B. Consultar como A con withTenant(A) pero SIN el eq(tenantId).
  -> debe devolver solo lo de A.
```

**Fase 2**
- Intentar `UPDATE catalog_items SET code = '...'` → excepción del trigger.
- Insertar una transacción `type='ingreso'` con una categoría de gasto → falla por la FK
  compuesta, no por código de aplicación.
- Archivar una categoría con transacciones → desaparece del selector nuevo, los registros
  históricos siguen mostrando su etiqueta.
- Intentar `DELETE` de una categoría en uso → `RESTRICT`.
- Crear un método de pago sin moneda → falla por el `CHECK`.

**Fase 3**
- Venta de 3 unidades de un producto con stock 10 → `SUM(delta) = 7`, y el `amount` de la
  transacción es la suma de subtotales (mandar un `amount` distinto desde el cliente y verificar
  que se ignora).
- Compra de 5 → stock 12.
- Cambiar el precio del producto → el `subtotal` de la venta anterior no se mueve.
- Anular la venta → stock vuelve a 10, y los movimientos originales siguen en la tabla.
- Mandar el mismo `client_request_id` dos veces → una sola transacción, un solo movimiento.
- Intentar una `venta` con `type='gasto'` → falla por el `CHECK`.
- Editar la moneda de un método de pago → las transacciones viejas conservan su `currency`.

**Fase 4**
- Crear un campo `select` "Color" con opciones, llenar 5 productos, renombrar la etiqueta de una
  opción → los 5 productos siguen mostrando el valor correcto (porque se guardó el `code`).
- Archivar una opción en uso → no aparece al crear, sí se sigue viendo en los que la tienen.
- Crear un campo requerido nuevo → los productos que ya existían siguen abriéndose y listándose
  sin excepción (validación laxa al leer).
- Ocultar y reordenar una columna fija → cambia la tabla y el formulario, el dato sigue en su
  columna tipada.
- Verificar que la UI hace imposible renombrar una `key` y cambiar el tipo de un campo con datos.

**Fase 5**
- Un cliente con transacciones en Bs, USD y EUR → los KPI muestran los tres, el gráfico responde
  al selector, y ningún total suma monedas distintas.
