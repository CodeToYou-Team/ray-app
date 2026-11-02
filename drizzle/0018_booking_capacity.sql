-- ---------------------------------------------------------------------------
-- Reservas: capacidad, recursos compartidos y cobro por persona
-- ---------------------------------------------------------------------------
-- Diseño en docs/plan_arquitectura_v2.md, sección "Reservas".
--
-- Hasta aquí un recurso era siempre exclusivo: una reserva a la vez. Eso cubre
-- la habitación y la cancha, pero no la clase de yoga de 15, el tour de 40
-- plazas ni el estacionamiento de 50 puestos. El modelo queda en dos números:
--
--   * El SERVICIO dice si sus recursos son exclusivos o compartidos.
--   * El RECURSO tiene una capacidad, que significa:
--       - exclusivo:  cuántas personas caben en UNA reserva (la 101, hasta 3);
--       - compartido: cuántas caben EN TOTAL a la vez (la clase, hasta 15).
--
-- Y el servicio dice si cobra por reserva (la habitación cuesta 40 vayan 1 o
-- 3) o por persona (el tour cuesta 15 cada uno).

ALTER TABLE "services"
  ADD COLUMN "booking_shared" boolean DEFAULT false NOT NULL,
  ADD COLUMN "booking_per_person" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Un servicio que no se reserva no puede ser "compartido" ni "por persona":
-- serían ajustes de algo que no existe, esperando a confundir a alguien
-- cuando lo activen.
ALTER TABLE "services"
  ADD CONSTRAINT "services_booking_options_need_unit" CHECK (
    "booking_unit" IS NOT NULL OR (NOT "booking_shared" AND NOT "booking_per_person")
  );--> statement-breakpoint

ALTER TABLE "resources"
  ADD COLUMN "capacity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "resources"
  ADD CONSTRAINT "resources_capacity_positive" CHECK ("capacity" >= 1);--> statement-breakpoint

-- `shared` y `per_person` se COPIAN del servicio al reservar, igual que el
-- precio: si mañana el tour pasa a cobrarse por grupo, las reservas de hoy
-- conservan cómo se calcularon. Y el EXCLUDE de abajo necesita `shared` en la
-- propia fila, porque un EXCLUDE no puede mirar otra tabla.
ALTER TABLE "bookings"
  ADD COLUMN "party_size" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "shared" boolean DEFAULT false NOT NULL,
  ADD COLUMN "per_person" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_party_size_positive" CHECK ("party_size" >= 1);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Exclusivos: la garantía de siempre, ahora solo para ellos
-- ---------------------------------------------------------------------------
-- En un recurso compartido, que dos reservas se solapen es lo normal: es la
-- clase llenándose. El EXCLUDE pasa a aplicar solo a los exclusivos.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_no_overlap";--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
    "tenant_id" WITH =,
    "resource_id" WITH =,
    "period" WITH &&
  ) WHERE (NOT "shared" AND "status" NOT IN ('cancelada', 'no_show'));--> statement-breakpoint

-- Lo que consulta el trigger de capacidad: las reservas compartidas activas
-- de un recurso que tocan un rango.
CREATE INDEX "bookings_shared_occupancy_idx"
  ON "bookings" USING gist ("tenant_id", "resource_id", "period")
  WHERE ("shared" AND "status" NOT IN ('cancelada', 'no_show'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Compartidos: la suma no puede pasar de la capacidad
-- ---------------------------------------------------------------------------
-- Un EXCLUDE sabe decir "no se pueden solapar", no "la suma no puede pasar de
-- 15". Esto lo dice, con la misma solidez:
--
-- 1. BLOQUEA la fila del recurso. Dos inscripciones simultáneas a la última
--    plaza no pueden contar las dos "queda 1": la segunda espera a que la
--    primera termine y cuenta de nuevo. Es el mismo patrón del FOR UPDATE de
--    los cobros, y se probó igual: quitando el bloqueo, se sobrevende.
--
-- 2. Calcula el PICO de ocupación dentro del rango nuevo. La ocupación es
--    escalonada y solo sube donde empieza una reserva, así que basta mirarla
--    en el inicio del rango nuevo y en cada inicio de otra reserva que caiga
--    dentro. Es exacto, sin discretizar en tramos.
--
-- Solo en INSERT y cuando cambia el rango, el tamaño o el recurso. NO cuando
-- cambia el estado: si alguien baja la capacidad, registrar la llegada de una
-- reserva que ya existía no puede fallar por eso.
CREATE OR REPLACE FUNCTION public.check_booking_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cap integer;
  pico integer;
BEGIN
  IF NEW.status IN ('cancelada', 'no_show') THEN
    RETURN NEW;
  END IF;

  IF NOT NEW.shared THEN
    -- Exclusivo: no compite con nadie (eso lo resuelve el EXCLUDE). Solo que
    -- el grupo quepa: tres personas en una habitación para dos, no.
    SELECT capacity INTO cap FROM public.resources
      WHERE id = NEW.resource_id AND tenant_id = NEW.tenant_id;
    IF NEW.party_size > cap THEN
      RAISE EXCEPTION 'La reserva es para % personas y el recurso admite %.',
        NEW.party_size, cap
        USING ERRCODE = 'RS002';
    END IF;
    RETURN NEW;
  END IF;

  SELECT capacity INTO cap FROM public.resources
    WHERE id = NEW.resource_id AND tenant_id = NEW.tenant_id
    FOR UPDATE;

  SELECT coalesce(max(x.ocupado), 0) INTO pico
  FROM (
    SELECT (
      SELECT coalesce(sum(b.party_size), 0)
      FROM public.bookings b
      WHERE b.tenant_id = NEW.tenant_id
        AND b.resource_id = NEW.resource_id
        AND b.id <> NEW.id
        AND b.shared
        AND b.status NOT IN ('cancelada', 'no_show')
        AND b.period @> p.punto
    ) AS ocupado
    FROM (
      SELECT lower(NEW.period) AS punto
      UNION
      SELECT lower(b.period)
      FROM public.bookings b
      WHERE b.tenant_id = NEW.tenant_id
        AND b.resource_id = NEW.resource_id
        AND b.id <> NEW.id
        AND b.shared
        AND b.status NOT IN ('cancelada', 'no_show')
        AND NEW.period @> lower(b.period)
    ) p
  ) x;

  IF pico + NEW.party_size > cap THEN
    RAISE EXCEPTION 'No quedan cupos: ya hay % de % y la reserva pide %.',
      pico, cap, NEW.party_size
      USING ERRCODE = 'RS001';
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER bookings_capacity
  BEFORE INSERT OR UPDATE OF "period", "party_size", "resource_id"
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.check_booking_capacity();
