# Scissor White — Vista de Lista en Agenda (admin)

- **Fecha:** 2026-07-30
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Alcance:** solo el panel admin (`public/index.html`, sección Agenda / `adm-p-calendar`). No toca Firestore, Cloud Functions, ni el widget de reservas público.

## Contexto (estado actual, verificado en el código)

- La Agenda admin (`#adm-p-calendar`) hoy solo tiene una vista: línea de tiempo de **un día** (`renderCalendar()`, `public/index.html:4594`), con navegación ◀ ▶ / Hoy (`bkDate`) y un filtro de barbero (`bkFilter`), ambos variables JS en memoria (no persistidas).
- Las citas se leen con `getBookings()` (alias de `getBk()`, que devuelve la cache `BK` poblada por `subscribeBookings` en tiempo real) y se editan/eliminan a través de `openBookingModal(bk)` (`public/index.html:4749`), que ya maneja crear, editar, validar conflictos y eliminar (`saveBookings`/`setBk`, que persiste en Firestore vía `window.SWData.saveBookings`).
- El modelo de una reserva (`bk`) ya tiene todos los campos necesarios para la tabla: `code, name, phone, email, svcId, svcName, price, dur, barberId, barberName, date (ISO), time (HH:MM), notes, over (bool sobrecupo), createdAt`.
- Existe un patrón de tabla ya establecido en la sección Clientes (`renderPatients()`, `public/index.html:5400`): buscador de texto (`a-pat-search`), tabla `.a-t`/`.a-tw`, tags `.a-tag`, columna de acciones `.a-tacts` con botones `.a-btn-g` (ver) y `.a-btn-danger` (eliminar). La nueva vista de lista reutiliza este mismo lenguaje visual y de clases CSS.
- El tag de "Sobrecupo" ya existe como `.a-bk-card-over-tag` (fondo `var(--a-warn)`), usado en las tarjetas de la línea de tiempo cuando `bk.over === true`.

## Decisiones tomadas con el usuario

1. **Relación con la línea de tiempo:** conviven. Se agrega un interruptor "📅 Día / ☰ Lista" junto al botón "+ Nueva cita"; ninguna vista reemplaza a la otra.
2. **Alcance de datos de la Lista:** NO está atada a un solo día (a diferencia de la línea de tiempo). Es una tabla plana, sin agrupar, que muestra todas las **próximas** citas (fecha/hora ≥ ahora) ordenadas cronológicamente — de ahí que tenga sentido una columna "Día" por fila.
3. **Controles en modo Lista:** se oculta la barra de navegación de un solo día (◀ ▶ Hoy) y en su lugar aparece un buscador de texto por nombre de cliente + un filtro de barbero equivalente al que ya usa la línea de tiempo (mismas opciones y mismo estado compartido — ver detalle técnico en "Diseño").
4. **Columnas de la tabla (fijas, en este orden):** Día | Hora | Cliente | Servicio | Barbero | Precio | Acción.
5. **Orden interactivo:** clic en una cabecera ordenable fija esa columna como criterio de orden; un segundo clic en la misma cabecera invierte la dirección (asc/desc). "Acción" no es ordenable.
6. **Persistencia de estado:** solo en memoria de la sesión (mismo patrón que `bkDate`/`bkFilter` ya existentes) — no se usa `localStorage`. Cada vez que se entra al panel Agenda, la vista vuelve a "Día" y, si se cambia a "Lista", el orden por defecto es Día ascendente (cronológico).

## Diseño

### UI — estructura del panel `adm-p-calendar`

- **Header (`.a-sh`):** sin cambios en el título/subtítulo. El interruptor de vista se agrega a la derecha, junto al botón `#a-bk-new` ("+ Nueva cita"): dos botones tipo segmented-control, `#a-bk-view-day` ("📅 Día") y `#a-bk-view-list` ("☰ Lista"), con clase activa `a-on` (mismo patrón de estado activo que ya usa `.an-item.an-on` en el menú lateral).
- **Modo Día (por defecto, sin cambios):** se muestran `#a-bk-nav` (navegación de fecha + filtro de barbero) y `#a-bk-timeline`.
- **Modo Lista (nuevo):** se ocultan `#a-bk-nav` (y con él, el `select` de filtro `#a-bk-filter-barber` que vive dentro) y `#a-bk-timeline`. Se muestra un contenedor nuevo `#a-bk-list`:
  - Barra de controles: input de texto `#a-bk-list-search` (placeholder "🔍 Buscar por nombre de cliente...", mismo estilo que `#a-pat-search`) + un segundo `select`, `#a-bk-list-filter-barber`, con las mismas opciones que `#a-bk-filter-barber` (ambos se pueblan con el mismo código, extraído a una función `renderBarberFilterOptions(selectEl)` reutilizada por los dos). Los dos `select` (el de Día y el de Lista) escriben a la misma variable de sesión `bkFilter` y se sincronizan entre sí (cambiar uno actualiza el `.value` del otro) para que el filtro no se "pierda" al alternar de vista.
  - Tabla `.a-t` dentro de `.a-tw`, con `<thead>` de 7 columnas clicleables (excepto "Acción"), cada `<th>` con `data-sort="day|time|name|svc|barber|price"` y un indicador `▲`/`▼` que solo se muestra en la columna activa.
  - `<tbody id="a-bk-list-body">` renderizado por `renderBookingList()`.

### Datos y orden — `renderBookingList()`

- Fuente: `getBookings()`, igual que la línea de tiempo.
- Filtro: `date/time >= ahora` (usa el mismo `parseDt(dateStr, timeStr)` ya existente para construir el `Date` real de cada reserva); luego filtro por `bkFilter` (barbero) si está activo; luego filtro por texto de búsqueda contra `b.name` (case-insensitive, mismo criterio que `renderPatients()` usa para clientes).
- Orden: variables de sesión `bkListSortKey` (default `'day'`) y `bkListSortDir` (default `'asc'`). Comparadores por columna:
  - `day`: compara la fecha completa (`Date` de `bk.date`, sin la hora) — agrupa por jornada.
  - `time`: compara solo la hora del día (`bk.time`, string `"HH:MM"`) — permite ver, por ejemplo, todas las citas de las 10:00 juntas sin importar el día.
  - `name`, `svc` (`svcName`), `barber` (`barberName`): `localeCompare` en español.
  - `price`: numérico.
  - Criterio secundario estable en todos los casos: `Date` completo (fecha+hora) ascendente, para que citas empatadas en la columna elegida no cambien de orden entre renders.
- Clic en un `<th data-sort>`: si es la misma columna activa, invierte `bkListSortDir`; si es otra, la fija como activa con dirección `asc`. Vuelve a llamar `renderBookingList()`.

### Fila de la tabla

Por cada reserva: `Día` (`new Date(bk.date).toLocaleDateString('es-CL')`, mismo formato que ya usa `renderPatients()` para fechas) | `Hora` (`bk.time`) | `Cliente` (`bk.name`, con el tag `.a-bk-card-over-tag` ("Sobrecupo") al lado si `bk.over`) | `Servicio` (`bk.svcName`) | `Barbero` (`bk.barberName`) | `Precio` (`fmtCLP(bk.price)`) | `Acción` (botones `.a-btn-g` "✎" y `.a-btn-danger` "✕", mismo patrón visual que `renderPatients()`).

- Clic en la fila (fuera de los botones de acción, mismo guard `e.target.closest('.a-tacts')` que ya usa `renderPatients()`) o en "✎" → `openBookingModal(bk)` (el modal existente, sin ningún cambio).
- Clic en "✕" → mismo flujo ya implementado en el listener de `#a-bkm-del`: modal de confirmación (`openDel(...)`) y luego `saveBookings(bookings.filter(...))`.
- Como `renderBookingsViews()` ya se ejecuta en cada actualización en tiempo real de `BK` (suscripción Firestore), se le agrega la llamada a `renderBookingList()` junto a `renderCalendar()` para que la tabla se mantenga sincronizada sin lógica nueva de refresco.

### Casos borde

- Sin próximas citas (o filtro/búsqueda sin resultados): fila única `colspan="7"` con mensaje, mismo estilo que el vacío de Clientes — "Sin citas próximas." o "Sin resultados para tu búsqueda." según haya o no texto en el buscador.
- Cambiar de barbero o buscar mientras se está en modo Lista no resetea el orden elegido; cambiar de vista (Día↔Lista) tampoco resetea el filtro de barbero (comparten la misma variable `bkFilter`, ver arriba), pero sí resetea el orden de la Lista a Día-ascendente si se vuelve a entrar a modo Lista en una sesión nueva del panel (ver "Persistencia" arriba — dentro de la misma sesión el orden elegido se mantiene mientras no se cierre el panel admin).

## Testing

Prueba manual en navegador (no hay suite automatizada para el admin actualmente):

1. Crear 4-5 citas de prueba en distintos días/horas/barberos/precios (incluyendo una marcada "Sobrecupo").
2. Alternar Día → Lista → Día: verificar que la línea de tiempo sigue funcionando exactamente igual que antes.
3. En Lista: verificar que aparecen todas las próximas citas (no solo las de "hoy"), ordenadas por Día/Hora ascendente por defecto.
4. Clic en cada cabecera ordenable una vez (asc) y dos veces (desc): Día, Cliente, Servicio, Barbero, Precio — confirmar el orden y la flecha ▲/▼.
5. Filtrar por barbero y luego buscar por nombre de cliente: confirmar que ambos filtros se combinan (AND).
6. Clic en una fila → confirmar que abre el modal de edición con los datos correctos; guardar un cambio → confirmar que la fila se actualiza en la Lista sin recargar.
7. Eliminar una cita desde la Lista (botón ✕) → confirmar el modal de confirmación y que la reserva desaparece tanto de la Lista como de la línea de tiempo (misma fuente de datos `BK`).
8. Confirmar que una reserva con fecha/hora ya pasada NO aparece en la Lista.

## Fuera de alcance (explícitamente)

- Cambios al modelo de datos de `bookings` en Firestore, a `firestore.rules`, o a Cloud Functions — todo el trabajo es cliente-side sobre datos ya existentes.
- Paginación o límite de filas: se asume un volumen de "próximas citas" manejable para una barbería (decenas, no miles); si el volumen crece mucho a futuro, sería un spec aparte.
- Selección múltiple / acciones masivas (eliminar o mover varias citas a la vez).
- Exportar la Lista a Excel (sí existe para Clientes, pero no fue pedido aquí).
- Persistir la preferencia de vista/orden entre sesiones (`localStorage`) — ver decisión #6.
