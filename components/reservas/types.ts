/**
 * Tipos que cruzan del servidor al cliente.
 *
 * Solo `export type`: se borran al compilar, así que importar esto desde un
 * componente de cliente no arrastra `lib/reservas/queries.ts`, que es
 * `server-only`.
 */
export type {
  BookableService as BoardService,
  BookingRow as BoardBooking,
} from "@/lib/reservas/queries";
