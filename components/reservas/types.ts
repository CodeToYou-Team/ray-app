/**
 * Tipos que cruzan del servidor al cliente.
 *
 * Solo `export type`: se borran al compilar, así que importar esto desde un
 * componente de cliente no arrastra `lib/reservas/queries.ts`, que es
 * `server-only`.
 */
import type { ResolvedField } from "@/lib/fields/resolve";
import type { CatalogChoices } from "@/lib/fields/types";

export type {
  BookableService as BoardService,
  BookingRow as BoardBooking,
} from "@/lib/reservas/queries";

/** Las columnas fijas de la reserva: `FIXED_FIELDS.booking` en lib/fields/fixed.ts. */
export type CampoFijo = "holder_name" | "holder_document" | "holder_phone" | "notes";

/**
 * Como se llama cada columna fija y si se ve, segun lo que el negocio
 * configuro en Ajustes. Oculta = no está en el formulario, el detalle ni el
 * listado, pero el valor guardado se conserva.
 */
export type CamposFijos = Record<
  CampoFijo,
  { label: string; visible: boolean; enTabla: boolean }
>;

/**
 * Las columnas de la reserva: las fijas con su nombre, las personalizadas ya
 * resueltas (sin ocultas ni archivadas), y las opciones de las que apuntan a
 * un catálogo.
 */
export interface BookingFields {
  fijos: CamposFijos;
  fields: ResolvedField[];
  catalogos: CatalogChoices;
}
