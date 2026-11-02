-- ===========================================================================
-- Superadmin: quien puede nombrar, cambiar y quitar administradores
-- ===========================================================================
-- En 0021 nadie podia escribir en platform_admins desde la app: solo el script
-- con el rol dueño. Aqui se abre esa escritura, pero solo a un nivel nuevo,
-- `superadmin`, y con tres garantias que impone la base y no la app:
--
--   1. Solo un superadmin escribe en platform_admins (politicas).
--   2. Siempre queda al menos un superadmin (trigger con bloqueo).
--   3. Cada alta, cambio y baja queda registrada con quien la hizo, tambien
--      las del script (trigger sobre platform_audit_log).
--
-- Un `admin` sigue igual que en 0021: gestiona negocios y no ve a los demas
-- administradores.

-- ---------------------------------------------------------------------------
-- 1. Nivel
-- ---------------------------------------------------------------------------
ALTER TABLE "platform_admins"
  ADD COLUMN "level" text DEFAULT 'admin' NOT NULL;--> statement-breakpoint

ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_level_check"
  CHECK ("level" IN ('admin', 'superadmin'));--> statement-breakpoint

-- Los admins que ya existen los nombro alguien con la credencial de la base:
-- pasan al nivel mas alto. Sin esto no habria ningun superadmin y nadie podria
-- gestionar admins desde la app.
UPDATE "platform_admins" SET "level" = 'superadmin';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. ¿Es superadmin quien tiene el GUC?
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER a la fuerza: la politica de SELECT de superadmin sobre
-- platform_admins llama a esta funcion, y si la funcion leyera la tabla con
-- RLS, Postgres cortaria con "infinite recursion detected in policy".
--
-- Lo unico que expone es si el id fijado en app.platform_admin_id es
-- superadmin. Para sacarle algo hay que conocer ese id de antemano.
CREATE OR REPLACE FUNCTION public.is_platform_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = public.current_platform_admin_id()
      AND level = 'superadmin'
  )
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.is_platform_superadmin() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_platform_superadmin() TO app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Politicas: el superadmin ve y escribe; el admin solo se ve a si mismo
-- ---------------------------------------------------------------------------
-- 0021 le quito las escrituras a app_user. Se devuelven, pero las politicas de
-- abajo solo dejan usarlas a un superadmin. Para cualquier otro, un UPDATE o
-- DELETE no encuentra filas y un INSERT falla.
GRANT INSERT, UPDATE, DELETE ON public.platform_admins TO app_user;--> statement-breakpoint

CREATE POLICY platform_admins_superadmin_select ON public.platform_admins
  FOR SELECT TO app_user
  USING (public.is_platform_superadmin());--> statement-breakpoint

CREATE POLICY platform_admins_superadmin_insert ON public.platform_admins
  FOR INSERT TO app_user
  WITH CHECK (public.is_platform_superadmin());--> statement-breakpoint

CREATE POLICY platform_admins_superadmin_update ON public.platform_admins
  FOR UPDATE TO app_user
  USING (public.is_platform_superadmin())
  WITH CHECK (public.is_platform_superadmin());--> statement-breakpoint

CREATE POLICY platform_admins_superadmin_delete ON public.platform_admins
  FOR DELETE TO app_user
  USING (public.is_platform_superadmin());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Siempre queda al menos un superadmin
-- ---------------------------------------------------------------------------
-- En la base y no en la app: vale igual para la pantalla y para el script.
--
-- El bloqueo es lo que lo hace correcto. Sin el, dos superadmins que se bajan
-- de nivel el uno al otro a la vez ven cada uno al otro todavia arriba, pasan
-- los dos, y no queda ninguno. Con el bloqueo el segundo espera, y su consulta
-- (otra sentencia, otra foto en READ COMMITTED) ya ve el cambio del primero.
--
-- La excepcion es borrar la cuenta entera (el DELETE llega en cascada desde
-- users): eso lo hace alguien con acceso a Supabase, que puede volver a
-- nombrar a otro con el script.
CREATE OR REPLACE FUNCTION public.platform_admins_keep_superadmin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.level <> 'superadmin'
     OR (TG_OP = 'UPDATE' AND NEW.level = 'superadmin') THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.user_id) THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('platform_admins_superadmin'));

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE level = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'Tiene que quedar al menos un superadmin.'
      USING ERRCODE = 'PA001';
  END IF;

  RETURN NULL;
END
$$;--> statement-breakpoint

CREATE TRIGGER platform_admins_keep_superadmin
  AFTER UPDATE OR DELETE ON public.platform_admins
  FOR EACH ROW
  EXECUTE FUNCTION public.platform_admins_keep_superadmin();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Auditoria de administradores
-- ---------------------------------------------------------------------------
-- No cabe en audit_log: esa tabla es por negocio (tenant_id NOT NULL) y un
-- admin no pertenece a ninguno.
CREATE TABLE "platform_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "action" "audit_action" NOT NULL,
  -- Quien lo hizo. NULL = el script, con el rol dueño. Sin FK a users: el log
  -- sobrevive a la baja de la cuenta.
  "actor_id" uuid,
  "diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "platform_audit_log_at_idx" ON "platform_audit_log" ("at");--> statement-breakpoint

ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Solo lo escribe el trigger de abajo. app_user lee, si es superadmin, y nada
-- mas: un log que la app puede editar no prueba nada.
REVOKE INSERT, UPDATE, DELETE ON public.platform_audit_log FROM app_user;--> statement-breakpoint

CREATE POLICY platform_audit_log_superadmin_select ON public.platform_audit_log
  FOR SELECT TO app_user
  USING (public.is_platform_superadmin());--> statement-breakpoint

-- Desde un trigger y no desde la app: asi no hay forma de cambiar un admin sin
-- dejar rastro, ni siquiera por el script. El correo se copia porque el log
-- tiene que seguir siendo legible si la cuenta se borra.
CREATE OR REPLACE FUNCTION public.platform_admins_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid := COALESCE(NEW.user_id, OLD.user_id);
  correo text;
BEGIN
  SELECT email INTO correo FROM public.users WHERE id = target;

  INSERT INTO public.platform_audit_log (entity, entity_id, action, actor_id, diff)
  VALUES (
    'platform_admins',
    target,
    CASE TG_OP
      WHEN 'INSERT' THEN 'create'::audit_action
      WHEN 'UPDATE' THEN 'update'::audit_action
      ELSE 'delete'::audit_action
    END,
    public.current_platform_admin_id(),
    CASE TG_OP
      WHEN 'INSERT' THEN jsonb_build_object('email', correo, 'level', NEW.level)
      WHEN 'UPDATE' THEN jsonb_build_object(
        'email', correo,
        'level', jsonb_build_object('from', OLD.level, 'to', NEW.level))
      ELSE jsonb_build_object('email', correo, 'level', OLD.level)
    END
  );

  RETURN NULL;
END
$$;--> statement-breakpoint

CREATE TRIGGER platform_admins_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.platform_admins
  FOR EACH ROW
  EXECUTE FUNCTION public.platform_admins_audit();
