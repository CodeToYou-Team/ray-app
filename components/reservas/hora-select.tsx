"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Una hora elegida de la lista de medias horas, en vez de escrita. Llega a
 * "24:00" (hasta la medianoche), que `<input type="time">` no admite. Si el
 * valor actual no está en la lista (una reserva vieja de otro tramo), se
 * muestra igual para no esconder lo guardado.
 */
export function HoraSelect({
  id,
  value,
  opciones,
  disabled,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  opciones: string[];
  disabled?: boolean;
  onChange: (v: string) => void;
  className?: string;
  "aria-label"?: string;
}) {
  const lista = opciones.includes(value) ? opciones : [value, ...opciones].sort();
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn("w-full font-mono", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {lista.map((h) => (
          <SelectItem key={h} value={h} className="font-mono">
            {h}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
