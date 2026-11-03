"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PRIMARY_CURRENCIES,
  STABLECOINS,
  OTHER_CURRENCIES,
} from "@/lib/currencies";

/** Elegir una moneda de la lista cerrada, agrupada como se usa: frecuentes primero. */
export function CurrencySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Moneda" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Frecuentes</SelectLabel>
          {PRIMARY_CURRENCIES.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              <span className="font-mono text-xs">{c.code}</span>
              <span className="text-muted-foreground"> · {c.name}</span>
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Stablecoins</SelectLabel>
          {STABLECOINS.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              <span className="font-mono text-xs">{c.code}</span>
              <span className="text-muted-foreground"> · {c.name}</span>
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Otras</SelectLabel>
          {OTHER_CURRENCIES.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              <span className="font-mono text-xs">{c.code}</span>
              <span className="text-muted-foreground"> · {c.name}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
