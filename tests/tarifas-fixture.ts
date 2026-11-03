import type postgres from "postgres";

/**
 * La tarifa de siempre (su unidad y su precio) para cada servicio reservable
 * del negocio que todavía no tiene una activa.
 *
 * Es lo mismo que hizo drizzle/0025_service_rates.sql con los servicios que ya
 * existían: los tests que insertan servicios por SQL, sin pasar por
 * `configureServiceBooking`, quedan como estaría un servicio migrado.
 */
export async function tarifasDeSiempre(
  sql: ReturnType<typeof postgres>,
  tenantId: string,
): Promise<void> {
  await sql`
    insert into service_rates (id, tenant_id, service_id, unit, price, currency)
    select gen_random_uuid(), s.tenant_id, s.id, s.booking_unit::text::rate_unit, s.price, s.currency
    from services s
    where s.tenant_id = ${tenantId}
      and s.booking_unit is not null
      and not exists (
        select 1 from service_rates r
        where r.tenant_id = s.tenant_id and r.service_id = s.id and r.archived_at is null
      )`;
}
