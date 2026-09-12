-- ===========================================================================
-- field_config: RLS e inmutabilidad de la clave
-- ===========================================================================

ALTER TABLE public.field_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY field_config_isolation ON public.field_config
  FOR ALL TO app_user
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TRIGGER field_config_touch_updated_at
  BEFORE UPDATE ON public.field_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- La clave, la entidad y el origen son inmutables
-- ---------------------------------------------------------------------------
-- `key` es lo que guardan los productos dentro de su JSONB `custom`. Si pudiera
-- cambiar, cada producto que tuviera ese campo quedaria apuntando a una clave
-- que ya no existe, y el dato seguiria ahi pero invisible. Renombrar cambia
-- `label`, que es justamente lo que el usuario quiere renombrar.
--
-- `source` tambien: convertir una columna fija en personalizada (o al reves)
-- cambiaria de donde se lee el valor, sin mover el dato.
CREATE OR REPLACE FUNCTION public.forbid_field_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION
      'field_config.key es inmutable (intento: % -> %). Para renombrar, cambia label.',
      OLD.key, NEW.key
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.entity IS DISTINCT FROM OLD.entity THEN
    RAISE EXCEPTION 'field_config.entity es inmutable.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'field_config.source es inmutable.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Cambiar el tipo de un campo con datos ya escritos los dejaria sin poder
  -- leerse: "rojo" no se convierte en numero. El camino soportado es crear un
  -- campo nuevo y archivar el viejo.
  IF NEW.source = 'custom' AND NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION
      'No se puede cambiar el tipo de un campo (% -> %). Crea uno nuevo y archiva este.',
      OLD.type, NEW.type
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER field_config_identity_immutable
  BEFORE UPDATE ON public.field_config
  FOR EACH ROW EXECUTE FUNCTION public.forbid_field_identity_change();
