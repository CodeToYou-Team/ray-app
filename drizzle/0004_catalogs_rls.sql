-- ===========================================================================
-- catalog_items: RLS, inmutabilidad del code y updated_at
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. RLS
-- ---------------------------------------------------------------------------
-- El proyecto tiene activado el "automatic RLS" de Supabase, asi que esta tabla
-- ya nace con RLS habilitado. Se repite igual: la migracion tiene que valer por
-- si sola, sin depender de un setting del dashboard que alguien puede apagar.
ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalog_items_isolation ON public.catalog_items
  FOR ALL TO app_user
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 2. El code es inmutable
-- ---------------------------------------------------------------------------
-- La regla de mayor palanca del diseño, y por eso se hace cumplir en la base y
-- no solo en la aplicacion.
--
-- `code` es lo que guardan los registros historicos. `label` es lo que se ve.
-- Renombrar "Pago movil" a "Pago Movil" tiene que cambiar solo la etiqueta; si
-- pudiera cambiar el code, cada transaccion vieja que lo referencia quedaria
-- apuntando a la nada y ningun reporte volveria a cuadrar.
CREATE OR REPLACE FUNCTION public.forbid_catalog_code_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION
      'catalog_items.code es inmutable (intento: % -> %). Para renombrar, cambia label.',
      OLD.code, NEW.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- Mover un item de catalogo tendria el mismo efecto que renombrar su code.
  IF NEW.catalog_key IS DISTINCT FROM OLD.catalog_key THEN
    RAISE EXCEPTION
      'catalog_items.catalog_key es inmutable (intento: % -> %).',
      OLD.catalog_key, NEW.catalog_key
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER catalog_items_code_immutable
  BEFORE UPDATE ON public.catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.forbid_catalog_code_change();

-- ---------------------------------------------------------------------------
-- 3. updated_at
-- ---------------------------------------------------------------------------
-- En un trigger y no en el codigo de la app: es imposible de olvidar, y vale
-- para cualquier tabla que se agregue despues.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

CREATE TRIGGER catalog_items_touch_updated_at
  BEFORE UPDATE ON public.catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER tenants_touch_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
