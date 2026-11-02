-- ---------------------------------------------------------------------------
-- Reservas, fase 2: check-in, check-out y cobros
-- ---------------------------------------------------------------------------
-- Diseño en docs/plan_arquitectura_v2.md, sección "Reservas".
--
-- Corrección al plan original, que decía "al salir se genera la venta con las
-- noches": eso contaría el anticipo dos veces. El dinero que entra el lunes es
-- ingreso del lunes. Así que CADA COBRO es el ingreso (una transacción normal,
-- en los reportes desde el día en que entró) y la reserva solo lleva cuánto
-- se le ha aplicado. El check-out cierra la estadía; no genera nada.

-- ---------------------------------------------------------------------------
-- Check-in y check-out
-- ---------------------------------------------------------------------------
ALTER TABLE "bookings"
  ADD COLUMN "checked_in_at" timestamp with time zone,
  ADD COLUMN "checked_out_at" timestamp with time zone;--> statement-breakpoint

-- El estado y las marcas de tiempo cuentan la misma historia, o no se puede
-- confiar en ninguno de los dos. "En curso" sin hora de llegada, o
-- "finalizada" sin hora de salida, es justo lo que nadie sabe leer después.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_checkin_consistent" CHECK (
    ("status" IN ('en_curso', 'finalizada')) = ("checked_in_at" IS NOT NULL)
  );--> statement-breakpoint

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_checkout_consistent" CHECK (
    ("status" = 'finalizada') = ("checked_out_at" IS NOT NULL)
  );--> statement-breakpoint

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_checkout_after_checkin" CHECK (
    "checked_out_at" IS NULL OR "checked_out_at" >= "checked_in_at"
  );--> statement-breakpoint

-- Lo que referencia `booking_payments` para no colgar un cobro de la reserva
-- de otro cliente.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_tenant_id_key" UNIQUE ("tenant_id", "id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Cobros de una reserva
-- ---------------------------------------------------------------------------
-- Cada fila liga una transacción de ingreso con la reserva a la que abona.
--
-- `applied_amount` está en la moneda de la RESERVA, no en la del pago, y se
-- guarda en vez de derivarse: si la reserva es en USD y se cobra en Bs, la
-- transacción dice 4.000 Bs y esto dice 100 USD. Volver de Bs a USD dividiendo
-- por la tasa no siempre devuelve el número exacto (con una tasa menor que 1
-- el redondeo se lleva centavos), y un saldo que queda en 0,01 para siempre es
-- peor que guardar una columna más.
CREATE TABLE "booking_payments" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "booking_id" uuid NOT NULL,
  "transaction_id" uuid NOT NULL,
  "applied_amount" numeric(14, 2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "booking_payments_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "booking_payments_booking_fk"
    FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id"),
  CONSTRAINT "booking_payments_transaction_fk"
    FOREIGN KEY ("tenant_id", "transaction_id") REFERENCES "transactions"("tenant_id", "id"),

  -- Un cobro abona a UNA reserva. Repartir una transacción entre dos haría
  -- que anularla moviera dos saldos a la vez sin que se viera.
  CONSTRAINT "booking_payments_transaction_unique" UNIQUE ("transaction_id"),
  CONSTRAINT "booking_payments_positive" CHECK ("applied_amount" > 0)
);--> statement-breakpoint

CREATE INDEX "booking_payments_booking_idx"
  ON "booking_payments" ("tenant_id", "booking_id");--> statement-breakpoint

ALTER TABLE "booking_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Solo se lee y se inserta. Un cobro equivocado se corrige ANULANDO su
-- transacción (deleted_at), que lo saca del saldo y deja el rastro; esta fila
-- se queda como historia de lo que pasó.
CREATE POLICY booking_payments_select ON public.booking_payments
  FOR SELECT TO app_user
  USING (tenant_id = public.current_tenant_id());--> statement-breakpoint
CREATE POLICY booking_payments_insert ON public.booking_payments
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- El dinero de un cobro no se edita por el costado
-- ---------------------------------------------------------------------------
-- `applied_amount` se calculó con el monto, la moneda y la tasa de la
-- transacción. Si alguien los cambia desde "Corregir" en Finanzas, la
-- transacción diría 4.400 Bs y la reserva seguiría creyendo que recibió 100
-- USD. La app ya lo impide con un mensaje; esto lo impide para cualquiera.
--
-- Anular sí se puede (deleted_at no está en la lista): es justamente la forma
-- de corregir un cobro.
CREATE OR REPLACE FUNCTION public.forbid_booking_payment_money_edit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.booking_payments WHERE transaction_id = OLD.id) THEN
    RAISE EXCEPTION
      'Este cobro pertenece a una reserva: para corregir el monto, anúlalo y regístralo de nuevo desde la reserva.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER transactions_booking_payment_money
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW
  WHEN (
    OLD.amount IS DISTINCT FROM NEW.amount
    OR OLD.currency IS DISTINCT FROM NEW.currency
    OR OLD.exchange_rate IS DISTINCT FROM NEW.exchange_rate
    OR OLD.base_currency IS DISTINCT FROM NEW.base_currency
  )
  EXECUTE FUNCTION public.forbid_booking_payment_money_edit();
