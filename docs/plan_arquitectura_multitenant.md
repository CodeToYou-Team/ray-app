# Plan de Arquitectura: Motor multi-tenant no-code sobre la base actual de Ray App

> ⚠️ **SUPERADO por [`plan_arquitectura_v2.md`](./plan_arquitectura_v2.md)** (septiembre 2026),
> tras reducir el alcance de "motor no-code genérico" a "esquema fijo + catálogos + campos
> personalizados en productos/servicios". **Este documento sigue siendo la referencia válida
> para toda la infraestructura**: las trampas de Supabase, el rol `NOBYPASSRLS`, `withTenant`,
> las correcciones al documento original y las reglas de evolución de esquemas. Lo que ya no
> aplica es el contenedor universal de entidades, las columnas promovidas, el aparato del BCV y
> el sistema de plantillas.

> Este documento es la revisión crítica y el plan de ejecución derivados de
> [`propuesta_arquitectura_multitenant_completa.md`](./propuesta_arquitectura_multitenant_completa.md),
> evaluados contra el estado real del código a agosto de 2026.

## Contexto

Necesitamos una web app SaaS donde cada cliente define sus propias tablas y campos, se le
autogenera el formulario y cada tabla tiene su propia visualización. Arrancamos con 2–3
clientes pequeños y crecemos gradualmente. El primer cliente real es un hotel que registra
entradas (habitación, horas, método de pago, monto en USD con conversión BCV, banco
condicional) con dos roles: personal que solo registra, y dueño que además ve la
consolidación de ingresos por banco y necesitará histórico y analítica.

Existe un documento de arquitectura recomendado
([`propuesta_arquitectura_multitenant_completa.md`](./propuesta_arquitectura_multitenant_completa.md))
y una base de código ya construida: un dashboard financiero en español, muy bien terminado
visualmente, pero **sin nada debajo** — cero base de datos, cero API, cero auth, todo
alimentado por `lib/mock-data.ts` y con formularios que hacen `console.log`.

**Decisiones tomadas que este plan asume:**

| Decisión | Elección |
| :--- | :--- |
| Quién define las tablas | El cliente, desde la UI (builder self-service) |
| Base de datos / auth | Supabase (Postgres + Auth + Storage) |
| App de finanzas actual | Se convierte en plantilla reutilizable |
| Prioridad | Motor genérico completo primero, luego se monta el hotel |

Como el builder self-service **es** la funcionalidad vendida, se construye el motor de
interpretación en tiempo de ejecución (JSONB dinámico). Eso descarta el atajo de
compilar el metadata a tablas reales, que sería más rápido pero solo sirve si el esquema
dinámico es una herramienta interna y no un producto para el cliente.

**Implicación de tiempo, para que quede dicha:** motor completo + builder antes de montar
al hotel es del orden de **7–9 semanas** de trabajo. Se recomienda construir las
definiciones del hotel durante la Fase 3 como banco de pruebas del motor (sin salir a
producción) — es la única forma honesta de saber que el motor está "completo".

---

## Veredicto sobre el documento propuesto

**Lo que se conserva:** PostgreSQL, el enfoque EAV-híbrido sobre JSONB, RLS para
aislamiento, metadata en tablas relacionales (`entities` / `entity_fields`), RHF + Zod
dinámico, TanStack Table eventualmente.

**Lo que se corrige — cada uno de estos falla en el teclado:**

1. **`uuid-ossp` / `uuid_generate_v4()` está obsoleto.** Usar `gen_random_uuid()`, o mejor
   UUIDv7 generado en la app para PKs ordenados por tiempo (evita bloat de índice y
   amplificación de WAL en la tabla caliente de inserts).
2. **El índice GIN que propone no sirve para la consulta que propone.** Un
   `gin(data)` con `jsonb_ops` no acelera comparaciones con `->>`; solo containment (`@>`),
   existencia (`?`) y jsonpath. El ejemplo `WHERE data->>'email' LIKE '%@empresa.com%'` hace
   seq scan. Se reemplaza por columnas promovidas indexadas (abajo).
3. **Hueco de integridad:** `entity_records.entity_id` y `entity_records.tenant_id` son FKs
   independientes. Nada impide un registro con el `tenant_id` de A apuntando al `entity_id`
   de B, y RLS no lo detecta. Se arregla con FK compuesta:
   ```sql
   ALTER TABLE entities ADD CONSTRAINT entities_tenant_id_key UNIQUE (tenant_id, id);
   ALTER TABLE entity_records ADD CONSTRAINT fk_record_entity
     FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, id) ON DELETE CASCADE;
   ```
4. **`SET LOCAL app.current_tenant_id = $1` no acepta parámetros.** `SET` no es
   parametrizable. El template `sql` de Drizzle lo manda como bind param y da error de
   sintaxis — y el "arreglo" obvio (interpolar el string) abre inyección SQL justo en la
   frontera de tenants. Lo correcto:
   ```ts
   await tx.execute(sql`select set_config('app.current_tenant_id', ${tenantId}, true)`);
   ```
5. **`is_required BOOLEAN` no alcanza.** El campo Banco del hotel es "requerido solo si
   método de pago = pago móvil". Debe ser `required: boolean | Cond`.
6. **Backend NestJS/Express separado: se descarta.** El documento no da más argumento que
   "TypeScript estricto", que Next ya da. Un solo despliegue, Route Handlers +
   Server Actions.

---

## Base de datos: Postgres en Supabase

**Por qué Postgres y no Mongo/Firebase:** JSONB da ~90% de la flexibilidad de Mongo *más*
SQL real para la parte que de verdad importa aquí — sumar dinero con `numeric` exacto,
agrupar por banco y por hora en zona horaria local, transacciones ACID sobre el registro +
su log de auditoría, y RLS a nivel de motor. Firebase es especialmente mal encaje: reportes
relacionales caros y modelo de costo por lectura.

**Por qué Supabase concretamente:** Auth (usuarios, invitaciones, recuperación de
contraseña) + Storage + RLS nativo en un servicio, free tier suficiente para 3 clientes.
El esquema lo controlamos con Drizzle, así que la base queda portable.

### La incomodidad que hay que asumir explícitamente

El valor central de Supabase es consultar desde el navegador con `supabase-js` protegido
por RLS con `auth.uid()`. Si usamos Drizzle del lado del servidor no usamos nada de eso:
estamos comprando Postgres administrado + Auth + Storage. Es un buen trato, pero **hay que
comprometerse a uno y escribirlo**, porque el modo de fallo es construir la mitad de cada uno.

> **Regla:** todo acceso a datos con Drizzle, solo del lado del servidor. Supabase Auth vía
> `@supabase/ssr` únicamente para sesiones. RLS con `app.current_tenant_id`, no `auth.uid()`.
> `supabase-js` nunca toca el navegador para datos.

### Trampas de la semana uno

- **`drizzle.config.ts` debe llevar `schemaFilter: ["public"]`** o `drizzle-kit` genera
  migraciones que borran `auth.*`, `storage.*` y `realtime.*`. Esto ha destruido proyectos reales.
- **No hacer FK de `memberships.user_id` a `auth.users(id)` desde Drizzle** (no puede
  administrar ese schema). Mantener tabla `users` propia, espejada por trigger sobre
  `auth.users`. Vale la pena ser dueño de la fila de usuario.
- **`prepare: false`** en la conexión `postgres.js` por el pooler, o aparece
  intermitentemente "prepared statement does not exist". URL pooled (6543) para la app,
  URL directa (5432) para `drizzle-kit migrate`.
- **Drizzle devuelve `numeric` como `string`. Eso es correcto, no "arreglarlo".** El dinero
  es `string` de extremo a extremo: `numeric` en PG, `string` en TS,
  `z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/)` en Zod. Nunca `number` de JS. Nunca
  `z.coerce.number()` — que además convierte `""` en `0`, un footgun serio en numéricos
  opcionales. El formulario actual en
  [`transaction-form-dialog.tsx:35`](../components/finanzas/transaction-form-dialog.tsx#L35) usa
  exactamente ese antipatrón; no se arrastra al motor.

### El punto que hace que RLS no sea decorativo

**Los roles `postgres` y `service_role` de Supabase tienen `BYPASSRLS`.** Si el string de
conexión de Drizzle es el que da el dashboard, **todas las políticas son un no-op** y no nos
enteramos hasta que un cliente vea los datos de otro. Hay que crear un rol de login
dedicado con `NOBYPASSRLS`, otorgarle privilegios, y conectar con ese. Y no usar el
service-role key "por ahora": cuesta lo mismo hacerlo bien el día uno, y "temporalmente
service_role" es cómo RLS nunca llega a existir.

Test obligatorio, y es criterio de salida de la Fase 1:
```sql
SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user;  -- debe ser false
```
más un test automatizado que pruebe que el tenant A no lee al B **con el filtro de
aplicación deliberadamente quitado**. Si ese test no pasa, RLS no es real.

### Patrón de acceso, en orden

```
Request
 └─ requireSession()            // @supabase/ssr, cookies() [async en Next 16]
 └─ requireMembership(slug)     // resuelve tenantId + rol desde nuestras propias tablas
 └─ requireCapability(cap)      // lib/authz/roles.ts
 └─ withTenant(tenantId, tx =>  // BEGIN; set_config(..., true)
        tx.select()...where(and(eq(records.tenantId, tenantId), ...))
    )                           // filtro de app Y RLS. Cinturón Y tirantes.
```

`SET LOCAL` **sí** sobrevive el pooling en modo transacción — el pooler fija un backend
mientras dura la transacción y el GUC se revierte en el `COMMIT`. Lo peligroso es un `SET`
de sesión, que sobrevive y filtra el tenant anterior al siguiente que agarre ese backend.

Mantener el `eq(tenantId, ...)` en cada query aunque RLS esté activo: si se quita se pierde
el prefijo del índice compuesto y los planes se degradan aun cuando RLS haga lo correcto.
Envolver la resolución de sesión/membresía en `cache()` de React para que los RSC anidados
no re-consulten.

---

## Almacenamiento: JSONB + columnas promovidas escritas por el motor

**Se descartan las columnas `GENERATED ALWAYS AS ... STORED` de la propuesta.** Dos razones,
ambas verificables:

1. **Postgres las rechaza para la que más se necesita.** La expresión de una columna generada
   debe ser demostrablemente `IMMUTABLE`, y `timestamptz_in` es `STABLE` porque depende de
   los GUCs `TimeZone` y `DateStyle`. No importa que los strings sean ISO-8601 con `Z`
   explícito — la verificación es sobre la función, no sobre el dato:
   ```sql
   -- ERROR: generation expression is not immutable
   occurred_at timestamptz GENERATED ALWAYS AS ((data->>'occurred_at')::timestamptz) STORED
   ```
   `(data->>'amount')::numeric` **sí** funciona (`numeric_in` es inmutable). Ese es el peor
   caso posible: se construye, funciona con el dinero, y truena con la fecha.
2. **Agregar o cambiar una columna generada reescribe la tabla completa** bajo
   `ACCESS EXCLUSIVE`, y antes de PG 17 la expresión no se puede alterar (hay que drop +
   re-add, dos reescrituras). Promover un campo debe ser una operación rutinaria por
   tenant; convertirla en reescritura de tabla es arquitectónicamente al revés.

**En su lugar: columnas tipadas normales que el motor escribe en cada insert/update.**

```ts
// lib/db/schema.ts (bosquejo)
export const entityRecords = pgTable("entity_records", {
  id:            uuid("id").primaryKey(),                 // UUIDv7 generado en app
  tenantId:      uuid("tenant_id").notNull(),
  entityId:      uuid("entity_id").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  data:          jsonb("data").$type<Record<string, unknown>>().notNull().default({}),

  // --- columnas promovidas: las escribe el motor según field.promoteTo ---
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  amountUsd:  numeric("amount_usd", { precision: 14, scale: 2 }),
  currency:   char("currency", { length: 3 }),
  status:     text("status"),
  refA:       uuid("ref_a"),      // ej. habitacion_id
  refB:       uuid("ref_b"),      // ej. tipo_id
  title:      text("title"),

  clientRequestId: uuid("client_request_id"),   // idempotencia
  createdBy:  uuid("created_by").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt:  timestamp("deleted_at", { withTimezone: true }),   // soft delete
});
```

El metadata declara el mapeo (`promoteTo: "amount_usd" | "occurred_at" | "ref_a" | ...`) y
una sola función hace la proyección en `lib/engine/promote.ts`:

```ts
export function project(fields: FieldDef[], data: Record<string, unknown>): PromotedCols {
  const out: PromotedCols = {};
  for (const f of fields) {
    if (!f.promoteTo) continue;
    out[f.promoteTo] = PROMOTERS[f.type](data[f.key]);   // money → amountUsd, datetime → Date
  }
  return out;
}
```

| | GENERATED STORED | Escritas por el motor |
| :--- | :--- | :--- |
| `timestamptz` desde JSONB | ❌ rechazado por PG | ✅ funciona |
| Valores que requieren lookup en DB (BCV) | ❌ imposible | ✅ natural |
| Agregar una columna promovida después | reescritura completa | **solo metadata, instantáneo** |
| Cambiar qué promueve un campo | DDL + reescritura | config + un `UPDATE` de backfill |
| Riesgo de desincronización | ninguno | ⚠️ si algo escribe fuera del motor |

La única desventaja es la desincronización, y es barata de controlar porque hay **una sola
ruta de escritura**:

1. Todo write pasa por `lib/engine/mutations.ts`. Ningún otro módulo hace
   `db.insert(entityRecords)` directo.
2. Cinturón adicional: un trigger `BEFORE INSERT OR UPDATE` que recalcula las dos derivables
   de JSONB. Los triggers **sí** pueden llamar funciones `STABLE`, así que
   `(NEW.data->'monto'->>'amountUsd')::numeric` y el cast a timestamptz son legales aquí —
   precisamente la vía de escape que las columnas generadas niegan.
3. Chequeo nocturno de consistencia que re-proyecta una muestra y alerta si hay diferencia
   (~30 líneas, corre dentro del cron del BCV).

### Índices

```sql
CREATE INDEX ON entity_records (tenant_id, entity_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ON entity_records (tenant_id, entity_id, ref_a)            WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ON entity_records (tenant_id, client_request_id)    WHERE client_request_id IS NOT NULL;
```

Sin `gin(data)` al inicio — es amplificación de escritura para consultas que no hacemos.
Agregar `gin(data jsonb_path_ops)` cuando exista una consulta real de containment
(`jsonb_path_ops` es mucho más pequeño que el default y soporta `@>`, que es el operador que
de verdad usaríamos).

---

## El catálogo de tipos de campo (el artefacto central)

Catálogo **cerrado y versionado** en `lib/engine/field-types.ts`. Cerrado es la palabra
importante: cada tipo que se agrega es código que se mantiene para siempre en el renderer, el
validador, el promotor y la tabla.

`text`, `textarea`, `number`, `integer`, `money`, `boolean`, `date`, `datetime`, `select`,
`multiselect`, `reference`, `email`, `phone`, `file`.

Metadata por campo: `key` (inmutable), `label`, `required: boolean | Cond`, `default`,
`visibleWhen`, `enabledWhen`, `readonly`, `showInTable`, `order`, `section`, `promoteTo`,
`optionsSource`.

Dos decisiones que cargan todo el peso:

- **`money` es un tipo compuesto**, no un escalar. Ver la prueba del hotel abajo.
- **`required: boolean | Cond`**, no un booleano.

Y una regla no negociable: **los valores de los `select` son códigos estables, no
etiquetas.** `"pago_movil"`, no `"Pago móvil"`. Si se guardan etiquetas, el primer rename
huerfaniza todos los registros históricos y todos los reportes.

### `buildZodSchema` — una sola fuente de verdad, con una asimetría honesta

`buildZodSchema(fields, { mode: "client" | "server" })`. No puede ser literalmente la misma
función porque el lado servidor además tiene que: resolver campos calculados (el lookup BCV
es async y toca la DB), quitar los valores de campos cuyo `visibleWhen` es falso, y validar
contra la versión de esquema *almacenada*. Fingir que no hay asimetría es exactamente donde
vive el bug de "el cliente mandó `amount_usd = 999999`".

### No pelear con `zodResolver` en esquemas dinámicos

El `as never` que hay hoy en
[`transaction-form-dialog.tsx:57`](../components/finanzas/transaction-form-dialog.tsx#L57) y en
[`app/productos/nuevo/page.tsx:49`](../app/productos/nuevo/page.tsx#L49) enmascara un desajuste
real de tipos input-vs-output. Para el motor, escribir un resolver propio — 20 líneas,
totalmente tipado, sin casts, y es donde vive el "requerido condicional":

```ts
const resolver: Resolver<FieldValues> = async (values) => {
  const r = schema.safeParse(values);
  return r.success
    ? { values: r.data, errors: {} }
    : { values: {}, errors: toRhfErrors(r.error) };
};
```

Normalizar también los imports `zod/v4` → `zod` (con zod 4.3.6 el export raíz ya es v4; el
subpath es residuo de la transición 3.25).

---

## Lógica condicional: declarativa, sin `eval`, ~40 líneas

```ts
// lib/engine/conditions.ts
export type Cond =
  | { op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; field: string; value: JsonPrimitive }
  | { op: "in" | "nin"; field: string; value: JsonPrimitive[] }
  | { op: "truthy" | "empty"; field: string }
  | { op: "and" | "or"; conditions: Cond[] }
  | { op: "not"; condition: Cond };

export function evaluate(c: Cond, values: Record<string, unknown>): boolean { /* switch total */ }
```

Puro, total, sin `eval`, y validado por un meta-esquema Zod al guardar la definición para
que una condición malformada nunca llegue al renderer. Tres consumidores del mismo JSON:
render en el cliente, validación en el cliente, validación en el servidor.

**Se descartan `json-logic-js`, JSONPath y un mini-parser de expresiones.** Dan aritmética,
operaciones de string y una superficie ilimitada que después hay que asegurar y tipar. Hacen
falta seis comparadores y tres combinadores.

Cuatro reglas fáciles de olvidar y caras de retrofitear:

1. **Aplicar la condición también en el servidor.** Si `banco` llega con
   `metodo_pago = "efectivo"`, **borrar la clave** antes del insert. Si no, el reporte de
   ingresos por banco tiene bancos fantasma y nunca se va a saber por qué.
2. **Limpiar al cerrar.** Cuando la condición pasa a falsa, limpiar el valor en cliente
   (`setValue(key, undefined)` en un efecto sobre `useWatch`) y en servidor. Si no: el
   usuario elige Banesco, cambia a efectivo, envía, y se guarda un banco huérfano.
3. **`enabledWhen` = visible pero deshabilitado; `visibleWhen` = no se renderiza.** Ambos
   quitan el valor. Banco quiere `enabledWhen` — el usuario debe *ver* que el campo existe.
4. **Sin ciclos.** Validar que el grafo de condiciones sea acíclico al guardar. `A visibleWhen B`
   + `B visibleWhen A` es un loop infinito de render.

---

## Los tres niveles de extensibilidad

Esta es la respuesta a "¿y cuando un cliente pide algo que el motor genérico no puede
inventar?".

**Nivel 1 — Declarativo (en la DB, sin código).** Tipo de campo + `required` +
`visibleWhen`/`enabledWhen` + `constraints` a nivel de entidad + `optionsSource`. Cubre ~80%
de todo cliente futuro. Es exactamente lo que edita el builder self-service.

**Nivel 2 — Resolvers por tipo de campo (nuestro código, registro estático).**

```ts
// lib/engine/resolvers/index.ts
export const RESOLVERS: Partial<Record<FieldType, Resolver>> = {
  money:     resolveMoney,      // lookup BCV + amountUsd + persistir la tasa
  reference: resolveRef,        // validar que el destino exista y sea del mismo tenant
  computed:  resolveComputed,   // expresión de whitelist
};
```

Aquí vive el BCV (~40 líneas). Configurado por metadata, reutilizado por todo cliente futuro
que cobre en Bs, y nunca ejecuta código escrito por el usuario.

**Nivel 3 — Plugins de plantilla (nuestro código, indexado por *plantilla*, jamás por tenant).**
Refinamientos Zod extra, campos derivados, definiciones de reportes.

```ts
// lib/templates/hotel/reservation.ts
export const hotelReservation: TemplatePlugin = {
  key: "hotel.reservation",
  fields: [...], constraints: [...],
  refine: (schema) => schema.check(...),
  derive: async (rec) => ({ duracion_min: differenceInMinutes(rec.hora_salida, rec.hora_entrada) }),
  reports: [incomePerBank, topRooms, peakHours],
};
```

**Regla crítica: `entities.template_key` es nullable y apunta a un registro *estático*.**
Indexado por plantilla, no por tenant. El hotel #2 reusa `hotel.reservation` tal cual. Si se
indexa por tenant vamos a tener 200 módulos a medida y ningún producto. Sin `eval`, sin
código en la DB, sin JS por tenant — nunca.

**Regla de gobierno:** si terminamos recurriendo al Nivel 3 más de una vez por cliente, al
catálogo de Nivel 1 le falta algo. Ese es el roadmap.

---

## La prueba del hotel, campo por campo

| # | Campo | Tipo | Veredicto |
| :-- | :--- | :--- | :--- |
| 1 | Tipo de habitación | `reference` | ✅ limpio (no `select`) |
| 2 | Número de habitación | `reference` | ⚠️ necesita opciones dependientes |
| 3 | Hora de entrada | `datetime` | ❌ la especificación del cliente está mal |
| 4 | Hora de salida | `datetime` | ❌ + validación cruzada |
| 5 | Método de pago | `select` | ✅ limpio (es un discriminador) |
| 6 | Monto USD con BCV | `money` | ❌❌ **tipo compuesto + resolver de servidor** |
| 7 | Banco condicional | `select` + `enabledWhen` | ✅ declarativo |

### 1 y 2 — referencias, no enums

`select` con opciones estáticas funcionaría, pero los tipos de habitación tienen precios que
cambian, y "qué habitaciones se venden más" necesita identidad estable, no una etiqueta que
alguien puede editar a "Suite Presidencial". Modelar `room_types` y `rooms` como entidades
propias. Costo: una definición más. Beneficio: la analítica sobrevive un rename y el dueño
puede agregar una habitación sin cambio de código.

El campo 2 además necesita algo que el documento propuesto no contempla: **opciones
dependientes.** Elegir "suite" debe filtrar los números a suites.

```ts
{ key: "habitacion_id", type: "reference",
  optionsSource: { entity: "rooms", labelField: "numero",
                   filter: [{ op: "eq", field: "tipo_id", valueFrom: "tipo_habitacion_id" }] } }
```

`valueFrom` referencia un campo hermano del formulario — el mismo evaluador de
`conditions.ts` con un tipo de nodo más.

### 3 y 4 — la especificación del cliente está mal y el motor debe rechazarla

Una `time` sin fecha para entrada/salida es una trampa:
- Entrada 23:30, salida 02:15 → `salida < entrada`. La duración es negativa y todo reporte
  de estancia promedio queda roto.
- Una hora sin fecha no se puede unir a un día, así que "horas pico" tendría que usar
  `created_at`, que es *cuándo se tecleó*, no cuándo entraron.

**Modelar ambos como `datetime`**, guardados en UTC ISO-8601, con una UI que se *sienta* como
selector de hora: fecha precargada a hoy (en la zona del tenant), colapsada, con el control
de reloj prominente. Se obtienen duraciones correctas, cruce de medianoche correcto, horas
pico correctas y zona horaria correcta, gratis.

El control de reloj hay que construirlo: `react-day-picker` es solo fecha y no hay
`time-picker` en `components/ui/`. ~150 líneas en
`components/engine/fields/datetime-field.tsx`.

Validación cruzada `hora_salida > hora_entrada`: no es expresable por campo, es un
refinamiento a nivel de objeto. Por eso el catálogo necesita `constraints` a nivel de
**entidad**, no solo por campo:

```ts
constraints: [{ kind: "compare", left: "hora_salida", op: "gt", right: "hora_entrada",
                message: "La salida debe ser posterior a la entrada" }]
```

Compila a un `.check()` sobre el objeto (zod 4; `.superRefine()` quedó deprecado). Cuarto
consumidor del mismo evaluador declarativo.

### 6 — aquí es donde el motor genérico se rompe, y la solución es un tipo compuesto

"Siempre USD; si pagó en Bs, convertir a la tasa BCV del día" son tres cosas que un motor de
metadata no puede inventar: la moneda de entrada difiere de la de almacenamiento, la
conversión requiere un lookup en DB, y **la tasa usada debe persistirse** o los totales
históricos se mueven solos cada vez que el BCV cambia.

Seis campos planos (`monto_original`, `moneda`, `tasa`, `fecha_tasa`, `monto_usd`,
`fuente`) es la respuesta equivocada: nada mantiene la consistencia, el formulario muestra
seis inputs, y un update parcial corrompe el invariante.

**Un solo campo, `type: "money"`, cuyo valor JSONB es un objeto tipado:**

```jsonc
{ "monto": {
    "currency": "VES", "amount": "1850.00",
    "rate": "36.4521000000", "rateDate": "2026-08-23", "rateSource": "bcv",
    "amountUsd": "50.75"          // calculado en servidor, autoritativo
} }
```

```ts
{ key: "monto", type: "money", required: true,
  config: { storeIn: "USD", allowedCurrencies: ["USD","VES","EUR"], rateSource: "bcv" },
  promoteTo: "amount_usd" }
```

El invariante es atómico (un objeto, escrito una vez). El formulario muestra un control:
monto + toggle de moneda + una pista en vivo "≈ $50.75 USD". Y **`amountUsd` se recalcula en
el servidor y el valor del cliente se descarta** — no negociable, es el número que suman los
reportes del dueño.

### 7 — Banco

```ts
{ key: "banco", type: "select", options: BANCOS,
  enabledWhen: { op: "eq", field: "metodo_pago", value: "pago_movil" },
  required:    { op: "eq", field: "metodo_pago", value: "pago_movil" } }
```

### Nota sobre el builder self-service

Los campos 1, 2, 3, 4 y 6 del hotel están mal especificados por el cliente. Un builder
self-service le habría dejado meter esos errores a datos permanentes e irreversibles. Por eso
las reglas de evolución de abajo no son burocracia: son lo único que hace seguro el builder.
Y el builder debe arrancar desde una **plantilla**, nunca desde una página en blanco.

---

## Reglas de evolución del esquema (críticas por el builder self-service)

El problema entero es que las claves JSONB *son* el esquema y no hay DDL que proteja. Las
reglas tienen que ser estructurales, no de procedimiento.

**Regla 1 — `entity_fields.key` es inmutable para siempre.** Con un trigger `BEFORE UPDATE`
que lance excepción, no solo con código de aplicación. Un "rename" cambia solo `label`. Esto
resuelve ~90% de los renames a costo cero y es la regla de mayor palanca del diseño. La clave
se auto-genera como slug del *primer* label, y la UI dice "nombre interno, no se puede
cambiar". Slug legible, no el UUID: `data->>'f_7a3e91c2'` hace miserable toda sesión de
debugging y todo reporte SQL.

**Regla 2 — los tipos solo cambian por un retículo de ampliación con whitelist, nunca en
sitio.**
```ts
const WIDENINGS: Record<FieldType, FieldType[]> = {
  integer: ["number", "text"], number: ["text"], text: ["textarea"],
  select: ["multiselect", "text"], date: ["datetime"],
  // el resto: [] — requiere campo nuevo + backfill
};
```
Todo lo que sale del retículo (`text → number`, `money → number`) está **prohibido**. El
camino es: crear campo nuevo, correr un script de backfill idempotente y versionado, marcar
el viejo `deprecated_at`, ocultarlo del formulario pero mantenerlo en los exports.

**Regla 3 — nada se borra nunca.** `archived_at` en `entity_fields`. El dato se queda en
`data`. Purgar es una acción de admin separada, explícita y con confirmación tipeada. Razón:
un tenant que archiva `banco` en marzo no debe romper el reporte de ingresos por banco de enero.

**Regla 4 — las opciones de `select` se archivan, no se eliminan.** La más olvidada y la que
produce los bugs más confusos.
```ts
options: [{ value: "banesco", label: "Banesco" },
          { value: "provincial", label: "BBVA Provincial", archivedAt: "2026-06-01" }]
```
Si se borra un valor en duro, todo registro histórico que lo tenga se renderiza vacío, y la
re-validación estricta al editar rechaza una fila que era válida cuando se escribió.

**Regla 5 — versionar el conjunto de campos y estampar el registro.**
`entities.schema_version`, `entity_field_versions` (snapshot append-only con hash de
contenido), `entity_records.schema_version` estampado al escribir.

> **Validación al escribir: ESTRICTA contra la versión actual. Validación al leer: LAXA, no
> lanza nunca.**

Un registro escrito bajo v3 que no cumple las reglas de v7 es un no-evento esperado: se
renderiza, se exporta, se agrega. Solo al editarlo se fuerza una migración-al-leer. **Sin
esta regla, la primera vez que un tenant agregue un campo requerido, todos sus registros
históricos se vuelven imposibles de abrir.**

**Regla 6 — cambiar `promoteTo` es config + backfill, no DDL.** Un `UPDATE` acotado a
`(tenant_id, entity_id)`. Este es el pago de la decisión de columnas promovidas.

**Regla 7 — las definiciones se hashean y el script de aplicación se niega a destruir.**
`pnpm entities:apply` compara deseado-vs-actual, imprime el plan, aplica lo aditivo, y **sale
con código distinto de cero** ante cualquier archivado o cambio de tipo salvo que se pase
`--allow-destructive`. Guarda el hash aplicado para que re-ejecutar sea no-op.

---

## Analítica: hacer lo aburrido

Dimensionemos. Un hotel con 50 entradas/día son ~18.000 filas/año. Tres clientes ≈ 55k
filas. Postgres agrega eso en milisegundos de un dígito en frío. **Cualquier vista
materializada, tabla de hechos o generador de vistas desde metadata que se construya ahora es
costo puro.**

**Recomendación: funciones de reporte tipadas en código, parametrizadas por clave de campo,
consultando `entity_records` directo.** No SQL generado desde metadata.

```ts
// lib/templates/hotel/reports.ts
export const incomePerBank: ReportDef = {
  key: "income_per_bank", capability: "report:read",
  async run({ tx, tenantId, entityId, from, to }) {
    return tx.execute(sql`
      SELECT COALESCE(data->>'banco', 'efectivo_' || lower(data->'monto'->>'currency')) AS tender,
             count(*) AS entries, sum(amount_usd) AS total_usd
      FROM entity_records
      WHERE tenant_id = ${tenantId} AND entity_id = ${entityId} AND deleted_at IS NULL
        AND occurred_at >= ${from} AND occurred_at < ${to}
      GROUP BY 1 ORDER BY total_usd DESC`);
  },
};
```

Por qué SQL en código y no vistas generadas:
- **Es legible.** En 8 meses hay que depurar "los totales están $12 abajo". Un string de 10
  líneas de SQL es tratable; una vista emitida por un compilador de metadata no.
- **Es honesto con el dominio.** "Ingresos por medio de pago" es genuinamente
  `banco ?? efectivo_<moneda>` — un coalesce sobre dos campos distintos. Un `GROUP BY <campo>`
  genérico no lo expresa, así que habría que escribirlo a mano igual, pero con más indirección.
- Las columnas promovidas ya dieron el tipado, así que `sum(amount_usd)` y los rangos
  sobre `occurred_at` pegan índices reales.

Los reportes viven en el plugin de plantilla de Nivel 3, así que `hotel.reservation` trae sus
tres reportes y el hotel #2 los recibe gratis. **Ese es el mecanismo de reutilización — no la
generación de SQL.**

**`peakHours` debe calcular la hora en tiempo LOCAL del tenant:**
`extract(hour from occurred_at AT TIME ZONE ${tz})`. De ahí `tenants.timezone text NOT NULL
DEFAULT 'America/Caracas'`. "Horas pico" en UTC está mal por 4 horas, lo que para un hotel
significa que el reporte es basura.

**Escalera de escalamiento, en orden y solo cuando se mida:**
1. Índices parciales y de expresión sobre las columnas promovidas (lleva a ~10M filas).
2. `VIEW` plana por entidad generada desde metadata (`data->>'k' AS k`). Su valor no es
   rendimiento — es dejar que Metabase/Excel consulten con nombres legibles. Cuando un
   cliente pida acceso BI.
3. Tabla de rollup a grano diario con recomputo incremental de los últimos 3 días.
4. Solo entonces, export columnar.

**Se descartan explícitamente las vistas materializadas.** `REFRESH` bloquea;
`CONCURRENTLY` exige índice único y recomputa todo. Una tabla de rollup con upserts
incrementales es estrictamente mejor y no es más difícil de escribir.

**También se descarta una tabla de hechos separada.** Es la idea de las columnas promovidas
con pasos extra y una segunda cosa que mantener sincronizada. Las columnas promovidas *son*
la tabla de hechos, desnormalizada en la fila que ya existe.

---

## La tasa BCV: donde va a estar la primera llamada molesta

```sql
CREATE TABLE exchange_rates (
  base_currency  char(3) NOT NULL,
  quote_currency char(3) NOT NULL,
  valid_on       date    NOT NULL,
  rate           numeric(20,10) NOT NULL CHECK (rate > 0),
  source         text    NOT NULL CHECK (source IN ('bcv','manual')),
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, base_currency, quote_currency, valid_on)
);
```
Global, sin RLS, legible por todos.

Cuatro cosas que la propuesta `(currency, rate, valid_on, source)` no contempla:

- **Par y dirección.** ¿`rate` es USD por VES o VES por USD? Hacen falta `base_currency`,
  `quote_currency` y una convención escrita ("unidades de quote por 1 de base"). Y hace falta
  EUR, porque el dueño quiere euros consolidados — no es tabla de una sola moneda.
- **`numeric(20,10)`**, no `(14,2)`. Una tasa con dos decimales no sirve.
- **El BCV publica la tasa de mañana hoy, y no publica fines de semana ni feriados.** El
  lookup nunca es `WHERE valid_on = current_date`, es la última tasa con `valid_on <= :fecha`:
  ```sql
  SELECT rate FROM exchange_rates
  WHERE base_currency='USD' AND quote_currency='VES' AND valid_on <= $1
  ORDER BY valid_on DESC LIMIT 1;
  ```
- **El scraper se va a caer y el hotel no puede dejar de cobrar.** Hace falta un formulario
  de override manual para el dueño (de ahí `source IN ('bcv','manual')`) y una alerta cuando
  el último fetch tenga más de 24h. Sin esto, un cambio del HTML del BCV un viernes es un fin
  de semana de ingresos que nadie puede registrar.

El job vive en `app/api/cron/bcv/route.ts` con Vercel Cron, protegido con bearer secret (no
"es una URL oscura"). Vercel Cron y no `pg_cron`: es TypeScript, testeable, y se puede
disparar a mano.

---

## Roles y lo que falta en la propuesta

**RBAC: empezar en código, no en tablas.** `memberships(user_id, tenant_id, role)` sí, día
uno. Pero una matriz de permisos por entidad en tablas sin UI para editarla es estrictamente
peor que 30 líneas de TypeScript — vamos a ser los únicos escribiendo filas, por SQL, y nos
vamos a equivocar en silencio.

```ts
// lib/authz/roles.ts
export const CAPABILITIES = {
  owner:   ["record:create","record:read_all","record:update","record:delete","report:read","entity:manage","rate:override"],
  manager: ["record:create","record:read_all","record:update","report:read"],
  staff:   ["record:create","record:read_own"],
} as const satisfies Record<Role, readonly Capability[]>;
```

Mover a filas de DB la primera vez que un cliente pida un rol que no tenemos. No antes.

**Y la visibilidad por campo es la herramienta equivocada para el requerimiento del hotel.**
"El dueño ve los ingresos consolidados, el personal no" no es "enmascarar una columna" — es
"el panel de totales y la ruta de reportes exigen `report:read`". Autorización por
ruta/consulta: más simple y no se puede filtrar por una respuesta de API que se olvidó redactar.

### Lo que falta por completo en la propuesta

No son "nice to have" para un **negocio de efectivo con personal de baja confianza y acceso
multi-rol**:

1. **Log de auditoría.** `record_events(id, tenant_id, record_id, actor_id, action, diff jsonb, at)`,
   append-only, insertado en la misma transacción que la escritura. Sin esto no se puede
   responder "el turno de noche dice que metió $200 y el total muestra $150". **Es la omisión
   #1.**
2. **Soft delete** (`deleted_at`). Borrado duro en una tabla de dinero es negligencia.
3. **Clave de idempotencia.** Recepción con wifi de hotel, doble tap en enviar → ingreso
   duplicado casi imposible de distinguir de dos walk-ins reales. `client_request_id uuid`
   con `UNIQUE (tenant_id, client_request_id)`, generado en el navegador al abrir el
   formulario. Cuatro líneas, previene una clase de dato irreparable.
4. **Zona horaria del tenant** (ver analítica).
5. **Export de datos del tenant.** Un botón, un cliente pidiéndolo, y la diferencia entre un
   trabajo de dos horas y uno de dos días.
6. **Observabilidad.** Trabajamos solos: Sentry, o no nos enteramos de los errores.

### Autorización y Next 16

**La autorización no va en `proxy.ts`** (en Next 16 el archivo antes llamado `middleware.ts`
se llama `proxy.ts`). Ese archivo es para redirects. La autorización va en la capa de datos —
CVE-2025-29927 fue exactamente eso.

**Los Server Actions son endpoints POST públicos.** No son "internos". Cada action necesita
su propio `requireTenant()` + `requireCapability()` arriba. No confiar en que la UI no
renderice el botón.

**Lecturas por RSC, escrituras por Server Actions.** No usar Server Actions para la lectura
de la tabla: son POST-only, sin caché, y serializan mal.

---

## Qué pasa con el código actual

La decisión es convertir la app de finanzas en plantilla, y esa es la intención correcta —
pero hay que ser preciso en *qué* se convierte, porque hay una trampa.

[`transaction-form-dialog.tsx`](../components/finanzas/transaction-form-dialog.tsx) y
[`transaction-table.tsx`](../components/finanzas/transaction-table.tsx) **no están
parametrizados por nada.** El formulario tiene bloques `FormField` escritos a mano con labels
en español duros, un `"Monto (MXN)"` literal y un `console.log`. La tabla tiene booleanos
`showTypeFilter`/`showTotal` y semántica ingreso/gasto hardcodeada. Convertir *esos
componentes React* en plantillas cuesta más que escribir las versiones dirigidas por metadata
desde cero — y mientras se intenta, arrastran supuestos de dominio (MXN, dualidad
ingreso/gasto) hacia el motor genérico.

**Lo que sí se conserva, y es mucho:**
- El sistema de diseño completo: los tokens oklch de `app/globals.css` con las extensiones
  `--success`/`--warning`/`--info`, `.app-shell-main` con su grilla punteada, los 22
  componentes de `components/ui/`, las fuentes, el light/dark, los wrappers de framer-motion.
- El shell de aplicación (sidebar + header sticky + transiciones de página).
- **La plantilla de finanzas se reescribe como definiciones de entidad reales** en
  `lib/templates/finanzas/` — `movimientos`, `productos`, `servicios`. Eso es lo que un
  cliente nuevo activa. Es la misma intención, implementada por el motor en vez de
  retrofiteando JSX.
- Las páginas mock se mueven a `app/(showcase)/**` congeladas y sirven como **demo de
  ventas**, que es su valor real y no es trivial. Se borran cuando haya dos clientes
  pagando y screenshots reales.
- `lib/mock-data.ts` → `lib/showcase/mock-data.ts` intacto. Se extrae solo lo genuinamente
  reutilizable — `formatDate`, `getPercentChange` — a `lib/format.ts`. `formatCurrency`
  está hardcodeado a MXN; el motor necesita
  `formatMoney(amount: string, currency: string, locale: string)`.

**Lo que se elimina:** el mapa `routeTitles` de
[`header.tsx`](../components/layout/header.tsx) — un client component haciendo `usePathname()`
contra una tabla de 16 rutas hardcodeadas. En el mundo nuevo los títulos vienen del metadata
de la entidad; el layout servidor los pasa como props.

**Lo que NO se arrastra:** el patrón de las tablas actuales, que filtran, ordenan y paginan
**en el cliente sobre un array completamente materializado**. Si se porta esa forma a JSONB
vamos a hacer `SELECT * FROM entity_records WHERE tenant_id = ...` y filtrar 50k filas en el
navegador. `WHERE`/`ORDER BY`/`LIMIT` en servidor desde `searchParams`, renderizado en RSC,
desde el día uno.

**TanStack Table: la librería correcta, en la fase equivocada.** Una vez que la forma de los
datos sea correcta, una tabla dirigida por metadata sobre el `components/ui/table.tsx` que ya
existe son ~120 líneas. TanStack entra en la Fase 4, cuando se quiera
visibilidad/reorden/resize de columnas persistidos — que es una razón genuinamente buena,
solo que no de Fase 1.

---

## Estructura de archivos

```
app/
  (app)/                             # UN layout, reemplaza los 4 idénticos
    layout.tsx                       # server component; sidebar + header
    [tenantSlug]/
      layout.tsx                     # requireMembership(slug) -> TenantProvider
      page.tsx
      [entity]/
        page.tsx                     # RSC lista: filtro/orden/página en servidor desde searchParams
        nuevo/page.tsx               # formulario generado
        [recordId]/page.tsx          # detalle + traza de auditoría
        [recordId]/editar/page.tsx
      reportes/page.tsx  reportes/[reportKey]/page.tsx
      ajustes/
        entidades/page.tsx           # el builder (lectura en Fase 2, escritura en Fase 5)
        tasas/page.tsx               # override manual de tasa BCV
  (showcase)/                        # demo congelada: finanzas/inventario/productos actuales
  admin/page.tsx                     # super-admin + impersonation
  api/cron/bcv/route.ts              # Vercel Cron, con bearer secret
proxy.ts                             # nombre de Next 16; solo redirects, NUNCA authz

lib/
  db/       index.ts (postgres.js + drizzle, pooled, prepare:false)
            schema.ts  tenant.ts (withTenant)  migrate.ts
  engine/   field-types.ts  conditions.ts  zod-builder.ts  promote.ts
            query.ts  mutations.ts (ÚNICA ruta de escritura)  read.ts
            resolvers/{index,money,reference}.ts
  templates/registry.ts  hotel/{rooms,reservation,reports}.ts  finanzas/*.ts
  authz/    session.ts  membership.ts  roles.ts
  money.ts  format.ts  showcase/mock-data.ts  utils.ts

components/
  engine/   record-form.tsx  field-renderer.tsx  record-table.tsx  record-table-toolbar.tsx
            fields/{text,number,money,select,reference,datetime,boolean,file}-field.tsx
  builder/  entity-editor.tsx  field-editor.tsx  condition-editor.tsx   # Fase 5
  layout/header.tsx                # sin routeTitles, recibe props

scripts/  apply-entities.ts  backfill-promoted.ts
drizzle/  migraciones, incl. SQL a mano para RLS y triggers
```

---

## Fases

**Fase 0 — desbloquear (½ día, cero arquitectura nueva)**
- Reinstalar `eslint@^9` + `eslint-config-next@16`; `"lint": "eslint ."`. **Hoy `pnpm lint`
  está roto**: se quitaron de las deps en el commit `71f9b95` pero `eslint.config.mjs` sigue
  importándolos. Agregar `"typecheck": "tsc --noEmit"` y un GitHub Action con ambos. Son 20
  minutos y estamos por multiplicar el código por 5.
- Colapsar los 4 layouts byte-idénticos en `app/(app)/layout.tsx`.
- Mover el showcase y `lib/mock-data.ts`; extraer `lib/format.ts`.
- Borrar `routeTitles` de `header.tsx`; pasar título/descripción como props.
- Normalizar imports `zod/v4` → `zod`.
- Actualizar `AGENTS.md` (dice Next 16.2.2, es 16.3.2) y agregar un ADR con las decisiones de
  este plan.

**Fase 1 — cimientos (~3 días)**
- Proyecto Supabase. **La primera migración crea `app_user` con `NOBYPASSRLS`** y la app
  conecta con ese rol. Escribir el test de fuga cross-tenant *antes* de escribir cualquier política.
- Drizzle + `drizzle.config.ts` con `schemaFilter: ["public"]`. URL pooled (`prepare: false`)
  para la app, directa para migraciones.
- `lib/db/schema.ts` completo: tenants (con `timezone`), users, memberships, entities,
  entity_fields, entity_field_versions, entity_records (columnas promovidas,
  `client_request_id`, `deleted_at`), record_events, exchange_rates.
- FK compuesta `(tenant_id, entity_id)`. Trigger de inmutabilidad en `entity_fields.key`.
- Políticas RLS + `withTenant()` con `set_config(..., true)`.
- Supabase Auth vía `@supabase/ssr`; `requireSession` / `requireMembership` / `requireCapability`.
- **Criterio de salida: un test automatizado que pruebe que el tenant A no puede leer al B,
  con el filtro de aplicación deliberadamente quitado.**

**Fase 2 — el motor (~1½ semanas)**
- `field-types.ts` (catálogo cerrado + meta-esquema Zod), `conditions.ts` + `evaluate()`,
  `zod-builder.ts`, resolver propio de RHF.
- `record-form.tsx` + `field-renderer.tsx` + todos los componentes de campo, incluido el
  reloj de `datetime-field.tsx` y el compuesto `money-field.tsx`.
- `promote.ts`, `mutations.ts` (evento de auditoría + idempotencia en una transacción),
  `read.ts` (validación laxa al leer), `query.ts` (searchParams → SQL).
- `record-table.tsx` sobre `components/ui/table.tsx`, **paginada en servidor desde el inicio**.
- `exchange_rates` + cron BCV + override manual + alerta de obsolescencia + resolver `money`.
- `scripts/apply-entities.ts`.
- `ajustes/entidades` en modo lectura (inspector de campos).

**Fase 3 — validar el motor con el hotel (~4 días, sin salir a producción)**
Aquí se construyen `lib/templates/hotel/{rooms,reservation,reports}.ts` como banco de pruebas.
Es la única forma de saber que el motor está completo. Contar cuántas veces se recurre al
Nivel 3: ese número es el roadmap.
- Reservación: `tipo_id` y `habitacion_id` (reference + opciones dependientes),
  `hora_entrada`/`hora_salida` (**datetime**), `metodo_pago` (select con códigos estables),
  `monto` (money), `banco` (select + `enabledWhen`).
- Constraint de entidad `hora_salida > hora_entrada`. Evaluar el constraint de exclusión de
  solapamiento de habitación como check de Nivel 3.
- Roles `staff` / `owner`. Reportes del dueño: ingresos por medio de pago (4 bancos +
  efectivo VES/USD + EUR), top habitaciones, horas pico — **todo en hora local del tenant**.
- Plantilla `lib/templates/finanzas/` reescrita como definiciones de entidad.

**Fase 4 — endurecer (~1 semana)**
- Sentry, rate limiting en actions, export de datos del tenant, chequeo nocturno de
  consistencia de columnas promovidas.
- TanStack Table, ahora sí, para visibilidad/reorden de columnas persistidos.
- Onboarding del hotel a producción.

**Fase 5 — el builder self-service (~1½–2 semanas)**
`ajustes/entidades` pasa a escritura. **Las Reglas 1–7 se aplican en la UI, no solo en la
API** — el builder solo es seguro si la UI hace imposible lo destructivo.
- Envío en orden: "agregar campo" → "reordenar/agrupar" → "editar etiquetas y opciones" →
  "archivar campo". **"Cambiar tipo" posiblemente nunca.**
- Arrancar siempre desde una plantilla, nunca desde una página en blanco.
- Editor visual de condiciones sobre el tipo `Cond` (dropdown campo/operador/valor, no texto libre).
- Impersonation de super-admin desde `admin/` — necesaria para depurar "dice requerido y
  yo lo llené".

---

## Verificación

**Fase 0:** `pnpm lint` y `pnpm typecheck` pasan. `pnpm dev` levanta y las páginas del
showcase se ven idénticas a hoy en `/(showcase)`.

**Fase 1 — el más importante de todo el plan:**
```
1. SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user;   -- false
2. Test de integración: sembrar tenants A y B con un registro cada uno.
   Consultar como A con withTenant(A) pero SIN el eq(tenantId) en el WHERE.
   Debe devolver 1 fila (la de A), no 2.
3. Intentar UPDATE de entity_fields.key -> debe lanzar excepción del trigger.
4. Intentar insertar un entity_record con tenant_id de A y entity_id de B
   -> debe fallar por la FK compuesta.
```

**Fase 2:**
- Test unitario de `evaluate()` sobre los 11 operadores + detección de ciclos.
- Test de `buildZodSchema` con un `required: Cond`: enviar sin `banco` y
  `metodo_pago="efectivo"` → válido; con `metodo_pago="pago_movil"` → inválido.
- Test de stripping en servidor: enviar `banco="banesco"` con `metodo_pago="efectivo"` →
  la fila guardada no tiene la clave `banco`.
- Test de idempotencia: enviar el mismo `client_request_id` dos veces → una sola fila.
- Test de `money`: enviar `{currency:"VES", amount:"1850.00", amountUsd:"999999"}` → el
  `amountUsd` guardado es el recalculado en servidor, no el del cliente; y `rate`/`rateDate`
  quedan persistidos.
- Test del lookup de tasa en sábado (sin fila de ese día) → toma la del viernes.

**Fase 3, contra el motor y sin código a medida salvo el plugin de plantilla:**
- Registrar una entrada con entrada 23:30 y salida 02:15 del día siguiente → duración
  positiva de 165 min.
- Registrar pago móvil sin banco → rechazado. Con banco → aceptado.
- Registrar efectivo → el campo banco visible pero deshabilitado.
- Elegir "suite" → el selector de habitación solo lista suites.
- Como `staff`, pedir `/reportes` → 403. Como `owner` → los tres reportes cuadran contra una
  suma calculada a mano de 20 registros sembrados.
- Horas pico con registros a las 23:00 hora Caracas → aparecen en la hora 23, no en la 3.
- Agregar un campo requerido nuevo a la entidad → los 20 registros anteriores siguen
  abriéndose, listándose y exportándose sin excepción.

**Fase 5:** crear una entidad completa desde la UI sin tocar código, y verificar que la UI
hace imposible renombrar una `key`, cambiar `money` a `number`, y borrar (no archivar) una
opción de select en uso.
