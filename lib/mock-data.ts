// ═══════════════════════════════════════════════════════════════
// RAY FINANCE — Mock Data Layer
// Realistic, coherent data across all modules
// ═══════════════════════════════════════════════════════════════

// ── Types ──────────────────────────────────────────────────────

export type TransactionType = "ingreso" | "gasto";

export interface Transaction {
  id: string;
  type: TransactionType;
  concept: string;
  category: string;
  amount: number;
  date: string; // ISO date
  origin?: string; // for income
  provider?: string; // for expenses
  productId?: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  purchasePrice: number;
  salePrice: number;
  sku: string;
  stock: number;
  minStock: number;
  image?: string;
  active: boolean;
  createdAt: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  duration?: string;
  active: boolean;
  createdAt: string;
}

export interface InventoryAlert {
  id: string;
  productId: string;
  productName: string;
  type: "low_stock" | "no_stock" | "overstock";
  currentStock: number;
  minStock: number;
  date: string;
  resolved: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  type: "pago" | "cobro" | "vencimiento" | "recordatorio";
  amount?: number;
  description?: string;
}

export interface MonthlyData {
  month: string;
  shortMonth: string;
  income: number;
  expenses: number;
}

// ── Categories ─────────────────────────────────────────────────

export const incomeCategories = [
  "Ventas de productos",
  "Servicios profesionales",
  "Consultoría",
  "Suscripciones",
  "Otros ingresos",
];

export const expenseCategories = [
  "Nómina",
  "Renta y servicios",
  "Marketing",
  "Materia prima",
  "Software y herramientas",
  "Logística",
  "Impuestos",
  "Otros gastos",
];

export const productCategories = [
  "Electrónica",
  "Accesorios",
  "Software",
  "Componentes",
  "Periféricos",
];

export const serviceCategories = [
  "Consultoría",
  "Desarrollo",
  "Diseño",
  "Mantenimiento",
  "Capacitación",
];

// ── Products ───────────────────────────────────────────────────

export const products: Product[] = [
  {
    id: "prod-001",
    name: 'Monitor UltraWide 34"',
    description: "Monitor curvo 34 pulgadas, resolución WQHD, 144Hz",
    category: "Electrónica",
    purchasePrice: 5200,
    salePrice: 8500,
    sku: "MON-UW34",
    stock: 12,
    minStock: 5,
    active: true,
    createdAt: "2025-09-15",
  },
  {
    id: "prod-002",
    name: "Teclado Mecánico Pro",
    description: "Teclado mecánico RGB, switches Cherry MX Brown",
    category: "Periféricos",
    purchasePrice: 1200,
    salePrice: 2100,
    sku: "TEC-MKP1",
    stock: 28,
    minStock: 10,
    active: true,
    createdAt: "2025-10-02",
  },
  {
    id: "prod-003",
    name: "Webcam HD 1080p",
    description: "Cámara web con micrófono integrado y corrección de luz",
    category: "Periféricos",
    purchasePrice: 680,
    salePrice: 1350,
    sku: "CAM-HD10",
    stock: 3,
    minStock: 8,
    active: true,
    createdAt: "2025-10-10",
  },
  {
    id: "prod-004",
    name: "Hub USB-C 7 en 1",
    description: "Hub multiport: HDMI, USB 3.0, SD, ethernet, PD 100W",
    category: "Accesorios",
    purchasePrice: 450,
    salePrice: 890,
    sku: "HUB-UC71",
    stock: 45,
    minStock: 15,
    active: true,
    createdAt: "2025-11-01",
  },
  {
    id: "prod-005",
    name: "SSD NVMe 1TB",
    description: "Unidad de estado sólido NVMe Gen4, 7000 MB/s lectura",
    category: "Componentes",
    purchasePrice: 1100,
    salePrice: 1950,
    sku: "SSD-NV1T",
    stock: 0,
    minStock: 5,
    active: true,
    createdAt: "2025-11-15",
  },
  {
    id: "prod-006",
    name: "Mouse Ergonómico Vertical",
    description: "Mouse inalámbrico vertical, DPI ajustable, recargable",
    category: "Periféricos",
    purchasePrice: 380,
    salePrice: 750,
    sku: "MOU-ERG1",
    stock: 19,
    minStock: 8,
    active: true,
    createdAt: "2025-12-01",
  },
  {
    id: "prod-007",
    name: "Docking Station USB-C",
    description: "Estación de acoplamiento triple monitor, 100W PD",
    category: "Accesorios",
    purchasePrice: 2800,
    salePrice: 4500,
    sku: "DOC-USC3",
    stock: 7,
    minStock: 3,
    active: true,
    createdAt: "2025-12-10",
  },
  {
    id: "prod-008",
    name: "Licencia Suite Productividad",
    description: "Licencia anual de suite ofimática empresarial",
    category: "Software",
    purchasePrice: 900,
    salePrice: 1500,
    sku: "SW-SUITE",
    stock: 50,
    minStock: 10,
    active: true,
    createdAt: "2026-01-05",
  },
  {
    id: "prod-009",
    name: "Cable HDMI 2.1 (2m)",
    description: "Cable HDMI 2.1, 8K@60Hz, 4K@120Hz, chapado en oro",
    category: "Accesorios",
    purchasePrice: 120,
    salePrice: 280,
    sku: "CBL-HD21",
    stock: 65,
    minStock: 20,
    active: true,
    createdAt: "2026-01-15",
  },
  {
    id: "prod-010",
    name: "Audífonos Cancelación Ruido",
    description: "Over-ear, ANC activo, batería 30h, Bluetooth 5.3",
    category: "Electrónica",
    purchasePrice: 2200,
    salePrice: 3800,
    sku: "AUD-ANC1",
    stock: 4,
    minStock: 5,
    active: true,
    createdAt: "2026-02-01",
  },
];

// ── Services ───────────────────────────────────────────────────

export const services: Service[] = [
  {
    id: "srv-001",
    name: "Consultoría IT Básica",
    description: "Sesión de consultoría para evaluación de infraestructura",
    category: "Consultoría",
    price: 2500,
    duration: "2 horas",
    active: true,
    createdAt: "2025-08-01",
  },
  {
    id: "srv-002",
    name: "Desarrollo Web a Medida",
    description: "Desarrollo de sitio web corporativo personalizado",
    category: "Desarrollo",
    price: 35000,
    duration: "4-6 semanas",
    active: true,
    createdAt: "2025-08-15",
  },
  {
    id: "srv-003",
    name: "Diseño de Identidad Visual",
    description: "Logotipo, paleta de colores, tipografía y guía de marca",
    category: "Diseño",
    price: 15000,
    duration: "2-3 semanas",
    active: true,
    createdAt: "2025-09-01",
  },
  {
    id: "srv-004",
    name: "Mantenimiento Mensual",
    description: "Soporte técnico, actualizaciones y monitoreo de servidores",
    category: "Mantenimiento",
    price: 4500,
    duration: "Mensual",
    active: true,
    createdAt: "2025-09-15",
  },
  {
    id: "srv-005",
    name: "Capacitación en Herramientas Digitales",
    description: "Taller grupal sobre productividad y herramientas cloud",
    category: "Capacitación",
    price: 8000,
    duration: "8 horas",
    active: true,
    createdAt: "2025-10-01",
  },
  {
    id: "srv-006",
    name: "Auditoría de Seguridad",
    description: "Evaluación completa de seguridad informática",
    category: "Consultoría",
    price: 18000,
    duration: "1 semana",
    active: true,
    createdAt: "2025-11-01",
  },
];

// ── Transactions ───────────────────────────────────────────────

export const transactions: Transaction[] = [
  // March 2026
  {
    id: "tx-001",
    type: "ingreso",
    concept: "Venta Monitor UltraWide x3",
    category: "Ventas de productos",
    amount: 25500,
    date: "2026-03-02",
    origin: "Tienda online",
    productId: "prod-001",
  },
  {
    id: "tx-002",
    type: "gasto",
    concept: "Nómina quincenal",
    category: "Nómina",
    amount: 45000,
    date: "2026-03-01",
    provider: "Interno",
  },
  {
    id: "tx-003",
    type: "ingreso",
    concept: "Consultoría IT — Empresa ABC",
    category: "Servicios profesionales",
    amount: 2500,
    date: "2026-03-05",
    origin: "Referencia",
  },
  {
    id: "tx-004",
    type: "gasto",
    concept: "Renta oficina marzo",
    category: "Renta y servicios",
    amount: 12000,
    date: "2026-03-01",
    provider: "Inmobiliaria MX",
  },
  {
    id: "tx-005",
    type: "ingreso",
    concept: "Desarrollo Web — Cliente Delta",
    category: "Servicios profesionales",
    amount: 35000,
    date: "2026-03-08",
    origin: "Contrato directo",
  },
  {
    id: "tx-006",
    type: "gasto",
    concept: "Google Workspace anual",
    category: "Software y herramientas",
    amount: 4800,
    date: "2026-03-10",
    provider: "Google",
  },
  {
    id: "tx-007",
    type: "ingreso",
    concept: "Venta Teclados Mecánicos x8",
    category: "Ventas de productos",
    amount: 16800,
    date: "2026-03-12",
    origin: "Tienda online",
    productId: "prod-002",
  },
  {
    id: "tx-008",
    type: "gasto",
    concept: "Campaña Meta Ads",
    category: "Marketing",
    amount: 8500,
    date: "2026-03-13",
    provider: "Meta",
  },
  {
    id: "tx-009",
    type: "ingreso",
    concept: "Mantenimiento mensual — 3 clientes",
    category: "Suscripciones",
    amount: 13500,
    date: "2026-03-15",
    origin: "Recurrente",
  },
  {
    id: "tx-010",
    type: "gasto",
    concept: "Compra SSD NVMe x10",
    category: "Materia prima",
    amount: 11000,
    date: "2026-03-16",
    provider: "Distribuidora Tech",
  },
  {
    id: "tx-011",
    type: "ingreso",
    concept: "Venta Hub USB-C x12",
    category: "Ventas de productos",
    amount: 10680,
    date: "2026-03-18",
    origin: "Marketplace",
    productId: "prod-004",
  },
  {
    id: "tx-012",
    type: "gasto",
    concept: "Nómina quincenal",
    category: "Nómina",
    amount: 45000,
    date: "2026-03-16",
    provider: "Interno",
  },
  {
    id: "tx-013",
    type: "ingreso",
    concept: "Capacitación Herramientas Digitales",
    category: "Servicios profesionales",
    amount: 8000,
    date: "2026-03-20",
    origin: "Evento presencial",
  },
  {
    id: "tx-014",
    type: "gasto",
    concept: "Envío paquetería — 15 pedidos",
    category: "Logística",
    amount: 3200,
    date: "2026-03-21",
    provider: "FedEx",
  },
  {
    id: "tx-015",
    type: "ingreso",
    concept: "Venta Audífonos ANC x5",
    category: "Ventas de productos",
    amount: 19000,
    date: "2026-03-22",
    origin: "Tienda online",
    productId: "prod-010",
  },
  {
    id: "tx-016",
    type: "gasto",
    concept: "ISR provisional marzo",
    category: "Impuestos",
    amount: 15200,
    date: "2026-03-25",
    provider: "SAT",
  },
  {
    id: "tx-017",
    type: "ingreso",
    concept: "Auditoría de Seguridad — Corp XYZ",
    category: "Servicios profesionales",
    amount: 18000,
    date: "2026-03-27",
    origin: "Referencia",
  },
  {
    id: "tx-018",
    type: "gasto",
    concept: "Material de oficina",
    category: "Otros gastos",
    amount: 1800,
    date: "2026-03-28",
    provider: "OfficeMax",
  },

  // February 2026
  {
    id: "tx-019",
    type: "ingreso",
    concept: "Venta Docking Station x4",
    category: "Ventas de productos",
    amount: 18000,
    date: "2026-02-03",
    origin: "Tienda online",
    productId: "prod-007",
  },
  {
    id: "tx-020",
    type: "gasto",
    concept: "Nómina quincenal",
    category: "Nómina",
    amount: 44000,
    date: "2026-02-01",
    provider: "Interno",
  },
  {
    id: "tx-021",
    type: "ingreso",
    concept: "Diseño de Identidad — Startup Nova",
    category: "Servicios profesionales",
    amount: 15000,
    date: "2026-02-05",
    origin: "Contrato directo",
  },
  {
    id: "tx-022",
    type: "gasto",
    concept: "Renta oficina febrero",
    category: "Renta y servicios",
    amount: 12000,
    date: "2026-02-01",
    provider: "Inmobiliaria MX",
  },
  {
    id: "tx-023",
    type: "ingreso",
    concept: "Licencias Suite x8",
    category: "Ventas de productos",
    amount: 12000,
    date: "2026-02-10",
    origin: "Canal B2B",
    productId: "prod-008",
  },
  {
    id: "tx-024",
    type: "gasto",
    concept: "Campaña Google Ads",
    category: "Marketing",
    amount: 6500,
    date: "2026-02-12",
    provider: "Google",
  },
  {
    id: "tx-025",
    type: "ingreso",
    concept: "Mantenimiento mensual — 3 clientes",
    category: "Suscripciones",
    amount: 13500,
    date: "2026-02-15",
    origin: "Recurrente",
  },
  {
    id: "tx-026",
    type: "gasto",
    concept: "Nómina quincenal",
    category: "Nómina",
    amount: 44000,
    date: "2026-02-16",
    provider: "Interno",
  },
  {
    id: "tx-027",
    type: "ingreso",
    concept: "Venta Mouse Ergonómico x15",
    category: "Ventas de productos",
    amount: 11250,
    date: "2026-02-18",
    origin: "Marketplace",
    productId: "prod-006",
  },
  {
    id: "tx-028",
    type: "gasto",
    concept: "Compra Webcams x20",
    category: "Materia prima",
    amount: 13600,
    date: "2026-02-20",
    provider: "Distribuidora Tech",
  },
  {
    id: "tx-029",
    type: "ingreso",
    concept: "Consultoría IT — Empresa GHI",
    category: "Servicios profesionales",
    amount: 5000,
    date: "2026-02-22",
    origin: "Referencia",
  },
  {
    id: "tx-030",
    type: "gasto",
    concept: "ISR provisional febrero",
    category: "Impuestos",
    amount: 13800,
    date: "2026-02-25",
    provider: "SAT",
  },

  // January 2026
  {
    id: "tx-031",
    type: "ingreso",
    concept: "Venta Monitor UltraWide x2",
    category: "Ventas de productos",
    amount: 17000,
    date: "2026-01-05",
    origin: "Tienda online",
    productId: "prod-001",
  },
  {
    id: "tx-032",
    type: "gasto",
    concept: "Nómina quincenal",
    category: "Nómina",
    amount: 43000,
    date: "2026-01-01",
    provider: "Interno",
  },
  {
    id: "tx-033",
    type: "ingreso",
    concept: "Desarrollo Web — Cliente Epsilon",
    category: "Servicios profesionales",
    amount: 28000,
    date: "2026-01-08",
    origin: "Contrato directo",
  },
  {
    id: "tx-034",
    type: "gasto",
    concept: "Renta oficina enero",
    category: "Renta y servicios",
    amount: 12000,
    date: "2026-01-01",
    provider: "Inmobiliaria MX",
  },
  {
    id: "tx-035",
    type: "ingreso",
    concept: "Venta Cables HDMI x30",
    category: "Ventas de productos",
    amount: 8400,
    date: "2026-01-12",
    origin: "Marketplace",
    productId: "prod-009",
  },
  {
    id: "tx-036",
    type: "gasto",
    concept: "Hosting y dominios anuales",
    category: "Software y herramientas",
    amount: 8200,
    date: "2026-01-10",
    provider: "AWS",
  },
  {
    id: "tx-037",
    type: "ingreso",
    concept: "Mantenimiento mensual — 3 clientes",
    category: "Suscripciones",
    amount: 13500,
    date: "2026-01-15",
    origin: "Recurrente",
  },
  {
    id: "tx-038",
    type: "gasto",
    concept: "Nómina quincenal",
    category: "Nómina",
    amount: 43000,
    date: "2026-01-16",
    provider: "Interno",
  },
  {
    id: "tx-039",
    type: "ingreso",
    concept: "Capacitación — Equipo Corp JKL",
    category: "Servicios profesionales",
    amount: 16000,
    date: "2026-01-20",
    origin: "Evento presencial",
  },
  {
    id: "tx-040",
    type: "gasto",
    concept: "Campaña Meta Ads enero",
    category: "Marketing",
    amount: 5500,
    date: "2026-01-22",
    provider: "Meta",
  },
  {
    id: "tx-041",
    type: "gasto",
    concept: "ISR provisional enero",
    category: "Impuestos",
    amount: 12500,
    date: "2026-01-25",
    provider: "SAT",
  },

  // December 2025
  {
    id: "tx-042",
    type: "ingreso",
    concept: "Venta especial fin de año",
    category: "Ventas de productos",
    amount: 42000,
    date: "2025-12-10",
    origin: "Tienda online",
  },
  {
    id: "tx-043",
    type: "gasto",
    concept: "Nómina diciembre",
    category: "Nómina",
    amount: 86000,
    date: "2025-12-01",
    provider: "Interno",
  },
  {
    id: "tx-044",
    type: "ingreso",
    concept: "Servicios diciembre",
    category: "Servicios profesionales",
    amount: 25000,
    date: "2025-12-15",
    origin: "Varios",
  },
  {
    id: "tx-045",
    type: "gasto",
    concept: "Renta oficina diciembre",
    category: "Renta y servicios",
    amount: 12000,
    date: "2025-12-01",
    provider: "Inmobiliaria MX",
  },
  {
    id: "tx-046",
    type: "ingreso",
    concept: "Suscripciones diciembre",
    category: "Suscripciones",
    amount: 13500,
    date: "2025-12-15",
    origin: "Recurrente",
  },
  {
    id: "tx-047",
    type: "gasto",
    concept: "Aguinaldos",
    category: "Nómina",
    amount: 35000,
    date: "2025-12-20",
    provider: "Interno",
  },

  // November 2025
  {
    id: "tx-048",
    type: "ingreso",
    concept: "Ventas noviembre",
    category: "Ventas de productos",
    amount: 38000,
    date: "2025-11-10",
    origin: "Varios",
  },
  {
    id: "tx-049",
    type: "gasto",
    concept: "Gastos operativos noviembre",
    category: "Renta y servicios",
    amount: 65000,
    date: "2025-11-01",
    provider: "Varios",
  },
  {
    id: "tx-050",
    type: "ingreso",
    concept: "Servicios noviembre",
    category: "Servicios profesionales",
    amount: 30000,
    date: "2025-11-15",
    origin: "Varios",
  },
  {
    id: "tx-051",
    type: "ingreso",
    concept: "Suscripciones noviembre",
    category: "Suscripciones",
    amount: 13500,
    date: "2025-11-15",
    origin: "Recurrente",
  },

  // October 2025
  {
    id: "tx-052",
    type: "ingreso",
    concept: "Ventas octubre",
    category: "Ventas de productos",
    amount: 35000,
    date: "2025-10-10",
    origin: "Varios",
  },
  {
    id: "tx-053",
    type: "gasto",
    concept: "Gastos operativos octubre",
    category: "Renta y servicios",
    amount: 62000,
    date: "2025-10-01",
    provider: "Varios",
  },
  {
    id: "tx-054",
    type: "ingreso",
    concept: "Servicios octubre",
    category: "Servicios profesionales",
    amount: 22000,
    date: "2025-10-15",
    origin: "Varios",
  },
  {
    id: "tx-055",
    type: "ingreso",
    concept: "Suscripciones octubre",
    category: "Suscripciones",
    amount: 9000,
    date: "2025-10-15",
    origin: "Recurrente",
  },
];

// ── Monthly Summary (last 12 months) ──────────────────────────

export const monthlyData: MonthlyData[] = [
  { month: "2025-04", shortMonth: "Abr", income: 52000, expenses: 48000 },
  { month: "2025-05", shortMonth: "May", income: 58000, expenses: 51000 },
  { month: "2025-06", shortMonth: "Jun", income: 61000, expenses: 53000 },
  { month: "2025-07", shortMonth: "Jul", income: 55000, expenses: 50000 },
  { month: "2025-08", shortMonth: "Ago", income: 63000, expenses: 54000 },
  { month: "2025-09", shortMonth: "Sep", income: 67000, expenses: 56000 },
  { month: "2025-10", shortMonth: "Oct", income: 66000, expenses: 62000 },
  { month: "2025-11", shortMonth: "Nov", income: 81500, expenses: 65000 },
  { month: "2025-12", shortMonth: "Dic", income: 80500, expenses: 133000 },
  { month: "2026-01", shortMonth: "Ene", income: 82900, expenses: 124200 },
  { month: "2026-02", shortMonth: "Feb", income: 74750, expenses: 133900 },
  { month: "2026-03", shortMonth: "Mar", income: 148980, expenses: 146500 },
];

// ── Expense distribution by category (current month) ──────────

export const expensesByCategory = [
  { category: "Nómina", amount: 90000, color: "var(--chart-1)" },
  { category: "Renta y servicios", amount: 12000, color: "var(--chart-2)" },
  { category: "Marketing", amount: 8500, color: "var(--chart-3)" },
  { category: "Materia prima", amount: 11000, color: "var(--chart-4)" },
  { category: "Software", amount: 4800, color: "var(--chart-5)" },
  { category: "Impuestos", amount: 15200, color: "var(--chart-1)" },
  { category: "Logística", amount: 3200, color: "var(--chart-2)" },
  { category: "Otros", amount: 1800, color: "var(--chart-3)" },
];

// ── Calendar Events ────────────────────────────────────────────

export const calendarEvents: CalendarEvent[] = [
  {
    id: "ev-001",
    title: "Pago nómina quincenal",
    date: "2026-04-01",
    type: "pago",
    amount: 45000,
    description: "Nómina primera quincena abril",
  },
  {
    id: "ev-002",
    title: "Cobro mantenimiento mensual",
    date: "2026-04-01",
    type: "cobro",
    amount: 13500,
    description: "3 clientes recurrentes",
  },
  {
    id: "ev-003",
    title: "Renta oficina",
    date: "2026-04-01",
    type: "pago",
    amount: 12000,
    description: "Renta mensual",
  },
  {
    id: "ev-004",
    title: "Vencimiento factura #892",
    date: "2026-04-05",
    type: "vencimiento",
    amount: 8500,
    description: "Cliente Delta — desarrollo web",
  },
  {
    id: "ev-005",
    title: "Cobro auditoría fase 2",
    date: "2026-04-08",
    type: "cobro",
    amount: 18000,
    description: "Corp XYZ",
  },
  {
    id: "ev-006",
    title: "Renovación licencia Adobe",
    date: "2026-04-10",
    type: "pago",
    amount: 3600,
    description: "Suscripción anual equipo diseño",
  },
  {
    id: "ev-007",
    title: "Pago nómina quincenal",
    date: "2026-04-16",
    type: "pago",
    amount: 45000,
    description: "Nómina segunda quincena",
  },
  {
    id: "ev-008",
    title: "Declaración ISR",
    date: "2026-04-17",
    type: "vencimiento",
    amount: 16000,
    description: "Provisional mensual",
  },
  {
    id: "ev-009",
    title: "Cobro proyecto web",
    date: "2026-04-20",
    type: "cobro",
    amount: 35000,
    description: "Cliente nuevo — entrega parcial",
  },
  {
    id: "ev-010",
    title: "Revisión presupuesto Q2",
    date: "2026-04-25",
    type: "recordatorio",
    description: "Reunión equipo directivo",
  },
  {
    id: "ev-011",
    title: "Pago proveedor Tech",
    date: "2026-04-28",
    type: "pago",
    amount: 15000,
    description: "Compra inventario mayo",
  },
];

// ── Inventory Alerts ───────────────────────────────────────────

export const inventoryAlerts: InventoryAlert[] = [
  {
    id: "alert-001",
    productId: "prod-005",
    productName: "SSD NVMe 1TB",
    type: "no_stock",
    currentStock: 0,
    minStock: 5,
    date: "2026-03-28",
    resolved: false,
  },
  {
    id: "alert-002",
    productId: "prod-003",
    productName: "Webcam HD 1080p",
    type: "low_stock",
    currentStock: 3,
    minStock: 8,
    date: "2026-03-25",
    resolved: false,
  },
  {
    id: "alert-003",
    productId: "prod-010",
    productName: "Audífonos Cancelación Ruido",
    type: "low_stock",
    currentStock: 4,
    minStock: 5,
    date: "2026-03-22",
    resolved: false,
  },
  {
    id: "alert-004",
    productId: "prod-009",
    productName: "Cable HDMI 2.1 (2m)",
    type: "overstock",
    currentStock: 65,
    minStock: 20,
    date: "2026-03-20",
    resolved: true,
  },
];

// ── Helper functions ───────────────────────────────────────────

export function getCurrentMonthTransactions() {
  return transactions.filter((t) => t.date.startsWith("2026-03"));
}

export function getCurrentMonthIncome() {
  return getCurrentMonthTransactions()
    .filter((t) => t.type === "ingreso")
    .reduce((sum, t) => sum + t.amount, 0);
}

export function getCurrentMonthExpenses() {
  return getCurrentMonthTransactions()
    .filter((t) => t.type === "gasto")
    .reduce((sum, t) => sum + t.amount, 0);
}

export function getPreviousMonthIncome() {
  return transactions
    .filter((t) => t.date.startsWith("2026-02") && t.type === "ingreso")
    .reduce((sum, t) => sum + t.amount, 0);
}

export function getPreviousMonthExpenses() {
  return transactions
    .filter((t) => t.date.startsWith("2026-02") && t.type === "gasto")
    .reduce((sum, t) => sum + t.amount, 0);
}

export function getActiveProducts() {
  return products.filter((p) => p.active);
}

export function getActiveServices() {
  return services.filter((s) => s.active);
}

export function getProductById(id: string) {
  return products.find((p) => p.id === id);
}

export function getServiceById(id: string) {
  return services.find((s) => s.id === id);
}

export function getLowStockProducts() {
  return products.filter((p) => p.active && p.stock <= p.minStock);
}

export function getStockStatus(product: Product): "ok" | "low" | "none" {
  if (product.stock === 0) return "none";
  if (product.stock <= product.minStock) return "low";
  return "ok";
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function getPercentChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return Math.round(((current - previous) / previous) * 100);
}

// Top selling products by revenue
export function getTopProducts() {
  const productSales = new Map<
    string,
    { name: string; revenue: number; units: number }
  >();

  transactions
    .filter((t) => t.type === "ingreso" && t.productId)
    .forEach((t) => {
      const product = products.find((p) => p.id === t.productId);
      if (!product) return;
      const existing = productSales.get(t.productId!) || {
        name: product.name,
        revenue: 0,
        units: 0,
      };
      existing.revenue += t.amount;
      existing.units += Math.round(t.amount / product.salePrice);
      productSales.set(t.productId!, existing);
    });

  return Array.from(productSales.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
}
