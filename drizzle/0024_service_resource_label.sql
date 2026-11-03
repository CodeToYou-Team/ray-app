-- ---------------------------------------------------------------------------
-- Reservas: cómo se llaman los recursos de cada servicio
-- ---------------------------------------------------------------------------
-- El formulario de reserva decía "Habitación" a todo lo que se reserva por
-- noche, aunque fuera una cabaña o una parcela de camping. Ahora cada servicio
-- dice cómo se llaman sus recursos: Habitación, Cancha, Cabaña, Terapeuta.
--
-- Es del SERVICIO y no una columna renombrable de la reserva porque un mismo
-- negocio puede tener habitaciones y canchas a la vez.
--
-- NULL = el nombre genérico ("Recurso"), que decide la app. Así cambiar el
-- genérico no obliga a reescribir filas.
ALTER TABLE "services" ADD COLUMN "resource_label" text;--> statement-breakpoint

ALTER TABLE "services"
  ADD CONSTRAINT "services_resource_label_length" CHECK (
    "resource_label" IS NULL OR length(btrim("resource_label")) BETWEEN 1 AND 40
  );
