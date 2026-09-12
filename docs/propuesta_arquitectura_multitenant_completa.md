# Guía de Arquitectura y Recomendaciones: Engine No-Code / Low-Code Multi-Tenant

Este documento recopila la propuesta integral de arquitectura, stack tecnológico, estrategia de base de datos y diseño DDL para construir una plataforma SaaS multi-tenant que permita a múltiples clientes definir tablas personalizadas, auto-generar formularios y visualizar sus datos de forma dinámica.

---

## 1. Visión General del Proyecto y Requerimientos

La meta es construir una aplicación web capaz de escalar gradualmente desde 2 o 3 clientes pequeños iniciales hasta cientos de organizaciones sin necesidad de reescribir la aplicación ni realizar despliegues de base de datos por cada cliente nuevo.

### Funcionalidades Core:
1. **Definición Dinámica de Esquemas:** Los clientes pueden definir sus propias tablas y las propiedades/campos que desean almacenar en cada una.
2. **Generación Automática de Formularios:** Cada tabla creada genera automáticamente su propio formulario de captura de datos con validaciones acordes a los tipos de campo.
3. **Visualización Adaptativa:** Cada tabla cuenta con su propia vista de listado/tabla con soporte para paginación, filtros y ordenamiento dinámico.
4. **Multi-Tenancy:** Aislamiento estricto de datos entre clientes para garantizar privacidad y seguridad.

---

## 2. Recomendación de Base de Datos y Modelado

Para gestionar esquemas dinámicos por cliente, la recomendación principal es utilizar **PostgreSQL** mediante el enfoque de **EAV-Híbrido (Entity-Attribute-Value sobre JSONB)** respaldado por **Row Level Security (RLS)**.

### ¿Por qué PostgreSQL + JSONB frente a otras alternativas?
* **ACID Compliancy & Consistencia:** Garantiza la integridad transaccional del sistema.
* **Flexibilidad de JSONB con Rendimiento Relacional:** Permite guardar la definición de las tablas y campos en tablas de metadatos tradicionales, mientras que los valores de los registros dinámicos se almacenan en un campo `JSONB`.
* **Indexación Avanzada (GIN):** PostgreSQL permite indexar directamente los atributos dentro del objeto JSONB para realizar búsquedas y filtros a alta velocidad.
* **Seguridad Nativa con RLS:** Permite aislar los datos de cada cliente a nivel de motor de base de datos, evitando filtraciones de información incluso si la aplicación comete un error en la capa API.

---

## 3. Arquitectura del Sistema

```
[ Frontend: Generador Dinámico (Next.js / React) ]
       │
       ▼
[ Form Engine (React Hook Form + Zod / JSON Schema) ]
       │
       ▼
[ Backend API / Validador (Node.js / Express / NestJS) ]
       │
       ▼
[ PostgreSQL: Metadatos + Datos Dinámicos JSONB + RLS ]
```

### Funcionamiento de los Componentes:
* **Definición de Entidades:** La interfaz del cliente permite configurar campos (`nombre`, `tipo`, `requerido`, `reglas`). Esta configuración se guarda en tablas de metadatos (`entities` y `entity_fields`).
* **Engine de Formularios:** En el frontend, un componente genérico lee la configuración de la entidad en formato **JSON Schema** y renderiza dinámicamente los controles de entrada (inputs, selects, datepickers) ajustando las validaciones al vuelo.
* **Engine de Visualización:** Un componente de tabla genérico (construido con librerías headless como **TanStack Table**) renderiza columnas de forma dinámica basándose en la lista de campos definida para esa entidad.

---

## 4. Stack Tecnológico Recomendado

| Capa | Tecnología | Razón / Beneficio |
| :--- | :--- | :--- |
| **Base de Datos** | **PostgreSQL** (Supabase, Neon, Azure PostgreSQL) | JSONB eficiente, soporte nativo para Row Level Security (RLS). |
| **Backend / API** | **Node.js** (NestJS / Express) | TypeScript estricto para validar esquemas dinámicos usando `Zod` o `AJV`. |
| **Form Engine** | **React Hook Form + Zod** (o `@rjsf/core`) | Permite construir esquemas de validación dinámicos a partir de metadatos JSON. |
| **UI & Tablas** | **Tailwind CSS + TanStack Table** | TanStack Table maneja columnas, paginación y filtros dinámicos sin acoplarse a la UI. |

---

## 5. Diseño de Base de Datos PostgreSQL (DDL, Índices y RLS)

### A. Esquema de Tablas (DDL)

```sql
-- Habilitar extensión para generación de UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. Clientes / Tenants
-- ============================================================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 2. Metadatos: Definición de Tablas/Entidades por Tenant
-- ============================================================================
CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,              -- Nombre técnico (ej: 'products')
    display_name VARCHAR(100) NOT NULL,      -- Nombre visible en UI (ej: 'Productos')
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_entity_per_tenant UNIQUE (tenant_id, name)
);

-- ============================================================================
-- 3. Metadatos: Campos/Propiedades de cada Entidad
-- ============================================================================
CREATE TABLE entity_fields (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,              -- Clave en el objeto JSONB (ej: 'price')
    label VARCHAR(100) NOT NULL,             -- Etiqueta en UI (ej: 'Precio Unitario')
    data_type VARCHAR(50) NOT NULL,          -- Tipo: 'string', 'number', 'boolean', 'date', 'select'
    is_required BOOLEAN DEFAULT FALSE,
    is_searchable BOOLEAN DEFAULT FALSE,
    options JSONB DEFAULT '[]'::jsonb,       -- Opciones para campos tipo 'select'
    validation_rules JSONB DEFAULT '{}'::jsonb, -- Reglas adicionales (min, max, regex)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_field_per_entity UNIQUE (entity_id, name)
);

-- ============================================================================
-- 4. Datos: Contenedor Universal de Registros Dinámicos
-- ============================================================================
CREATE TABLE entity_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,  -- Valores dinámicos (ej: {"price": 100, "brand": "ACME"})
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### B. Estrategia de Índices para Alto Rendimiento

```sql
-- Índice GIN sobre el objeto JSONB completo para consultas dinámicas
CREATE INDEX idx_records_data_gin ON entity_records USING gin (data);

-- Índices B-Tree para ruteo rápido de consultas por Tenant y Entidad
CREATE INDEX idx_entities_tenant ON entities(tenant_id);
CREATE INDEX idx_fields_entity ON entity_fields(entity_id);
CREATE INDEX idx_records_tenant_entity ON entity_records(tenant_id, entity_id);

-- Índice para ordenamiento cronológico por entidad y cliente
CREATE INDEX idx_records_created_at ON entity_records(tenant_id, entity_id, created_at DESC);
```

### C. Implementación de Row Level Security (RLS)

```sql
-- Activar RLS en todas las tablas sensibles
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_records ENABLE ROW LEVEL SECURITY;

-- Política de Aislamiento para 'entities'
CREATE POLICY tenant_isolation_entities ON entities
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Política de Aislamiento para 'entity_fields'
CREATE POLICY tenant_isolation_fields ON entity_fields
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Política de Aislamiento para 'entity_records'
CREATE POLICY tenant_isolation_records ON entity_records
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
```

---

## 6. Flujo de Operaciones (Ejemplos SQL)

```sql
-- 1. Configurar Contexto de Tenant en la Sesión actual
SET LOCAL app.current_tenant_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

-- 2. Registrar Nueva Entidad 'Clientes' y sus Metadatos
INSERT INTO entities (id, tenant_id, name, display_name) 
VALUES (
    'b1111111-1111-1111-1111-111111111111', 
    current_setting('app.current_tenant_id')::uuid, 
    'clients', 
    'Clientes'
);

INSERT INTO entity_fields (entity_id, tenant_id, name, label, data_type, is_required)
VALUES (
    'b1111111-1111-1111-1111-111111111111', 
    current_setting('app.current_tenant_id')::uuid, 
    'email', 
    'Correo Electrónico', 
    'string', 
    true
);

-- 3. Insertar Registro Dinámico
INSERT INTO entity_records (entity_id, tenant_id, data)
VALUES (
    'b1111111-1111-1111-1111-111111111111',
    current_setting('app.current_tenant_id')::uuid,
    '{"email": "juan@empresa.com", "telefono": "+123456789", "VIP": true}'::jsonb
);

-- 4. Consultar Registros con Proyección y Filtro sobre JSONB
SELECT 
    id, 
    data->>'email' AS email, 
    (data->>'VIP')::boolean AS is_vip,
    created_at
FROM entity_records
WHERE entity_id = 'b1111111-1111-1111-1111-111111111111'
  AND data->>'email' LIKE '%@empresa.com%';
```

---

## 7. Plan de Implementación Recomendado

1. **Fase 1 (MVP para 2-3 clientes):** Implementar la estructura DDL en PostgreSQL, configurar el middleware de backend para inyectar `app.current_tenant_id` y construir el generador de formularios básico en React.
2. **Fase 2 (Validación y Renderizado Dinámico):** Integrar `Zod` dinámico en el frontend para validar campos requeridos, opciones de select y expresiones regulares configuradas por el usuario.
3. **Fase 3 (Visualización Avanzada):** Implementar tablas dinámicas con paginación desde el servidor y filtros avanzados sobre el JSONB.
