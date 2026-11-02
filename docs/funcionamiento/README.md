# Funcionamiento actual de Ray App

> Estado descrito: rama `testing`, commit `b740023` (1 de noviembre de 2026), que incluye el
> módulo de reservas hasta la capacidad y el cobro por persona.
> Estos documentos describen **lo que la aplicación hace hoy**, leído del código.
> El plan a futuro vive en [`../plan_arquitectura_v2.md`](../plan_arquitectura_v2.md) y la
> puesta en marcha de la base de datos en [`../setup.md`](../setup.md).

## Qué es

Ray App es una aplicación web para pequeños negocios que necesitan llevar **ingresos, gastos,
catálogo de productos y servicios, inventario y reservas** (habitaciones, canchas, clases,
equipos), cobrando en varias monedas a la vez (dólares, bolívares, euros, USDT, USDC…).

Es **multi-cliente** (multi-tenant): varios negocios comparten la misma instalación y cada uno
solo ve sus propios datos. Cada usuario pertenece a un negocio y tiene un rol (dueño, encargado
o personal) que decide qué puede ver y hacer.

## Documentos

| # | Documento | De qué trata |
|---|---|---|
| 1 | [Acceso, cuentas y roles](01-acceso-y-roles.md) | Registro, inicio de sesión, invitaciones, roles y permisos, menú lateral |
| 2 | [Finanzas: ingresos, gastos y movimientos](02-finanzas.md) | Registrar operaciones, ventas y compras, monedas y tasa de cambio, corregir y anular |
| 3 | [Productos, servicios e inventario](03-productos-e-inventario.md) | Catálogo, stock calculado por movimientos, ajustes y alertas |
| 4 | [Inicio, reportes e historial](04-inicio-reportes-historial.md) | Panel de inicio, reportes con gráficos, historial mes a mes |
| 5 | [Ajustes](05-ajustes.md) | Negocio (moneda y tasas), catálogos, columnas personalizadas, equipo |
| 6 | [Arquitectura técnica](06-arquitectura-tecnica.md) | Stack, capas, aislamiento entre clientes, modelo de datos, dinero, auditoría |
| 7 | [Limitaciones conocidas y trabajo en curso](07-limitaciones-y-pendientes.md) | Huecos detectados al revisar el código y lo que está en desarrollo |
| 8 | [Reservas](08-reservas.md) | Servicios reservables, recursos y capacidad, disponibilidad, check-in/check-out y cobros |

## Mapa de pantallas

Todas las pantallas internas comparten el mismo marco: menú lateral a la izquierda, cabecera
con el título de la sección arriba y el contenido en el centro.

| Ruta | Pantalla | Quién la ve |
|---|---|---|
| `/login` | Entrar | Público |
| `/registro` | Crear cuenta | Público |
| `/sin-acceso` | Cuenta creada sin invitación | Usuario autenticado sin negocio |
| `/dashboard` | Inicio | Todos los roles |
| `/finanzas` | Redirige a `/finanzas/ingresos` | — |
| `/finanzas/ingresos` | Ingresos | Todos los roles |
| `/finanzas/gastos` | Gastos | Todos los roles |
| `/finanzas/movimientos` | Movimientos (ingresos + gastos, con balance) | Todos los roles |
| `/finanzas/reportes` | Reportes | Dueño y encargado |
| `/finanzas/historial` | Historial mes a mes | Dueño y encargado |
| `/productos` | Productos y servicios | Todos los roles (editar: dueño y encargado) |
| `/inventario` | Stock | Todos los roles |
| `/inventario/alertas` | Alertas de inventario | Todos los roles |
| `/reservas` | Disponibilidad: cuadrícula de recursos × días | Todos los roles |
| `/reservas/listado` | Listado de reservas: búsqueda, filtros y lo que se debe | Todos los roles |
| `/reservas/recursos` | Qué servicios se reservan, cómo y con qué recursos | Dueño y encargado |
| `/ajustes` | Redirige a la primera sección permitida | — |
| `/ajustes/negocio` | Moneda por defecto y tasas de cambio | Solo dueño |
| `/ajustes/catalogos` | Categorías y métodos de pago | Todos (editar: dueño y encargado) |
| `/ajustes/columnas` | Columnas de productos y servicios | Solo dueño |
| `/ajustes/usuarios` | Equipo e invitaciones | Solo dueño |

La raíz `/` redirige a `/dashboard`.

## Ideas que atraviesan toda la aplicación

Estas reglas explican la mayor parte de los comportamientos que pueden sorprender a primera
vista. Se detallan en cada documento.

1. **Los totales nunca se suman entre monedas.** No existe un "total general": cada pantalla
   muestra una tarjeta o fila por moneda. Restar gastos en bolívares de ingresos en dólares no
   da ningún número con significado.
2. **La moneda la define el método de pago.** "Zelle" es USD, "Pago móvil" es VES. Cada
   operación copia la moneda de su método de pago en el momento de registrarse.
3. **Lo registrado no cambia solo.** El precio de cada renglón de una venta, la moneda y la tasa
   de cambio se guardan con la operación. Cambiar después un precio, una tasa o un método de
   pago no altera lo que ya se registró.
4. **Nada se borra de verdad.** Las operaciones se anulan; los productos, categorías, columnas
   y recursos se archivan; las reservas se cancelan. El historial siempre se puede reconstruir.
   (La única excepción son las tasas vigentes de Ajustes, que no tienen historia que guardar.)
5. **El stock no es un número guardado.** Es la suma de todas las entradas y salidas
   registradas. Para corregirlo se agrega un movimiento, nunca se sobrescribe.
6. **Cada acción comprueba el permiso en el servidor.** Ocultar un botón en la interfaz es solo
   comodidad; el servidor vuelve a verificar el rol en cada escritura.

## Glosario

| Término | Significado |
|---|---|
| Cliente / negocio / tenant | Una empresa que usa la app. Sus datos están aislados de los demás. |
| Operación suelta | Ingreso o gasto con monto escrito a mano. No toca el inventario. |
| Venta | Ingreso con renglones de productos o servicios. Descuenta inventario. |
| Compra de insumos | Gasto con renglones de productos. Suma inventario. |
| Renglón | Una línea de una venta o compra: qué, cuántos y a qué precio. |
| Anular | Marcar una operación como inválida. Sigue en la base, pero deja de contar. |
| Corregir | Editar una operación ya registrada (concepto, fecha, montos, renglones…). |
| Archivar | Ocultar algo de los selectores nuevos sin borrarlo del historial. |
| Movimiento de stock | Una entrada (+) o salida (−) de unidades de un producto, con su motivo. |
| Tasa sugerida | El número con que llega precargado el campo de tasa al registrar una venta o cobrar una reserva. |
| Recurso | Lo que se reserva: una habitación, una cancha, una sala, un equipo. |
| Reserva | Un recurso ocupado durante un rango de noches u horas, a nombre de alguien. |
| Exclusivo | Servicio cuyos recursos admiten una reserva a la vez (una habitación). |
| Compartido | Servicio cuyos recursos admiten varias reservas a la vez hasta llenar la capacidad (una clase). |
| Capacidad | En un exclusivo, personas por reserva; en un compartido, personas en total a la vez. |
| Cobro de reserva | Un ingreso ligado a una reserva. Baja su saldo. |
| Check-in / check-out | Registrar la llegada y la salida de una reserva. |
| Turno | Un horario fijo publicado de un servicio por hora: "martes de 18:00 a 19:00". |
