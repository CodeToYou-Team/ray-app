"use client";

import { Input } from "@/components/ui/input";
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
  currencyLabel,
} from "@/lib/currencies";

const GRUPOS = [
  { label: "Las más usadas", items: PRIMARY_CURRENCIES },
  { label: "Stablecoins", items: STABLECOINS },
  { label: "Otras", items: OTHER_CURRENCIES },
];

/**
 * Sugerencias, no una lista cerrada: el servidor acepta cualquier zona IANA.
 * Son las de los clientes que hay hoy y las vecinas.
 */
const ZONAS = [
  "America/Caracas",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Mexico_City",
  "America/Panama",
  "America/Santo_Domingo",
  "America/New_York",
  "Europe/Madrid",
];

export function CurrencySelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue>{currencyLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {GRUPOS.map((g) => (
          <SelectGroup key={g.label}>
            <SelectLabel>{g.label}</SelectLabel>
            {g.items.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {currencyLabel(c.code)}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TimezoneInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <Input
        id={id}
        value={value}
        list={`${id}-zonas`}
        spellCheck={false}
        className="font-mono text-sm"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={`${id}-zonas`}>
        {ZONAS.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}

/** "Hotel Sol & Playa" -> "hotel-sol-playa". Solo una propuesta: se puede editar. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
