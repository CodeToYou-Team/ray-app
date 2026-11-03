import type { FieldEntity, FieldType } from "@/lib/db/schema";

/**
 * Las columnas FIJAS de productos, servicios y reservas.
 *
 * Son columnas reales de la tabla, no claves del JSONB, y eso es deliberado:
 * `price`, `sku`, `category_id` y `min_stock` cargan la logica de inventario,
 * los renglones de venta y las alertas. Moverlas al JSONB obligaria a
 * `(custom->>'price')::numeric` en todas partes y quitaria la FK de categoria y
 * el CHECK del precio.
 *
 * Lo que el cliente SI puede hacer con ellas: renombrarlas, ocultarlas y
 * reordenarlas. Eso vive en `field_config` con source='fixed'; el tipo y las
 * validaciones salen de aqui.
 */
export interface FixedFieldDef {
  key: string;
  type: FieldType;
  label: string;
  required: boolean;
  /** Para el tipo `catalog`: de que catalogo salen las opciones. */
  catalogKey?: string;
  /** Nunca se puede ocultar: sin ella la fila no se puede identificar. */
  alwaysVisible?: boolean;
  /**
   * Si sale como columna del listado mientras el cliente no diga otra cosa.
   * Por defecto si; las de la reserva que antes no salian siguen sin salir.
   */
  defaultShowInTable?: boolean;
  help?: string;
}

export const FIXED_FIELDS: Record<FieldEntity, FixedFieldDef[]> = {
  product: [
    {
      key: "name",
      type: "text",
      label: "Nombre",
      required: true,
      alwaysVisible: true,
    },
    { key: "sku", type: "text", label: "SKU", required: false },
    {
      key: "category_id",
      type: "catalog",
      label: "Categoría",
      required: true,
      catalogKey: "product_category",
    },
    { key: "price", type: "money", label: "Precio", required: true },
    {
      key: "min_stock",
      type: "number",
      label: "Stock mínimo",
      required: false,
      help: "Por debajo de esta cantidad el producto aparece como stock bajo.",
    },
    {
      key: "is_active",
      type: "boolean",
      label: "Disponible para vender",
      required: false,
    },
  ],
  service: [
    {
      key: "name",
      type: "text",
      label: "Nombre",
      required: true,
      alwaysVisible: true,
    },
    {
      key: "category_id",
      type: "catalog",
      label: "Categoría",
      required: true,
      catalogKey: "service_category",
    },
    { key: "price", type: "money", label: "Precio", required: true },
    {
      key: "is_active",
      type: "boolean",
      label: "Disponible para vender",
      required: false,
    },
  ],
  /**
   * Los datos del titular y las notas: columnas reales de `bookings`. El
   * formulario, el detalle y el listado leen de aqui su nombre y si se ven
   * (`CamposFijos` en components/reservas/types.ts), asi que renombrar u
   * ocultar desde Ajustes si tiene efecto.
   */
  booking: [
    {
      key: "holder_name",
      type: "text",
      label: "Titular",
      required: true,
      alwaysVisible: true,
    },
    {
      key: "holder_document",
      type: "text",
      label: "Documento",
      required: false,
      defaultShowInTable: false,
    },
    {
      key: "holder_phone",
      type: "text",
      label: "Teléfono",
      required: false,
      defaultShowInTable: false,
    },
    {
      key: "notes",
      type: "textarea",
      label: "Notas",
      required: false,
      defaultShowInTable: false,
    },
  ],
};

const BY_ENTITY_KEY = new Map(
  Object.entries(FIXED_FIELDS).flatMap(([entity, fields]) =>
    fields.map((f) => [`${entity}:${f.key}`, f] as const),
  ),
);

export function fixedField(
  entity: FieldEntity,
  key: string,
): FixedFieldDef | undefined {
  return BY_ENTITY_KEY.get(`${entity}:${key}`);
}

export function isFixedKey(entity: FieldEntity, key: string): boolean {
  return BY_ENTITY_KEY.has(`${entity}:${key}`);
}
