-- ===========================================================================
-- RLS y reglas de las tablas de operaciones
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. RLS
-- ---------------------------------------------------------------------------
-- El "automatic RLS" de Supabase ya las habilita, pero la migracion tiene que
-- valer por si sola: ese setting del dashboard se puede apagar.
ALTER TABLE public.products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements   ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_isolation ON public.products
  FOR ALL TO app_user
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY services_isolation ON public.services
  FOR ALL TO app_user
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY transactions_isolation ON public.transactions
  FOR ALL TO app_user
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY transaction_items_isolation ON public.transaction_items
  FOR ALL TO app_user
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- stock_movements es append-only, igual que audit_log: se lee e inserta, pero
-- no se actualiza ni se borra. Corregir un movimiento equivocado se hace
-- insertando el compensatorio, que es justamente lo que deja rastro de que
-- alguien lo corrigio.
CREATE POLICY stock_movements_select ON public.stock_movements
  FOR SELECT TO app_user
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY stock_movements_insert ON public.stock_movements
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 2. updated_at
-- ---------------------------------------------------------------------------
CREATE TRIGGER products_touch_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER services_touch_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER transactions_touch_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. El subtotal de un renglon tiene que ser qty * unit_price
-- ---------------------------------------------------------------------------
-- Se verifica en la base y no solo en la aplicacion. El subtotal es lo que
-- suma el monto de la transaccion: si un renglon miente, el total miente, y
-- eso no se detecta hasta que alguien cuadra la caja a mano.
--
-- Va como CHECK y no como columna generada porque `numeric * numeric` con
-- redondeo a 2 decimales necesita round(), y asi queda explicito que el que
-- escribe es responsable de calcularlo bien.
ALTER TABLE public.transaction_items
  ADD CONSTRAINT transaction_items_subtotal_matches
  CHECK (subtotal = round(qty * unit_price, 2));

-- ---------------------------------------------------------------------------
-- 4. Los renglones solo existen para ventas y compras
-- ---------------------------------------------------------------------------
-- Una 'operacion' suelta con renglones seria incoherente: su monto se teclea a
-- mano y no se deriva de nada. Un CHECK no puede mirar otra tabla, asi que va
-- como trigger.
CREATE OR REPLACE FUNCTION public.check_transaction_item_kind()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tx_kind text;
  tx_type text;
BEGIN
  SELECT kind, type INTO tx_kind, tx_type
  FROM public.transactions WHERE id = NEW.transaction_id;

  IF tx_kind = 'operacion' THEN
    RAISE EXCEPTION
      'Una operacion suelta no lleva renglones; su monto se registra directo.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Comprar un servicio no mueve inventario ni es "compra de insumos": eso es
  -- un gasto suelto. Se bloquea para que el reporte de compras signifique algo.
  IF tx_kind = 'compra' AND NEW.item_type = 'service' THEN
    RAISE EXCEPTION
      'Una compra de insumos solo lleva productos. Para pagar un servicio, registra un gasto suelto.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER transaction_items_kind_check
  BEFORE INSERT OR UPDATE ON public.transaction_items
  FOR EACH ROW EXECUTE FUNCTION public.check_transaction_item_kind();

-- ---------------------------------------------------------------------------
-- 5. Los movimientos de stock no se editan
-- ---------------------------------------------------------------------------
-- Un historial de inventario editable no sirve para responder "por que dice 14
-- y hay 12". El trigger cubre a cualquiera, incluido el rol dueño.
--
-- Solo UPDATE, deliberadamente NO DELETE: `stock_movements` cuelga de
-- `tenants` con ON DELETE CASCADE, y un trigger que bloquee DELETE haria
-- imposible dar de baja un cliente (y tumbaria la limpieza de los tests).
-- El borrado para la aplicacion ya esta cerrado por RLS: app_user tiene
-- politicas de SELECT e INSERT y ninguna de DELETE, asi que no puede borrar.
CREATE OR REPLACE FUNCTION public.forbid_stock_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'stock_movements es append-only. Para corregir, inserta el movimiento compensatorio.'
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.forbid_stock_movement_mutation();
