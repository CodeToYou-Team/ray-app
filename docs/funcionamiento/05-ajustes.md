# 5. Ajustes

`/ajustes` no tiene contenido propio: redirige a la **primera sección que el rol puede abrir**
(el dueño cae en Negocio; el encargado y el personal, en Catálogos).

| Sección | Ruta | Quién entra | Quién edita |
|---|---|---|---|
| Negocio | `/ajustes/negocio` | Dueño | Dueño |
| Catálogos | `/ajustes/catalogos` | Todos | Dueño y encargado |
| Columnas | `/ajustes/columnas` | Dueño | Dueño |
| Equipo | `/ajustes/usuarios` | Dueño | Dueño |

---

## Negocio

### Moneda por defecto

La moneda "en la que el negocio piensa sus precios". Se usa para:

- Proponerla al crear un producto o servicio.
- Ponerla primero en las tarjetas del Inicio.
- Elegirla por defecto en Reportes e Historial.

**No convierte nada ni toca nada ya registrado.** Cada operación guarda su propia moneda, así que
los totales de meses anteriores no cambian. Solo admite monedas de la lista cerrada.

### Tasas de cambio

Lista de tasas "vigentes" por par de monedas, por ejemplo `1 USD = 40 VES`, con la fecha en que
se fijaron.

- **Fijar una tasa / Fijar otra**: se eligen moneda base, moneda destino y valor (mayor que cero,
  hasta 6 decimales). Las dos monedas tienen que ser distintas.
- Hay **una sola tasa por par**: volver a guardar el mismo par la reemplaza.
- **Quitar** la borra (aquí sí se borra de verdad: no hay historial que preservar, porque cada
  operación guardó la suya).

Para qué sirve: es la tasa con la que llega **precargado** el formulario al registrar una venta
cobrada en otra moneda, o al [cobrar una reserva](08-reservas.md#cobrar) en otra moneda. Si no hay ninguna fijada para ese par, se propone la última usada. Ver
[Finanzas › tasa de cambio](02-finanzas.md#venta-en-otra-moneda-la-tasa-de-cambio).

**Cambiar o quitar una tasa no modifica ninguna operación ya registrada.**

---

## Catálogos

Listas editables que alimentan los selectores de toda la app. Una pestaña por catálogo:

| Catálogo | Se usa en | Lleva moneda |
|---|---|:-:|
| Categorías de ingreso | Registrar ingresos | — |
| Categorías de gasto | Registrar gastos | — |
| Métodos de pago | Registrar ingresos y gastos | ✔ |
| Categorías de producto | Crear productos | — |
| Categorías de servicio | Crear servicios | — |

Cada método de pago **define la moneda** en que entra el pago; de ahí sale la moneda de cada
operación.

### Acciones (dueño y encargado)

- **Nuevo**: nombre (hasta 80 caracteres) y, en métodos de pago, la moneda.
- **Editar**: cambia el nombre y, en métodos de pago, la moneda. Las operaciones ya registradas
  **conservan la moneda que tenían** (la copiaron al registrarse).
- **Archivar / Restaurar**: un elemento archivado desaparece de los selectores nuevos pero sigue
  apareciendo en los registros antiguos. **Nunca se borra.**
- **Ver archivados**: interruptor para mostrarlos en la lista.

El personal ve las listas sin botones.

### Identificador

Al crear un elemento se genera un **identificador** a partir del nombre (sin acentos, en
minúsculas, con guiones bajos: "Logística" → `logistica`). Se muestra al editar y **no cambia
nunca**, aunque se renombre. Si dos nombres distintos generan el mismo identificador
("Efectivo $" y "Efectivo €"), se le agrega un sufijo (`efectivo_2`). Dos elementos con
exactamente el mismo nombre en un catálogo se rechazan.

### Valores iniciales de un negocio nuevo

Los crea el script de alta (`pnpm seed:tenant`) y son totalmente editables:

- **Ingreso**: Ventas de productos, Servicios profesionales, Consultoría, Suscripciones, Otros
  ingresos.
- **Gasto**: Nómina, Renta y servicios, Marketing, Materia prima, Software y herramientas,
  Logística, Impuestos, Otros gastos.
- **Métodos de pago**: Efectivo USD, Efectivo Bs (VES), Efectivo EUR, Pago móvil (VES),
  Transferencia Bs (VES), Zelle (USD), USDT, USDC.
- **Producto**: Electrónica, Accesorios, Software, Componentes, Periféricos.
- **Servicio**: Consultoría, Desarrollo, Diseño, Mantenimiento, Capacitación.

---

## Columnas

Define **qué información se guarda** de cada producto y de cada servicio. Dos pestañas:
Productos y Servicios. La tabla muestra Columna · Tipo · Identificador · En tabla · Acciones.

### Columnas del sistema (fijas)

Son columnas reales de la base de datos y de ellas dependen ventas, inventario y alertas:

| Productos | Servicios |
|---|---|
| Nombre, SKU, Categoría, Precio, Stock mínimo, Disponible para vender | Nombre, Categoría, Precio, Disponible para vender |

Desde aquí se pueden **renombrar** y marcar como ocultas o fuera del listado, pero **no** cambiar
su tipo, su obligatoriedad ni archivarlas. "Nombre" no se puede ocultar. (Ver
[limitaciones](07-limitaciones-y-pendientes.md#ajustes-de-columnas-fijas-sin-efecto-en-productos):
hoy esos cambios sobre columnas fijas no se reflejan en la pantalla de Productos.)

### Columnas personalizadas

**Nueva columna** abre un diálogo con:

- **Nombre**. De él se genera el **identificador**, que queda fijo para siempre.
- **Tipo** (no se puede cambiar después):

  | Tipo | Para qué |
  |---|---|
  | Texto corto | Una línea: marca, modelo, color (máx. 200 caracteres por defecto) |
  | Texto largo | Descripciones, notas (máx. 2000) |
  | Número | Admite decimales: peso, medidas |
  | Número entero | Piezas, meses de garantía |
  | Monto | Dos decimales: costo, precio de referencia |
  | Sí / No | Una casilla: importado, frágil, en promoción |
  | Fecha | Vencimiento, fecha de compra |
  | Lista de opciones | Se elige una; las opciones se definen ahí mismo |
  | Lista con varias opciones | Se pueden elegir varias |
  | Catálogo | Apunta a uno de los catálogos de Ajustes › Catálogos |

- **Opciones** (en las listas): se agregan y renombran libremente. **Quitar una opción la
  archiva**: los productos que ya la tenían la siguen mostrando, pero deja de ofrecerse.
- **Obligatorio al guardar**.
- **Mostrar como columna en el listado** de Productos.
- **Ocultar del formulario** (al editar una existente).

Reglas:

- No se puede crear una columna cuyo identificador choque con una fija (por ejemplo "Precio").
- Dos columnas con el mismo nombre se rechazan; si solo coincide el identificador, se le agrega
  un sufijo.
- **Archivar** una columna personalizada la quita del formulario y del listado. Los valores
  ya guardados se quedan en la base, pero se pierden en cada producto que se vuelva a guardar.
- Para "cambiar el tipo" de una columna: crear una nueva y archivar la vieja.

### Validación

Los valores se validan con la misma función en el navegador y en el servidor, contra la
configuración vigente. **Al leer no se valida**: un producto creado antes de que una columna se
volviera obligatoria se sigue pudiendo abrir y listar.

---

## Equipo

Solo el dueño.

### Miembros

Tabla con nombre, correo y rol de cada persona.

- El rol se cambia con un selector en la misma fila (excepto el propio, que no se puede tocar).
- **Quitar del equipo** pide confirmación: la persona pierde el acceso y sus operaciones se
  quedan.
- Siempre debe quedar al menos un dueño.

### Invitaciones pendientes

Correos invitados que todavía no se han registrado, con su rol. Se pueden **cancelar**.

### Invitar a alguien

1. **Invitar** → correo y rol (con la descripción de lo que puede hacer cada rol).
2. Al guardar aparece **"Invitación creada"** con el enlace a `/registro` (se arma con la
   dirección real del servidor) para pasárselo a la persona.
3. Volver a invitar un correo que ya está pendiente solo actualiza su rol. Invitar a alguien que
   ya es miembro se rechaza.

El flujo completo está en [Acceso y roles](01-acceso-y-roles.md#cómo-entra-una-persona-nueva-flujo-de-invitación).
