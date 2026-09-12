/**
 * Registro de catalogos.
 *
 * Agregar un catalogo nuevo (bancos, proveedores, unidades de medida) es una
 * entrada aca y nada mas: no hace falta migracion, tabla ni pantalla nueva.
 * `catalog_items.catalog_key` es `text` libre justamente para permitirlo; la
 * integridad de que cada referencia apunte al catalogo correcto la dan las FK
 * compuestas del lado que referencia.
 */
export interface CatalogDef {
  /** Titulo de la pantalla. */
  label: string;
  /** Como se nombra un item suelto ("Nueva categoría de ingreso"). */
  singular: string;
  description: string;
  /**
   * Si el catalogo lleva moneda. Hoy solo los metodos de pago: de ahi sale el
   * `currency` que se copia a cada transaccion. La base lo exige con un CHECK.
   */
  hasCurrency: boolean;
}

export const CATALOGS = {
  income_category: {
    label: "Categorías de ingreso",
    singular: "Categoría de ingreso",
    description: "Cómo se clasifican los ingresos al registrarlos.",
    hasCurrency: false,
  },
  expense_category: {
    label: "Categorías de gasto",
    singular: "Categoría de gasto",
    description: "Cómo se clasifican los gastos al registrarlos.",
    hasCurrency: false,
  },
  payment_method: {
    label: "Métodos de pago",
    singular: "Método de pago",
    description:
      "Cada método define la moneda en la que entra el pago. Los totales se llevan separados por moneda, no se convierten.",
    hasCurrency: true,
  },
  product_category: {
    label: "Categorías de producto",
    singular: "Categoría de producto",
    description: "Cómo se agrupan los productos del catálogo.",
    hasCurrency: false,
  },
  service_category: {
    label: "Categorías de servicio",
    singular: "Categoría de servicio",
    description: "Cómo se agrupan los servicios del catálogo.",
    hasCurrency: false,
  },
} as const satisfies Record<string, CatalogDef>;

export type CatalogKey = keyof typeof CATALOGS;

export const CATALOG_KEYS = Object.keys(CATALOGS) as CatalogKey[];

export function isCatalogKey(value: string): value is CatalogKey {
  return Object.hasOwn(CATALOGS, value);
}

export function catalogDef(key: CatalogKey): CatalogDef {
  return CATALOGS[key];
}

/**
 * Convierte una etiqueta en el `code` inmutable que se guarda.
 *
 * Se genera UNA vez, al crear. Despues es inmutable (lo garantiza un trigger),
 * asi que renombrar la etiqueta no lo toca. Se quitan los acentos para que el
 * code sea legible en SQL: `data->>'categoria'` con "Logística" adentro es
 * mucho peor de depurar que "logistica".
 */
export function slugifyCode(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/**
 * Catalogos por defecto de un cliente nuevo. Salen de lib/mock-data.ts, que era
 * el contenido con el que se diseñaron las pantallas. Son un punto de partida
 * editable: el cliente renombra, agrega y archiva lo que necesite.
 */
export const DEFAULT_CATALOG_ITEMS: Record<CatalogKey, { label: string; currency?: string }[]> = {
  income_category: [
    { label: "Ventas de productos" },
    { label: "Servicios profesionales" },
    { label: "Consultoría" },
    { label: "Suscripciones" },
    { label: "Otros ingresos" },
  ],
  expense_category: [
    { label: "Nómina" },
    { label: "Renta y servicios" },
    { label: "Marketing" },
    { label: "Materia prima" },
    { label: "Software y herramientas" },
    { label: "Logística" },
    { label: "Impuestos" },
    { label: "Otros gastos" },
  ],
  payment_method: [
    // Las etiquetas llevan el codigo de moneda y no el simbolo: "Efectivo $" y
    // "Efectivo €" generarian el mismo code, porque los simbolos se descartan.
    { label: "Efectivo USD", currency: "USD" },
    { label: "Efectivo Bs", currency: "VES" },
    { label: "Efectivo EUR", currency: "EUR" },
    { label: "Pago móvil", currency: "VES" },
    { label: "Transferencia Bs", currency: "VES" },
    { label: "Zelle", currency: "USD" },
    { label: "USDT", currency: "USDT" },
    { label: "USDC", currency: "USDC" },
  ],
  product_category: [
    { label: "Electrónica" },
    { label: "Accesorios" },
    { label: "Software" },
    { label: "Componentes" },
    { label: "Periféricos" },
  ],
  service_category: [
    { label: "Consultoría" },
    { label: "Desarrollo" },
    { label: "Diseño" },
    { label: "Mantenimiento" },
    { label: "Capacitación" },
  ],
};
