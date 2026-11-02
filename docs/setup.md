# Setup de base de datos (Supabase)

Pasos para dejar corriendo la Fase 1. Todo el codigo ya esta; falta el proyecto de
Supabase y sus credenciales.

## 1. Crear el proyecto

En [supabase.com](https://supabase.com) crea un proyecto. Guarda la password del
rol `postgres` que te muestra al crearlo — es la que va en `DIRECT_URL`.

Al crearlo aparecen tres opciones. Van asi:

| Opcion | Valor | Motivo |
| :--- | :--- | :--- |
| Enable Data API | **OFF** | Es PostgREST. No lo usamos: los datos van por Drizzle sobre el protocolo nativo de Postgres. Encendido seria solo superficie de ataque. |
| Automatically expose new tables | **OFF** | Redundante con la Data API apagada, pero evita que una tabla nueva quede expuesta sin decision explicita si algun dia se enciende. |
| Enable automatic RLS | **ON** | Red de seguridad: activa RLS en toda tabla nueva de `public`. Olvidarse de un `ENABLE ROW LEVEL SECURITY` es el fallo catastrofico del proyecto; con esto, una tabla sin politicas queda en default-deny y la app falla ruidosamente en vez de filtrar datos en silencio. |

Al desactivar la Data API, Supabase advierte que "supabase-js y librerias
similares no podran consultar ni mutar datos". **Eso es exactamente lo buscado.**
Lo que sigue funcionando:

- **Supabase Auth** — es otro servicio (GoTrue, en `/auth/v1`), independiente de
  PostgREST. `supabase.auth.getUser()`, login, registro y el refresh de sesion de
  `proxy.ts` no se tocan.
- **Las consultas de la app** — Drizzle habla Postgres directo por el pooler.
- **Storage** — tambien es un servicio aparte.

Lo unico que deja de funcionar es `supabase.from(...)`, que no se usa en ningun
lugar del codigo. De hecho `createSupabaseServerClient()` devuelve un tipo
estrechado a `{ auth }`, asi que intentar leer datos con supabase-js es un error
de compilacion, no una convencion.

Efecto colateral menor: el **Table Editor** del dashboard puede quedar sin poder
navegar filas, porque usa la Data API. Para eso esta `pnpm db:studio` (Drizzle
Studio). El setting es reversible.

## 2. Generar la password de `app_user`

La app **no** conecta con el rol `postgres`. Conecta con `app_user`, que crea
`drizzle/0001_rls_and_app_role.sql` y que no tiene `BYPASSRLS`.

La migracion crea el rol **sin login y sin password** a proposito, para no dejar
un secreto versionado en git. Genera una:

```bash
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

Guardala. La vas a usar dos veces: en el paso 4 (para habilitar el rol) y en el
`DATABASE_URL` del paso 3.

## 3. Crear `.env.local`

No hay `.env.example` en el repo a proposito: es un archivo mas donde se puede
filtrar una credencial por descuido, y `lib/env.ts` ya documenta cada variable
con el detalle de por que va asi. Crea el archivo a mano:

```bash
cat > .env.local <<'EOF'
DATABASE_URL=""
DIRECT_URL=""
NEXT_PUBLIC_SUPABASE_URL=""
NEXT_PUBLIC_SUPABASE_ANON_KEY=""
TEST_DATABASE_URL=""
TEST_DIRECT_URL=""
EOF
```

Las dos URLs de base de datos salen del boton **Connect** del proyecto:

| Variable | De donde | Puerto | Rol |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Transaction pooler | **6543** | `app_user` |
| `DIRECT_URL` | Session pooler | **5432** | `postgres` |

> **Si `DIRECT_URL` no conecta**, no pierdas tiempo: usa el **Transaction
> pooler (6543)** tambien para `DIRECT_URL`. Se verifico que aplica estas
> migraciones sin problema. En la red donde se configuro esto por primera vez
> ninguna de las dos opciones de 5432 era alcanzable — la Direct connection es
> solo IPv6 (`ENOTFOUND`) y el Session pooler cortaba la conexion
> (`ECONNRESET`) aun con el puerto abierto.
>
> Lo que el modo transaccion no soporta es estado de **sesion** (un `SET` que
> sobreviva al COMMIT) y prepared statements. Las migraciones no dependen de eso,
> y `withTenant` usa `set_config(..., true)` justamente para no depender de
> estado de sesion.

Supabase te da los strings con el rol `postgres`. En `DATABASE_URL` cambia el
usuario y la password por los de `app_user`.

`NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` salen de
**Project Settings > API**.

## 4. Migrar y habilitar el rol

```bash
pnpm db:migrate
```

Aplica en orden:

1. `0000_tenancy.sql` — tablas `tenants`, `users`, `memberships`, `audit_log`.
2. `0001_rls_and_app_role.sql` — rol `app_user`, `current_tenant_id()` y las
   politicas RLS.
3. `0002_auth_mirror.sql` — trigger que copia `auth.users` a `public.users`.

Ahora habilita el rol. Una sola vez, en el **SQL Editor** de Supabase, con la
password del paso 2:

```sql
ALTER ROLE app_user WITH LOGIN PASSWORD 'la-password-que-generaste';
```

Y comproba la conexion:

```bash
pnpm db:check
```

Te dice la version de Postgres, con que usuario estas conectado, cuantas
migraciones se aplicaron, que politicas hay, y falla si el rol puede saltarse
RLS. Eso ultimo es lo importante.

## 5. Verificar que RLS es real

**Este es el paso que no se puede saltar.** Los roles `postgres` y `service_role`
de Supabase tienen `BYPASSRLS`: si `DATABASE_URL` apunta a uno de ellos, todas las
politicas son decorativas y no hay aislamiento entre clientes — y no te enteras
hasta que un cliente ve los datos de otro.

Crea un segundo proyecto de Supabase (o usa un Postgres local) para tests, migralo
igual, y agrega a `.env.local`. **Que no sea la base de desarrollo**: los tests crean y
borran filas, y algunos (los de "siempre queda un superadmin") se saltan si encuentran
datos reales.

```
TEST_DATABASE_URL="postgresql://app_user:...@...:6543/postgres"
TEST_DIRECT_URL="postgresql://postgres:...@...:5432/postgres"
```

Luego:

```bash
pnpm test
```

`tests/tenant-isolation.test.ts` siembra dos clientes y consulta **quitando a
proposito el filtro `where tenant_id = ...`**. Si igual no aparecen las filas del
otro cliente, RLS funciona. Si aparecen, algo esta mal configurado y hay que
resolverlo antes de seguir.

Sin `TEST_DATABASE_URL` esos tests se saltan (no fallan), asi que un `pnpm test`
verde no prueba nada por si solo. Fijate en que diga `7 skipped`.

## 6. Dar de alta el primer cliente

**6.1 — Crear el usuario.** En el dashboard: **Authentication > Users > Add user**.
Marca *Auto Confirm User*, o no vas a poder entrar hasta confirmar el correo.
El trigger `sync_user_from_auth_trigger` lo copia solo a `public.users`.

**6.2 — Crear el cliente y su membresia:**

```bash
pnpm seed:tenant --name "Hotel X" --slug hotel-x --email dueno@hotel.com
```

Esto crea el cliente, hace `owner` a ese usuario y siembra los catalogos por
defecto (categorias de ingreso y gasto, metodos de pago, categorias de producto
y servicio). Es idempotente y no pisa lo que el cliente haya editado despues.

`--currency` es solo presentacion: define que moneda va en grande en los KPI.
No se convierte nada — los totales van separados por moneda.

**6.3 — (Opcional) Darte acceso a `/admin` como superadmin:**

```bash
pnpm admin:grant --email yo@empresa.com --super
```

Desde ahí se dan de alta los siguientes negocios sin volver a la terminal, y sin que el dueño
tenga que registrarse antes: queda una invitación que se canjea cuando lo haga. Los demás
administradores se nombran en `/admin/administradores`.

**6.4 — Entrar:**

```bash
pnpm dev
```

En <http://localhost:3000> te redirige a `/login`. Despues de entrar, los
catalogos se administran en **Ajustes** (abajo en el sidebar).
