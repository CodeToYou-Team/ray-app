-- ===========================================================================
-- Espejo de auth.users -> public.users
-- ===========================================================================
-- Supabase Auth es dueño de auth.users y drizzle-kit no administra ese schema
-- (de hecho `schemaFilter: ["public"]` existe para que no lo toque). Tener tabla
-- propia nos deja poner FKs desde memberships y ser dueños de la fila del
-- usuario, a costa de mantenerla sincronizada con este trigger.

CREATE OR REPLACE FUNCTION public.sync_user_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
-- search_path fijo: una funcion SECURITY DEFINER sin esto es escalable via
-- objetos plantados en un schema que preceda en el search_path del invocador.
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    -- Supabase guarda lo que venga del signup o del proveedor OAuth aca.
    COALESCE(
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name'
    ),
    COALESCE(NEW.created_at, now()),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET email      = EXCLUDED.email,
        -- No sobreescribir un nombre ya puesto con un NULL del proveedor.
        full_name  = COALESCE(EXCLUDED.full_name, public.users.full_name),
        updated_at = now();
  RETURN NEW;
END
$$;

-- El trigger y el backfill se envuelven en un chequeo de existencia de
-- auth.users: en un Postgres pelado (un contenedor para tests, por ejemplo) ese
-- schema no existe y la migracion fallaria. El resto del esquema no depende de
-- Supabase Auth, asi que no tiene sentido que sea eso lo que impida migrar.
DO $mirror$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'users'
  ) THEN
    RAISE NOTICE 'auth.users no existe: se omite el espejo (esto es normal fuera de Supabase).';
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS sync_user_from_auth_trigger ON auth.users;
  CREATE TRIGGER sync_user_from_auth_trigger
    AFTER INSERT OR UPDATE OF email, raw_user_meta_data ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.sync_user_from_auth();

  -- Trae los usuarios que ya existieran antes de instalar el trigger.
  INSERT INTO public.users (id, email, full_name, created_at, updated_at)
  SELECT
    u.id,
    u.email,
    COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
    COALESCE(u.created_at, now()),
    now()
  FROM auth.users u
  WHERE u.email IS NOT NULL
  ON CONFLICT (id) DO NOTHING;
END
$mirror$;
