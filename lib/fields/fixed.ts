import type { FieldEntity, FieldType } from "@/lib/db/schema";

/**
 * Las columnas FIJAS de productos y servicios.
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
   * Sin columnas fijas configurables: nombre, documento, teléfono y notas son
   * del formulario de reserva, escrito a mano, y renombrarlos desde Ajustes no
   * tendría efecto. En reservas solo se agregan columnas propias.
   */
  booking: [],
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
