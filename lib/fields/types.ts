import type { FieldType } from "@/lib/db/schema";

/**
 * Catalogo CERRADO de tipos de campo.
 *
 * Cerrado es la palabra importante: cada tipo que se agrega es codigo que hay
 * que mantener para siempre en cuatro lugares — el input, el validador, el
 * formateo en la tabla y el filtro. Agregar uno es una decision, no un detalle.
 */

export interface FieldTypeDef {
  label: string;
  /** Texto de ayuda en el selector al crear una columna. */
  hint: string;
  /** Si el tipo usa la lista `options` (select, multiselect). */
  usesOptions: boolean;
  /** Si el tipo apunta a un catalogo administrado por el cliente. */
  usesCatalog: boolean;
}

export const FIELD_TYPES = {
  text: {
    label: "Texto corto",
    hint: "Una línea. Marca, modelo, color escrito a mano.",
    usesOptions: false,
    usesCatalog: false,
  },
  textarea: {
    label: "Texto largo",
    hint: "Varias líneas. Descripciones, notas.",
    usesOptions: false,
    usesCatalog: false,
  },
  number: {
    label: "Número",
    hint: "Admite decimales. Peso, medidas.",
    usesOptions: false,
    usesCatalog: false,
  },
  integer: {
    label: "Número entero",
    hint: "Sin decimales. Cantidad de piezas, garantía en meses.",
    usesOptions: false,
    usesCatalog: false,
  },
  money: {
    label: "Monto",
    hint: "Dos decimales. Costo, precio de referencia.",
    usesOptions: false,
    usesCatalog: false,
  },
  boolean: {
    label: "Sí / No",
    hint: "Una casilla. Importado, frágil, en promoción.",
    usesOptions: false,
    usesCatalog: false,
  },
  date: {
    label: "Fecha",
    hint: "Vencimiento, fecha de compra.",
    usesOptions: false,
    usesCatalog: false,
  },
  select: {
    label: "Lista de opciones",
    hint: "Eliges una. Las opciones se definen aquí mismo.",
    usesOptions: true,
    usesCatalog: false,
  },
  multiselect: {
    label: "Lista con varias opciones",
    hint: "Puedes elegir más de una.",
    usesOptions: true,
    usesCatalog: false,
  },
  catalog: {
    label: "Catálogo",
    hint: "Apunta a un catálogo que administras en Ajustes. Úsalo cuando la opción tenga datos propios.",
    usesOptions: false,
    usesCatalog: true,
  },
} as const satisfies Record<FieldType, FieldTypeDef>;

export const FIELD_TYPE_KEYS = Object.keys(FIELD_TYPES) as FieldType[];

export function fieldTypeDef(type: FieldType): FieldTypeDef {
  return FIELD_TYPES[type];
}

/** Una opcion de un campo select/multiselect. */
export interface FieldOption {
  /** Estable e inmutable. Es lo que se guarda en el JSONB. */
  code: string;
  /** Editable. Es lo que se ve. */
  label: string;
  /**
   * Las opciones se ARCHIVAN, nunca se borran.
   *
   * Si se borrara el valor, cada producto que lo tuviera se renderizaria vacio,
   * y al editarlo la validacion estricta rechazaria una fila que era valida
   * cuando se escribio.
   */
  archivedAt?: string;
}

/**
 * Opciones de los catalogos que usan los campos `catalog`, por `catalogKey`.
 *
 * Objetos planos y no `Map`: cruzan de un Server Component a uno de cliente.
 */
export type CatalogChoices = Record<
  string,
  {
    /** Activos: lo que se ofrece al elegir. */
    options: { code: string; label: string }[];
    /** code -> label, incluidos los archivados, para mostrar lo ya guardado. */
    labels: Record<string, string>;
  }
>;

/**
 * Convierte una etiqueta en la clave inmutable que se guarda.
 *
 * Se genera UNA vez, al crear. Se quitan los acentos para que el JSONB sea
 * legible en SQL: `custom->>'garantia'` se depura mucho mejor que
 * `custom->>'garantía'`, que ademas obliga a comillas en media herramienta.
 */
export function slugifyKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 60);
}
