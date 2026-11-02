# 2. Finanzas: ingresos, gastos y movimientos

## Las tres pantallas

| Pantalla | Qué lista | Botones | Tarjetas de arriba |
|---|---|---|---|
| **Ingresos** (`/finanzas/ingresos`) | Solo ingresos | Registrar ingreso | Total por moneda |
| **Gastos** (`/finanzas/gastos`) | Solo gastos | Registrar gasto | Total por moneda |
| **Movimientos** (`/finanzas/movimientos`) | Ingresos y gastos juntos | Registrar ingreso · Registrar gasto | Ingresos, gastos y **balance** por moneda |

Movimientos es la única pantalla que muestra balance, y lo hace **dentro de cada moneda**.

### La tabla

Columnas: **Fecha · Concepto · Categoría · Método · Monto**, más un menú de acciones (⋮) si el
rol puede corregir o anular.

- Las ventas y compras llevan una etiqueta **Venta** / **Compra** junto al concepto.
- El monto va en verde con flecha hacia arriba (ingreso) o en rojo hacia abajo (gasto).
- Si la operación se cobró con conversión de moneda, debajo del monto aparece la tasa usada,
  por ejemplo `1 USD = 40 VES`.
- Orden: de la fecha más reciente a la más antigua.
- **20 filas por página**, con botones Anterior / Siguiente.
- Las operaciones **anuladas no aparecen** ni cuentan en ningún total.

### Buscador y filtros

Encima de la tabla:

- **Buscar por concepto**: busca el texto en cualquier parte del concepto, sin distinguir
  mayúsculas (sí distingue acentos). Espera ~350 ms después de la última tecla antes de buscar.
- **Desde / Hasta**: rango de fechas inclusivo. Si se ponen al revés, la app los intercambia.
- **Limpiar**: quita todos los filtros.

Comportamiento:

- Todo el estado (página, texto, fechas) vive en la **URL** (`?q=…&desde=…&hasta=…&page=…`):
  el enlace se puede compartir y el botón Atrás funciona como se espera.
- Cambiar un filtro vuelve a la primera página.
- **Las tarjetas de totales aplican los mismos filtros que la tabla.** Si buscas "alquiler",
  el total de arriba es el de lo que estás viendo, no el de todo el año.
- Sin resultados, la tabla ofrece un botón **Quitar los filtros**.
- Un parámetro mal formado en la URL (una fecha inválida) se ignora en lugar de romper la
  página.

## Registrar una operación

El botón **Registrar ingreso** / **Registrar gasto** abre un diálogo.

### Tipo de operación

| Tipo | En ingresos | En gastos | Cómo se fija el monto | Inventario |
|---|---|---|---|---|
| **Operación suelta** | ✔ | ✔ | Se escribe a mano | No lo toca |
| **Venta** | ✔ | — | Suma de los renglones (precio de catálogo) | **Descuenta** los productos |
| **Compra de insumos** | — | ✔ | Suma de los renglones (precio que se escribe) | **Suma** los productos |

Cambiar de tipo vacía los renglones.

### Campos comunes

| Campo | Notas |
|---|---|
| Concepto | Obligatorio, hasta 200 caracteres. |
| Fecha | Por defecto hoy. Es la fecha de la operación, no la de registro. |
| Categoría | De las categorías de **ingreso** o de **gasto**, según el caso. Las archivadas no aparecen. |
| Método de pago | Define la **moneda** de la operación (aparece junto al nombre). Cambiarlo vacía los renglones. |
| Monto | Solo en operación suelta. Hasta 2 decimales. |
| Notas | Opcional, hasta 1000 caracteres. |

El botón **Registrar** se habilita cuando todo lo obligatorio está completo y bien formado.

### Venta

1. Elige primero el método de pago (sin él no se pueden agregar renglones).
2. **Agregar** crea un renglón: se elige un producto o servicio (agrupados) y la cantidad.
3. Debajo de cada renglón se ve `precio × cantidad = subtotal`, y al final el total.

Reglas:

- Se pueden vender productos y servicios mezclados.
- Solo aparecen los que están **disponibles para vender** y no archivados.
- **El precio no se puede editar**: sale del catálogo. El servidor recalcula el precio y el
  total al guardar e ignora cualquier monto que mande el navegador.
- Todos los renglones deben tener **precio de catálogo en la misma moneda**. En cuanto se elige
  el primero, el selector solo ofrece ítems de esa moneda. (Mezclar USD y VES en una venta
  exigiría dos tasas y el total no sería de ninguna moneda.)

### Venta en otra moneda: la tasa de cambio

Si los precios del catálogo están en una moneda y el método de pago en otra (catálogo en USD,
cobro en "Pago móvil" VES), aparece el recuadro **Tasa de cambio**:

```
1 USD = [ 40.000000 ] VES
```

- La tasa es **obligatoria** en ese caso: hasta 6 decimales y mayor que cero.
- Cada precio de catálogo se convierte con esa tasa (redondeo a 2 decimales) y los renglones se
  guardan **ya convertidos**. La vista previa muestra los precios convertidos, que son los que
  se van a guardar.
- La tasa y la moneda original quedan guardadas en la operación. **Releer la venta meses
  después da siempre el mismo número**, aunque la tasa de hoy sea otra.
- No hay consulta a ningún servicio externo ni tabla de tasas históricas.

**Tasa sugerida.** El campo llega precargado:

1. Con la tasa **fijada en Ajustes › Negocio** para ese par de monedas, si existe. Debajo dice
   "Es la que tienes fijada en Ajustes…".
2. Si no hay una fijada, con la **última tasa usada** en una venta de ese par (de operaciones
   no anuladas). Debajo dice "Es la que usaste el {fecha}. Cámbiala si hoy es otra."
3. Si nunca se usó, vacío.

La sugerencia solo se aplica cuando cambia el par de monedas; no pisa lo que la persona ya
escribió. Cambiarla en el formulario afecta solo a esa operación.

Las compras **no usan tasa**: el costo se escribe directamente en la moneda del pago.

### Compra de insumos

- Solo admite **productos** (no servicios). Para pagar un servicio se registra un gasto suelto;
  la base de datos también lo impide.
- Cada renglón pide **cuánto costó cada unidad** (campo "Costo"). Es obligatorio: el precio de
  venta del catálogo no se usa porque no es lo que costó reabastecer.
- El campo se precarga con **lo que se pagó la última vez** por ese producto (de compras no
  anuladas, por fecha de la operación). Si nunca se compró, queda vacío.

### Lo que pasa al guardar

En una sola transacción de base de datos (si algo falla, no queda nada a medias):

1. Se valida que el método de pago y la categoría existan, pertenezcan al catálogo correcto y no
   estén archivados.
2. Se copia la **moneda del método de pago** a la operación (snapshot: si mañana alguien cambia
   la moneda de ese método, esta operación no cambia).
3. En ventas y compras: se guardan los renglones con su **precio congelado** y se calcula el
   total en el servidor.
4. Por cada renglón de **producto** se crea un movimiento de stock: negativo en ventas (motivo
   `venta`), positivo en compras (motivo `compra`). Los servicios no tienen stock.
5. Se escribe un evento en la **auditoría**.

**Doble clic / red inestable.** Cada apertura del formulario genera un identificador único que
viaja con el envío. Si llega dos veces, el servidor reconoce que es la misma operación y
devuelve la que ya existe en lugar de duplicarla.

Tras guardar, el diálogo se cierra y se refrescan Ingresos, Gastos, Movimientos, Inventario e
Inicio.

## Corregir una operación

Menú ⋮ › **Corregir** (dueño y encargado). Abre el mismo formulario precargado.

Se puede cambiar: concepto, fecha, categoría, método de pago, monto (si es suelta), renglones y
cantidades, precio de compra y tasa de cambio.

**No se puede cambiar el tipo** (ingreso/gasto) **ni la clase** (suelta/venta/compra). Para eso
hay que anular y registrar otra; el formulario lo indica.

Reglas de precio al corregir una **venta**:

- Si la conversión no cambió (misma tasa, misma moneda de pago), los renglones que ya estaban
  **conservan su precio original**; un renglón nuevo toma el precio actual del catálogo.
  Corregir "eran 3, no 2" no revalúa la venta al precio de hoy.
- Si cambió la tasa, la moneda del pago o la de los precios, **todos los precios se recalculan
  desde el catálogo actual** con la nueva conversión (lo que también adopta cualquier cambio de
  precio de lista desde que se registró).

En una **compra**, el costo de cada renglón es editable y llega precargado con el registrado.

Una categoría o método de pago **archivado** se acepta si ya era el de esa operación (para poder
corregir, por ejemplo, la fecha de un registro antiguo).

**Inventario al corregir.** No se reescriben los movimientos originales. Se calcula la
**diferencia** de cantidad por producto y se agrega un movimiento de motivo `ajuste` con la nota
`Corrección de "<concepto>"`. El stock queda igual que si se hubiera registrado bien desde el
principio, y el historial muestra que hubo una corrección.

La auditoría guarda qué campos cambiaron (`desde → hasta`). No se puede corregir una operación
anulada.

**Los cobros de reservas no se corrigen desde aquí.** Aparecen como operaciones sueltas con el
concepto `Reserva <recurso> · <titular>`, pero la reserva guardó cuánto le abonó cada uno; si
aquí cambiara el monto, la transacción diría una cosa y el saldo de la reserva otra. El formulario
lo rechaza con "Este cobro pertenece a una reserva. Para corregirlo, anúlalo y vuelve a cobrar
desde la reserva.", y la base de datos impide cambiar su monto, moneda o tasa por cualquier otra
vía. Ver [Reservas](08-reservas.md#los-cobros-en-finanzas).

## Anular una operación

Menú ⋮ › **Anular** (solo dueño). Se ejecuta al momento, sin diálogo de confirmación.

- La operación **no se borra**: se marca como anulada y deja de aparecer y de contar en totales,
  reportes y sugerencias.
- Sus movimientos de stock originales se quedan y se agregan los **compensatorios** (motivo
  `anulacion`): una venta anulada devuelve las unidades, una compra anulada las retira.
- Se registra en la auditoría.
- No se puede anular dos veces.
- Si es el **cobro de una reserva**, además vuelve a subir el saldo de esa reserva. Es la forma de
  corregir un cobro equivocado o de registrar que se devolvió un anticipo.

## Monedas

- Lista **cerrada** de monedas ([`lib/currencies.ts`](../../lib/currencies.ts)):
  - Frecuentes: USD, VES, EUR
  - Stablecoins: USDT, USDC (separadas de USD a propósito: se liquidan distinto)
  - Otras: COP, BRL, PEN, CLP, ARS, MXN, GBP
- Un código fuera de la lista se rechaza: "usd" o "UDS" crearían en silencio una moneda nueva en
  los totales.
- Los montos se muestran con el formato de su moneda.
