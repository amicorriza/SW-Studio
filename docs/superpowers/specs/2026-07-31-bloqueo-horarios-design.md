# Scissor White — Bloqueo de horarios por hora (colación + bloqueos puntuales)

- **Fecha:** 2026-07-31
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Alcance:** panel admin (`public/index.html`, secciones Agenda y Horarios) + disponibilidad pública (`functions/availability.js`, `functions/index.js`). Es un addendum independiente a `docs/superpowers/specs/2026-07-30-agenda-lista-vista-design.md` — no lo modifica, solo agrega botones/estado nuevos a la Agenda que esa spec ya definió.

## Contexto (estado actual, verificado en el código)

- Cada barbero (`staff/{id}`) tiene `schedule[dow]` (0=Domingo..6=Sábado): `{open, start, end} | null` — **un solo rango continuo por día**, sin huecos. Se edita en la sección Horarios del admin (`renderSchedule()`, `public/index.html`).
- El widget público de reservas usa ese mismo `schedule` (recibido vía `refreshCatalog()`, expuesto en `BARBERS[].schedule`) para calcular la ventana de apertura del día (`hoursRangeFor(dow, barber)`, `public/index.html`) — es lectura pública ya hoy (`staff` permite `read: if true`).
- La disponibilidad **real** (qué horarios dentro de esa ventana ya están ocupados) se resuelve server-side: `getAvailability` (Cloud Function `onCall`, `functions/index.js`) llama a `computeAvailability({bookings, staff, barberId})` (`functions/availability.js`), que agrupa las reservas del día en `barberBusy: {barberId: [{start,end}]}`. El cliente (`isBarberFreeAt`/`isSlotAvailable`/`renderSlots`, `public/index.html`) solo compara los horarios candidatos contra `AVAIL.barberBusy` — nunca ve ni necesita el detalle de cada reserva (PII protegida por diseño, ver comentarios en `availability.js`).
- El admin, al crear/editar una cita (`checkBookingConflict()`, modal `#a-bkm`), valida conflictos contra otras reservas del mismo barbero (`checkConflict()`) y permite forzar el agendamiento marcando "Sobrecupo" (`over:true`) — mismo patrón que se reutiliza acá para el nuevo tipo de advertencia.
- No existe hoy ningún concepto de "no disponible dentro de un día abierto" — para bloquear una hora, la única opción actual es cerrar el día completo.

## Decisiones tomadas con el usuario

1. **Dos tipos de bloqueo:** colación **recurrente** (mismo horario cada semana, por día de la semana) + bloqueos **puntuales** por fecha específica (ej. un trámite). Un solo bloque de colación por día — no múltiples recesos recurrentes (fuera de alcance).
2. **Efecto en el admin:** al crear/editar una cita en un horario bloqueado (colación o puntual), se muestra una advertencia — igual patrón que "Sobrecupo" hoy (misma caja, mismo checkbox para forzar) — no se bloquea de forma dura.
3. **Efecto en el público:** ambos tipos de bloqueo (recurrente y puntual) le quitan esas horas al widget público de reservas — un cliente no puede reservar online en un horario bloqueado, sea colación o puntual.
4. **Dónde se gestionan:** la colación recurrente se edita en Horarios (junto al horario semanal de cada barbero, que es donde ya vive esa configuración). Los bloqueos puntuales se crean desde la Agenda (línea de tiempo del día), como un bloque más en el calendario — no en Horarios — porque el admin ya está mirando ese día cuando decide bloquearlo.
5. **Estilo visual del bloqueo en el calendario:** tarjeta de fondo sólido oscuro (mismo tono que otros elementos "de sistema" del admin), claramente distinta de una tarjeta de cita (blanca).
6. **No aparece en la vista de Lista** (`docs/superpowers/specs/2026-07-30-agenda-lista-vista-design.md`) — esa tabla es de reservas de clientes (columnas Cliente/Servicio/Precio no aplican a un bloqueo). El bloqueo solo se ve en la línea de tiempo del día.

## Diseño

### Principio de arquitectura

Desde la perspectiva del widget público, una reserva real, una colación recurrente y un bloqueo puntual son lo mismo: "este horario no se puede reservar". En vez de duplicar la lógica de solape en el cliente (como hoy hace `hoursRangeFor` con el horario abierto/cerrado), **se extiende `computeAvailability()` para que también incorpore la colación y los bloqueos puntuales dentro del mismo `barberBusy`** que ya arma a partir de las reservas. Así el código del widget público que decide qué horarios mostrar tachados (`isSlotAvailable`, `renderSlots`, `isBarberFreeAt`) **no cambia**: sigue comparando contra `AVAIL.barberBusy` tal cual ya hace hoy. Una sola fuente de verdad server-side, sin riesgo de que cliente y servidor se desincronicen.

### Modelo de datos

**Colación recurrente** — campo nuevo en `staff/{id}.schedule[dow]`:

```js
// antes: {open:true, start:'10:00', end:'20:00'}
// después (campo `break` opcional, solo si el barbero tiene colación ese día):
{open:true, start:'10:00', end:'20:00', break:{start:'13:00', end:'14:00'}}
```

`break` es `undefined`/ausente si el barbero no tiene colación configurada ese día. Sigue viviendo en el doc `staff/{id}`, público en lectura (`allow read: if true`, sin cambios en `firestore.rules` para esta parte).

**Bloqueos puntuales** — colección nueva `scheduleBlocks/{id}`:

```js
{ id, barberId, date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM', reason, createdAt }
```

`firestore.rules`: `match /scheduleBlocks/{id} { allow read, write: if isAdmin(); }` — mismo patrón que `patients`/`adminLog`. El público **nunca** lee esta colección directo; solo la ve reflejada (como rangos ocupados, sin `reason`) a través de `getAvailability`.

### Disponibilidad pública

- `computeAvailability({bookings, staff, barberId, dow, scheduleBlocks})` (`functions/availability.js`) gana dos parámetros: `dow` (día de semana, 0-6, de la fecha consultada) y `scheduleBlocks` (los bloqueos puntuales de esa fecha, ya filtrados por el llamador). Para cada barbero activo, además de agrupar sus reservas en `barberBusy[id]`, agrega:
  - el rango de `staff[id].schedule[dow].break` (si existe), y
  - el rango de cada `scheduleBlocks` con `barberId === id`.
- `getAvailability` (`functions/index.js`) pasa a consultar también `scheduleBlocks` filtrando por la `date` recibida (misma consulta a Firestore que ya hace para `bookings` de ese día) antes de llamar `computeAvailability`.
- `public/index.html`: **sin cambios** en `isBarberFreeAt`, `isSlotAvailable`, `renderSlots`, `hoursRangeFor` — siguen comparando contra `AVAIL.barberBusy` exactamente como hoy.

### Admin — Horarios (colación recurrente)

En `renderSchedule()`, cada fila de día "Abierto" gana un control adicional debajo del rango de apertura/cierre: un toggle "Colación" (mismo componente visual `.a-tog`/`.a-tt` que ya usa el toggle abierto/cerrado) que, al activarse, revela dos `<input type="time">` (inicio/fin de colación) — mismo patrón que los inputs de apertura/cierre ya existentes. Al desactivar el toggle, se borra el campo `break` del día (vuelve a `undefined`).

### Admin — Agenda (bloqueos puntuales)

- El admin carga **todos** los `scheduleBlocks` una vez al iniciar sesión (junto al resto de `loadFromCloud()`), en una variable en memoria — mismo espíritu que ya existen `D`/`BK`/`PT` para services/staff/bookings/patients. Tanto el render de la línea de tiempo como la verificación de advertencia del modal de citas (ver más abajo) leen de esa misma variable, sin pedir nada nuevo a Firestore por cada interacción.
- Botón "+ Bloquear horario" junto a "+ Nueva cita" (vista Día de la Agenda, `#a-bk-day-view`). Abre un modal nuevo y simple: barbero, fecha, hora inicio, hora fin, motivo (texto libre) — sin servicio/cliente/precio/notas.
- Guardado: CRUD directo por documento en `scheduleBlocks` (crear/editar/eliminar un doc individual, en `public/js/data.js` — mismo patrón que ya usan `getPatients`/`savePatients`/`deletePatient`) — **no** se reutiliza el patrón "leer array completo, reescribir batch con diff de borrados" que usan las reservas; es innecesario acá, son mutaciones simples y poco frecuentes sobre una colección propia.
- Render: en la línea de tiempo del día (`renderCalendar()`), se cargan los `scheduleBlocks` de la fecha/barbero visibles y se dibujan como tarjetas adicionales, con el mismo cálculo de posición (`top`/`height` por minuto) que ya usan las tarjetas de citas, pero con el estilo elegido (fondo sólido oscuro, ⏱ + motivo) y **sin** el listener que abre `openBookingModal` — en su lugar, clic abre un modal de "Editar bloqueo" (motivo/hora, o eliminar).

### Admin — advertencia al crear/editar una cita

`checkBookingConflict()` (modal `#a-bkm`) gana una segunda verificación, además de la ya existente contra otras reservas (`checkConflict`): si el horario candidato se solapa con la colación del barbero ese día de semana, o con alguno de sus `scheduleBlocks` de esa fecha, se muestra la misma caja de advertencia que ya existe para "Sobrecupo" — mismo checkbox (`over`) para forzar el guardado — con el mensaje ajustado para indicar si es colación o un bloqueo puntual (mostrando su motivo).

### Casos borde

- Un bloqueo puntual o la colación que se solapa con una reserva **ya existente** (creada antes de que existiera el bloqueo): no se valida retroactivamente ni se avisa al guardar el bloqueo/colación — solo se avisa hacia adelante, al crear/editar una cita nueva. Igual sigue apareciendo en el widget público como horario ocupado (por la reserva existente), no hay inconsistencia visible para el cliente.
- Dos bloqueos puntuales solapados entre sí para el mismo barbero: se permite sin advertencia (caso raro, responsabilidad del admin, no se sobre-construye validación para esto).
- Colación fuera del rango de apertura del día (ej. colación 13:00-14:00 pero el barbero cierra a las 12:00 ese día): el bloque de colación simplemente no tiene efecto, ya que `hoursRangeFor` ya excluye ese rango del todo. No se valida ni se advierte en la UI de Horarios — es responsabilidad del admin configurar horarios coherentes.

## Testing

- `functions/test/availability.test.js` (ya existe, `node:test`, mismo estilo que el resto de `functions/test/`): casos nuevos para `computeAvailability` — colación recurrente bloquea su rango; un `scheduleBlocks` de la fecha bloquea su rango; ambos coexisten y se combinan correctamente con `barberBusy` derivado de reservas reales (ninguno pisa al otro).
- Resto del feature (UI de Horarios, botón "+ Bloquear horario", advertencia en el modal de citas, efecto real en el widget público de reservas): verificación manual con un pase end-to-end real en el emulador de Firebase (mismo enfoque que se usó para la vista de Lista de la Agenda) antes de cerrar el feature — acá pesa más que en esa feature anterior porque este cambio sí toca el flujo de reserva público, no solo el admin.

## Fuera de alcance (explícitamente)

- Múltiples colaciones recurrentes por día (solo una).
- Bloqueos recurrentes que no sean "todo el año, mismo día de semana" (ej. "solo los martes de este mes") — la colación recurrente es simple: se aplica siempre que el día esté abierto.
- Validación retroactiva de reservas existentes contra nuevos bloqueos/colación.
- Mostrar los bloqueos puntuales en la vista de Lista de la Agenda.
- Notificar al cliente si se le asigna una cita que luego queda dentro de un bloqueo creado después (no aplica: los bloqueos no se validan retroactivamente, ver Casos borde).

## Trabajo futuro

- **Vista de agenda multi-barbero (columnas en paralelo).** Hoy `renderCalendar()` (`public/admin/index.html`) pinta una sola línea de tiempo por día, filtrable por barbero vía el dropdown "Todos los barberos" (`bkFilter`) — al elegir "todos", superpone las citas de todos los barberos en una misma columna repartiéndolas por solape (`cluster`/`cols`), no una columna fija por barbero. Valdría la pena ofrecer un modo alternativo dentro de la Agenda con **una columna fija por barbero activo**, mostrando en paralelo sus citas, colaciones y bloqueos del día — deja comparar carga entre barberos de un vistazo, sin filtrar de a uno.
  - Características a abstraer de una captura de referencia de un panel de barbería con este patrón (no es de este proyecto, es solo inspiración visual): encabezado con foto+nombre por columna; franja horaria común a la izquierda (misma escala que ya usa `renderCalendar()`, compartida entre columnas); tarjetas de evento con el mismo lenguaje visual que ya existe (blanca = cita, sólida oscura = bloqueo/colación) pero con **colores distintos según el tipo de evento** (servicio, asesoría, colación, reunión, bloqueo, otro) en vez de un único tono "de sistema"; leyenda de color fija al pie de la agenda explicando cada tipo; navegación de fecha (◀ hoy ▶); y un toggle para volver a la vista de un solo barbero ("Ir a agenda diaria").
  - También aparece en la referencia un bloqueo a nivel de todo el local (ej. "Reunión administrativa", sin barbero específico) — hoy `scheduleBlocks/{id}` siempre tiene `barberId`, así que un bloqueo "de todos" requeriría decidir si se modela como N documentos (uno por barbero) o un `barberId: null` que `computeAvailability`/la UI traten como "afecta a todos".
  - Implicaría además: extender el bloqueo con una categoría (`colación`/`reunión`/`bloqueo`/`otro`) más allá del `reason` de texto libre actual, para poder colorear por tipo en vez de un solo estilo "de sistema".
  - No se diseña ni se implementa acá — queda registrado como candidato a spec propio cuando se priorice.
