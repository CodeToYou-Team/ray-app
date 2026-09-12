"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { activeOptions, type ResolvedField } from "@/lib/fields/resolve";
import { cn } from "@/lib/utils";

export interface FieldInputProps {
  field: ResolvedField;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Opciones de un campo `catalog`, resueltas en el servidor. */
  catalogOptions?: { code: string; label: string }[];
  error?: string;
}

/**
 * Un input por tipo de campo.
 *
 * El renderer, el validador (lib/fields/validate.ts) y la tabla consumen la
 * MISMA definicion resuelta, que es lo que impide que el formulario acepte algo
 * que el servidor despues rechaza.
 */
export function FieldInput({
  field,
  value,
  onChange,
  catalogOptions,
  error,
}: FieldInputProps) {
  const id = `campo-${field.key}`;
  const texto = typeof value === "string" ? value : "";

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
        {field.source === "custom" && (
          <Badge variant="outline" className="text-[9px] font-normal">
            personalizada
          </Badge>
        )}
      </Label>

      <Control
        id={id}
        field={field}
        value={value}
        texto={texto}
        onChange={onChange}
        catalogOptions={catalogOptions}
        invalid={Boolean(error)}
      />

      {field.help && !error && (
        <p className="text-xs text-muted-foreground">{field.help}</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Control({
  id,
  field,
  value,
  texto,
  onChange,
  catalogOptions,
  invalid,
}: {
  id: string;
  field: ResolvedField;
  value: unknown;
  texto: string;
  onChange: (v: unknown) => void;
  catalogOptions?: { code: string; label: string }[];
  invalid: boolean;
}) {
  const claseError = invalid ? "border-destructive" : undefined;

  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          id={id}
          rows={3}
          value={texto}
          className={claseError}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "boolean":
      return (
        <div className="flex items-center gap-2">
          <Switch
            id={id}
            checked={value === true}
            onCheckedChange={(v) => onChange(v)}
          />
          <Label htmlFor={id} className="text-sm font-normal text-muted-foreground">
            {value === true ? "Sí" : "No"}
          </Label>
        </div>
      );

    case "date":
      return (
        <Input
          id={id}
          type="date"
          value={texto}
          className={claseError}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "number":
    case "integer":
    case "money":
      return (
        <Input
          id={id}
          inputMode="decimal"
          value={typeof value === "number" ? String(value) : texto}
          placeholder={field.type === "money" ? "0.00" : "0"}
          className={cn("font-mono", claseError)}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "select": {
      const opciones = activeOptions(field);
      // Un valor archivado se sigue ofreciendo, o al editar se perderia.
      const guardado = texto;
      const faltante =
        guardado && !opciones.some((o) => o.code === guardado)
          ? field.options.find((o) => o.code === guardado)
          : null;

      return (
        <Select value={guardado} onValueChange={onChange}>
          <SelectTrigger id={id} className={cn("w-full", claseError)}>
            <SelectValue placeholder="Elige una opción" />
          </SelectTrigger>
          <SelectContent>
            {opciones.map((o) => (
              <SelectItem key={o.code} value={o.code}>
                {o.label}
              </SelectItem>
            ))}
            {faltante && (
              <SelectItem value={faltante.code}>
                {faltante.label}
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  (ya no disponible)
                </span>
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      );
    }

    case "multiselect": {
      const seleccionadas = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className={cn("flex flex-wrap gap-1.5 rounded-md border p-2", claseError)}>
          {activeOptions(field).map((o) => {
            const activa = seleccionadas.includes(o.code);
            return (
              <button
                key={o.code}
                type="button"
                onClick={() =>
                  onChange(
                    activa
                      ? seleccionadas.filter((c) => c !== o.code)
                      : [...seleccionadas, o.code],
                  )
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  activa
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-muted",
                )}
              >
                {o.label}
              </button>
            );
          })}
          {activeOptions(field).length === 0 && (
            <span className="text-xs text-muted-foreground">
              Sin opciones disponibles.
            </span>
          )}
        </div>
      );
    }

    case "catalog":
      return (
        <Select value={texto} onValueChange={onChange}>
          <SelectTrigger id={id} className={cn("w-full", claseError)}>
            <SelectValue placeholder="Elige una opción" />
          </SelectTrigger>
          <SelectContent>
            {(catalogOptions ?? []).map((o) => (
              <SelectItem key={o.code} value={o.code}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    default:
      return (
        <Input
          id={id}
          value={texto}
          className={claseError}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** Formatea un valor guardado para mostrarlo en una tabla. */
export function formatFieldValue(
  field: ResolvedField,
  value: unknown,
  catalogLabels?: Map<string, string>,
): string {
  if (value === undefined || value === null || value === "") return "—";

  switch (field.type) {
    case "boolean":
      return value === true ? "Sí" : "No";
    case "select":
      return field.options.find((o) => o.code === value)?.label ?? String(value);
    case "multiselect": {
      const lista = Array.isArray(value) ? value : [value];
      if (lista.length === 0) return "—";
      return lista
        .map(
          (v) => field.options.find((o) => o.code === v)?.label ?? String(v),
        )
        .join(", ");
    }
    case "catalog":
      return catalogLabels?.get(String(value)) ?? String(value);
    case "date":
      return String(value);
    default:
      return String(value);
  }
}
