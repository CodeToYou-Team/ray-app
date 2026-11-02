-- ---------------------------------------------------------------------------
-- Inventario: el stock no puede quedar en negativo
-- ---------------------------------------------------------------------------
-- Hasta aquí se podía vender lo que no había: la venta descontaba igual y el
-- producto quedaba en -3. Un stock negativo no describe nada que exista en la
-- bodega, y a partir de ahí "por qué dice 14 y hay 12" deja de tener respuesta.
--
-- Va en la base y no en la app por la misma razón que el EXCLUDE de las
-- reservas: "leer el stock y, si alcanza, insertar" tiene una carrera. Dos
-- cajas vendiendo la última unidad a la vez leen las dos "queda 1" y venden
-- las dos. Esto cierra la carrera:
--
-- 1. BLOQUEA la fila del producto. La segunda venta espera a que la primera
--    termine y cuenta de nuevo (en READ COMMITTED cada consulta de la función
--    toma una foto nueva, así que ve lo que la primera ya confirmó). Mismo
--    patrón que bookings_capacity.
--
-- 2. Suma TODOS los movimientos del producto, incluido el que se acaba de
--    insertar. Es AFTER y por fila: cuando corre, todas las filas del mismo
--    INSERT ya están, así que una venta con dos renglones del mismo producto
--    se mide completa y no renglón por renglón.
--
-- Solo mira los movimientos que SACAN (delta < 0). Uno que mete nunca puede
-- empeorar nada, y así un producto que ya estuviera en negativo antes de esta
-- migración se puede reabastecer: si no, una compra de 3 sobre -5 fallaría y
-- no habría forma de arreglarlo.
--
-- Cubre todas las puertas a la vez: vender, corregir una venta hacia arriba,
-- anular una compra de la que ya se vendió, restaurar una venta anulada, y el
-- ajuste o la merma manual.
--
-- SQLSTATE propio `ST001`, con el id del producto en DETAIL: la app lo traduce
-- a "quedan N de tal producto" leyendo el stock confirmado.
CREATE OR REPLACE FUNCTION public.check_stock_not_negative()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  queda numeric;
BEGIN
  PERFORM 1 FROM public.products
    WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id
    FOR UPDATE;

  SELECT coalesce(sum(delta), 0) INTO queda
  FROM public.stock_movements
  WHERE tenant_id = NEW.tenant_id AND product_id = NEW.product_id;

  IF queda < 0 THEN
    RAISE EXCEPTION 'No hay stock suficiente: quedaría en %.', queda
      USING ERRCODE = 'ST001', DETAIL = NEW.product_id::text;
  END IF;

  RETURN NULL;
END
$$;--> statement-breakpoint

CREATE TRIGGER stock_movements_not_negative
  AFTER INSERT ON public.stock_movements
  FOR EACH ROW
  WHEN (NEW.delta < 0)
  EXECUTE FUNCTION public.check_stock_not_negative();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Restaurar una operación anulada
-- ---------------------------------------------------------------------------
-- Deshacer una anulación vuelve a aplicar el efecto original sobre el
-- inventario. Se registra con su propio motivo y no como "venta" o "compra":
-- en el historial del producto tiene que leerse que eso fue una restauración,
-- no una venta nueva.
ALTER TYPE "public"."stock_reason" ADD VALUE IF NOT EXISTS 'restauracion';
