-- ===========================================================================
-- Rol de aplicacion + Row Level Security
-- ===========================================================================
-- Esta es la migracion mas importante del proyecto. Los roles `postgres` y
-- `service_role` que da Supabase tienen BYPASSRLS: si la app conecta con uno de
-- ellos, TODAS las politicas de aca abajo son decorativas y no hay aislamiento
-- entre clientes. Nadie se entera hasta que un cliente ve los datos de otro.
--
-- El rol se crea SIN login y SIN password: un secreto no va versionado en git.
-- Despues de migrar, corre una vez en el SQL Editor de Supabase:
--
--   ALTER ROLE app_user WITH LOGIN PASSWORD 'la-password-que-generaste';
--
-- y usa ese usuario en DATABASE_URL. Ver docs/setup.md.

-- ---------------------------------------------------------------------------
-- 1. Funcion que leen todas las politicas
-- ---------------------------------------------------------------------------
-- `withTenant()` fija este GUC con set_config(..., true) dentro de la
-- transaccion. STABLE (no IMMUTABLE) porque depende del estado de la sesion.
-- El NULLIF evita que un GUC vacio explote al castear a uuid: devuelve NULL, y
-- comparar cualquier cosa con NULL da falso, o sea "no ves nada" — que es el
-- default seguro cuando alguien olvida abrir el contexto de cliente.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- 2. Rol de aplicacion, sin BYPASSRLS
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    -- NOBYPASSRLS es el default; se pone explicito porque es la razon de ser de
    -- este rol. NOLOGIN a proposito: la password se pone aparte con ALTER ROLE
    -- para no dejarla en el repositorio. Hasta que se haga, la app no conecta —
    -- que es un fallo ruidoso y preferible a un rol con password conocida.
    CREATE ROLE app_user NOLOGIN NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO app_user;

-- Que las tablas futuras hereden los permisos sin tener que acordarse.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
-- ENABLE, deliberadamente SIN "FORCE ROW LEVEL SECURITY".
--
-- FORCE haria que el dueño de la tabla tambien quede sujeto a las politicas. Se
-- evaluo y se descarta: el dueño es quien corre las migraciones, el trigger que
-- espeja auth.users y los scripts de alta de clientes, y todos esos operan sin
-- contexto de cliente (durante un signup todavia no hay tenant activo). Con
-- FORCE quedarian bloqueados por default-deny, porque las politicas de abajo
-- estan concedidas solo TO app_user.
--
-- La frontera de seguridad real es que la app SIEMPRE conecta como app_user, que
-- no tiene BYPASSRLS y si esta sujeto a estas politicas. Que el dueño pueda
-- saltarlas es el comportamiento normal de Postgres y solo aplica a operaciones
-- administrativas explicitas.
ALTER TABLE public.tenants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log   ENABLE ROW LEVEL SECURITY;

-- tenants: solo la fila del cliente activo.
CREATE POLICY tenants_isolation ON public.tenants
  FOR ALL TO app_user
  USING      (id = public.current_tenant_id())
  WITH CHECK (id = public.current_tenant_id());

-- memberships: las del cliente activo.
CREATE POLICY memberships_isolation ON public.memberships
  FOR ALL TO app_user
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- users: no tiene tenant_id (un usuario podria pertenecer a varios clientes),
-- asi que la visibilidad se deriva de tener membresia en el cliente activo.
CREATE POLICY users_visible_in_tenant ON public.users
  FOR ALL TO app_user
  USING (EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = users.id
      AND m.tenant_id = public.current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = users.id
      AND m.tenant_id = public.current_tenant_id()
  ));

-- audit_log: append-only. Se puede leer e insertar lo del cliente activo, pero
-- NO actualizar ni borrar: un log de auditoria editable no sirve de nada.
CREATE POLICY audit_log_select ON public.audit_log
  FOR SELECT TO app_user
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY audit_log_insert ON public.audit_log
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = public.current_tenant_id());
