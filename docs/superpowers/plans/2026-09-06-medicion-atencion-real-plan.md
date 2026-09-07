# Medición de la atención real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capturar lo que realmente ocurre con cada cita — Llegó / No llegó / Iniciar / Finalizar — mediante una PWA instalable para el barbero con notificaciones push, para habilitar los seis KPI del PDF que hoy son imposibles.

**Architecture:** Una máquina de estados pura (`functions/shared/attendance.js`, sin I/O, testeable con `node --test`) decide qué transición es válida y qué notificación corresponde. `functions/index.js` hace todo el I/O: cuatro funciones nuevas (`getMyDay`, `markAttendance`, `linkStaffAccount` como `onCall`, y `staffAttendanceNudges` como `onSchedule` cada 2 min). La PWA (`public/barbero/`) es HTML/CSS/JS plano sin bundler, autenticada con Firebase Auth, y **nunca escribe a Firestore directamente** — todo pasa por callables con Admin SDK, igual que el resto del código público. El admin gana los mismos botones como respaldo y deja de borrar al cancelar.

**Tech Stack:** Firebase (Hosting, Firestore, Auth, Functions Node 22 en `southamerica-east1`, Cloud Messaging), `firebase-admin@14` (ya trae `firebase-admin/messaging`), SDK web 10.13.0 desde el CDN de gstatic, `node:test` para tests, Playwright para el test de navegador. Sin bundler, sin framework, sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-09-06-medicion-atencion-real-design.md`

## Global Constraints

- **Sin frameworks y sin bundler.** Nada de React/Vue. Los HTML son monolíticos con CSS y JS inline: **sustituir funciones, no reestructurar archivos**.
- **Sin dependencias nuevas** ni en `package.json` raíz ni en `functions/package.json`.
- **SDK web: exactamente `https://www.gstatic.com/firebasejs/10.13.0/`** — la misma versión que ya usa todo el sitio.
- **Región de toda función: `southamerica-east1`.**
- **Todas las marcas de tiempo de asistencia son del servidor** (`new Date().toISOString()` dentro de la Cloud Function). El reloj del móvil del barbero nunca es fuente de verdad.
- **La zona horaria del negocio gobierna**, nunca la del navegador. Todo instante se calcula con `zonedInstant(dateKeyOf(b.date), b.time, b.tz || resolveBusinessTz(info))`. Nunca `new Date(b.date)`.
- **Toda reserva se aísla en su propio `try`** al iterar lotes: el admin no pasa por `isValidBookingPayload()`, así que un `date` malformado es un caso real (ya tumbó un lote antes).
- **Interruptor de seguridad**: `staffAttendanceNudges` no envía nada salvo que `businessInfo.nudgesEnabled === true`. Deploy ≠ activación. Copia el patrón de `sendBookingReminders` (`functions/index.js`).
- **Sin cambios de diseño visual.** Reusar tokens, clases y estilo del admin.
- **Comentarios y textos de UI en español**, tuteo, igual que el resto del repo.
- **Antes de cualquier `firebase deploy --only functions:...`**: sacar `functions/.env` del directorio (`README.md:154-166`), o el deploy falla con *"Secret environment variable overlaps non secret environment variable"*.
- **La lista de deploy de `README.md` es manual.** Toda función nueva se agrega ahí o se congela en silencio (ya pasó con `createBooking`).
- **Nada se despliega a producción.** Staging, y despliega Aldo.

## Prerrequisitos (los hace Aldo en la consola de Firebase, antes de la Task 7)

Ninguno bloquea las Tasks 1-6; sí bloquean la prueba real del push.

1. **Cloud Messaging → Web Push certificates → Generate key pair.** Copiar la clave pública
   (empieza con `B…`, ~87 caracteres) y pegarla en `VAPID_KEY` en `public/barbero/index.html`.
   Es **pública por diseño**, igual que el resto de `firebaseConfig`: no habilita nada por sí
   sola, no va a Secret Manager y no toca `functions/.env`.
2. **Authentication → Users → Add user**, uno por barbero (correo + contraseña). Solo crear la
   cuenta; el vínculo con la ficha de staff lo hace el botón "Vincular cuenta" del panel
   Personal (Task 8).
3. Confirmar que el proyecto está en plan Blaze — `onSchedule` necesita Cloud Scheduler. Ya lo
   está: `refreshGoogleReviews` y `sendBookingReminders` corren hoy.

---

### Task 1: Estados de cita y un solo criterio de "ocupa el horario"

Hoy hay dos listas negras de un elemento (`b.status !== 'declined'`) que van a divergir en cuanto existan más estados. Esta tarea las reemplaza por una lista blanca compartida.

**Files:**
- Modify: `functions/shared/status.js`
- Modify: `functions/shared/availability.js:104-108`
- Modify: `public/admin/index.html:2119`
- Test: `functions/test/status.test.js`, `functions/test/availability.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `BOOKING_STATUSES: string[]`, `DEFAULT_BOOKING_STATUS: 'pending'`, `isValidBookingStatus(status: string): boolean`, `BLOCKING_STATUSES: string[]`, `isBlockingStatus(status?: string): boolean` desde `functions/shared/status.js`.

- [ ] **Step 1: Escribir los tests que fallan**

En `functions/test/status.test.js`, agregar al final:

```js
test('BOOKING_STATUSES cubre el ciclo completo de la atención real', () => {
  for (const s of ['pending', 'confirmed', 'declined', 'arrived', 'in_service', 'completed', 'no_show', 'cancelled']) {
    assert.ok(isValidBookingStatus(s), `${s} debería ser válido`);
  }
  assert.ok(!isValidBookingStatus('atendida'));
  assert.ok(!isValidBookingStatus(''));
});

test('isBlockingStatus: pending/confirmed/arrived/in_service/completed ocupan el horario', () => {
  for (const s of ['pending', 'confirmed', 'arrived', 'in_service', 'completed']) {
    assert.ok(isBlockingStatus(s), `${s} debería ocupar el horario`);
  }
});

test('isBlockingStatus: declined/no_show/cancelled liberan el horario', () => {
  for (const s of ['declined', 'no_show', 'cancelled']) {
    assert.ok(!isBlockingStatus(s), `${s} debería liberar el horario`);
  }
});

// El default seguro es OCUPAR, no liberar: una reserva vieja sin `status` es
// una cita real que nadie debe pisar. Liberarla produciría doble reserva.
test('isBlockingStatus: una reserva sin status ocupa el horario', () => {
  assert.ok(isBlockingStatus(undefined));
  assert.ok(isBlockingStatus(null));
  assert.ok(isBlockingStatus(''));
});
```

Agregar `BLOCKING_STATUSES, isBlockingStatus` al `require` que ya encabeza ese archivo.

En `functions/test/availability.test.js`, agregar:

```js
test('computeAvailability: no_show y cancelled liberan el horario, completed no', () => {
  const staff = [{ id: 'v', status: 'active', schedule: SCHEDULE_LUNES_A_SABADO }];
  const mk = (status, time) => ({ barberId: 'v', date: '2026-09-07', time, dur: 30, status });
  const { barberBusy } = computeAvailability({
    bookings: [mk('no_show', '10:00'), mk('cancelled', '11:00'), mk('completed', '12:00')],
    staff, barberId: 'v', dow: 1, scheduleBlocks: [],
  });
  const starts = (barberBusy.v || []).filter(r => r.kind === 'booking').map(r => r.start);
  assert.deepStrictEqual(starts, ['12:00']);
});
```

Reusar la constante de schedule que ya exista en ese archivo; si se llama distinto, usar el nombre real.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd functions && node --test test/status.test.js test/availability.test.js`
Expected: FAIL — `isBlockingStatus is not a function`.

- [ ] **Step 3: Implementar**

Reemplazar el cuerpo de `functions/shared/status.js` (conservando el comentario de cabecera y ampliándolo):

```js
// Ciclo completo desde 2026-09 (medición de la atención real, Fase 1 del
// reporte de KPI): a los estados del recordatorio se suman los que marca el
// profesional. Ver functions/shared/attendance.js para las transiciones.
const BOOKING_STATUSES = [
  'pending', 'confirmed', 'declined',
  'arrived', 'in_service', 'completed', 'no_show', 'cancelled',
];
const DEFAULT_BOOKING_STATUS = 'pending';

// Único criterio de "esta reserva ocupa el horario", compartido por
// computeAvailability() y por checkConflict() del admin. Es una lista BLANCA
// a propósito: con lista negra, cada estado nuevo que alguien olvide agregar
// libera silenciosamente un horario ocupado (doble reserva). Con lista
// blanca, el olvido produce el error seguro -- un horario que se ve ocupado.
const BLOCKING_STATUSES = ['pending', 'confirmed', 'arrived', 'in_service', 'completed'];

function isValidBookingStatus(status) {
  return BOOKING_STATUSES.indexOf(status) !== -1;
}

// Una reserva sin `status` (documentos anteriores a Fase 2) ocupa el horario.
function isBlockingStatus(status) {
  if (!status) return true;
  return BLOCKING_STATUSES.indexOf(status) !== -1;
}

module.exports = {
  BOOKING_STATUSES, DEFAULT_BOOKING_STATUS, isValidBookingStatus,
  BLOCKING_STATUSES, isBlockingStatus,
};
```

En `functions/shared/availability.js`, agregar arriba `const { isBlockingStatus } = require('./status.js');` y reemplazar el filtro de las líneas 104-108:

```js
  // Un solo criterio de "ocupa el horario" (shared/status.js). declined,
  // no_show y cancelled liberan el slot; el resto lo ocupa.
  relevant
    .filter(b => isBlockingStatus(b.status))
    .forEach(b => addBusy(b.barberId, b.time, addMinutesToTime(b.time, b.dur || 0), 'booking'));
```

En `public/admin/index.html`, reemplazar la línea 2119 (`if(b.status === 'declined') continue;`) por:

```js
    // Copia deliberada de BLOCKING_STATUSES (functions/shared/status.js) --
    // el admin es un <script> plano sin bundler y no puede requerirlo.
    if(!isBlockingStatus(b.status)) continue;
```

y agregar, junto a la constante `DEFAULT_BUFFER_MIN` que ya vive cerca de la línea 3543:

```js
var BLOCKING_STATUSES = ['pending','confirmed','arrived','in_service','completed'];
function isBlockingStatus(s){ return !s || BLOCKING_STATUSES.indexOf(s) !== -1; }
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd functions && node --test`
Expected: PASS, sin regresiones (los 160 previos siguen en verde).

- [ ] **Step 5: Commit**

```bash
git add functions/shared/status.js functions/shared/availability.js functions/test/status.test.js functions/test/availability.test.js public/admin/index.html
git commit -m "feat(shared): BLOCKING_STATUSES como criterio único de horario ocupado"
```

---

### Task 2: Máquina de estados de la atención

**Files:**
- Create: `functions/shared/attendance.js`
- Test: `functions/test/attendance.test.js`

**Interfaces:**
- Consumes: `isValidBookingStatus` de `functions/shared/status.js`.
- Produces: `ATTENDANCE_ACTIONS: string[]`, `canTransition(from: string|undefined, action: string): boolean`, `applyAction(booking: object, action: string, now: Date, opts?: {by?: string, reason?: string, atISO?: string, snoozeMs?: number}): object|null`.

`applyAction` devuelve el parche de campos a escribir, o `null` si la acción ya está aplicada (idempotencia). Nunca lanza por datos sucios.

- [ ] **Step 1: Escribir el test que falla**

Crear `functions/test/attendance.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { canTransition, applyAction } = require('../shared/attendance.js');

const NOW = new Date('2026-09-07T18:30:00.000Z');

test('canTransition: el ciclo feliz completo', () => {
  assert.ok(canTransition('pending', 'arrive'));
  assert.ok(canTransition('confirmed', 'arrive'));
  assert.ok(canTransition('arrived', 'start'));
  assert.ok(canTransition('in_service', 'end'));
});

// El flujo que pidió el usuario va de la notificación "¿Deseas comenzar la
// atención?" directo a iniciar. Obligar a marcar Llegó primero agregaría un
// toque que el PDF pide evitar explícitamente (§3).
test('canTransition: atajo pending/confirmed -> start sin marcar Llegó', () => {
  assert.ok(canTransition('pending', 'start'));
  assert.ok(canTransition('confirmed', 'start'));
});

test('canTransition: transiciones inválidas', () => {
  assert.ok(!canTransition('completed', 'start'));
  assert.ok(!canTransition('no_show', 'end'));
  assert.ok(!canTransition('declined', 'arrive'));
  assert.ok(!canTransition('pending', 'end'), 'no se puede finalizar lo que no empezó');
  assert.ok(!canTransition('cancelled', 'arrive'));
});

test('applyAction arrive: setea status y arrivedAt del servidor', () => {
  const p = applyAction({ status: 'confirmed' }, 'arrive', NOW, { by: 'victoria' });
  assert.strictEqual(p.status, 'arrived');
  assert.strictEqual(p.arrivedAt, NOW.toISOString());
  assert.strictEqual(p.attendanceBy, 'victoria');
});

test('applyAction start desde confirmed: setea arrivedAt igual a startedAt', () => {
  const p = applyAction({ status: 'confirmed' }, 'start', NOW, { by: 'victoria' });
  assert.strictEqual(p.status, 'in_service');
  assert.strictEqual(p.startedAt, NOW.toISOString());
  assert.strictEqual(p.arrivedAt, NOW.toISOString());
});

test('applyAction start desde arrived: NO pisa el arrivedAt original', () => {
  const b = { status: 'arrived', arrivedAt: '2026-09-07T18:00:00.000Z' };
  const p = applyAction(b, 'start', NOW, {});
  assert.strictEqual(p.startedAt, NOW.toISOString());
  assert.strictEqual(p.arrivedAt, undefined, 'no debe incluir arrivedAt en el parche');
});

test('applyAction end: calcula actualDur en minutos y durSource timer', () => {
  const b = { status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z' };
  const p = applyAction(b, 'end', NOW, {});
  assert.strictEqual(p.status, 'completed');
  assert.strictEqual(p.endedAt, NOW.toISOString());
  assert.strictEqual(p.actualDur, 30);
  assert.strictEqual(p.durSource, 'timer');
});

test('applyAction end con corrección: durSource manual + auditoría del original', () => {
  const b = { status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z' };
  const p = applyAction(b, 'end', NOW, { atISO: '2026-09-07T18:45:00.000Z', reason: 'olvidé cerrar', by: 'victoria' });
  assert.strictEqual(p.endedAt, '2026-09-07T18:45:00.000Z');
  assert.strictEqual(p.actualDur, 45);
  assert.strictEqual(p.durSource, 'manual');
  assert.strictEqual(p.attendanceAudit.length, 1);
  assert.strictEqual(p.attendanceAudit[0].field, 'endedAt');
  assert.strictEqual(p.attendanceAudit[0].to, '2026-09-07T18:45:00.000Z');
  assert.strictEqual(p.attendanceAudit[0].reason, 'olvidé cerrar');
});

test('applyAction end nunca produce actualDur negativa', () => {
  const b = { status: 'in_service', startedAt: '2026-09-07T19:00:00.000Z' };
  const p = applyAction(b, 'end', NOW, {});
  assert.strictEqual(p.actualDur, 0);
});

// Posponer solo mueve la hora del próximo aviso. El contador de insistencia
// lo lleva el scheduler al ENVIAR (una sola fuente de verdad): si lo tocaran
// los dos, cada ciclo gastaría dos del tope y la app dejaría de avisar a la
// mitad de tiempo del previsto.
test('applyAction snooze: corre snoozeUntil y no toca el contador ni el estado', () => {
  const b = { status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z', nudgeEndCount: 2 };
  const p = applyAction(b, 'snooze', NOW, { snoozeMs: 10 * 60 * 1000 });
  assert.strictEqual(p.snoozeUntil, '2026-09-07T18:40:00.000Z');
  assert.strictEqual(p.nudgeEndCount, undefined);
  assert.strictEqual(p.status, undefined);
});

test('applyAction es idempotente: repetir una acción ya aplicada devuelve null', () => {
  assert.strictEqual(applyAction({ status: 'arrived' }, 'arrive', NOW, {}), null);
  assert.strictEqual(applyAction({ status: 'completed' }, 'end', NOW, {}), null);
  assert.strictEqual(applyAction({ status: 'no_show' }, 'no_show', NOW, {}), null);
});

test('applyAction devuelve null ante una transición inválida', () => {
  assert.strictEqual(applyAction({ status: 'completed' }, 'start', NOW, {}), null);
});

test('applyAction cancel y no_show', () => {
  assert.strictEqual(applyAction({ status: 'pending' }, 'cancel', NOW, {}).status, 'cancelled');
  assert.strictEqual(applyAction({ status: 'arrived' }, 'no_show', NOW, {}).status, 'no_show');
});

test('applyAction no lanza con una reserva vacía o basura', () => {
  assert.doesNotThrow(() => applyAction({}, 'start', NOW, {}));
  assert.doesNotThrow(() => applyAction({ status: 'in_service', startedAt: 'no-es-fecha' }, 'end', NOW, {}));
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd functions && node --test test/attendance.test.js`
Expected: FAIL — `Cannot find module '../shared/attendance.js'`.

- [ ] **Step 3: Implementar**

Crear `functions/shared/attendance.js`:

```js
// functions/shared/attendance.js — máquina de estados de la atención real
// (Llegó / No llegó / Iniciar / Finalizar) y decisión de qué notificación
// corresponde. Lógica pura, sin firebase-admin y sin I/O: mismo patrón que
// shared/availability.js y reminders.js, testeable con node --test sin
// emulador. functions/index.js hace todo el I/O y le pasa los datos ya
// leídos; este módulo solo decide.
'use strict';

const ATTENDANCE_ACTIONS = ['arrive', 'no_show', 'start', 'end', 'snooze', 'cancel'];

// De qué estados se puede aplicar cada acción. El atajo pending|confirmed ->
// start existe a propósito: el flujo que produce el dato va de la
// notificación "¿Deseas comenzar la atención?" directo a iniciar, y el PDF
// (§3) pide la menor cantidad de toques posible.
const FROM = {
  arrive: ['pending', 'confirmed'],
  no_show: ['pending', 'confirmed', 'arrived'],
  start: ['pending', 'confirmed', 'arrived'],
  end: ['in_service'],
  snooze: ['in_service'],
  cancel: ['pending', 'confirmed', 'arrived'],
};

function canTransition(from, action) {
  const allowed = FROM[action];
  if (!allowed) return false;
  return allowed.indexOf(from || 'pending') !== -1;
}

// Estado en que queda una reserva tras aplicar la acción (snooze no mueve el
// estado: solo corre el recordatorio).
const RESULT = {
  arrive: 'arrived', no_show: 'no_show', start: 'in_service',
  end: 'completed', cancel: 'cancelled',
};

function msOf(value) {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function auditEntry(nowISO, field, from, to, by, reason) {
  return { at: nowISO, field, from: from || null, to, by: by || null, reason: reason || null };
}

// Devuelve el parche de campos a escribir, o null si no hay nada que hacer
// (acción ya aplicada, o transición inválida). Nunca lanza: una reserva con
// startedAt corrupto degrada a actualDur 0, no tumba la llamada.
function applyAction(booking, action, now, opts) {
  const b = booking || {};
  const o = opts || {};
  const status = b.status || 'pending';
  if (!canTransition(status, action)) return null;

  const nowISO = now.toISOString();
  const by = o.by || null;

  // Posponer solo corre la hora del próximo aviso. El contador de
  // insistencia lo lleva el scheduler al enviar -- una sola fuente de verdad.
  if (action === 'snooze') {
    const ms = o.snoozeMs || 10 * 60 * 1000;
    return { snoozeUntil: new Date(now.getTime() + ms).toISOString() };
  }

  const patch = { status: RESULT[action], attendanceBy: by };

  if (action === 'arrive') patch.arrivedAt = nowISO;
  if (action === 'no_show') patch.noShowAt = nowISO;
  if (action === 'cancel') patch.cancelledAt = nowISO;

  if (action === 'start') {
    patch.startedAt = nowISO;
    // Iniciar sin haber marcado Llegó implica que el cliente está presente.
    // Si ya se había marcado, se respeta la hora original.
    if (!b.arrivedAt) patch.arrivedAt = nowISO;
  }

  if (action === 'end') {
    const corrected = o.atISO && msOf(o.atISO) !== null;
    const endISO = corrected ? o.atISO : nowISO;
    patch.endedAt = endISO;
    patch.durSource = corrected ? 'manual' : 'timer';
    const startMs = msOf(b.startedAt);
    const endMs = msOf(endISO);
    patch.actualDur = (startMs === null || endMs === null)
      ? 0
      : Math.max(0, Math.round((endMs - startMs) / 60000));
    if (corrected) {
      patch.attendanceAudit = (b.attendanceAudit || [])
        .concat([auditEntry(nowISO, 'endedAt', nowISO, endISO, by, o.reason)]);
    }
  }

  return patch;
}

module.exports = { ATTENDANCE_ACTIONS, canTransition, applyAction };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd functions && node --test test/attendance.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add functions/shared/attendance.js functions/test/attendance.test.js
git commit -m "feat(shared): máquina de estados de la atención (llegó/inició/finalizó)"
```

---

### Task 3: Decisión de notificaciones (`computeNudges`)

**Files:**
- Modify: `functions/shared/attendance.js`
- Modify: `functions/shared/timezone.js`
- Test: `functions/test/attendance.test.js`, `functions/test/timezone.test.js`

**Interfaces:**
- Consumes: `zonedInstant`, `DEFAULT_TZ` de `shared/timezone.js`; `dateKeyOf` de `shared/availability.js`.
- Produces: `DEFAULT_NUDGE_LEAD_MIN: 10`, `MAX_END_NUDGES: 6`, `SNOOZE_MS: 600000`, `computeNudges(bookings: object[], now: Date, cfg: {leadMin?: number, tz?: string}): object[]` desde `shared/attendance.js`; `resolveNudgeLeadMin(businessInfo): number` desde `shared/timezone.js`.

Cada elemento devuelto: `{ bookingId, kind, barberId, title, body, data: { b, a } }` con `kind ∈ 'upcoming'|'start'|'end'`. `data.b` es el id del doc y `data.a` la acción sugerida, para el enlace profundo de la PWA.

- [ ] **Step 1: Escribir los tests que fallan**

En `functions/test/timezone.test.js`, agregar (y sumar `resolveNudgeLeadMin` al `require`):

```js
test('resolveNudgeLeadMin: default 10 cuando falta businessInfo o el campo', () => {
  assert.strictEqual(resolveNudgeLeadMin(null), 10);
  assert.strictEqual(resolveNudgeLeadMin({}), 10);
  assert.strictEqual(resolveNudgeLeadMin({ nudgeLeadMin: 15 }), 15);
  assert.strictEqual(resolveNudgeLeadMin({ nudgeLeadMin: 0 }), 0);
  assert.strictEqual(resolveNudgeLeadMin({ nudgeLeadMin: 'x' }), 10);
});
```

En `functions/test/attendance.test.js`, agregar (sumando `computeNudges` al `require`):

```js
// 2026-09-07 15:00 en America/Santiago = 18:00Z (invierno, GMT-3 desde
// septiembre). Se fija el tz en cada reserva para no depender del runner.
const TZ = 'America/Santiago';
const bk = (over) => Object.assign({
  _docId: 'b1', barberId: 'victoria', name: 'Ana', date: '2026-09-07',
  time: '15:00', dur: 45, status: 'confirmed', tz: TZ,
}, over);
const at = (hhmmZ) => new Date(`2026-09-07T${hhmmZ}:00.000Z`);

test('computeNudges upcoming: dentro de la ventana de anticipación', () => {
  const n = computeNudges([bk()], at('17:52'), { leadMin: 10, tz: TZ });
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].kind, 'upcoming');
  assert.match(n[0].body, /Ana/);
  assert.match(n[0].body, /15:00/);
});

test('computeNudges upcoming: fuera de la ventana no dispara', () => {
  assert.strictEqual(computeNudges([bk()], at('17:30'), { leadMin: 10, tz: TZ }).length, 0);
});

test('computeNudges upcoming: no se repite si ya se envió', () => {
  const b = bk({ nudgeUpcomingAt: '2026-09-07T17:52:00.000Z' });
  assert.strictEqual(computeNudges([b], at('17:55'), { leadMin: 10, tz: TZ }).length, 0);
});

test('computeNudges start: la hora ya pasó y no se ha iniciado', () => {
  const n = computeNudges([bk()], at('18:01'), { leadMin: 10, tz: TZ });
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].kind, 'start');
  assert.strictEqual(n[0].data.a, 'start');
});

test('computeNudges start: no dispara si ya se marcó no_show', () => {
  const b = bk({ status: 'no_show', noShowAt: '2026-09-07T18:00:00.000Z' });
  assert.strictEqual(computeNudges([b], at('18:05'), { leadMin: 10, tz: TZ }).length, 0);
});

test('computeNudges end: al cumplirse la duración planificada', () => {
  const b = bk({ status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z', nudgeStartAt: 'x' });
  const n = computeNudges([b], at('18:46'), { leadMin: 10, tz: TZ });
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].kind, 'end');
});

test('computeNudges end: no dispara antes de cumplirse la duración', () => {
  const b = bk({ status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z' });
  assert.strictEqual(computeNudges([b], at('18:30'), { leadMin: 10, tz: TZ }).length, 0);
});

test('computeNudges end: respeta snoozeUntil y vuelve a disparar al vencer', () => {
  const b = bk({ status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z',
    nudgeEndAt: '2026-09-07T18:45:00.000Z', snoozeUntil: '2026-09-07T18:55:00.000Z', nudgeEndCount: 1 });
  assert.strictEqual(computeNudges([b], at('18:50'), { tz: TZ }).length, 0, 'sigue pospuesto');
  assert.strictEqual(computeNudges([b], at('18:56'), { tz: TZ }).length, 1, 'venció la posposición');
});

test('computeNudges end: deja de insistir al llegar al tope', () => {
  const b = bk({ status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z', nudgeEndCount: 6 });
  assert.strictEqual(computeNudges([b], at('20:00'), { tz: TZ }).length, 0);
});

// Sin esto el aviso de fin se redispararía en CADA corrida del scheduler --
// una vibración cada 2 minutos hasta que el barbero responda. El tope de
// MAX_END_NUDGES no alcanza a protegerlo por sí solo si el barbero
// simplemente ignora la notificación en vez de posponerla.
test('computeNudges end: no se repite en cada corrida, espera SNOOZE_MS', () => {
  const b = bk({ status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z',
    nudgeEndAt: '2026-09-07T18:45:00.000Z', nudgeEndCount: 1 });
  assert.strictEqual(computeNudges([b], at('18:47'), { tz: TZ }).length, 0, 'solo pasaron 2 min');
  assert.strictEqual(computeNudges([b], at('18:56'), { tz: TZ }).length, 1, 'pasaron más de 10 min');
});

// El admin escribe reservas SIN tz y con date 'YYYY-MM-DDTHH:mm:00.000Z'
// (public/admin/index.html). Ambas cosas tienen que funcionar.
test('computeNudges: reserva del admin sin tz y con date con sufijo', () => {
  const b = bk({ tz: undefined, date: '2026-09-07T15:00:00.000Z' });
  const n = computeNudges([b], at('17:52'), { leadMin: 10, tz: TZ });
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].kind, 'upcoming');
});

test('computeNudges: una reserva malformada no tumba el resto del lote', () => {
  const mala = bk({ _docId: 'mala', date: 'no-es-fecha', time: null });
  const buena = bk({ _docId: 'buena' });
  let n;
  assert.doesNotThrow(() => { n = computeNudges([mala, buena], at('17:52'), { leadMin: 10, tz: TZ }); });
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].bookingId, 'buena');
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd functions && node --test test/attendance.test.js test/timezone.test.js`
Expected: FAIL — `computeNudges is not a function`.

- [ ] **Step 3: Implementar**

En `functions/shared/timezone.js`, junto a `resolveBufferMin`, agregar y exportar:

```js
// Minutos de anticipación del aviso "se acerca la hora" que recibe el
// profesional. Mismo patrón que resolveBufferMin: default en código,
// override en businessInfo/main desde el panel Info.
const DEFAULT_NUDGE_LEAD_MIN = 10;
function resolveNudgeLeadMin(businessInfo) {
  const v = businessInfo && businessInfo.nudgeLeadMin;
  return Number.isFinite(v) ? v : DEFAULT_NUDGE_LEAD_MIN;
}
```

En `functions/shared/attendance.js`, agregar arriba:

```js
const { DEFAULT_TZ, zonedInstant } = require('./timezone.js');
const { dateKeyOf } = require('./availability.js');

const DEFAULT_NUDGE_LEAD_MIN = 10;
// Tope de insistencia al cerrar: 6 posposiciones de 10 min = una hora. Pasado
// eso la atención queda para revisión manual en vez de seguir vibrando el
// teléfono -- el PDF (§3) pide expresamente que el timer no presione.
const MAX_END_NUDGES = 6;
const SNOOZE_MS = 10 * 60 * 1000;
```

y al final, antes del `module.exports`:

```js
// Instante real de la cita. Respeta el tz propio de la reserva; las que
// escribe el admin no tienen ninguno y caen al del negocio.
function bookingInstant(b, fallbackTz) {
  const tz = b.tz || fallbackTz || DEFAULT_TZ;
  const d = zonedInstant(dateKeyOf(b.date), b.time, tz);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

function hhmm(b) {
  return String(b.time || '').slice(0, 5);
}

// Decide qué avisos corresponden AHORA. Una reserva produce como máximo uno
// por corrida, y el más avanzado del ciclo gana: si ya es hora de finalizar,
// no tiene sentido preguntar si querés empezar.
function computeNudges(bookings, now, cfg) {
  const c = cfg || {};
  const leadMs = (Number.isFinite(c.leadMin) ? c.leadMin : DEFAULT_NUDGE_LEAD_MIN) * 60000;
  const nowMs = now.getTime();
  const out = [];

  (bookings || []).forEach((b) => {
    // Aislada por reserva: el admin no pasa por isValidBookingPayload(), así
    // que un date corrupto es un caso real y no puede tumbar el lote.
    try {
      const id = b._docId;
      if (!id || !b.barberId) return;
      const nombre = b.name || 'tu cliente';

      // --- fin de la atención ---
      if (b.status === 'in_service' && !b.endedAt) {
        const startMs = new Date(b.startedAt).getTime();
        if (!Number.isNaN(startMs)) {
          const count = Number(b.nudgeEndCount) || 0;
          const snoozeMs = b.snoozeUntil ? new Date(b.snoozeUntil).getTime() : null;
          const dueMs = (snoozeMs && !Number.isNaN(snoozeMs))
            ? snoozeMs
            : startMs + (Number(b.dur) || 0) * 60000;
          // El aviso de fin es el único que se repite. Sin este piso volvería
          // a salir en CADA corrida (cada 2 min) mientras el barbero no
          // responda: se espera SNOOZE_MS desde el último envío, igual que
          // si lo hubiera pospuesto él.
          const lastMs = b.nudgeEndAt ? new Date(b.nudgeEndAt).getTime() : null;
          const listo = !lastMs || Number.isNaN(lastMs) || nowMs >= lastMs + SNOOZE_MS;
          if (count < MAX_END_NUDGES && nowMs >= dueMs && listo) {
            out.push({
              bookingId: id, kind: 'end', barberId: b.barberId,
              title: 'Atención en curso',
              body: `¿Deseas finalizar la atención de ${nombre}?`,
              data: { b: id, a: 'end' },
            });
          }
        }
        return;
      }

      if (b.status !== 'pending' && b.status !== 'confirmed') return;

      const t = bookingInstant(b, c.tz);
      if (t === null) return;

      // --- inicio de la atención ---
      if (nowMs >= t) {
        if (b.nudgeStartAt) return;
        out.push({
          bookingId: id, kind: 'start', barberId: b.barberId,
          title: 'Es la hora',
          body: `¿Deseas comenzar la atención para ${nombre}?`,
          data: { b: id, a: 'start' },
        });
        return;
      }

      // --- se acerca la hora ---
      if (!b.nudgeUpcomingAt && t - nowMs <= leadMs) {
        out.push({
          bookingId: id, kind: 'upcoming', barberId: b.barberId,
          title: 'Próxima atención',
          body: `Se acerca la hora de atención con ${nombre} a las ${hhmm(b)}`,
          data: { b: id, a: 'view' },
        });
      }
    } catch {
      /* reserva malformada: se ignora, el lote sigue */
    }
  });

  return out;
}
```

Actualizar el `module.exports` a `{ ATTENDANCE_ACTIONS, canTransition, applyAction, computeNudges, DEFAULT_NUDGE_LEAD_MIN, MAX_END_NUDGES, SNOOZE_MS }`, y el de `timezone.js` para incluir `DEFAULT_NUDGE_LEAD_MIN, resolveNudgeLeadMin`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd functions && node --test`
Expected: PASS, todo en verde.

- [ ] **Step 5: Commit**

```bash
git add functions/shared/attendance.js functions/shared/timezone.js functions/test/attendance.test.js functions/test/timezone.test.js
git commit -m "feat(shared): computeNudges decide los avisos de atención"
```

---

### Task 4: Callables `getMyDay`, `markAttendance` y `linkStaffAccount`

**Files:**
- Modify: `functions/index.js`
- Modify: `public/js/data.js`
- Modify: `firestore.rules`
- Test: `tests/rules/staffDevices.test.js`

**Interfaces:**
- Consumes: `canTransition`, `applyAction`, `ATTENDANCE_ACTIONS`, `SNOOZE_MS` de `shared/attendance.js`; `assertAdmin` de `functions/index.js:30`.
- Produces:
  - `getMyDay({date?}) → {staffId, name, bookings: [{id, code, name, time, dur, svcName, price, status, startedAt, endedAt, actualDur, arrivedAt}]}`
  - `markAttendance({bookingId, action, at?, reason?}) → {ok: true, already?: true, status, actualDur?}`
  - `linkStaffAccount({staffId, email}) → {ok: true, uid}`
  - En `public/js/data.js`: `getMyDay(date)`, `markAttendance(bookingId, action, opts)`, `linkStaffAccount(staffId, email)`, más `saveMyPushToken(uid, token)`.

- [ ] **Step 1: Escribir el test de reglas que falla**

Crear `tests/rules/staffDevices.test.js` siguiendo el patrón de los archivos que ya existen en `tests/rules/` (leer uno antes para copiar el `beforeAll`/`testEnv` exacto):

```js
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { describe, it } from 'vitest';

describe('staffDevices', () => {
  it('un barbero escribe y lee su propio doc de dispositivos', async () => {
    const db = testEnv.authenticatedContext('uid-victoria').firestore();
    await assertSucceeds(setDoc(doc(db, 'staffDevices/uid-victoria'), { tokens: ['t1'] }));
    await assertSucceeds(getDoc(doc(db, 'staffDevices/uid-victoria')));
  });

  it('un barbero NO puede escribir ni leer el doc de otro', async () => {
    const db = testEnv.authenticatedContext('uid-victoria').firestore();
    await assertFails(setDoc(doc(db, 'staffDevices/uid-esteban'), { tokens: ['t1'] }));
    await assertFails(getDoc(doc(db, 'staffDevices/uid-esteban')));
  });

  it('un anónimo no puede escribir ninguno', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'staffDevices/uid-victoria'), { tokens: ['t1'] }));
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test:rules`
Expected: FAIL — el primer caso falla porque la colección no tiene regla y todo está denegado por defecto.

- [ ] **Step 3: Implementar reglas y callables**

En `firestore.rules`, antes del cierre del `match /databases/...`:

```
    // Tokens de FCM del dispositivo de cada profesional (PWA /barbero).
    // Único lugar del repo donde alguien que no es admin escribe directo a
    // Firestore: es un dato por-usuario, sin PII, y la regla es una sola
    // igualdad. Todo lo demás de la PWA pasa por callables con Admin SDK.
    match /staffDevices/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
```

En `functions/index.js`, agregar al bloque de requires:

```js
const { getAuth } = require('firebase-admin/auth');
const { canTransition, applyAction, ATTENDANCE_ACTIONS, SNOOZE_MS } = require('./shared/attendance.js');
```

y estos tres exports (junto a los demás `onCall`):

```js
// Resuelve el barbero a partir del usuario autenticado. El vínculo es
// staff/{id}.uid, escrito por linkStaffAccount. Devuelve null si no hay
// ninguno -- un usuario de Auth sin ficha de staff no es un barbero.
async function resolveStaffFor(db, request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const snap = await db.collection('staff').where('uid', '==', request.auth.uid).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

exports.getMyDay = onCall({ region: 'southamerica-east1' }, async (request) => {
  const db = getFirestore(app);
  const staff = await resolveStaffFor(db, request);
  if (!staff) throw new HttpsError('permission-denied', 'Esta cuenta no está vinculada a ningún profesional.');

  const businessInfoSnap = await db.collection('businessInfo').doc('main').get();
  const tz = resolveBusinessTz(businessInfoSnap.exists ? businessInfoSnap.data() : null);
  const dayKey = dateKeyOf(request.data && request.data.date) || dateKeyInZone(new Date(), tz);
  const { end } = dayBoundsOf(dayKey);

  // Rango sobre `date` (campo simple, sin índice compuesto). El >= / <
  // cubre además las reservas del admin, cuyo date trae sufijo 'T...Z'.
  const snap = await db.collection('bookings')
    .where('barberId', '==', staff.id)
    .where('date', '>=', dayKey)
    .where('date', '<', end)
    .get();

  const bookings = snap.docs.map((d) => {
    const b = d.data();
    return {
      id: d.id, code: b.code || '', name: b.name || '', time: b.time || '',
      dur: b.dur || 0, svcName: b.svcName || '', price: b.price || 0,
      status: b.status || 'pending', arrivedAt: b.arrivedAt || null,
      startedAt: b.startedAt || null, endedAt: b.endedAt || null,
      actualDur: Number.isFinite(b.actualDur) ? b.actualDur : null,
      nudgeEndCount: b.nudgeEndCount || 0,
    };
  }).sort((x, y) => String(x.time).localeCompare(String(y.time)));

  return { staffId: staff.id, name: staff.name || '', date: dayKey, bookings };
});

exports.markAttendance = onCall({ region: 'southamerica-east1' }, async (request) => {
  const db = getFirestore(app);
  const { bookingId, action, at, reason } = request.data || {};
  if (!bookingId || ATTENDANCE_ACTIONS.indexOf(action) === -1) {
    throw new HttpsError('invalid-argument', 'Falta la cita o la acción no es válida.');
  }

  const isAdmin = !!request.auth && (request.auth.token.admin === true || request.auth.uid === ADMIN_UID_FALLBACK);
  const staff = isAdmin ? null : await resolveStaffFor(db, request);
  if (!isAdmin && !staff) throw new HttpsError('permission-denied', 'Esta cuenta no está vinculada a ningún profesional.');

  const ref = db.collection('bookings').doc(String(bookingId));

  return db.runTransaction(async (tx) => {
    // Dentro de la transacción solo tx.get() -- invariante del proyecto.
    const doc = await tx.get(ref);
    if (!doc.exists) throw new HttpsError('not-found', 'Esa cita ya no existe.');
    const b = doc.data();

    // Un barbero solo puede marcar sus propias citas; el admin, cualquiera.
    if (!isAdmin && b.barberId !== staff.id) {
      throw new HttpsError('permission-denied', 'Esa cita no es tuya.');
    }

    const patch = applyAction(b, action, new Date(), {
      by: isAdmin ? 'admin' : staff.id,
      reason: reason || null,
      atISO: at || null,
      snoozeMs: SNOOZE_MS,
    });

    // Idempotente por diseño: un segundo toque de la misma notificación no
    // rompe nada ni pisa la hora original.
    if (!patch) return { ok: true, already: true, status: b.status || 'pending' };

    tx.update(ref, patch);
    return {
      ok: true,
      status: patch.status || b.status || 'pending',
      actualDur: Number.isFinite(patch.actualDur) ? patch.actualDur : null,
    };
  });
});

exports.linkStaffAccount = onCall({ region: 'southamerica-east1' }, async (request) => {
  assertAdmin(request);
  const db = getFirestore(app);
  const { staffId, email } = request.data || {};
  if (!staffId || !email) throw new HttpsError('invalid-argument', 'Falta el profesional o el correo.');

  let user;
  try {
    user = await getAuth(app).getUserByEmail(String(email).trim().toLowerCase());
  } catch {
    throw new HttpsError('not-found', 'No existe ninguna cuenta con ese correo. Creala primero en Firebase Auth.');
  }

  const ref = db.collection('staff').doc(String(staffId));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Ese profesional no existe.');

  await ref.update({ uid: user.uid, authEmail: user.email || '' });
  return { ok: true, uid: user.uid };
});
```

En `public/js/data.js`, junto a los otros wrappers de callables:

```js
// ═══ MEDICIÓN DE LA ATENCIÓN REAL (PWA /barbero + respaldo del admin) ═══
// Ninguna de estas escribe a Firestore desde el cliente: todo pasa por
// callables con Admin SDK, igual que createBooking.
async function getMyDay(date) {
  const call = httpsCallable(functions, 'getMyDay');
  const { data } = await call({ date: date || null });
  return data; // { staffId, name, date, bookings: [...] }
}

async function markAttendance(bookingId, action, opts) {
  const call = httpsCallable(functions, 'markAttendance');
  const { data } = await call({ bookingId, action, ...(opts || {}) });
  return data; // { ok, already, status, actualDur }
}

async function linkStaffAccount(staffId, email) {
  const call = httpsCallable(functions, 'linkStaffAccount');
  const { data } = await call({ staffId, email });
  return data; // { ok, uid }
}

// Único write directo a Firestore fuera del admin: el token del dispositivo.
// Ver el match /staffDevices/{uid} en firestore.rules.
async function saveMyPushToken(uid, token) {
  await setDoc(doc(db, 'staffDevices', uid), {
    tokens: arrayUnion(token), updatedAt: new Date().toISOString(),
  }, { merge: true });
}
```

Agregar `arrayUnion` al import de `firebase-firestore.js` y las cuatro funciones a los dos bloques de export del final del archivo.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm run test:rules && cd functions && node --test`
Expected: PASS en ambos.

- [ ] **Step 5: Commit**

```bash
git add functions/index.js public/js/data.js firestore.rules tests/rules/staffDevices.test.js
git commit -m "feat(functions): getMyDay, markAttendance y linkStaffAccount"
```

---

### Task 5: Función programada de notificaciones

**Files:**
- Modify: `functions/index.js`
- Modify: `README.md:168-175`

**Interfaces:**
- Consumes: `computeNudges` de `shared/attendance.js`; `resolveNudgeLeadMin` de `shared/timezone.js`.
- Produces: `exports.staffAttendanceNudges` (`onSchedule`, cada 2 minutos).

- [ ] **Step 1: Implementar**

En `functions/index.js`, agregar `const { getMessaging } = require('firebase-admin/messaging');` a los requires, `computeNudges` al require de attendance y `resolveNudgeLeadMin` al de timezone. Después agregar:

```js
// Avisos al profesional: "se acerca la hora", "¿comenzamos?", "¿finalizamos?".
// Corre cada 2 min porque el aviso de fin debe caer cerca del minuto exacto
// en que se cumple la duración planificada. La query trae solo las citas de
// ayer y hoy (decenas de docs), no la colección entera.
exports.staffAttendanceNudges = onSchedule(
  { schedule: 'every 2 minutes', timeZone: 'America/Santiago', region: 'southamerica-east1' },
  async () => {
    try {
      const db = getFirestore(app);
      const now = new Date();

      const businessInfoSnap = await db.collection('businessInfo').doc('main').get();
      const businessInfoData = businessInfoSnap.exists ? businessInfoSnap.data() : null;

      // Mismo interruptor de seguridad que sendBookingReminders: por defecto
      // (campo ausente) no manda nada y corta ANTES de tocar `bookings`.
      // Desplegar deja el Cloud Scheduler instalado pero en no-op; recién
      // envía cuando alguien activa nudgesEnabled:true tras verificar en
      // staging que la PWA y el push se ven bien.
      if (!businessInfoData || businessInfoData.nudgesEnabled !== true) {
        logger.info('staffAttendanceNudges: nudgesEnabled no está activado, no se envía nada.');
        return;
      }

      const tz = resolveBusinessTz(businessInfoData);
      const leadMin = resolveNudgeLeadMin(businessInfoData);

      const todayKey = dateKeyInZone(now, tz);
      const yesterdayKey = dateKeyInZone(new Date(now.getTime() - 24 * 60 * 60 * 1000), tz);
      const { end } = dayBoundsOf(todayKey);

      // Ayer entra por las atenciones que quedaron abiertas cruzando la
      // medianoche. Rango sobre `date` -- campo simple, sin índice nuevo.
      const snap = await db.collection('bookings')
        .where('date', '>=', yesterdayKey)
        .where('date', '<', end)
        .get();

      const items = new Map(snap.docs.map((d) => [d.id, d.ref]));
      const bookings = snap.docs.map((d) => ({ ...d.data(), _docId: d.id }));
      const nudges = computeNudges(bookings, now, { leadMin, tz });
      if (!nudges.length) return;

      // uid -> staffId se deriva del lado del servidor. Nunca se confía en
      // un staffId que haya escrito el cliente en staffDevices.
      const staffSnap = await db.collection('staff').get();
      const tokensByStaff = {};
      await Promise.all(staffSnap.docs.map(async (s) => {
        const uid = s.data().uid;
        if (!uid) return;
        const dev = await db.collection('staffDevices').doc(uid).get();
        const tokens = dev.exists ? (dev.data().tokens || []) : [];
        if (tokens.length) tokensByStaff[s.id] = { uid, tokens };
      }));

      const nowISO = now.toISOString();
      const FIELD = { upcoming: 'nudgeUpcomingAt', start: 'nudgeStartAt', end: 'nudgeEndAt' };

      for (const n of nudges) {
        // Un fallo por reserva no aborta la corrida.
        try {
          const target = tokensByStaff[n.barberId];
          if (!target) continue;

          const res = await getMessaging(app).sendEachForMulticast({
            tokens: target.tokens,
            notification: { title: n.title, body: n.body },
            data: { b: n.data.b, a: n.data.a },
            webpush: {
              fcmOptions: { link: `https://scissorwhite.cl/barbero/?b=${n.data.b}&a=${n.data.a}` },
            },
          });

          // Purga de tokens muertos (teléfono reinstalado, permiso revocado):
          // si no se limpian, cada corrida reintenta contra ellos para siempre.
          const muertos = res.responses
            .map((r, i) => (r.success ? null : target.tokens[i]))
            .filter(Boolean);
          if (muertos.length) {
            await db.collection('staffDevices').doc(target.uid)
              .update({ tokens: FieldValue.arrayRemove(...muertos) });
          }

          if (res.successCount > 0) {
            const patch = { [FIELD[n.kind]]: nowISO };
            if (n.kind === 'end') {
              // Consumir la posposición y contar el envío. El contador es lo
              // que hace efectivo el tope de MAX_END_NUDGES cuando el barbero
              // ignora la notificación en vez de posponerla -- sin esto solo
              // contaría las posposiciones explícitas y la app insistiría
              // para siempre.
              patch.snoozeUntil = null;
              patch.nudgeEndCount = FieldValue.increment(1);
            }
            await items.get(n.bookingId).update(patch);
          }
        } catch (e) {
          logger.error('staffAttendanceNudges: falló un aviso', n.bookingId, e);
        }
      }
    } catch (e) {
      // Mismo criterio que refreshGoogleReviews: se loguea y NO se relanza,
      // para no gastar reintentos. La corrida de 2 min después recoge todo.
      logger.error('staffAttendanceNudges: falló la corrida', e);
    }
  },
);
```

En `README.md`, agregar los cuatro nombres nuevos al comando de deploy:

```
functions:getMyDay,functions:markAttendance,functions:linkStaffAccount,\
functions:staffAttendanceNudges
```

- [ ] **Step 2: Verificar que el módulo carga sin errores de sintaxis**

Run: `cd functions && node -e "require('./index.js'); console.log('ok')"`
Expected: imprime `ok`.

- [ ] **Step 3: Correr toda la suite**

Run: `cd functions && node --test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/index.js README.md
git commit -m "feat(functions): staffAttendanceNudges (push de atención cada 2 min)"
```

---

### Task 6: PWA del barbero — shell, sesión y agenda del día

**Files:**
- Create: `public/barbero/index.html`
- Create: `public/barbero/manifest.webmanifest`
- Create: `public/barbero/icon-192.png`, `public/barbero/icon-512.png`, `public/barbero/icon-maskable-512.png`
- Modify: `firebase.json`

**Interfaces:**
- Consumes: `window.SWAuth` (`signIn`, `signOut`, `onChange`), `window.SWData.getMyDay`, `window.SWData.markAttendance`.
- Produces: la app en `/barbero/`; funciones globales `renderDay()`, `act(bookingId, action)`, `applyDeepLink()`.

- [ ] **Step 1: Generar los íconos**

El repo no tiene íconos de 192/512 — solo `apple-touch-icon.png` y favicons de 16/32. Generar los tres desde `public/assets/logo.png` con cualquier herramienta de imagen (fondo `#0A0A0A`, el logo centrado; el maskable con ~20% de margen para la zona segura de Android). Confirmar tamaños:

Run: `node -e "const f=require('fs');['192','512'].forEach(s=>console.log(s, f.statSync('public/barbero/icon-'+s+'.png').size))"`
Expected: dos tamaños distintos de cero.

- [ ] **Step 2: Crear el manifest**

`public/barbero/manifest.webmanifest`:

```json
{
  "name": "SW Barbero",
  "short_name": "SW Barbero",
  "start_url": "/barbero/",
  "scope": "/barbero/",
  "display": "standalone",
  "background_color": "#0A0A0A",
  "theme_color": "#0A0A0A",
  "orientation": "portrait",
  "icons": [
    { "src": "/barbero/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/barbero/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/barbero/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 3: Crear la app**

`public/barbero/index.html`, un solo archivo con CSS y JS inline (mismo criterio que `admin/index.html` y `confirmar-cita.html`). Requisitos concretos:

- `<head>`: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, `<meta name="theme-color" content="#0A0A0A">`, `<link rel="manifest" href="/barbero/manifest.webmanifest">`, `<link rel="apple-touch-icon" href="/barbero/icon-192.png">`.
- Paleta y tipografía del admin. Botones de al menos 48px de alto — se tocan de pie, con las manos ocupadas.
- Dos vistas: `#login` (email + contraseña + botón) y `#app` (encabezado con el nombre del barbero y la fecha, lista de tarjetas, sección "Por revisar", botón de salir).
- **La sesión se resuelve con `SWAuth.onChange`, no con el botón de login.** Esto es lo que hoy el admin no hace (`public/js/auth.js:12` está definido y nunca consumido) y sin ello una app instalada pide login en cada apertura en frío:

```js
window.SWAuth.onChange(function(user){
  if(user){ show('app'); loadDay(); }
  else { show('login'); }
});
```

- Botones por estado, exactamente:

```js
function botones(b){
  if(b.status === 'in_service') return [['end','FINALIZAR ATENCIÓN','pri'], ['snooze','Recuérdame en 10 min','sec']];
  if(b.status === 'arrived')    return [['start','INICIAR ATENCIÓN','pri'], ['no_show','No llegó','sec']];
  if(b.status === 'pending' || b.status === 'confirmed')
    return [['arrive','LLEGÓ','pri'], ['no_show','NO LLEGÓ','sec'], ['start','Iniciar','sec']];
  return [];
}
```

- Estados `completed` / `no_show` / `cancelled` / `declined`: tarjeta atenuada con el resumen (inicio, fin, real vs. plan) en vez de botones.
- Timer de la atención en curso: `setInterval` de 1s que solo repinta el texto del tiempo transcurrido, **nunca** vuelve a llamar a `getMyDay`. Visible pero discreto (PDF §3).
- "Por revisar": las citas `in_service` cuyo `startedAt + dur` ya pasó con más de 30 min de holgura.
- `act(bookingId, action)` llama a `SWData.markAttendance`, y **reporta el error real** si falla — mismo criterio que `saveBookingAnd()` del admin (`public/admin/index.html:2044`), que existe precisamente porque antes un guardado rechazado se veía igual que uno exitoso.
- Refresco: al volver al foco (`visibilitychange`) y cada 60s mientras la app esté visible. Sin `onSnapshot` — la PWA no habla con Firestore.
- Al final, los tres scripts: `/js/firebase-init.js`, `/js/data.js`, `/js/auth.js`, los tres `type="module"`.

- [ ] **Step 4: Agregar los headers de hosting**

En `firebase.json`, dentro de `hosting.headers`:

```json
{ "source": "/barbero/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
{ "source": "**/*.webmanifest", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
```

`/barbero/sw.js` **debe** ir sin caché: un service worker cacheado es un service worker congelado, y el manifest no cae en ninguna de las tres reglas que ya existen.

- [ ] **Step 5: Verificar en el navegador**

Run: `firebase emulators:start` y abrir `http://localhost:5000/barbero/`
Expected: se ve el login; tras entrar con un usuario vinculado, aparece la agenda del día. Los botones cambian el estado y la tarjeta se repinta.

- [ ] **Step 6: Commit**

```bash
git add public/barbero firebase.json
git commit -m "feat(barbero): PWA instalable con la agenda del día y los cuatro botones"
```

---

### Task 7: Push en la PWA — service worker, token y enlace profundo

**Files:**
- Create: `public/barbero/sw.js`
- Modify: `public/barbero/index.html`

**Interfaces:**
- Consumes: `window.SWData.saveMyPushToken(uid, token)`.
- Produces: registro del service worker en `/barbero/sw.js`, obtención del token FCM, y manejo de `?b=<id>&a=<accion>`.

- [ ] **Step 1: Crear el service worker**

`public/barbero/sw.js` — service worker clásico (no módulo), porque `importScripts` no existe en los de tipo módulo:

```js
// public/barbero/sw.js — service worker de la PWA del barbero.
// Scope /barbero/, así no interfiere con el sitio ni con /admin.
// Se usan los builds *-compat* porque un service worker clásico no puede
// hacer `import`, y `importScripts` es la única forma de traer el SDK sin
// bundler. Misma versión (10.13.0) que el resto del sitio.
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCIRapdq3FmO4hZgnH4uQjK-CEtm4GKtOg',
  authDomain: 'scissor-white.firebaseapp.com',
  projectId: 'scissor-white',
  storageBucket: 'scissor-white.firebasestorage.app',
  messagingSenderId: '801854192115',
  appId: '1:801854192115:web:45c4bab322ee6154583a86',
});

firebase.messaging().onBackgroundMessage(function(payload){
  const d = payload.data || {};
  const n = payload.notification || {};
  self.registration.showNotification(n.title || 'Scissor White', {
    body: n.body || '',
    icon: '/barbero/icon-192.png',
    badge: '/barbero/icon-192.png',
    tag: 'sw-' + (d.b || ''),      // una notificación por cita, no una pila
    renotify: true,
    data: d,
    // Las acciones solo se ven en Android: Safari no las soporta. Por eso
    // NUNCA ejecutan nada acá -- solo abren la app con la intención en la
    // URL, que es el camino que funciona igual en los dos sistemas.
    actions: d.a === 'end'
      ? [{ action: 'end', title: 'Finalizar' }, { action: 'snooze', title: '10 min más' }]
      : (d.a === 'start' ? [{ action: 'start', title: 'Comenzar' }] : []),
  });
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  const d = event.notification.data || {};
  const accion = event.action || d.a || 'view';
  const url = '/barbero/?b=' + encodeURIComponent(d.b || '') + '&a=' + encodeURIComponent(accion);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      for (const c of list) {
        if (c.url.indexOf('/barbero/') !== -1 && 'focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
```

- [ ] **Step 2: Pedir el token en la app**

En `public/barbero/index.html`, dentro del módulo, tras confirmar sesión:

```js
import { getMessaging, getToken, onMessage }
  from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js';
import { app } from '/js/firebase-init.js';

// Clave VAPID pública del proyecto (Consola → Cloud Messaging → Web Push
// certificates). Es pública por diseño, igual que el resto de firebaseConfig:
// no habilita nada por sí sola. Reemplazar por la real antes de desplegar.
const VAPID_KEY = 'PEGAR_AQUI_LA_CLAVE_VAPID_PUBLICA';

async function activarAvisos(uid){
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
  // El permiso DEBE pedirse desde un gesto del usuario (botón "Activar
  // avisos"), no al cargar: iOS lo exige y Chrome lo penaliza.
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return;
  const reg = await navigator.serviceWorker.register('/barbero/sw.js', { scope: '/barbero/' });
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (token) await window.SWData.saveMyPushToken(uid, token);
}

// Con la app abierta el push no dispara notificación del sistema: se repinta
// la agenda, que es más útil que una notificación sobre algo ya visible.
onMessage(getMessaging(app), function(){ loadDay(); });
```

Agregar un botón "Activar avisos en este teléfono" en el encabezado, que llama a `activarAvisos(user.uid)`, y que se oculta cuando `Notification.permission === 'granted'`.

- [ ] **Step 3: Manejar el enlace profundo**

En `public/barbero/index.html`:

```js
// Tocar la notificación abre /barbero/?b=<id>&a=<accion>. La acción se
// ejecuta ACÁ, ya autenticados -- nunca en el service worker, que no tiene
// sesión. Se limpia la URL para que un refresco no la repita (aunque
// markAttendance es idempotente, repetirla confundiría el mensaje).
async function applyDeepLink(){
  const q = new URLSearchParams(location.search);
  const b = q.get('b'), a = q.get('a');
  history.replaceState(null, '', '/barbero/');
  if (!b || !a || a === 'view') return;
  await act(b, a);
}
```

Llamarla desde `loadDay()`, después de pintar.

- [ ] **Step 4: Verificar en el navegador**

Run: `firebase emulators:start`, abrir `http://localhost:5000/barbero/` en Chrome, activar avisos.
Expected: en DevTools → Application → Service Workers aparece `/barbero/sw.js` activo; el doc `staffDevices/{uid}` tiene un token. Con `?b=<id>&a=start` en la URL, la cita pasa a `in_service` y la URL queda limpia.

- [ ] **Step 5: Commit**

```bash
git add public/barbero
git commit -m "feat(barbero): push FCM con service worker propio y enlace profundo"
```

---

### Task 8: Admin — respaldo, cancelar sin borrar y configuración

**Files:**
- Modify: `public/admin/index.html` (tarjetas de la Agenda ~2500-2540; `deleteBookingAnd` 2052; llamadas 2326 y 2810; panel Info 1181 y 3590/3599; panel Personal)
- Modify: `public/js/metrics.js:144,265,296,333`
- Test: `tests/unit/metrics.test.js`

**Interfaces:**
- Consumes: `SWData.markAttendance`, `SWData.linkStaffAccount`.
- Produces: `cancelBookingAnd(id, okMsg)`, `attendanceButtons(b)`, `renderPorRevisar()` en el admin.

- [ ] **Step 1: Escribir el test que falla**

En `tests/unit/metrics.test.js`, junto a los casos de `mFilterPeriod`:

```js
test('mFilterPeriod excluye cancelled igual que declined', () => {
  const bks = [
    { date: '2026-09-10', price: 1000, status: 'cancelled' },
    { date: '2026-09-10', price: 1000, status: 'completed' },
  ];
  const r = M.mFilterPeriod(bks, { from: PERIOD.from, to: PERIOD.to, mode: 'agendado', today: PERIOD.today });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].status, 'completed');
});

// no_show NO se excluye a propósito: una cita a la que el cliente no llegó
// sigue siendo una reserva, y es el numerador del KPI de no-show que el
// dashboard (P2) va a calcular. Excluirla acá lo volvería incalculable.
test('mFilterPeriod NO excluye no_show', () => {
  const bks = [{ date: '2026-09-10', price: 1000, status: 'no_show' }];
  const r = M.mFilterPeriod(bks, { from: PERIOD.from, to: PERIOD.to, mode: 'agendado', today: PERIOD.today });
  assert.strictEqual(r.length, 1);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test`
Expected: FAIL — la cita `cancelled` sigue contando.

- [ ] **Step 3: Implementar**

En `public/js/metrics.js`, agregar junto a las constantes del tope del IIFE:

```js
  // Estados que no cuentan como demanda ni ingreso. 'no_show' NO está acá a
  // propósito: es una reserva real y el numerador del KPI de no-show.
  var EXCLUDED_STATUSES = ['declined', 'cancelled'];
  function isExcluded(s){ return EXCLUDED_STATUSES.indexOf(s) !== -1; }
```

y reemplazar las cuatro comparaciones `b.status === 'declined'` (líneas 144, 265, 296, 333) por `isExcluded(b.status)`.

En `public/admin/index.html`:

1. Sustituir `deleteBookingAnd` (2052) por `cancelBookingAnd`, que archiva en vez de borrar:

```js
// Cancelar ARCHIVA: el registro se conserva con status 'cancelled' y el
// horario queda libre (ver BLOCKING_STATUSES). Antes esto hacía deleteDoc y
// la cita desaparecía sin rastro, lo que hacía imposible medir la tasa de
// cancelación y confundía una cancelación con un no-show.
function cancelBookingAnd(id, okMsg){
  return window.SWData.markAttendance(id, 'cancel').then(function(){
    showAlert('a-bk-alert', 'ok', okMsg);
  }).catch(function(e){
    console.error('Error cancelando reserva', e);
    showAlert('a-bk-alert', 'err', 'No se pudo cancelar: ' + ((e && e.code) || 'error desconocido') + '.');
  });
}
```

2. En los dos puntos de llamada (2326 y 2810), cambiar `deleteBookingAnd(...)` por `cancelBookingAnd(...)`, el mensaje a `'Cita cancelada.'`, el texto del diálogo a `'¿Cancelar esta cita? Se libera el horario y la cita queda registrada como cancelada.'`, y el `log('Eliminó cita', ...)` a `log('Canceló cita', ...)`.

3. Dejar `delBk()` (2023) y `deleteBookingLocal()` (2035) en su lugar, sin uso, con un comentario que explique por qué siguen ahí.

4. En la tarjeta de la Agenda (~2507), extender el `statusTag` con los estados nuevos, reusando `.a-bk-card-status-tag`:

```js
    } else if(b.status === 'arrived'){
      statusTag = '<span class="a-bk-card-status-tag arrived">Llegó</span>';
    } else if(b.status === 'in_service'){
      statusTag = '<span class="a-bk-card-status-tag inservice">En atención</span>';
    } else if(b.status === 'completed'){
      statusTag = '<span class="a-bk-card-status-tag completed">✓ Atendida</span>';
    } else if(b.status === 'no_show'){
      statusTag = '<span class="a-bk-card-status-tag noshow">No llegó</span>';
    } else if(b.status === 'cancelled'){
      statusTag = '<span class="a-bk-card-status-tag cancelled">Cancelada</span>';
```

y agregar las clases CSS junto a `.a-bk-card-status-tag.declined` (línea 544), con los colores que ya existen como variables. `no_show` y `cancelled` reusan el atenuado de `.a-bk-card.declined` (546-547).

5. Los mismos cuatro botones en el modal de la cita, contra `SWData.markAttendance`, y una sección "Por revisar" con las citas `in_service` cuyo fin planificado pasó hace más de 30 min.

6. Panel Info: input `ai-nudgeLeadMin` junto a `ai-bufferMin` (1181), carga junto a la línea 3590 y guardado junto a 3599:

```html
<label class="a-lbl" for="ai-nudgeLeadMin">Avisar al profesional (min antes)</label>
<input class="a-in" id="ai-nudgeLeadMin" type="number" min="0" step="5">
```

```js
  nudgeLeadMin: parseInt(g('ai-nudgeLeadMin').value, 10) || 0,
```

7. Panel Personal: por cada barbero, mostrar `authEmail` si existe, y un botón "Vincular cuenta" que pida el correo y llame a `SWData.linkStaffAccount(staffId, email)`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test && cd functions && node --test`
Expected: PASS en ambos.

- [ ] **Step 5: Commit**

```bash
git add public/admin/index.html public/js/metrics.js tests/unit/metrics.test.js
git commit -m "feat(admin): marcar asistencia, cancelar sin borrar y avisos configurables"
```

---

### Task 9: Test de navegador y documentación

**Files:**
- Create: `tests/browser/barbero.mjs`
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: Escribir el test de navegador**

Crear `tests/browser/barbero.mjs` copiando la estructura de `tests/browser/dashboard.mjs` (leerlo primero): servidor estático sobre `public/` en un puerto libre, `addInitScript` que stubbea `window.SWAuth` y `window.SWData`, y `page.route` que aborta `**gstatic.com/**` y `**googleapis.com/**`.

Casos: con una cita `confirmed` se ven LLEGÓ / NO LLEGÓ / Iniciar; al tocar LLEGÓ se llama a `markAttendance` con `'arrive'` y la tarjeta pasa a mostrar INICIAR ATENCIÓN; con una `in_service` se ve FINALIZAR y el tiempo transcurrido; una `completed` muestra el resumen y ningún botón; entrar con `?b=X&a=start` dispara `markAttendance` una sola vez y deja la URL limpia.

- [ ] **Step 2: Correr el test**

Run: `node tests/browser/barbero.mjs`
Expected: todos los casos en verde.

- [ ] **Step 3: Actualizar la documentación**

En `CLAUDE.md`, actualizar el bloque "Estado conocido": ya existen transiciones de estado reales (`functions/shared/attendance.js`), `BLOCKING_STATUSES` es el criterio único de horario ocupado, `deleteBooking()` ya no se usa para cancelar, y `public/barbero/` es la PWA del profesional. Agregar `public/barbero/` al mapa de archivos del encabezado.

En `README.md`, documentar: cómo vincular una cuenta de barbero (crear el usuario en la consola → botón "Vincular cuenta" en Personal), dónde se genera la clave VAPID, y que `businessInfo.nudgesEnabled` debe activarse a mano para que los avisos empiecen a salir.

- [ ] **Step 4: Verificación final completa**

Run: `npm test && npm run test:rules && cd functions && node --test && cd .. && node tests/browser/dashboard.mjs && node tests/browser/barbero.mjs`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add tests/browser/barbero.mjs CLAUDE.md README.md
git commit -m "test(barbero): recorrido de la PWA + documentación de la medición"
```

---

## Verificación manual en el emulador (antes de dar P1 por terminado)

1. Vincular una cuenta a un barbero y entrar en `/barbero/` desde el teléfono.
2. Sembrar una cita a 8 minutos. Activar `businessInfo.nudgesEnabled = true`.
3. Disparar `staffAttendanceNudges` a mano y verificar el aviso *"Se acerca la hora de atención con…"*.
4. Tocar la notificación → verifica que abre la cita correcta.
5. Iniciar la atención → `startedAt` con hora del **servidor**, no del teléfono.
6. Esperar la duración planificada → llega *"¿Deseas finalizar la atención?"*.
7. Posponer 10 min → no vuelve a avisar hasta que vence; entonces avisa de nuevo.
8. Finalizar → `actualDur` correcta y `durSource: 'timer'`.
9. Marcar No llegó en otra cita → `getAvailability` vuelve a ofrecer ese horario.
10. Dejar una atención sin cerrar → aparece en "Por revisar" y el scheduler deja de insistir al llegar al tope.
11. Cancelar desde el admin → el documento **sigue existiendo** con `status: 'cancelled'`.
12. Instalar la PWA en un Android y un iPhone (iOS 16.4+, "Agregar a pantalla de inicio") y confirmar que el push llega con la pantalla bloqueada.
