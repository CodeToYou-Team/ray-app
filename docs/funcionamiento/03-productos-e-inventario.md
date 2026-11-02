# 3. Productos, servicios e inventario

## Productos y servicios (`/productos`)

Una sola pantalla con dos pestañas: **Productos (n)** y **Servicios (n)** (el número cuenta los
no archivados).

- **Productos** llevan inventario.
- **Servicios** no tienen stock. Un servicio también puede volverse **reservable** (una
  habitación por noche, una cancha por hora, una clase con cupos) desde **Reservas › Recursos**:
  ver [Reservas](08-reservas.md).

### Listado

| Pestaña | Columnas |
|---|---|
| Productos | Producto · SKU · Categoría · Precio · Stock · *(columnas personalizadas)* · acciones |
| Servicios | Servicio · Categoría · Precio · *(columnas personalizadas)* · acciones |

- **Buscar…** filtra por nombre (en el navegador).
- El interruptor **Archivados** muestra también los archivados (atenuados, con etiqueta
  "Archivado").
- Un producto marcado como no disponible para vender lleva la etiqueta **Inactivo**.
- El stock se pinta en **rojo** si es 0 o menos y en **ámbar** si está en o por debajo del
  mínimo.
- Las columnas personalizadas que aparecen son las configuradas en Ajustes › Columnas con
  "Mostrar como columna en el listado".

Acciones por fila (solo dueño y encargado):

| Icono | Acción |
|---|---|
| Ajustes (⚙) | **Ajustar inventario** (solo productos no archivados) |
| Lápiz | Editar |
| Archivo | Archivar / Restaurar (inmediato, sin confirmación) |

El personal ve el listado sin botones.

### Crear o editar

Botón **Nuevo producto** / **Nuevo servicio** (según la pestaña activa) o el lápiz de una fila.

| Campo | Producto | Servicio | Notas |
|---|:-:|:-:|---|
| Nombre | ✔ | ✔ | Obligatorio, hasta 160 caracteres |
| Categoría | ✔ | ✔ | Obligatoria. De "Categorías de producto" o "de servicio". Las archivadas no se pueden elegir |
| SKU | opcional | — | Único entre los productos no archivados del negocio |
| Precio | ✔ | ✔ | Hasta 2 decimales, no negativo |
| Moneda | ✔ | ✔ | Por defecto la moneda del negocio (Ajustes › Negocio) |
| Stock mínimo | opcional | — | Por debajo de esto, el producto aparece como "stock bajo" |
| Stock inicial | solo al crear | — | Se registra como un movimiento `inicial`, no como un número suelto |
| Disponible para vender | ✔ | ✔ | Si se apaga, deja de aparecer al registrar ventas y compras. Las reservas **no** lo respetan todavía: ver [limitaciones](07-limitaciones-y-pendientes.md#reservas) |
| Columnas personalizadas | ✔ | ✔ | Las configuradas por el dueño; se validan según su tipo |

Al guardar:

- Se registra en la auditoría (con el cambio de precio, si lo hubo).
- **Cambiar el precio no altera las ventas ya registradas**: cada renglón guardó su precio.
- Las columnas personalizadas se guardan reemplazando el conjunto entero: el valor de una
  columna **archivada** se pierde al volver a guardar el producto.

Errores frecuentes traducidos: "Ya existe otro producto con ese SKU.", "Esa categoría no existe.",
"\"X\" está archivada.".

### Archivar

Archivar **no borra**: el producto o servicio deja de ofrecerse en ventas, compras e inventario,
pero las operaciones antiguas lo siguen mostrando. Se puede restaurar.

## Inventario

### Cómo se calcula el stock

**El stock de un producto es la suma de todos sus movimientos.** No hay una columna "stock" que
se incremente; cada entrada o salida es una fila que no se edita ni se borra.

| Motivo | Signo | Lo genera |
|---|---|---|
| `inicial` | + | Stock inicial al crear el producto |
| `compra` | + | Una compra de insumos |
| `venta` | − | Una venta |
| `ajuste` | ± | Ajuste manual por conteo físico, o la corrección de una operación |
| `merma` | ± (normalmente −) | Ajuste manual por merma o daño |
| `anulacion` | ± | Anular una venta (+) o una compra (−) |

Las cantidades admiten hasta 3 decimales (útil para kilos, litros, metros).

La base de datos **impide modificar** un movimiento ya registrado. Para corregir siempre se
agrega otro.

### Estado de un producto

| Estado | Condición |
|---|---|
| **Sin stock** | stock ≤ 0 |
| **Bajo** | tiene mínimo definido y stock ≤ mínimo |
| **Disponible** | el resto |

Un producto **sin mínimo definido nunca aparece como bajo**.

### Stock (`/inventario`)

- Tres tarjetas con el conteo de productos **Disponibles**, **Bajos** y **Sin stock**.
- Buscador por nombre o SKU.
- Tabla: Producto · SKU · Stock · Mínimo · Estado.
- Solo productos no archivados.
- Es de consulta: el inventario se mueve registrando ventas y compras en Finanzas, o con
  **Ajustar inventario** en Productos.

### Ajustar inventario

Desde Productos › icono de ajuste (dueño y encargado, permiso `stock:adjust`).

- Se escribe la **diferencia**, no el stock final: `5` suma, `-2` resta. El diálogo muestra en
  cuánto quedaría el stock.
- Motivo: **Ajuste por conteo físico** o **Merma o daño**.
- Nota opcional.
- No puede ser cero.

Se pide la diferencia porque el movimiento es lo que explica el cambio; fijar un valor absoluto
borraría esa explicación.

### Alertas (`/inventario/alertas`)

Las alertas no se guardan en ninguna tabla: se derivan del stock en cada carga, así que no
pueden quedar desactualizadas.

- **Agotados**: productos sin stock ("No se pueden vender").
- **Por debajo del mínimo**: quedan menos unidades que el mínimo definido.
- **Sin mínimo definido**: lista aparte de los productos que nunca van a avisar, con enlace a
  Productos para definirlo.
- Si no hay nada que reponer: "Todo en orden" (o, si no hay productos, un botón para crear el
  primero).

> Nota: hoy la app **no impide vender por debajo de cero**. Una venta con más unidades de las que
> hay se registra y el stock queda negativo (aparece como "Sin stock").
