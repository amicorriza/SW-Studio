# Scissor White — Medición de la atención real (estados, PWA del barbero y notificaciones)

- **Fecha:** 2026-09-06
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Etapa:** B/C — confirmado con el usuario el 2026-09-01 ([[scissor_white_stage_b_c_transition]]).
  De la lista PROHIBIDO del CLAUDE.md siguen vigentes: no migrar a framework, no reescribir los
  HTML monolíticos (sustituir funciones, no reestructurar), no tocar el módulo de reseñas de
  Google, no cambiar el diseño visual, no desplegar a producción.
- **Origen:** `Reporte_KPI_Scissor_White.pdf` (Micorriza). Este spec implementa su **Fase 1 —
  Medición**. El usuario además pidió explícitamente el módulo móvil que produce ese dato.
- **Rama:** `feature/medicion-atencion-real`, creada desde `feature/dashboard-metricas-negocio`
  con `feature/recordatorio-citas` ya fusionada (merge limpio, 210/210 tests en verde).
  `main` no se tocó; el PR #1 sigue abierto y se fusiona por su propio camino.
- **Es el primero de tres.** P2 (dashboard KPI simple + detalle) y P3 (motor de recomendaciones
  semanales) tienen su propio spec y dependen de que este exista primero.

## Por qué este proyecto va antes que el dashboard

De los 10 KPI que pide el PDF, **seis son imposibles con los datos actuales**: asistencia real,
no-show, tiempo real por servicio, desviación de tiempo, ingreso por hora real y ocupación
efectiva. Los seis salen del mismo dato que nadie captura: qué pasó realmente con la cita.

El Dashboard actual ya lo declara en su propia nota al pie
(`public/admin/index.html:1961`): *"Realizado asume que toda cita pasada ocurrió — aún no se
registra asistencia"*. El spec del dashboard
(`2026-09-02-dashboard-metricas-negocio-design.md:159-163`) nombró este trabajo como el
proyecto siguiente. Construir el panel antes que la medición produce celdas vacías.

## Contexto (estado actual, verificado en la rama)

- **Estados**: `functions/shared/status.js:13` tiene `BOOKING_STATUSES = ['pending',
  'confirmed', 'declined']` tras el merge de recordatorios. `'confirmed'`/`'declined'` son la
  respuesta del cliente al email de recordatorio — **no** hay ningún registro de lo que hizo el
  profesional.
- **Disponibilidad**: `functions/shared/availability.js:107` filtra con
  `.filter(b => b.status !== 'declined')`. El admin replica el criterio en
  `checkConflict()` (`public/admin/index.html:2119`: `if(b.status === 'declined') continue;`).
  Son dos listas negras de un solo elemento que van a divergir en cuanto haya más estados.
- **Cancelar destruye el registro**: `deleteBookingAnd()` (`public/admin/index.html:2052`) →
  `delBk()` (2023) → `SWData.deleteBooking()` (`public/js/data.js:94`) → `deleteDoc`. Dos
  puntos de llamada: la lista (2326) y el modal de la cita (2810). Una cita cancelada
  desaparece sin rastro, así que hoy la tasa de cancelación no es medible y las cancelaciones
  no se distinguen de los no-show.
- **No existe relación Auth↔staff**. El doc de `staff` tiene `id` (slug: `victoria`,
  `esteban`, `ariel`), `name`, `role`, `days`, `bio`, `status`, `photo`, `schedule`. **No hay
  `uid`, ni `email`, ni ningún campo de cuenta.** `bookings.barberId` referencia el slug.
- **`firestore.rules` es admin-o-nada** en las nueve colecciones. `isAdmin()` (línea 10) es
  custom claim `admin:true` **o** un UID literal. No existe ningún predicado por-usuario, ni
  una colección `users/{uid}`.
- **El gate de sesión del admin es puro DOM**: `login()` (1620-1633) muestra/oculta divs.
  `SWAuth.onChange` (`public/js/auth.js:12`) está **definido y nunca consumido** — grep en todo
  `public/` da solo su definición. Para una app instalada, que arranca en frío todo el tiempo,
  eso no sirve.
- **No hay nada de PWA**: ningún manifest, service worker, `getMessaging()` ni ícono 192/512 en
  el repo. Solo `<meta name="theme-color">` en el landing.
- **`firebase-admin@14` ya trae `firebase-admin/messaging`** — enviar push no agrega
  dependencias. `firebase.json` no tiene `rewrites` ni `targets`; `public/<dir>/index.html` se
  sirve solo, igual que `/admin`.
- **Precedente de función programada**: `refreshGoogleReviews` (`functions/index.js:403-422`),
  `onSchedule` con `timeZone: 'America/Santiago'` y un `catch` que **no relanza** (para no
  gastar reintentos). Es el molde exacto.
- **Precedente de opción configurable**: `bufferMin` — default en código
  (`resolveBufferMin()`, `functions/shared/timezone.js:30`), input en el panel Info
  (`ai-bufferMin`, línea 1182), carga en 3590-3591, guardado en 3599.
- **Trampa verificada**: el admin escribe reservas **sin `tz`** y con
  `date: 'YYYY-MM-DDTHH:mm:00.000Z'` (hora de pared mal etiquetada como Z),
  `public/admin/index.html:2758`. Además no pasa por `isValidBookingPayload()`. Todo cálculo de
  instante debe ser `zonedInstant(dateKeyOf(b.date), b.time, b.tz || resolveBusinessTz(info))`,
  nunca `new Date(b.date)`.

## Decisiones tomadas con el usuario

1. **Entrega secuencial**: P1 medición → P2 dashboard → P3 recomendaciones, con revisión entre
   cada una.
2. **Acceso del barbero**: email + contraseña de Firebase Auth. Aldo crea el usuario en la
   consola; un campo `uid` en el doc de `staff` lo vincula.
3. **Avisos**: push real vía FCM + función programada, para que lleguen con el teléfono
   bloqueado.
4. **Cancelar archiva** (`status: 'cancelled'`), ya no borra.
5. **`feature/recordatorio-citas` se fusiona primero** — hecho.
6. **Aviso "se acerca la hora": 10 minutos antes, configurable** desde el panel Info.

## Modelo de datos

### Máquina de estados

```
pending → confirmed | declined          (recordatorio: ya existe)
pending | confirmed → arrived → in_service → completed
pending | confirmed → in_service        (atajo: iniciar sin marcar Llegó; setea arrivedAt = startedAt)
pending | confirmed | arrived → no_show
pending | confirmed | arrived → cancelled
```

`BOOKING_STATUSES` pasa a `['pending','confirmed','declined','arrived','in_service',
'completed','no_show','cancelled']`.

El atajo `pending|confirmed → in_service` no es un capricho: el flujo que pidió el usuario va
directo de la notificación *"¿Deseas comenzar la atención?"* a iniciar. Obligar a marcar Llegó
primero agregaría un toque que el PDF pide evitar (§3: *"debe requerir la menor cantidad
posible de interacción"*).

**"Revisar" del PDF no es un estado, es derivado**: `in_service` cuyo fin planificado ya pasó
con holgura, o `completed` con `actualDur` anómala. Se calcula al pintar. Así una atención
cerrada tarde sigue siendo `completed` y no ensucia el ciclo, que es justo lo que el PDF pide
al exigir que la corrección quede marcada como tal.

### `BLOCKING_STATUSES` — un solo criterio de "ocupa el horario"

```js
const BLOCKING_STATUSES = ['pending','confirmed','arrived','in_service','completed'];
```

Reemplaza las dos listas negras de un elemento que hay hoy. `computeAvailability`
(`functions/shared/availability.js:107`) y `checkConflict()`
(`public/admin/index.html:2119`) pasan a preguntar por pertenencia a esta lista. `declined`,
`no_show` y `cancelled` liberan el horario. Una reserva **sin `status`** (documentos viejos)
cuenta como bloqueante — el default seguro es ocupar, no liberar.

### Campos nuevos en `bookings/{id}`

| Campo | Tipo | Notas |
|---|---|---|
| `arrivedAt`, `noShowAt`, `startedAt`, `endedAt`, `cancelledAt` | ISO string | **Siempre hora del servidor.** El reloj del móvil del barbero no es fuente de verdad. |
| `actualDur` | number (min) | `endedAt − startedAt`, redondeado. Se calcula al cerrar. |
| `durSource` | `'timer'` \| `'manual'` | `'manual'` si se cerró corrigiendo la hora. P2 puede excluir los manuales de la mediana. |
| `attendanceBy` | string | `staffId` o `'admin'`. |
| `attendanceAudit` | array de `{at, field, from, to, by, reason}` | Toda corrección conserva el original (PDF §3). |
| `nudgeUpcomingAt`, `nudgeStartAt`, `nudgeEndAt` | ISO string | Dedupe de push. |
| `nudgeEndCount` | number | Tope de posposiciones. |
| `snoozeUntil` | ISO string | "Recuérdame en 10 min". |

**Nada de esto entra en `buildBookingDoc()`.** Se escribe después de creada la reserva; las
reservas viejas simplemente no lo tienen y toda lectura debe tolerar su ausencia.

### Campos nuevos fuera de `bookings`

- `staff/{id}.uid` y `staff/{id}.authEmail` — vínculo con Firebase Auth, escritos por
  `linkStaffAccount`.
- `businessInfo/main.nudgeLeadMin` — default 10, mismo patrón que `bufferMin`.
- `businessInfo/main.nudgesEnabled` — interruptor de seguridad, default apagado (campo
  ausente). Mismo patrón que `remindersEnabled`: desplegar deja el Cloud Scheduler instalado
  pero en no-op, y los avisos recién empiezan cuando alguien lo activa a mano tras verificar en
  staging. Deploy ≠ activación.
- `staffDevices/{uid}` — `{ tokens: [...], updatedAt }`. Colección nueva.

## Arquitectura

### `functions/shared/attendance.js` (módulo nuevo, puro)

Sin `firebase-admin`, sin I/O, `now` siempre inyectado — mismo molde que
`functions/shared/availability.js` y `functions/reminders.js`.

- `canTransition(from, action)` → `boolean`.
- `applyAction(booking, action, now, opts)` → el parche de campos a escribir, o `null` si la
  acción ya está aplicada (idempotencia). `action ∈ 'arrive'|'no_show'|'start'|'end'|
  'snooze'|'cancel'`.
- `computeNudges(bookings, now, cfg)` → `[{bookingId, kind, barberId, title, body, data}]`,
  `kind ∈ 'upcoming'|'start'|'end'`:
  - **upcoming** — instante de la cita en `[now, now + leadMin]`, status `pending|confirmed`,
    sin `nudgeUpcomingAt`. Texto: *"Se acerca la hora de atención con {nombre} a las {hh:mm}"*.
  - **start** — instante de la cita ya pasó, sin `startedAt`, sin `noShowAt`, sin
    `nudgeStartAt`. Texto: *"¿Deseas comenzar la atención para {nombre}?"*.
  - **end** — `startedAt + dur` ya pasó, o `snoozeUntil` ya venció; sin `endedAt`;
    `nudgeEndCount < MAX_END_NUDGES` (6, o sea una hora de insistencia); y han pasado al menos
    10 minutos desde `nudgeEndAt`. Ese último piso no es cosmético: sin él el aviso saldría en
    cada corrida del scheduler —una vibración cada 2 minutos— mientras el barbero no responda,
    y el tope no lo protegería, porque solo se alcanza si él pospone explícitamente. El
    contador lo incrementa el scheduler al enviar, nunca `applyAction('snooze')`: con dos
    fuentes, cada ciclo gastaría dos del tope. Texto: *"¿Deseas finalizar la atención?"*.

**"Por revisar" no genera push.** Es una sección visible en la PWA y en la Agenda del admin
(atenciones `in_service` cuyo fin planificado pasó hace más de 30 min). Mandar además una
notificación diaria sería insistir sobre algo que ya está a la vista en las dos pantallas donde
se trabaja.
- `resolveNudgeLeadMin(businessInfo)` → calcado de `resolveBufferMin()`, default 10.

Toda reserva se aísla en su propio `try`: un `date` malformado no puede tumbar el lote. Esa
falla ya ocurrió de verdad en el trabajo de recordatorios
([[scissor_white_recordatorio_citas]], bug #1).

### Funciones nuevas en `functions/index.js` (todas `southamerica-east1`)

| Función | Tipo | Contrato |
|---|---|---|
| `getMyDay` | `onCall` | `{date?}` → `{staffId, name, bookings:[...]}`. Resuelve `staff where uid == request.auth.uid` con Admin SDK. Devuelve solo los campos que la PWA pinta. |
| `markAttendance` | `onCall` | `{bookingId, action, at?, reason?}`. Verifica pertenencia (el admin puede cualquiera), valida con `canTransition`, escribe con hora del servidor. Idempotente: `{ok:true, already:true, status}`. |
| `linkStaffAccount` | `onCall` (admin) | `{staffId, email}` → `getUserByEmail` → escribe `uid` + `authEmail`. Reusa `assertAdmin` (`functions/index.js:29`). |
| `staffAttendanceNudges` | `onSchedule` | Cada 2 min. Molde: `refreshGoogleReviews`. |

### Índice compuesto nuevo

`getMyDay` combina una igualdad (`barberId`) con un rango (`date`), y Firestore exige que el
campo de igualdad vaya **primero** en el índice compuesto. El que ya existe,
`bookings(date, barberId)`, **no** sirve para esa consulta: se agrega `bookings(barberId, date)`
a `firestore.indexes.json`. Se declara acá y no se descubre al desplegar — es el mismo tropiezo
que el proyecto ya tuvo con `scheduleBlocks`. Mientras el índice se construye, la app del
barbero devuelve error al cargar la agenda.

`staffAttendanceNudges`, en cambio, consulta solo por rango de `date` — campo simple, sin índice
compuesto —, filtra con `computeNudges`, arma el mapa uid→staffId leyendo
`staff` con Admin SDK (nunca confía en lo que escribió el cliente), envía con
`sendEachForMulticast()` y escribe los marcadores de dedupe. Un fallo por reserva se aísla; un
fallo de la corrida se loguea y **no se relanza**. Los tokens que Firebase reporta como
inválidos se purgan de `staffDevices/{uid}`.

**Por qué todo va por callable y no por reglas.** `firestore.rules` es admin-o-nada y no tiene
ningún predicado por-usuario. Un rol de barbero exigiría custom claims replicados a mano (el
UID de admin ya vive duplicado en cuatro archivos) más validación campo a campo en CEL — donde
este repo ya se quemó ([[scissor_white_admin_no_puede_crear_citas]]: una clave ausente en las
reglas produce un *evaluation error*, no un `false`). Por callable, `firestore.rules` cambia en
un solo bloque.

### `firestore.rules` — único cambio

```
match /staffDevices/{uid} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

Cubierto por `tests/rules` (vitest + emulador, ya montado).

### PWA `public/barbero/`

Vanilla, sin bundler ni framework, mismo estilo que `admin/`:

- **`index.html`** — CSS y JS inline. Login (email + contraseña), agenda del día en tarjetas,
  sección "Por revisar". Botones por estado:

  | Estado | Botones |
  |---|---|
  | `pending` / `confirmed` | **LLEGÓ** · **NO LLEGÓ** · *Iniciar* |
  | `arrived` | **INICIAR ATENCIÓN** · *No llegó* |
  | `in_service` | **FINALIZAR ATENCIÓN** + tiempo transcurrido |
  | `completed` | resumen: inicio, fin, real vs. plan · *Corregir* |
  | `no_show` / `cancelled` / `declined` | atenuado, con opción de deshacer |

  El timer va visible pero discreto (PDF §3: *"sirve para registrar, no para presionar al
  profesional"*).
  **Consume `SWAuth.onChange` de verdad** — hoy definido y nunca usado. Una app instalada
  arranca en frío y no puede exigir login en cada apertura.
- **`manifest.webmanifest`** — `display: 'standalone'`, `scope: '/barbero/'`,
  `start_url: '/barbero/'`, iconos 192 y 512 más variante `maskable`. **Hay que generarlos**
  desde `public/assets/logo.png`; hoy solo existen `apple-touch-icon.png` y favicons de 16/32.
- **`sw.js`** — scope `/barbero/`. `importScripts` de `firebase-app-compat.js` +
  `firebase-messaging-compat.js` del CDN de gstatic, versión 10.13.0 (la misma que el resto del
  sitio). Precachea solo el shell; los datos siempre van a la red — una agenda cacheada es una
  agenda equivocada. Maneja `notificationclick`.
- El token se pide con `getToken(messaging, { vapidKey, serviceWorkerRegistration })`, así el
  service worker vive en `/barbero/sw.js` y no hay que plantar un `firebase-messaging-sw.js` en
  la raíz del sitio. La **VAPID key es pública** (consola → Cloud Messaging → Web Push
  certificates): va junto a la config de `firebase-init.js`, no necesita Secret Manager ni
  tocar `functions/.env`.

**Las acciones nunca se ejecutan desde el service worker.** Tocar la notificación —o una de sus
acciones en Android— abre la PWA en `/barbero/?b=<id>&a=<accion>`; la app, ya autenticada,
llama a `markAttendance` y muestra el resultado. Es la única forma que funciona igual en los dos
sistemas: **Safari no soporta acciones en notificaciones**, y en iPhone el push exige iOS 16.4+
**y** que el barbero haya usado "Agregar a pantalla de inicio". Eso es un requisito del
dispositivo, no un bug a arreglar, y se verifica en un teléfono real antes de dar el módulo por
bueno.

`firebase.json` suma headers `no-cache` para `/barbero/sw.js` (un service worker cacheado es un
service worker congelado) y para el manifest, que hoy no cae en ninguna de las tres reglas
existentes.

### Admin: respaldo, cancelación y configuración

- **Agenda**: badges de los estados nuevos (mismo sistema visual que
  `.a-bk-card-status-tag.declined`, línea 544) y los mismos cuatro botones contra
  `markAttendance` — el admin puede marcar cualquier cita. Cubre "el barbero no tenía el
  teléfono" y las correcciones con motivo.
- **Sección "Por revisar"** con las atenciones sin cerrar.
- **Cancelar deja de borrar**: `deleteBookingAnd()` (2052) se sustituye por
  `cancelBookingAnd()`, que escribe `status:'cancelled'` + `cancelledAt` con el mismo patrón
  honesto de `saveBookingAnd()` (2044: reporta el error real en vez de mostrar éxito a ciegas).
  Los dos puntos de llamada (2326 y 2810) y el texto del diálogo cambian: *"¿Cancelar esta
  cita? Se libera el horario y queda registrada como cancelada."* `delBk()` (2023) y
  `SWData.deleteBooking()` quedan sin uso; se documentan, no se eliminan.
- **Panel Info**: input `ai-nudgeLeadMin` junto a `ai-bufferMin`, con la misma mecánica de
  carga (3590) y guardado (3599).
- **Panel Personal**: botón "Vincular cuenta" por barbero → `linkStaffAccount`, más el
  indicador de si ya tiene cuenta.

### `public/js/metrics.js` — cambio mínimo

`mFilterPeriod` suma **solo `'cancelled'`** a las exclusiones junto a `'declined'`, en las
cuatro funciones que hoy filtran por estado (144, 265, 296, 333).

`'no_show'` **no se excluye**, a propósito: una cita a la que el cliente no llegó sigue siendo
una reserva, y es el numerador del KPI de no-show que este proyecto existe para habilitar.
Excluirla acá lo volvería incalculable en P2.

El efecto secundario es que un no-show suma su `price` al ingreso del período, igual que hoy.
Eso ya pasa —hoy toda cita pasada se asume atendida— así que no empeora nada, pero deja de ser
aceptable en cuanto haya datos: **P2 separa "reservas del período" de "ingresos del período"**,
que hoy son el mismo filtro. Es la corrección natural del pie de nota de la línea 1961, y va
junto con `mAttendanceCoverage()`. Acá no se toca, para no cambiar los números del dashboard en
un proyecto que no es el del dashboard.

## Testing

**Unitarias** — `functions/test/attendance.test.js` (el módulo vive en `functions/shared/`, así
que su suite va con las de Functions), `node:test` plano con fechas fijas, estilo de
`functions/test/reminders.test.js`: la máquina de estados completa (transiciones válidas, inválidas, idempotencia, el atajo
`confirmed → in_service`); `computeNudges` en el borde inicial y final de cada ventana, con
posposición, al llegar al tope, con `tz` ausente (el caso real del admin), con `date`
malformado (no debe propagar); `BLOCKING_STATUSES` con reserva sin `status`;
`resolveNudgeLeadMin` sin `businessInfo`, sin el campo, y con valor.
`functions/test/availability.test.js` suma los casos de `no_show` y `cancelled` liberando el
horario, y `completed` sin liberarlo.
`tests/unit/metrics.test.js` suma el caso de `'cancelled'` excluido y el de `'no_show'`
**incluido** — con un comentario que explique por qué, para que nadie lo "arregle" después.

**Reglas** — `npm run test:rules`: un barbero escribe su propio `staffDevices/{uid}`; no puede
escribir ni leer el de otro; un anónimo no puede ninguno.

**Emulador, extremo a extremo** — sembrar una cita a 8 minutos, correr
`staffAttendanceNudges` a mano, verificar el push, tocar la notificación, confirmar que
`markAttendance` escribe `startedAt` con hora del servidor, dejar correr la duración, posponer
una vez, finalizar, y verificar `actualDur` + `durSource:'timer'`. Repetir marcando No llegó y
verificar que `getAvailability` vuelve a ofrecer el horario. Dejar una atención sin cerrar y
verificar que aparece en "Por revisar" y que el scheduler deja de insistir al llegar al tope.
Cancelar desde el admin y verificar que el documento sigue existiendo con `status:'cancelled'`.

**Navegador** — `tests/browser/barbero.mjs`, mismo patrón que `tests/browser/dashboard.mjs`
(servidor estático local, `SWAuth`/`SWData` stubbeados con `addInitScript`, gstatic y
googleapis abortados). Playwright ya está en devDependencies.

**Dispositivo real** — instalar la PWA en un Android y un iPhone; verificar que el push llega
con la pantalla bloqueada y que el enlace profundo abre la cita correcta.

## Riesgos

- **Lista de deploy manual**: `README.md:168-175` enumera las funciones a mano y CLAUDE.md
  documenta que `createBooking` se cayó de esa lista y se congeló en silencio. Este spec suma
  cuatro nombres; actualizar el comando es parte de la tarea, no un paso posterior.
- **`functions/.env` rompe el deploy de funciones** (`README.md:154-166`): sacarlo del
  directorio antes de desplegar y devolverlo después.
- **Push en iPhone** sin iOS 16.4+ ni "Agregar a pantalla de inicio": no llega nada.
- **Costo del scheduler**: cada 2 min = 720 corridas/día, con una consulta que trae solo las
  citas de ayer y hoy. Queda dentro de la cuota gratuita, pero conviene medirlo la primera
  semana.
- **Adopción**: si el barbero no marca, los KPI de P2 quedan vacíos y el dashboard empeora en
  vez de mejorar. Por eso P2 incluye `mAttendanceCoverage()` — para que eso se vea en el panel
  en vez de pasar en silencio.
- **Reloj del móvil**: nunca se usa. Todas las marcas de tiempo son del servidor.
- **Nada se despliega a producción**: va a staging, y despliega Aldo.

## Fuera de alcance

- Los KPI nuevos y las dos vistas del dashboard — eso es P2.
- El motor de recomendaciones semanales — eso es P3.
- Cambiar precio o duración automáticamente a partir de lo medido (PDF §9: prohibido
  explícitamente).
- Notificar al cliente cualquier cosa de este flujo.
- WhatsApp como canal.
- Cerrar la brecha de que el admin no pasa por `isValidBookingPayload()` — sigue siendo trabajo
  aparte.
- Quitar el UID de admin hardcodeado de los cuatro archivos ([[scissor_white_admin_uid_fallback_fase3]]).
