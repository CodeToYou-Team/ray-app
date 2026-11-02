# 6. Arquitectura técnica

Resumen técnico de cómo está construida la app hoy. Las decisiones y su justificación completa
están en [`../plan_arquitectura_v2.md`](../plan_arquitectura_v2.md); la configuración de
Supabase, en [`../setup.md`](../setup.md).

## Stack

| Pieza | Versión / detalle |
|---|---|
| Framework | Next.js 16.3 (App Router), React 19.2, TypeScript estricto |
| Estilos | Tailwind CSS 4 (tokens en `app/globals.css`), componentes shadcn/ui en `components/ui` |
| Base de datos | Postgres en Supabase, accedido con Drizzle ORM + `postgres` (postgres.js) |
| Autenticación | Supabase Auth (solo autenticación, vía `@supabase/ssr`) |
| Validación | Zod 4 |
| Gráficos | Recharts |
| Tema | `next-themes` (claro/oscuro) |
| Fuentes | Plus Jakarta Sans + IBM Plex Mono |
| Tests | Vitest |
| Gestor de paquetes | pnpm |

## Organización del código

```
app/
  (auth)/          login, registro, sin-acceso — sin barra lateral
  (admin)/admin    administración de la plataforma: alta, edición y suspensión de negocios
  (app)/           todas las pantallas internas, bajo un único layout (barra lateral + cabecera)
    layout.tsx     resuelve sesión y negocio; redirige a /login, /sin-acceso o /admin
    error.tsx      pantalla "Algo salió mal" con el código (digest) del error
components/        UI por módulo (finanzas, productos, inventario, ajustes, catalogs, fields…)
lib/
  admin/           negocios vistos por el admin de la plataforma (núcleo + actions)
  authz/           sesión, roles/permisos, miembros e invitaciones
  db/              esquema Drizzle, conexión, withTenant / withUser / withPlatformAdmin
  finanzas/        registro de operaciones, consultas, reportes, dashboard
  productos/       alta/edición de productos y servicios, ajustes de stock
  inventario/      cálculo de stock
  reservas/        recursos, reservas, disponibilidad, check-in/out y cobros
  catalogs/        registro de catálogos y sus acciones
  fields/          columnas personalizadas: tipos, resolución, validación
  tenant/          moneda por defecto y tasas vigentes
  money.ts         aritmética exacta de dinero
  currencies.ts    lista cerrada de monedas
  nav.ts           registro único de rutas (cabecera + barra lateral + permisos por ruta)
drizzle/           migraciones (las de RLS, triggers y roles, escritas a mano)
scripts/           alta de clientes y utilidades de base de datos
tests/             Vitest
proxy.ts           refresco de sesión (antes "middleware")
```

## Flujo de una petición

- **Lecturas**: las páginas son Server Components que consultan Postgres directamente (con
  `withTenant`) y pasan los datos ya calculados a componentes cliente. Nunca se traen todas las
  filas para filtrar en el navegador: la paginación, búsqueda y totales se resuelven en SQL.
- **Escrituras**: Server Actions (`"use server"`). Cada una:
  1. llama a `requireCapability(permiso)`, que resuelve sesión, negocio y rol, y falla si falta
     el permiso;
  2. delega en la lógica de negocio;
  3. invalida las rutas afectadas con `revalidatePath`.
- **Separación `actions.ts` / `register.ts`**: en finanzas, productos, reservas, campos y miembros, la
  lógica vive en un archivo que recibe `{ tenantId, userId }` explícitos y no sabe de sesiones;
  `actions.ts` es solo la envoltura con el permiso. Así la lógica de dinero e inventario se
  prueba sin simular Supabase. Las rutas no deben llamar `register.ts` directamente.
- **Errores**: las acciones devuelven `{ ok: false, error }` con mensajes en español; los errores
  de Postgres (únicos, FK, CHECK) se traducen a algo legible.

## Aislamiento entre clientes

Varias capas, de la más externa a la más interna:

1. **`proxy.ts`** solo refresca la sesión. No autoriza (una autorización en middleware se puede
   saltar; ver CVE-2025-29927).
2. **`requireTenant` / `requireCapability`** deducen el negocio de la membresía del usuario
   autenticado (`supabase.auth.getUser()`, que valida el token contra el servidor). El negocio
   no viaja en la URL.
3. **Cada consulta filtra por `tenant_id`** explícitamente.
4. **RLS en Postgres**: `withTenant(tenantId, fn)` abre una transacción y fija
   `app.current_tenant_id` con `set_config(..., true)` (local a la transacción, seguro con el
   pooler en modo transacción). Todas las políticas comparan `tenant_id` con ese valor.
5. **Rol `app_user` sin BYPASSRLS**: la app se conecta con un rol que no puede saltarse RLS.
   `postgres` y `service_role` sí pueden, por eso no se usan. `assertRlsEnforced()` lo verifica.
6. **Data API (PostgREST) desactivada**: `supabase-js` solo se usa para auth y su cliente está
   tipado como `{ auth }`, así que leer datos por ahí no compila.
7. **"Automatic RLS" de Supabase** activo: una tabla nueva sin políticas queda cerrada.

**Arranque de sesión.** Para saber el negocio hay que leer `memberships`, que está protegida por
negocio. `withUser(userId, fn)` fija `app.current_user_id` y habilita solo políticas de lectura
sobre las propias membresías, los negocios a los que se pertenece, la propia fila de usuario y
las invitaciones dirigidas al propio correo.

**Administración de la plataforma.** `withPlatformAdmin(adminId, fn, tenantId?)` fija
`app.platform_admin_id`, un GUC propio y distinto del de usuario, para que el arranque de sesión
normal de un admin no vea nada de más. Las políticas de admin solo se activan si ese id está en
`platform_admins`, y solo permiten **leer** `tenants`, `memberships`, `users` e `invitations` de
todos los negocios: nada de operaciones, reservas, productos ni auditoría. Las escrituras del
admin pasan por el contexto del negocio que modifican (`tenantId`), con las mismas políticas de
siempre.

`platform_admins` tiene dos niveles, `admin` y `superadmin`. Solo un superadmin escribe en ella
desde la app (`is_platform_superadmin()`, `SECURITY DEFINER` para que su política no se llame a
sí misma). Un trigger con bloqueo asesor impide quedarse sin superadmin, también ante dos cambios
simultáneos (error `PA001`), y otro registra cada cambio en `platform_audit_log` con el actor,
incluido el script (actor nulo). `app_user` solo lee ese log, y solo si es superadmin.

## Modelo de datos

| Tabla | Para qué | Notas |
|---|---|---|
| `tenants` | Negocios | `slug`, `timezone` (por defecto America/Caracas), `primary_currency`, `suspended_at` (solo lo cambia un admin: trigger) |
| `platform_admins` | Administradores de la plataforma | `level` admin/superadmin; solo un superadmin escribe; siempre queda uno (trigger) |
| `platform_audit_log` | Auditoría de lo que no es de un negocio (cambios de admins) | La escribe solo un trigger; `actor_id` nulo = script |
| `users` | Espejo de `auth.users` | Lo mantiene un trigger sobre `auth.users` |
| `memberships` | Usuario ↔ negocio + rol | Único por (usuario, negocio). Rol: owner/manager/staff |
| `invitations` | Correos invitados con rol | Correo en minúsculas; una pendiente por correo y negocio |
| `catalog_items` | Todos los catálogos (polimórfica por `catalog_key`) | `code` inmutable (trigger); `currency` solo en métodos de pago (CHECK) |
| `products` | Productos | `custom` jsonb; SKU único entre no archivados; `deleted_at` = archivado |
| `services` | Servicios | Igual que productos, sin SKU ni stock. `booking_unit` (noche/hora, o nulo si no se reserva), `booking_shared`, `booking_per_person` |
| `transactions` | Ingresos y gastos | `type` ingreso/gasto, `kind` operacion/venta/compra, `currency` copiada, `exchange_rate` + `base_currency`, `client_request_id` (idempotencia), `deleted_at` = anulada |
| `transaction_items` | Renglones de ventas y compras | Precio congelado; CHECK `subtotal = round(qty*unit_price, 2)` |
| `stock_movements` | Entradas y salidas de stock | Append-only (trigger bloquea UPDATE; RLS no permite DELETE) |
| `exchange_rates` | Tasa vigente por par | Solo sugerencia; único por (negocio, base, destino) |
| `resources` | Lo que se reserva (habitación, cancha…) | Pertenece a un servicio; `capacity`; nombre único entre los activos; `archived_at` |
| `bookings` | Reservas | `period` (`tstzrange` semiabierto), `status`, `party_size`; precio, moneda, `shared` y `per_person` copiados del servicio; horas de llegada y salida; `custom` jsonb |
| `service_schedules` | Turnos de un servicio por hora | Día ISO (1 = lunes), hora de inicio y fin; un `EXCLUDE` impide dos turnos solapados el mismo día. Nada los referencia: se borran sin perder historia |
| `booking_payments` | Cobro ↔ reserva | Liga una transacción de ingreso con la reserva y guarda lo abonado **en la moneda de la reserva**. Append-only |
| `field_config` | Configuración de columnas | `key` y `type` inmutables (trigger) |
| `audit_log` | Auditoría | Append-only; sin FK al usuario para sobrevivir a su baja |

Integridad que impone la base (no solo la app):

- **FK compuestas** `(tenant_id, catalog_key, id)`: una categoría de gasto no puede usarse en un
  ingreso, ni una de servicio en un producto.
- `kind` coherente con `type`: venta solo en ingresos, compra solo en gastos.
- Un renglón apunta a un producto **o** a un servicio, nunca a ambos.
- Trigger: una operación suelta no puede tener renglones; una compra no puede llevar servicios.
- Montos y precios no negativos; cantidades de renglón > 0; movimientos de stock ≠ 0.
- **Reservas exclusivas**: `EXCLUDE USING gist` impide dos reservas activas solapadas del mismo
  recurso (canceladas y no presentadas no cuentan). Requiere la extensión `btree_gist`.
- **Reservas compartidas**: un trigger bloquea la fila del recurso y rechaza la reserva si el
  **pico** de ocupación del rango pasaría de la capacidad (error `RS001`; `RS002` si el grupo no
  cabe en un exclusivo).
- Reserva y recurso atados por FK compuesta `(tenant_id, service_id, resource_id)`.
- Estado de la reserva coherente con sus horas de llegada, salida y cancelación (CHECK).
- Trigger: no se puede cambiar el monto, la moneda ni la tasa de una transacción que es cobro de
  una reserva.
- `updated_at` se mantiene por trigger.

Los ids son **UUIDv7** (ordenados por tiempo), generados en la app.

## Dinero

- En Postgres es `numeric`; en TypeScript, **siempre `string`**. Nunca `number`.
- Toda la aritmética pasa por [`lib/money.ts`](../../lib/money.ts), que trabaja con `BigInt`
  escalados: montos con 2 decimales, cantidades con 3, tasas con 6.
- El redondeo (half-up) coincide con `round(x, 2)` de Postgres, para que el CHECK del subtotal
  nunca rechace un renglón calculado por la app.
- Por usar `BigInt`, `tsconfig` apunta a ES2022.

## Auditoría

Cada escritura relevante inserta una fila en `audit_log` **en la misma transacción**: entidad,
id, acción (`create`/`update`/`delete`/`restore`), quién y un `diff` con lo que cambió
(`{ campo: { from, to } }`). Cubre operaciones (alta, corrección, anulación), productos,
servicios, ajustes de stock, catálogos, columnas, invitaciones, membresías, recursos, reservas
(alta, cancelación, llegada, salida, no presentado) y cobros. Hoy no hay pantalla para
consultarla.

## Migraciones

En `drizzle/`, aplicadas con `pnpm db:migrate`:

| Archivo | Contenido |
|---|---|
| `0000_tenancy` | tenants, users, memberships, audit_log |
| `0001_rls_and_app_role` | `current_tenant_id()`, rol `app_user`, RLS base |
| `0002_auth_mirror` | trigger espejo `auth.users` → `users` |
| `0003_catalogs` / `0004_catalogs_rls` | catálogos, `code` inmutable, `updated_at` |
| `0005_transactions_inventory` / `0006_transactions_rls` | productos, servicios, operaciones, renglones, stock y sus reglas |
| `0007_user_bootstrap_rls` | políticas de `withUser` |
| `0008_widen_currency` | monedas a `varchar(10)` (USDT, USDC) |
| `0009_category_required` | categoría obligatoria en productos y servicios |
| `0010_field_config` / `0011_field_config_rules` | columnas personalizadas |
| `0012_invitations` / `0013_invitations_rls` | invitaciones |
| `0014_exchange_rate` | tasa por operación |
| `0015_exchange_rate_settings` | tasas vigentes por par |
| `0016_bookings` | recursos, reservas, `btree_gist` y el `EXCLUDE` contra la doble reserva |
| `0017_booking_checkin_payments` | check-in/check-out, cobros de reservas y el trigger que protege su dinero |
| `0018_booking_capacity` | capacidad, recursos compartidos, cobro por persona y el trigger de cupos |
| `0019_service_schedules` | horarios fijos (turnos) de los servicios por hora |
| `0020_booking_custom_fields` | columnas personalizadas en la reserva (`field_entity` + `bookings.custom`) |
| `0021_platform_admin` | `platform_admins`, políticas de lectura del admin, `tenants.suspended_at` y el trigger que se lo niega al negocio |
| `0022_platform_superadmin` | nivel superadmin, sus políticas de escritura, "al menos un superadmin" y `platform_audit_log` |

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm dev` / `build` / `start` | Servidor de desarrollo, build y producción |
| `pnpm lint` / `typecheck` | ESLint (debe quedar limpio) y `tsc --noEmit` |
| `pnpm db:generate` / `db:migrate` / `db:studio` | drizzle-kit |
| `pnpm db:bootstrap` | Habilita la contraseña de `app_user` y escribe `DATABASE_URL` en `.env.local` |
| `pnpm db:check` | Diagnóstico de conexión |
| `pnpm seed:tenant --name … --slug … --email …` | Da de alta un negocio, su dueño (que debe estar registrado antes) y los catálogos iniciales. Idempotente |
| `pnpm admin:grant --email … [--super \| --revoke]` | Da o quita acceso a `/admin`. Para el primer superadmin; después se gestionan en `/admin/administradores` |
| `pnpm test` | Vitest |

Los negocios se dan de alta desde `/admin` (ver [Acceso](01-acceso-y-roles.md#administración-de-la-plataforma-admin)).
`seed:tenant` sigue sirviendo para la primera instalación, cuando todavía no hay admin.

## Variables de entorno

Definidas y documentadas en [`lib/env.ts`](../../lib/env.ts) (no hay `.env.example` a propósito):

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión de la app: transaction pooler (6543) con el usuario `app_user.<project_ref>` |
| `DIRECT_URL` | Migraciones |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Solo autenticación |

## Tests

En `tests/` (Vitest): dinero, navegación, catálogos, campos, productos, registro y corrección de
operaciones, consultas de finanzas, reportes, tasas, miembros, aislamiento entre clientes y
reservas (incluidas reservas y cobros simultáneos). Los
tests de base de datos **se saltan sin `TEST_DATABASE_URL`** (un verde sin esa variable no prueba
nada) y corren contra un Postgres remoto, con timeout de 30 s por latencia de red.
