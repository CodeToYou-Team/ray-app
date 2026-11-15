import { formatMoney, formatQuantity, type FormatMoneyOptions } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Los dos unicos lugares donde una cifra se pinta.
 *
 * Antes cada tabla ponia `font-mono` a mano, y el resultado era un `font-mono`
 * con cuatro significados (dinero, codigos, slugs y monedas). Ahora:
 *
 * - `Money` es dinero: monoespaciado, y el color dice si suma o resta.
 * - `Num` es una cantidad: stock, personas, porcentajes.
 *
 * Ninguno de los dos formatea por su cuenta: todo pasa por `lib/format.ts`, que
 * es lo que ya sabia que VES se escribe "Bs".
 */

const TONOS = {
  default: "text-foreground",
  success: "text-success",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
} as const;

export type TonoCifra = keyof typeof TONOS;

interface MoneyProps {
  /** El monto tal como viene de la base: string. */
  value: string | number;
  /** Nunca hay un monto sin moneda, porque no se suma entre monedas. */
  currency: string;
  tone?: TonoCifra;
  options?: FormatMoneyOptions;
  className?: string;
}

export function Money({
  value,
  currency,
  tone = "default",
  options,
  className,
}: MoneyProps) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums whitespace-nowrap",
        TONOS[tone],
        className,
      )}
    >
      {formatMoney(value, currency, options)}
    </span>
  );
}

interface NumProps {
  value: string | number;
  tone?: TonoCifra;
  className?: string;
}

export function Num({ value, tone = "default", className }: NumProps) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums whitespace-nowrap",
        TONOS[tone],
        className,
      )}
    >
      {formatQuantity(String(value))}
    </span>
  );
}
