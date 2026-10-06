-- ===========================================================================
-- invitations: RLS
-- ===========================================================================
-- Esta tabla tiene dos lectores con contextos distintos, y por eso lleva dos
-- politicas en vez de una:
--
--   1. El dueño administrando las invitaciones de SU cliente, con el contexto
--      de tenant normal.
--   2. Alguien que acaba de registrarse y todavia no pertenece a ningun
--      cliente, buscando si lo invitaron. Ese todavia no tiene tenant — es el
--      mismo problema de huevo y gallina del arranque de sesion — asi que lee
--      con el contexto de usuario de 0007.

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- 1. Gestion: las invitaciones del cliente activo.
CREATE POLICY invitations_isolation ON public.invitations
  FOR ALL TO app_user
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- 2. Canje: SOLO lectura, y solo de las invitaciones dirigidas al correo del
--    usuario autenticado. No se expone ninguna otra: ni las de otros correos
--    del mismo cliente, ni las de otros clientes.
--
--    El correo se resuelve desde public.users en vez de pasarlo en otro GUC:
--    un GUC mas seria otra cosa que el codigo puede olvidar fijar, y aqui el
--    dato ya esta disponible a partir de current_app_user_id().
CREATE POLICY invitations_addressed_to_me ON public.invitations
  FOR SELECT TO app_user
  USING (
    accepted_at IS NULL
    AND lower(email) = (
      SELECT lower(u.email)
      FROM public.users u
      WHERE u.id = public.current_app_user_id()
    )
  );
