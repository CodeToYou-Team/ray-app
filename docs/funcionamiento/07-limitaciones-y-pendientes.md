# 7. Limitaciones conocidas y trabajo en curso

Cosas detectadas al revisar el código para escribir estos documentos. No son decisiones de
diseño documentadas: son huecos entre lo que la app dice o pretende y lo que hace hoy. Están
ordenadas por impacto aproximado.

## Comportamiento que puede confundir o filtrar información

### El rol Personal ve todas las operaciones y sus totales

Existen los permisos `transaction:read_own` (personal) y `transaction:read_all` (dueño y
encargado), pero **ninguna consulta los aplica**. Hoy el personal ve en Ingresos, Gastos,
Movimientos e Inicio **todas** las operaciones del negocio, con sus totales por moneda, el
balance de Movimientos y las tarjetas "Este mes".

La pantalla de Equipo describe al rol Personal como "ve solo las suyas. No ve los totales", y
eso solo se cumple en Reportes e Historial.

- Dónde: `loadTransactionsPage` ([`lib/finanzas/page-data.ts`](../../lib/finanzas/page-data.ts)) y
  `loadDashboard` ([`lib/finanzas/dashboard.ts`](../../lib/finanzas/dashboard.ts)) no filtran por
  `created_by` ni ocultan totales según el rol.

### Fecha por defecto del formulario en UTC

El formulario de operaciones propone la fecha con `new Date().toISOString().slice(0, 10)`, que
es la fecha **UTC**. En Venezuela (UTC−4), a partir de las 20:00 propone el **día siguiente**. Si
nadie la corrige, la operación queda con fecha de mañana.

Relacionado: "este mes" en Inicio y los periodos de Reportes se calculan con el reloj del
servidor, no con la zona horaria del negocio (`tenants.timezone`, que existe pero hoy no se usa
para esto).

### Anular y archivar no piden confirmación

**Anular** una operación (menú ⋮) y **archivar** un producto o servicio se ejecutan al primer clic.
Ambas acciones son reversibles en la base de datos (archivar tiene "Restaurar"), pero **anular no
tiene botón para deshacer** desde la interfaz.

## Funciones a medio conectar

### Columnas de tipo "Catálogo" sin opciones en el formulario de productos

Se puede crear una columna personalizada de tipo **Catálogo**, pero el formulario de productos
no le pasa las opciones del catálogo: el selector aparece **vacío** y no se puede rellenar. En el
listado, si tuviera valor, se mostraría el identificador en vez del nombre.

- Dónde: [`components/productos/catalog-view.tsx`](../../components/productos/catalog-view.tsx)
  usa `<FieldInput>` y `formatFieldValue` sin `catalogOptions` / `catalogLabels`.

### Ocultar columnas fijas sin efecto en Productos

En Ajustes › Columnas se pueden renombrar, ocultar o sacar del listado las columnas del sistema
(Nombre, SKU, Precio…). El **nombre** ya se ve en la tabla y el formulario de Productos y
Servicios, pero **ocultar y sacar del listado no tienen efecto ahí**: esas columnas siguen
escritas a mano. Ocultar Categoría o Precio, además, no es inocuo: son obligatorias para crear
un producto. En Reservas sí funcionan las tres cosas.

### Cabecera con elementos decorativos

El campo **Buscar…** y la campana con el contador **3** de la cabecera no hacen nada: no hay
búsqueda global ni notificaciones.

### Lógica sin pantalla

Estas funciones existen en el servidor pero ninguna pantalla las usa:

- Reordenar elementos de un catálogo y columnas personalizadas (`reorderCatalog`,
  `reorderFields`). Los elementos nuevos se agregan al final.
- Historial de movimientos de stock de un producto (`listMovements`), que es la respuesta a "¿por
  qué dice 14 si hay 12?".
- Consulta de la auditoría (`audit_log` se escribe, pero no se lee en ningún sitio).

## Textos desactualizados

Tras añadir la conversión de moneda en ventas, quedaron mensajes que ya no son ciertos:

| Dónde | Texto | Lo que pasa ahora |
|---|---|---|
| Diálogo de producto/servicio | "Solo se puede vender en una operación cobrada en esa misma moneda: los montos no se convierten." | Se puede vender en otra moneda indicando la tasa |
| Formulario de venta sin método de pago | "…solo se pueden agregar productos con precio en esa misma moneda." | Se puede agregar cualquiera; se pide tasa si difiere |
| Venta sin ítems disponibles | "No hay productos ni servicios con precio en {moneda}…" | El filtro no es por la moneda del pago |
| Menú del usuario | "Rol: owner" | Muestra el código interno, no "Dueño" |
| Equipo › rol Personal | "Registra operaciones y ve solo las suyas. No ve los totales." | Ver primer punto |

## Reglas de negocio no implementadas

- **Se puede vender sin stock**: una venta con más unidades de las disponibles se registra y el
  stock queda negativo.
- **Un usuario, un negocio**: no se puede pertenecer a varios negocios a la vez.
- **Sin "entrar como" un negocio**: el admin de la plataforma gestiona negocios y equipos, pero
  no puede ver las pantallas de un negocio como lo vería su dueño (impersonación para soporte).
- **La pantalla de login no enlaza al registro**: se llega con el enlace que da el dueño.
- **No hay recuperación de contraseña** desde la app.

## Reservas

El módulo está descrito en [Reservas](08-reservas.md). Lo que hoy no hace o hace a medias:

### Salida anticipada con algo ya cobrado de más

Si alguien reservó hasta el 14 y se va el 12, se puede **modificar** la reserva para que salga el
12: las noches que no usó quedan libres. Pero si ya había pagado las cuatro noches, el total no
puede quedar por debajo de lo cobrado, y hay que **anular un cobro a mano** en Finanzas y volver a
cobrar lo que corresponda. No hay devolución automática.

### Cambiar de servicio una reserva

Modificar permite cambiar recurso, fechas, personas y titular, pero no el servicio (de Doble a
Suite). Para eso se cancela y se crea otra; lo cobrado en la primera habría que anularlo y volver a
cobrarlo en la nueva.

### Otras limitaciones

- **Fechas pasadas**: la cuadrícula no ofrece reservar en días pasados, pero el formulario deja
  escribir una fecha pasada y la reserva se acepta.
- **Modificar desde el listado** muestra como "ocupado" solo lo que está en la página visible: la
  disponibilidad que ofrece el formulario es orientativa. Si el recurso ya está tomado, la base de
  datos lo rechaza igual al guardar.
- **Por hora**, la reserva no puede cruzar la medianoche y va en tramos de 30 minutos.
- **Compartidos por hora**: la cuadrícula agrupa por turno exacto (mismo inicio y fin). Dos
  reservas que se solapan con horas distintas aparecen como fichas separadas, aunque el control de
  cupos sí las cuenta juntas.
- **Cancelar no devuelve dinero**: los cobros de una reserva cancelada siguen siendo ingresos
  hasta que se anulen en Finanzas.
- No hay "una doble cualquiera" (asignar la habitación al llegar), reservas con dos recursos ni
  reservas recurrentes.

- **Horarios fijos solo por servicio**: todos los recursos de un servicio comparten turnos. Una
  sala que abre otros días que la otra necesita ir en un servicio aparte.
- **Reservas fuera del horario en compartidos**: una reserva hecha antes de publicar los turnos, a
  una hora que se pisa con un turno pero no coincide con él, cuenta para los cupos de ese turno
  (la base suma bien) pero en la cuadrícula aparece en una ficha aparte, no dentro del turno.

- **Columnas personalizadas iguales para todos los servicios**: la placa del vehículo aparece
  también en las reservas del hotel. No hay columnas por servicio.

El plan completo está en la sección "Reservas" de
[`../plan_arquitectura_v2.md`](../plan_arquitectura_v2.md).
