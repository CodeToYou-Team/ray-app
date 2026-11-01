# 4. Inicio, reportes e historial

Todas estas pantallas respetan la misma regla: **cada cifra pertenece a una sola moneda**.

## Inicio (`/dashboard`)

Visible para todos los roles.

### Tarjetas "Este mes"

Una tarjeta **por cada moneda** con movimientos en el mes en curso:

- **Ingresos** y **Gastos** del mes, cada uno con su variación porcentual contra el mes anterior
  ("+12% vs mes anterior"). Si el mes anterior fue 0 o no hubo movimientos en esa moneda, dice
  "sin mes anterior para comparar".
- **Balance** (ingresos − gastos), en rojo si es negativo.

La moneda por defecto del negocio va primero; el resto, en orden alfabético.

Si no hay movimientos en el mes, se muestra una tarjeta vacía con botones para registrar el
primer ingreso o gasto.

### Debajo

- **Últimos movimientos**: las 8 operaciones más recientes (no anuladas), con etiqueta de
  venta/compra, categoría, fecha y monto. Enlace **Ver todos** a Movimientos.
- **Acciones rápidas**: Ingreso, Gasto, Producto, Inventario (enlaces a sus pantallas).
- **Inventario**: cuántos productos hay en el catálogo y hasta 5 alertas de stock (agotados en
  rojo, bajos en ámbar), con enlace si hay más.

## Reportes (`/finanzas/reportes`)

Solo **dueño y encargado** (`report:read`). El personal ve una tarjeta de "No tienes acceso".

### Selectores

- **Moneda**: las monedas en las que el negocio ha operado. Si todavía no hay operaciones, se
  ofrece la moneda por defecto. Por defecto se elige la moneda del negocio.
- **Periodo**: Últimos 3 meses · **Últimos 6 meses** (por defecto) · Últimos 12 meses · Todo.
  "Últimos N meses" va desde el día 1 del mes de hace N−1 meses hasta hoy.

Ambos viven en la URL (`?moneda=VES&periodo=12m`).

### Contenido

| Bloque | Qué muestra |
|---|---|
| Tarjetas | Ingresos, Gastos y Balance del periodo |
| Evolución mensual | Barras de ingresos y gastos por mes |
| Ingresos por categoría | Totales por categoría, de mayor a menor |
| Gastos por categoría | Ídem para gastos |
| Ingresos por método de pago | Gráfico de torta: cuánto entró por cada método (solo los de esa moneda) |
| Productos más vendidos | Top 10 por monto vendido: unidades y total. Solo ventas, no compras |

Si no hay operaciones en esa moneda y periodo: "No hay operaciones en {moneda} para este
periodo".

Los meses se agrupan por la **fecha de la operación** (una fecha sin hora), así que no hay
desfases por zona horaria.

## Historial (`/finanzas/historial`)

Solo **dueño y encargado**.

- Selector de **moneda** (mismo criterio que Reportes). No tiene selector de periodo: muestra
  todos los meses con movimientos.
- Tabla del **mes más reciente al más antiguo**: Mes · Ingresos · Gastos · Balance · vs. anterior.
- "vs. anterior" es la variación de **ingresos** respecto al mes previo de la lista.
- Sin datos: "Sin movimientos en {moneda}".
