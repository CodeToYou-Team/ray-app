import type { FieldConfigRow, FieldEntity, FieldType } from "@/lib/db/schema";
import { FIXED_FIELDS, fixedField } from "./fixed";
import type { FieldOption } from "./types";

/**
 * Un campo ya resuelto: la mezcla de lo que dice el codigo y lo que el cliente
 * configuro. Es lo unico que consumen el formulario, la tabla y el validador,
 * asi que las tres cosas no se pueden desincronizar.
 */
export interface ResolvedField {
  key: string;
  source: "fixed" | "custom";
  label: string;
  type: FieldType;
  required: boolean;
  options: FieldOption[];
  config: Record<string, unknown>;
  hidden: boolean;
  showInTable: boolean;
  sortOrder: number;
  archived: boolean;
  /** Las fijas no se archivan ni cambian de tipo. */
  editable: { label: boolean; type: boolean; required: boolean; archive: boolean };
  alwaysVisible: boolean;
  help?: string;
  /** Solo para type='catalog'. */
  catalogKey?: string;
}

/**
 * Mezcla las columnas fijas del codigo con la configuracion del cliente.
 *
 * Reglas:
 *   - Una columna fija SIEMPRE aparece, tenga o no fila en field_config. Asi,
 *     agregar una columna fija nueva en el codigo no requiere tocar la base de
 *     los clientes existentes.
 *   - La fila de field_config solo aporta overrides (etiqueta, orden, visible).
 *   - Las personalizadas salen enteras de field_config.
 *   - Las archivadas se excluyen salvo que se pidan: sus datos siguen en el
 *     JSONB y hay que poder verlos en la pantalla de configuracion.
 */
export function resolveFields(
  entity: FieldEntity,
  config: FieldConfigRow[],
  options: { includeArchived?: boolean; includeHidden?: boolean } = {},
): ResolvedField[] {
  const porKey = new Map(
    config.filter((c) => c.entity === entity).map((c) => [c.key, c]),
  );

  const resueltos: ResolvedField[] = [];

  // 1. Las fijas, en el orden en que las declara el codigo.
  for (const [index, def] of FIXED_FIELDS[entity].entries()) {
    const override = porKey.get(def.key);
    resueltos.push({
      key: def.key,
      source: "fixed",
      label: override?.label?.trim() || def.label,
      type: def.type,
      required: def.required,
      options: [],
      config: override?.config ?? {},
      hidden: def.alwaysVisible ? false : (override?.hidden ?? false),
      showInTable: override?.showInTable ?? true,
      sortOrder: override?.sortOrder ?? index,
      archived: false,
      editable: { label: true, type: false, required: false, archive: false },
      alwaysVisible: def.alwaysVisible ?? false,
      help: def.help,
      catalogKey: def.catalogKey,
    });
  }

  // 2. Las personalizadas, despues de las fijas por defecto.
  const base = FIXED_FIELDS[entity].length;
  for (const row of config) {
    if (row.entity !== entity || row.source !== "custom") continue;
    if (row.archivedAt && !options.includeArchived) continue;

    resueltos.push({
      key: row.key,
      source: "custom",
      label: row.label?.trim() || row.key,
      // `type` es NOT NULL para custom (lo garantiza un CHECK), pero el tipo
      // de Drizzle no lo sabe.
      type: (row.type ?? "text") as FieldType,
      required: row.required,
      options: row.options ?? [],
      config: row.config ?? {},
      hidden: row.hidden,
      showInTable: row.showInTable,
      sortOrder: base + row.sortOrder,
      archived: row.archivedAt !== null,
      editable: { label: true, type: false, required: true, archive: true },
      alwaysVisible: false,
      catalogKey:
        typeof row.config?.catalogKey === "string"
          ? row.config.catalogKey
          : undefined,
    });
  }

  const visibles = options.includeHidden
    ? resueltos
    : resueltos.filter((f) => !f.hidden);

  return visibles.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );
}

/** Solo las columnas que van en la tabla del listado. */
export function tableFields(fields: ResolvedField[]): ResolvedField[] {
  return fields.filter((f) => f.showInTable && !f.archived);
}

/** Solo las personalizadas: las que viven en el JSONB `custom`. */
export function customFields(fields: ResolvedField[]): ResolvedField[] {
  return fields.filter((f) => f.source === "custom");
}

/** Opciones activas de un select. Las archivadas se siguen resolviendo al leer. */
export function activeOptions(field: ResolvedField): FieldOption[] {
  return field.options.filter((o) => !o.archivedAt);
}

/**
 * Etiqueta de un valor guardado.
 *
 * Busca tambien entre las archivadas: un producto de enero con una opcion
 * archivada en marzo tiene que seguir mostrando su nombre y no un hueco.
 */
export function optionLabel(field: ResolvedField, code: string): string {
  return field.options.find((o) => o.code === code)?.label ?? code;
}

/** Valida que una clave nueva no choque con una fija ni con otra existente. */
export function keyTaken(
  entity: FieldEntity,
  key: string,
  config: FieldConfigRow[],
): boolean {
  if (fixedField(entity, key)) return true;
  return config.some((c) => c.entity === entity && c.key === key);
}
