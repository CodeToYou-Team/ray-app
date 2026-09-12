-- ===========================================================================
-- Arranque de sesion: resolver a que cliente pertenece un usuario
-- ===========================================================================
-- El problema que resuelve esta migracion es de huevo y gallina.
--
-- Todas las politicas escritas hasta ahora exigen
-- `tenant_id = current_tenant_id()`, y ese GUC lo fija `withTenant()`. Pero para
-- llamar a `withTenant()` hay que SABER el tenant, y para saberlo hay que leer
-- `memberships`... que esta protegida por esa misma politica. Sin contexto de
-- cliente, `current_tenant_id()` es NULL, toda comparacion da falso y la
-- consulta devuelve cero filas: el login queda imposible.
--
-- La solucion es un SEGUNDO contexto, el del usuario autenticado, con politicas
-- que le dejan ver exactamente lo minimo para resolver su propio cliente:
-- sus membresias, los clientes a los que pertenece, y su propia fila de usuario.
-- Nada mas.
--
-- Se elige esto sobre una funcion SECURITY DEFINER que saltara RLS: esa seria
-- una puerta trasera capaz de enumerar las membresias de cualquiera. Aca el
-- alcance lo sigue decidiendo Postgres, y las politicas nuevas son PERMISIVAS,
-- asi que se suman con OR a las que ya existen sin ampliar nada mas.

-- ---------------------------------------------------------------------------
-- 1. El GUC del usuario
-- ---------------------------------------------------------------------------
-- Lo fija `withUser()` con set_config(..., true), igual que el del cliente: es
-- local a la transaccion y se revierte en el COMMIT, asi que el pooler en modo
-- transaccion no puede filtrarlo a la siguiente peticion.
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO app_user;

-- ---------------------------------------------------------------------------
-- 2. Politicas de arranque
-- ---------------------------------------------------------------------------
-- Solo SELECT: este contexto sirve para averiguar donde estas, nunca para
-- escribir. Toda escritura sigue pasando por withTenant().

-- Tus propias membresias.
CREATE POLICY memberships_own ON public.memberships
  FOR SELECT TO app_user
  USING (user_id = public.current_app_user_id());

-- Los clientes a los que perteneces.
CREATE POLICY tenants_own ON public.tenants
  FOR SELECT TO app_user
  USING (EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.tenant_id = tenants.id
      AND m.user_id = public.current_app_user_id()
  ));

-- Tu propia fila de usuario.
CREATE POLICY users_self ON public.users
  FOR SELECT TO app_user
  USING (id = public.current_app_user_id());
