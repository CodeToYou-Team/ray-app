-- ===========================================================================
-- Administracion de la plataforma: quien da de alta y suspende negocios
-- ===========================================================================
-- Hasta aqui la unica forma de crear un cliente era `pnpm seed:tenant`, con el
-- rol dueño de la base. Esta migracion agrega un TERCER contexto, ademas del de
-- cliente (0001) y el de usuario (0007): el del administrador de la plataforma.
--
-- Lo que ese contexto puede hacer es deliberadamente poco:
--
--   - LEER `tenants`, `memberships`, `users` e `invitations` de todos los
--     clientes. Es lo minimo para listar negocios, ver quien es su dueño y
--     comprobar que un correo no pertenezca ya a otro negocio.
--   - Nada mas. No ve operaciones, reservas, productos ni el log de auditoria
--     de nadie: administra negocios, no lee su contabilidad.
--
-- Las ESCRITURAS del admin no pasan por politicas nuevas. Crear o modificar un
-- cliente se hace abriendo withTenant() con el id de ese cliente, igual que
-- cualquier otra escritura, asi que siguen sujetas a las mismas politicas.

-- ---------------------------------------------------------------------------
-- 1. Quien es admin
-- ---------------------------------------------------------------------------
-- Se llena SOLO por script (`pnpm admin:grant`), con el rol dueño. app_user no
-- tiene ninguna politica de escritura sobre esta tabla, asi que ninguna Server
-- Action puede convertir a nadie en admin, ni por error ni a proposito.
CREATE TABLE "platform_admins" (
  "user_id" uuid PRIMARY KEY NOT NULL
    REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Los privilegios por defecto de 0001 le dan todo a app_user sobre las tablas
-- nuevas. Aqui se le quitan las escrituras: sin politica ya fallaria, pero asi
-- falla por permisos y queda escrito que es a proposito.
REVOKE INSERT, UPDATE, DELETE ON public.platform_admins FROM app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. El GUC del admin
-- ---------------------------------------------------------------------------
-- Uno PROPIO, distinto de app.current_user_id. Si las politicas de admin
-- leyeran el GUC de usuario, cada withUser() de un admin — el arranque de
-- sesion normal — veria todos los clientes sin haberlo pedido. Con un GUC
-- aparte, el alcance amplio solo existe dentro de withPlatformAdmin().
CREATE OR REPLACE FUNCTION public.current_platform_admin_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.platform_admin_id', true), '')::uuid
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.current_platform_admin_id() TO app_user;--> statement-breakpoint

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Cada admin ve solo su propia fila: basta para comprobar "¿soy admin?" y no
-- sirve para enumerar a los demas.
CREATE POLICY platform_admins_self ON public.platform_admins
  FOR SELECT TO app_user
  USING (user_id = public.current_platform_admin_id());--> statement-breakpoint

-- Fijar el GUC no basta: el id tiene que estar en la tabla. Un id cualquiera
-- en app.platform_admin_id da false, igual que un GUC vacio.
--
-- Sin SECURITY DEFINER: corre como app_user, y la politica de arriba es la que
-- le deja ver la fila. No hay recursion porque esa politica no llama a esto.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = public.current_platform_admin_id()
  )
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Lectura entre clientes, solo de lo necesario
-- ---------------------------------------------------------------------------
-- PERMISIVAS y solo SELECT: se suman con OR a las existentes y no habilitan
-- ninguna escritura.
CREATE POLICY tenants_platform_admin ON public.tenants
  FOR SELECT TO app_user
  USING (public.is_platform_admin());--> statement-breakpoint

CREATE POLICY memberships_platform_admin ON public.memberships
  FOR SELECT TO app_user
  USING (public.is_platform_admin());--> statement-breakpoint

CREATE POLICY users_platform_admin ON public.users
  FOR SELECT TO app_user
  USING (public.is_platform_admin());--> statement-breakpoint

CREATE POLICY invitations_platform_admin ON public.invitations
  FOR SELECT TO app_user
  USING (public.is_platform_admin());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Suspension
-- ---------------------------------------------------------------------------
-- Un negocio no se borra: se suspende. Sus datos quedan intactos y reactivarlo
-- es volver a poner NULL.
ALTER TABLE "tenants" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint

-- La politica tenants_isolation deja que el propio cliente actualice su fila
-- (asi cambia su moneda por defecto). Sin esto, un dueño podria levantarse la
-- suspension con cualquier UPDATE que se escribiera mal en el futuro. Solo el
-- admin, con su GUC fijado, puede tocar esta columna desde la app; el rol
-- dueño (migraciones y scripts) no es app_user y no pasa por aqui.
CREATE OR REPLACE FUNCTION public.tenants_guard_suspension()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
     AND current_user = 'app_user'
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo un administrador de la plataforma puede suspender o reactivar un negocio.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER tenants_guard_suspension
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.tenants_guard_suspension();
