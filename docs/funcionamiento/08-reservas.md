# 8. Reservas

## Resumen

- Una **reserva** ocupa un **recurso** (una habitación, una cancha, una sala, un equipo) durante
  un **rango de tiempo**, por noches o por horas.
- Un servicio se vuelve reservable desde **Reservas › Recursos**. Hasta entonces se vende como
  siempre, como renglón de una venta.
- Cada servicio reservable es **exclusivo** (una reserva a la vez, como una habitación) o
  **compartido** (varias reservas a la vez hasta llenar los cupos, como una clase o un tour).
- **Dos reservas no pueden pisarse**: en los exclusivos, no se puede reservar algo ya ocupado; en
  los compartidos, no se puede pasar de la capacidad. Lo impide la base de datos, también
  cuando dos personas reservan al mismo tiempo.
- La reserva **no es una venta**. Los cobros se registran aparte, cuando entra el dinero, y la
  reserva lleva su **saldo**.

## Cómo se configura (`/reservas/recursos`)

Solo **dueño y encargado** (`resource:manage`). El personal puede reservar, pero no decide qué se
reserva ni con qué recursos.

Paso previo: el servicio tiene que existir en **Productos › Servicios** (nombre, precio,
categoría). La pantalla lista todos los servicios del negocio; si no hay ninguno, lleva a
Productos.

### Las tres decisiones de cada servicio

| Opción | Valores | Qué significa |
|---|---|---|
| **Unidad** | No se reserva · Por noche · Por hora | Si se reserva y en qué unidad se cobra el tiempo |
| **Modo** | Exclusivo · Compartido | Si una reserva ocupa el recurso entero o comparte cupos con otras |
| **Cobro** | Por reserva · Por persona | Si el precio es por la reserva entera o por cada persona |

El modo y el cobro solo aparecen cuando el servicio se reserva. Al activarlo, queda **exclusivo** y
**por reserva**.

### Recursos y capacidad

Cada servicio reservable tiene sus recursos: la 101, la 102, la Cancha 1… Se agregan con un
nombre y una **capacidad**, que significa cosas distintas según el modo:

| Modo | La capacidad es… | Ejemplo |
|---|---|---|
| Exclusivo | Cuántas personas caben en **una** reserva | Habitación 301, capacidad 3 → hasta 3 personas |
| Compartido | Cuántas personas caben **en total a la vez** | Sala de yoga, capacidad 15 → hasta 15 inscritos sumando todas las reservas |

La capacidad se pone por recurso, no por servicio: el servicio "Alquiler de sala" puede tener una
Sala A de 10 y una Sala B de 20.

Ejemplos de configuración:

| Negocio | Servicio | Unidad | Modo | Cobro | Recursos |
|---|---|---|---|---|---|
| Hotel | Habitación doble | Por noche | Exclusivo | Por reserva | 101, 102… (capacidad 2) |
| Canchas | Cancha de pádel | Por hora | Exclusivo | Por reserva | Cancha 1, Cancha 2 (capacidad 4) |
| Academia | Clase de yoga | Por hora | Compartido | Por persona | Sala (capacidad 15) |
| Hostal | Cama en dormitorio | Por noche | Compartido | Por persona | Dorm A (capacidad 8) |
| Estacionamiento | Puesto por hora | Por hora | Compartido | Por persona | Planta baja (capacidad 50) |

### Qué se puede cambiar y qué no

- **La unidad y el modo quedan fijos con la primera reserva** del servicio (de cualquier estado,
  incluidas las canceladas). Pasar de noche a hora dejaría reservas cuya cantidad ya no significa
  lo mismo, y mezclar exclusivas con compartidas en un mismo recurso dejaría un hueco que ninguna
  de las dos protecciones cubre. Si hace falta reservar de otra forma, se crea otro servicio. La
  pantalla lo explica debajo de los selectores.
- **El cobro se puede cambiar en cualquier momento.** Cada reserva guardó cómo se calculaba la
  suya, así que el cambio solo afecta a las nuevas.
- **La capacidad de un recurso** se edita en su fila (se guarda al salir del campo o con Enter).
  Subirla siempre se puede. **Bajarla, solo hasta lo ya comprometido** en reservas que no han
  terminado: si la clase del martes tiene 12 inscritos, no puede pasar a 10 cupos.
- **Nombres de recurso únicos** entre los activos del negocio, sin distinguir mayúsculas: "101" es
  una sola habitación aunque se venda como Doble o como Suite.

### Servicios "no disponibles para vender"

El interruptor **Disponible para vender** de la ficha del servicio (en Productos) también vale para
reservas, con un matiz:

- **Apagado, no acepta reservas nuevas.** No aparece en el formulario ni ofrece celdas libres en
  la cuadrícula. Si alguien lo intenta igual, se rechaza con "\"Suite\" no está disponible para
  vender. Actívalo en Productos para aceptar reservas."
- **Las reservas que ya tenía siguen su curso.** El servicio sigue en la cuadrícula mientras tenga
  reservas en esos 14 días, con la etiqueta "No disponible: no acepta reservas nuevas", y se les
  puede registrar la llegada, cobrar y registrar la salida. Si desapareciera, el huésped que llega
  mañana no tendría dónde registrarse.
- Sin reservas en la ventana, un servicio apagado no se muestra.
- En **Recursos** se sigue pudiendo configurar, con una nota que explica por qué no aparece en
  Disponibilidad.

Encenderlo de nuevo reabre las reservas.

### Archivar un recurso o un servicio

Archivar un recurso (icono de archivo en Recursos) o un servicio (en Productos) lo saca de la
disponibilidad sin borrar las reservas que tuvo. Archivar un recurso además libera su nombre para
uno nuevo.

**No se puede mientras tenga reservas pendientes**, porque desaparecerían de la cuadrícula y no
habría dónde registrar la llegada, cobrar ni dar la salida. Pendiente es:

- una reserva **en curso**, siempre, aunque su fecha de salida ya haya pasado (quien se quedó más
  de lo previsto sigue adentro hasta que se registre su salida);
- una reserva **reservada** que todavía no terminó.

No cuentan las canceladas, las no presentadas, las finalizadas, ni las reservadas cuya fecha ya
pasó sin que nadie registrara la llegada.

Para dejar de aceptar reservas nuevas **sin** esperar a que terminen las existentes, está
[Disponible para vender](#servicios-no-disponibles-para-vender).

## Disponibilidad (`/reservas`)

Todos los roles. Es la pantalla principal del módulo.

### La cuadrícula

- **Filas**: los recursos, agrupados por servicio. Cada grupo muestra el precio, la unidad, y si
  es por persona o con cupos. Un servicio reservable sin recursos aparece con un enlace para
  agregarlos.
- **Columnas**: **14 días** a partir de hoy. Hoy va resaltado.
- **Navegación**: Semana anterior · **Hoy** · Semana siguiente. La fecha de inicio vive en la URL
  (`?desde=AAAA-MM-DD`), así que el enlace se puede compartir.
- **"Hoy" es hoy en la zona horaria del negocio**, no en la del servidor.
- En el teléfono, la cuadrícula se desplaza de lado dentro de su tarjeta.

Cómo se ve cada reserva:

| Recurso | Se muestra | Al tocarlo |
|---|---|---|
| Exclusivo, por noche | Un bloque con el nombre del titular que abarca sus noches. `‹` o `›` si empieza antes o sigue después de la ventana | Detalle de la reserva |
| Exclusivo, por hora | Una ficha con la hora de inicio dentro del día | Detalle de la reserva |
| Compartido, por noche | La ocupación de cada noche, por ejemplo `5/8` | Lista de quiénes van esa noche |
| Compartido, por hora | Una ficha por turno con hora y ocupación, por ejemplo `18:00 · 7/15` | Lista de quiénes van en ese turno |

Colores en los **exclusivos** (cada bloque es una reserva):

| Color | Significa |
|---|---|
| Azul | Reservada (todavía no llegó) |
| Verde | En curso (ya hizo check-in) |
| Gris | Finalizada |

En los **compartidos** cada celda junta varias reservas, así que el color dice cuánto lugar
queda: **azul** si hay cupos, **rojo** si está lleno. El estado de cada reserva se ve en la lista
que se abre al tocarla.

En ambos, un **punto rojo** indica que hay saldo pendiente.

Las canceladas y las de quien no se presentó **no aparecen**: ya no ocupan nada.

Tocar una celda vacía (o el `+` de un día) abre **Nueva reserva** con ese recurso y esa fecha ya
puestos. En los días pasados no se ofrece.

### Nueva reserva

Botón **Nueva reserva** arriba, o tocando una celda libre.

| Campo | Notas |
|---|---|
| Qué se reserva | Los servicios reservables que tienen al menos un recurso |
| Habitación / Recurso | Cada opción dice cuánto le queda: "ocupado", "lleno", "hasta 3" o "4 de 15 cupos". Los que no tienen lugar para esas fechas aparecen deshabilitados |
| Entrada y Salida (por noche) | La noche del día de salida **no se cobra**: del 10 al 12 son 2 noches. Si se mueve la entrada más allá de la salida, la salida se corre sola |
| Fecha, Desde y Hasta (por hora) | En tramos de 30 minutos. El mismo día: no puede cruzar la medianoche |
| Personas / Cupos | Por defecto 1. No puede pasar de la capacidad (exclusivo) ni de lo que queda libre (compartido) |
| A nombre de | Obligatorio |
| Cédula o documento, Teléfono, Notas | Opcionales |

Debajo se ve el **total**: `2 noches × USD 40,00 = USD 80,00`, o
`1 hora × 3 personas × USD 10,00 = USD 30,00` si cobra por persona.

Al guardar:

- **El precio y la moneda quedan congelados**: si mañana sube la tarifa, esta reserva no cambia.
  También se guarda si era exclusiva o compartida y si cobraba por persona.
- Si otra persona tomó ese recurso un segundo antes, la reserva se rechaza con **"Ese recurso ya
  tiene una reserva que se cruza con esas fechas."** o **"No quedan cupos suficientes en ese
  horario."** La disponibilidad que muestra el formulario es orientativa; la base de datos tiene la
  última palabra.
- Por eso el doble clic no duplica: la segunda reserva choca con la primera.
- Se registra en la auditoría.

Reglas de tiempo:

- **Por noche**, la reserva va de la medianoche del día de entrada a la medianoche del de salida,
  en la zona horaria del negocio. Salir el 12 y entrar el 12 no choca.
- **Por hora**, los tramos que se tocan no chocan (de 18:00 a 19:00 y de 19:00 a 20:00 sí se
  pueden); los que se pisan, sí.
- Una reserva por noche no puede pasar de 365 noches.

### Recursos compartidos: cómo se cuentan los cupos

Lo que se controla es el **máximo de personas a la vez** dentro del rango, no la suma de todas las
reservas que lo tocan. Ejemplo en un dormitorio de 4 camas:

```
Noche del 10:  3 personas
Noche del 11:  otras 3 personas
Nueva reserva: 1 persona, noches del 10 y el 11  →  se acepta
```

Nunca hay más de 4 a la vez (3 + 1 cada noche), aunque sumar todo daría 7. Y al revés: una reserva
que empieza en un momento tranquilo pero atraviesa uno lleno se rechaza.

## El detalle de una reserva

Muestra el titular, el estado, el servicio y el recurso, y:

- **Fechas** y **Personas** (o Cupos).
- **Total**, con su cálculo: `2 noches × USD 40,00 = USD 80,00`.
- **Pagado** y **Saldo** (en rojo si debe algo, en verde si está saldada).
- **Cobros**: cada uno con fecha, método de pago y monto. Si se cobró en otra moneda, debajo se ve
  lo que abonó en la moneda de la reserva. Los cobros **anulados** aparecen tachados y no cuentan.
- Documento, teléfono (se puede tocar para llamar) y notas, si los hay.

### Estados y qué se puede hacer en cada uno

```
                     Registrar llegada              Registrar salida
   ┌───────────┐  (desde el día de llegada)  ┌──────────┐            ┌────────────┐
   │ Reservada │ ──────────────────────────► │ En curso │ ─────────► │ Finalizada │
   └───────────┘                             └──────────┘            └────────────┘
     │       │
     │       └─ No se presentó (desde el día de llegada) ──► No se presentó
     └─ Cancelar ─────────────────────────────────────────► Cancelada
```

| Acción | Cuándo | Qué hace |
|---|---|---|
| **Registrar llegada** (check-in) | Reservada, desde el día de llegada y antes de que termine | Pasa a *En curso* y guarda la hora real de llegada |
| **Registrar salida** (check-out) | En curso | Pasa a *Finalizada* y guarda la hora de salida. Si hay saldo, pide confirmarlo |
| **No se presentó** | Reservada, desde el día de llegada | Libera el recurso. **Lo cobrado se conserva** (para eso es un anticipo). Pide confirmación |
| **Cancelar** | Reservada | Libera el recurso. Se puede anotar un motivo. Pide confirmación |
| **Cobrar** | Reservada, En curso o Finalizada, si hay saldo | Ver abajo |

Permisos: registrar llegada, salida, no presentado y cancelar exigen `booking:manage` (los tres
roles). Cobrar exige `transaction:create`, porque registra un ingreso (también los tres roles).

Detalles:

- **Ninguna acción borra la reserva.** Cancelada y no presentada quedan guardadas, solo que dejan
  de ocupar el recurso y de verse en la cuadrícula.
- Antes del día de llegada no se puede registrar la llegada ni marcar que no vino: todavía no se
  sabe.
- Una reserva que ya terminó sin check-in no admite la llegada: se cobra lo pendiente o se marca
  como no presentada.
- **Salir con saldo** no pasa por descuido: el botón muestra cuánto queda y ofrece **Cobrar
  primero** o **Salir con saldo pendiente**. Esto último queda en la auditoría con el saldo y quién
  lo aceptó, y el saldo se puede cobrar después.
- **Cancelar una reserva con cobros** no devuelve el dinero: los cobros siguen siendo ingresos. Si
  se devuelve el anticipo, hay que anular el cobro en Finanzas. El diálogo de cancelación lo avisa.
- Los botones dependen de la fecha que ve el navegador; quien decide es el servidor. Cerca de la
  medianoche puede aparecer un botón que el servidor rechace con su motivo.

### Cobrar

Se puede cobrar todo o una parte, las veces que haga falta, hasta saldar.

| Campo | Notas |
|---|---|
| Cuánto abona | En la **moneda de la reserva**. Llega con el saldo completo; "Todo el saldo" lo vuelve a poner |
| Método de pago | Por defecto, uno en la moneda de la reserva |
| Categoría | De ingresos |
| Tasa de cambio | Solo si el método cobra en otra moneda. Llega precargada con la tasa fijada en Ajustes o la última usada, y dice cuál es. Muestra cuánto entra de verdad |

Ejemplo: reserva de 120 USD, se abonan 20 USD por pago móvil a 40 Bs por dólar. Entran
**800 Bs**, la reserva descuenta **20 USD** y el saldo queda en 100 USD.

Reglas:

- **No se puede cobrar más que el saldo.** Si el cliente dio de más, se cobra el saldo y el vuelto
  se maneja aparte.
- Una reserva **pagada completa** no admite más cobros.
- **El doble clic no cobra dos veces**, y **dos cobros simultáneos** a la misma reserva no pueden
  pasarse del saldo: el segundo espera al primero y vuelve a calcular.

## Los cobros en Finanzas

Cada cobro **es un ingreso normal**:

- Aparece en **Ingresos** y **Movimientos** como operación suelta, con el concepto
  `Reserva <recurso> · <titular>`, la **fecha del día en que entró el dinero** (en la zona del
  negocio) y la tasa si hubo conversión.
- Cuenta en los totales, el Inicio, los Reportes y el Historial como cualquier otro ingreso.
- **El check-out no genera ninguna venta.** Si la generara por el total, el anticipo se contaría
  dos veces.
- **No se puede corregir** desde Finanzas: el formulario lo rechaza con "Este cobro pertenece a una
  reserva. Para corregirlo, anúlalo y vuelve a cobrar desde la reserva." La base de datos también
  impide cambiar su monto, moneda o tasa.
- **Sí se puede anular** (dueño): deja de contar como ingreso **y** vuelve a subir el saldo de la
  reserva. Es la forma de corregir un cobro equivocado o registrar una devolución.

## Mensajes frecuentes

| Situación | Mensaje |
|---|---|
| El recurso ya está ocupado (exclusivo) | "Ese recurso ya tiene una reserva que se cruza con esas fechas." |
| No quedan cupos (compartido) | "No quedan cupos suficientes en ese horario." |
| Grupo más grande que el recurso | "\"301\" admite hasta 3 personas." / "\"Sala\" tiene 15 cupos en total." |
| Salida antes o igual que la entrada | "La salida tiene que ser al menos un día después de la entrada." |
| Tramo que no es de 30 minutos | "La duración tiene que ir en tramos de 30 minutos." |
| Tramo que cruza la medianoche | "La hora de fin tiene que ser después de la de inicio, el mismo día." |
| Llegada antes de tiempo | "La llegada es el 10/11/2026. Todavía no se puede hacer check-in." |
| Cobro mayor que el saldo | "El cobro pasa del saldo, que es 80.00 USD." |
| Cobro en otra moneda sin tasa | "La reserva es en USD y el pago en VES. Escribe la tasa que aplicaste." |
| Cambiar la forma de reservar con reservas | "\"Habitación doble\" ya tiene reservas. Para reservar de otra forma, crea otro servicio." |
| Bajar la capacidad por debajo de lo ocupado | "\"Sala\" ya tiene momentos con 12 cupos ocupados. No se puede bajar a 10." |
| Archivar un recurso con reservas pendientes | "\"101\" tiene reservas pendientes. Cancélalas o espera a que terminen." |
| Archivar un servicio con reservas pendientes | "\"Habitación doble\" tiene 2 reservas pendientes. Cancélalas o espera a que terminen antes de archivarlo. Para dejar de aceptar reservas nuevas, apaga \"Disponible para vender\"." |

## Lo que todavía no hace

Ver también [limitaciones](07-limitaciones-y-pendientes.md#reservas).

- **Horarios fijos** (en desarrollo): publicar los turnos de un servicio (yoga, martes y jueves a
  las 18:00) y que solo se pueda reservar en ellos. Hoy un servicio por hora acepta cualquier tramo
  de 30 minutos.
- **Modificar una reserva**: no se pueden cambiar las fechas, el recurso ni las personas de una
  reserva hecha. Hay que cancelarla y crear otra.
- **Salida anticipada**: si alguien reservó hasta el 14 y se va el 12, el recurso sigue ocupado
  hasta el 14 y el total no cambia.
- **Columnas personalizadas en la reserva** (por ejemplo, placa del vehículo o motivo del viaje).
- **"Una doble cualquiera"**: reservar el tipo de habitación y asignar el número al llegar.
- **Dos recursos en una reserva** (un masaje que necesita terapeuta y cabina).
- **Reservas recurrentes** (la cancha todos los martes).
