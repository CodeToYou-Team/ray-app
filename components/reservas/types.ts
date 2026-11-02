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

/**
 * Las columnas personalizadas de la reserva, ya resueltas (sin ocultas ni
 * archivadas), y las opciones de las que apuntan a un catálogo.
 */
export interface BookingFields {
  fields: ResolvedField[];
  catalogos: CatalogChoices;
}
