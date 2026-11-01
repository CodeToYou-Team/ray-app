# 1. Acceso, cuentas y roles

## Resumen

- Registrarse **no da acceso a nada** por sí solo. El acceso lo concede el dueño de un negocio
  apuntando el correo de la persona en una invitación.
- Cada usuario pertenece hoy a **un solo negocio**, y el negocio se deduce de la sesión (no
  aparece en la URL).
- Hay tres roles: **Dueño**, **Encargado** y **Personal**.

## Pantallas públicas

### Entrar (`/login`)

Formulario de correo y contraseña. Si la persona ya tiene sesión y negocio, se la manda
directo a `/dashboard`.

- Si las credenciales fallan, el mensaje es siempre **"Correo o contraseña incorrectos."**, sin
  distinguir si el correo existe. Es deliberado: distinguirlo permitiría averiguar qué correos
  están registrados.
- Al entrar bien, va a `/dashboard`.
- La pantalla no tiene enlace a `/registro`: a esa página se llega con el enlace que comparte el
  dueño al invitar (ver más abajo).

### Crear cuenta (`/registro`)

Pide **nombre**, **correo** y **contraseña** (mínimo 8 caracteres). El texto de ayuda insiste en
usar exactamente el correo con el que invitaron a la persona.

Según cómo esté configurado Supabase:

- **Con confirmación de correo** (lo normal): aparece "Revisa tu correo". La persona confirma y
  luego entra por `/login`.
- **Sin confirmación**: entra directamente.

Mensajes de error traducidos:

| Situación | Mensaje |
|---|---|
| Límite de correos de Supabase | "Demasiados intentos de registro seguidos. Espera unos minutos…" |
| Correo ya registrado | "Ya existe una cuenta con ese correo. Entra en vez de registrarte." |
| Cualquier otro | "No se pudo crear la cuenta." |

### Cuenta sin acceso (`/sin-acceso`)

Es donde termina quien tiene cuenta pero **ningún negocio le ha dado acceso**. En vez de
rebotarlo al login (que parecería un fallo), la pantalla explica que falta una invitación y
**muestra el correo con el que entró**, que es el dato que necesita quien lo va a invitar.
Tiene un botón **Salir**.

## Cómo entra una persona nueva (flujo de invitación)

```
Dueño                                   Persona invitada
─────                                   ────────────────
Ajustes › Equipo › "Invitar"
  correo + rol  ──► invitación pendiente
Copia el enlace a /registro  ─────────► Abre el enlace, se registra
                                        con ESE MISMO correo
                                        (confirma el correo si hace falta)
                                        Entra
                                          │
                     la app busca una invitación pendiente para su correo
                                          │
                                ┌─────────┴─────────┐
                              la hay             no la hay
                                │                    │
                    se crea su membresía       /sin-acceso
                    con el rol de la
                    invitación → /dashboard
```

Detalles:

- La invitación se canjea **la primera vez que la app resuelve el negocio del usuario**, sea
  cual sea la pantalla por la que entre (no solo por `/login`).
- El correo se compara en minúsculas.
- Si hubiera varias invitaciones pendientes para el mismo correo (de negocios distintos), gana
  la más antigua.
- Al canjearla, la invitación queda marcada como aceptada (no se borra) y se registra en la
  auditoría.
- No se envían correos propios: el único correo es el de confirmación que ya manda Supabase.
  Por eso el dueño tiene que pasarle el enlace a la persona por su cuenta.

## Sesión

- La sesión la gestiona Supabase Auth con cookies.
- En cada petición, `proxy.ts` (el antiguo *middleware* de Next) **solo refresca la sesión**:
  rota el token si está por vencer. No decide permisos.
- Si alguien sin sesión abre una pantalla interna, va a `/login`. Si tiene sesión pero no
  negocio, va a `/sin-acceso`.
- **Cerrar sesión** está en el menú del usuario, abajo en la barra lateral.

## Roles y permisos

Los permisos están definidos en código ([`lib/authz/roles.ts`](../../lib/authz/roles.ts)), no
en tablas.

### Qué puede hacer cada rol

| Permiso | Qué habilita | Dueño | Encargado | Personal |
|---|---|:-:|:-:|:-:|
| `transaction:create` | Registrar ingresos y gastos | ✔ | ✔ | ✔ |
| `transaction:update` | Corregir una operación registrada | ✔ | ✔ | — |
| `transaction:delete` | Anular una operación | ✔ | — | — |
| `product:read` | Ver productos y servicios | ✔ | ✔ | ✔ |
| `product:manage` | Crear, editar y archivar productos y servicios | ✔ | ✔ | — |
| `stock:read` | Ver el inventario | ✔ | ✔ | ✔ |
| `stock:adjust` | Ajustar inventario a mano (conteo, merma) | ✔ | ✔ | — |
| `catalog:read` | Ver catálogos | ✔ | ✔ | ✔ |
| `catalog:manage` | Crear, renombrar y archivar categorías y métodos de pago | ✔ | ✔ | — |
| `report:read` | Ver Reportes e Historial | ✔ | ✔ | — |
| `field:manage` | Configurar columnas de productos y servicios | ✔ | — | — |
| `member:manage` | Invitar, cambiar roles y quitar personas | ✔ | — | — |
| `tenant:manage` | Moneda por defecto y tasas de cambio | ✔ | — | — |

Además existen `transaction:read_all` (dueño y encargado) y `transaction:read_own` (personal),
pero **hoy no se aplican**: ver [limitaciones](07-limitaciones-y-pendientes.md#el-rol-personal-ve-todas-las-operaciones-y-sus-totales).

En la pantalla de Equipo los roles se describen así:

- **Dueño**: todo, incluidos los reportes de ingresos y la gestión del equipo.
- **Encargado**: opera el negocio y ve los reportes, pero no administra el equipo.
- **Personal**: registra operaciones. (La descripción de la UI dice "ve solo las suyas" y "no ve
  los totales"; hoy eso solo es cierto para Reportes e Historial.)

### Dónde se comprueban

1. **Menú lateral.** Se ocultan los enlaces a pantallas que el rol no puede abrir. Un grupo
   (por ejemplo Ajustes) solo desaparece si ninguna de sus secciones es accesible. Es
   comodidad, no seguridad.
2. **Páginas protegidas.** Reportes, Historial, Negocio, Columnas y Equipo comprueban el permiso
   al cargarse. Si falta, muestran una tarjeta **"No tienes acceso"** con una explicación del
   motivo y un botón para volver al inicio.
3. **Botones.** Corregir, Anular, Nuevo producto, Ajustar inventario, editar catálogos… solo se
   pintan si el rol tiene el permiso.
4. **Server Actions.** Cada escritura empieza con `requireCapability(...)`. Aunque alguien
   invoque la acción directamente, sin el permiso falla. Esta es la comprobación que de verdad
   protege.
5. **Base de datos (RLS).** Independientemente del rol, ninguna consulta puede ver datos de otro
   negocio. Ver [arquitectura](06-arquitectura-tecnica.md#aislamiento-entre-clientes).

### Reglas sobre el equipo

- Nadie puede **cambiar su propio rol** ni **quitarse a sí mismo**.
- Siempre tiene que quedar **al menos un dueño**: no se puede bajar de rol ni quitar al último.
- Quitar a alguien le retira el acceso, pero **sus operaciones registradas se quedan**.

## Menú lateral

Orden de las secciones (filtrado según el rol):

- **Inicio**
- **Finanzas** → Ingresos · Gastos · Movimientos · Reportes · Historial
- **Productos**
- **Inventario** → Stock · Alertas
- *(abajo)* **Ajustes** → Negocio · Catálogos · Columnas · Equipo
- *(abajo del todo)* Usuario: nombre y correo; su menú tiene **Modo claro/oscuro**, el rol y
  **Cerrar sesión**

El título y la descripción que aparecen en la cabecera salen del mismo registro de rutas
([`lib/nav.ts`](../../lib/nav.ts)). En desarrollo, una ruta no registrada genera un aviso en la
consola.

La cabecera también tiene el selector de **tema claro/oscuro**.
