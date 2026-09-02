# Recordatorio de citas (confirmar/declinar) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enviar un recordatorio por email 24h antes de cada cita (ventana rodante, nunca a una hora fija que pueda caer de noche), dejar que el cliente confirme o decline desde un link, y reflejar esa respuesta como badge en la Agenda del admin — reduciendo el no-show sin tocar autogestión completa (modificar/cancelar) ni WhatsApp.

**Architecture:** Módulo puro nuevo (`functions/reminders.js`) decide qué reservas caen en la ventana `[now+24h, now+24h+15min)`; una función `onSchedule` cada 15 min lo usa para enviar el email (nuevo render en `functions/email.js`) y marcar `reminderToken`+`reminderSentAt`. Dos `onCall` nuevas (`respondToBookingReminder`, `getBookingForReminderAction`) resuelven la página nueva `public/confirmar-cita.html`, que exige un tap explícito antes de escribir nada. `computeAvailability` excluye `status:'declined'` para liberar el horario. Todo pasa por Cloud Functions (Admin SDK) — nunca lectura/escritura directa de `bookings` desde el cliente.

**Tech Stack:** Firebase Cloud Functions v2 (Node 22, `onCall`/`onSchedule`), Firestore, Resend (email), vanilla JS sin framework (`public/`), `node:test` para el backend.

**Spec:** `docs/superpowers/specs/2026-09-01-recordatorio-citas-design.md` (aprobado).

---

## File Structure

| File | Cambio |
|---|---|
| `functions/shared/status.js` | Modify — sumar `'confirmed'`/`'declined'` a `BOOKING_STATUSES`. |
| `functions/shared/availability.js` | Modify — `computeAvailability` excluye `status:'declined'` de `barberBusy`. |
| `functions/reminders.js` | Create — lógica pura: `generateReminderToken`, `findBookingsNeedingReminder`. |
| `functions/email.js` | Modify — `renderReminderEmail` + `sendReminderEmail`. |
| `functions/index.js` | Modify — `sendBookingReminders` (`onSchedule`), `respondToBookingReminder` (`onCall`), `getBookingForReminderAction` (`onCall`). |
| `firestore.indexes.json` | Modify — índice compuesto `bookings(status, date)`. |
| `README.md` | Modify — lista manual de deploy (8 → 11 funciones). |
| `CLAUDE.md` | Modify — actualizar "Estado conocido"/PROHIBIDO tras este goal. |
| `public/js/data.js` | Modify — wrappers `getBookingForReminderAction`/`respondToBookingReminder`. |
| `public/confirmar-cita.html` | Create — página de confirmar/declinar. |
| `public/admin/index.html` | Modify — `checkConflict` excluye `declined`; badges de status en la Agenda. |
| `functions/test/status.test.js` | Modify — actualizar caso desactualizado + nuevos casos. |
| `functions/test/availability.test.js` | Modify — casos de exclusión de `declined`. |
| `functions/test/reminders.test.js` | Create. |
| `functions/test/email.test.js` | Modify — casos para `renderReminderEmail`. |

`public/admin/index.html` y `functions/index.js` no tienen cobertura de `node:test` en este repo hoy (son glue code / HTML+JS plano) — se verifican con la corrida manual del Task 10, mismo criterio que ya aplica al resto de `exports.*` en `functions/index.js`.

---

### Task 1: `functions/shared/status.js` — nuevos estados

**Files:**
- Modify: `functions/shared/status.js`
- Test: `functions/test/status.test.js`

- [ ] **Step 1: Actualizar el test desactualizado y agregar los nuevos casos**

El test actual afirma que `'confirmed'` es inválido — eso deja de ser cierto con este goal. Reemplazar todo el archivo:

```js
const test = require('node:test');
const assert = require('node:assert');
const { BOOKING_STATUSES, DEFAULT_BOOKING_STATUS, isValidBookingStatus } = require('../shared/status.js');

test('DEFAULT_BOOKING_STATUS es pending', () => {
  assert.strictEqual(DEFAULT_BOOKING_STATUS, 'pending');
});

test('BOOKING_STATUSES incluye el default', () => {
  assert.ok(BOOKING_STATUSES.indexOf(DEFAULT_BOOKING_STATUS) !== -1);
});

test('BOOKING_STATUSES incluye confirmed y declined (recordatorio de citas, 2026-09)', () => {
  assert.ok(BOOKING_STATUSES.indexOf('confirmed') !== -1);
  assert.ok(BOOKING_STATUSES.indexOf('declined') !== -1);
});

test('isValidBookingStatus acepta pending/confirmed/declined y rechaza cualquier otro valor', () => {
  assert.strictEqual(isValidBookingStatus('pending'), true);
  assert.strictEqual(isValidBookingStatus('confirmed'), true);
  assert.strictEqual(isValidBookingStatus('declined'), true);
  assert.strictEqual(isValidBookingStatus('cancelled'), false);
  assert.strictEqual(isValidBookingStatus(''), false);
  assert.strictEqual(isValidBookingStatus(undefined), false);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd functions && node --test test/status.test.js`
Expected: FAIL — `BOOKING_STATUSES incluye confirmed y declined` y la última prueba fallan (`confirmed`/`declined` todavía no están en la lista).

- [ ] **Step 3: Implementar**

Reemplazar el contenido completo de `functions/shared/status.js`:

```js
// functions/shared/status.js — estado de una reserva.
//
// Con este módulo (etapa B, 2026-09) el repo tiene su primera transición de
// estado real: 'pending' -> 'confirmed' | 'declined', vía el flujo de
// recordatorio de citas (ver functions/reminders.js y
// exports.respondToBookingReminder en functions/index.js). Antes de esto
// 'pending' era el único valor posible y nada lo cambiaba después de crear
// la reserva -- cancelar sigue siendo deleteDoc (destruye el registro), eso
// NO cambió acá: 'declined' es la respuesta del cliente al recordatorio, no
// una cancelación administrativa.
'use strict';

const BOOKING_STATUSES = ['pending', 'confirmed', 'declined'];
const DEFAULT_BOOKING_STATUS = 'pending';

function isValidBookingStatus(status) {
  return BOOKING_STATUSES.indexOf(status) !== -1;
}

module.exports = { BOOKING_STATUSES, DEFAULT_BOOKING_STATUS, isValidBookingStatus };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd functions && node --test test/status.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/shared/status.js functions/test/status.test.js
git commit -m "feat(functions): sumar confirmed/declined a BOOKING_STATUSES"
```

---

### Task 2: `computeAvailability` excluye reservas declinadas

**Files:**
- Modify: `functions/shared/availability.js`
- Test: `functions/test/availability.test.js`

- [ ] **Step 1: Agregar los tests que fallan**

Agregar al final de `functions/test/availability.test.js` (después del último test existente):

```js
test('computeAvailability excluye reservas con status "declined" de barberBusy', () => {
  const bookings = [
    { barberId: 'felipe', date: '2026-07-10', time: '10:00', dur: 50, status: 'declined' },
    { barberId: 'felipe', date: '2026-07-10', time: '15:00', dur: 30, status: 'confirmed' },
  ];
  const staff = [{ id: 'felipe', status: 'active' }];
  const result = computeAvailability({ bookings, staff, barberId: 'felipe' });
  assert.deepStrictEqual(result.barberBusy.felipe, [{ start: '15:00', end: '15:30', kind: 'booking' }]);
});

test('computeAvailability sigue ocupando el slot para status "pending" y "confirmed" (sin cambios)', () => {
  const bookings = [
    { barberId: 'felipe', date: '2026-07-10', time: '10:00', dur: 50, status: 'pending' },
    { barberId: 'felipe', date: '2026-07-10', time: '15:00', dur: 30, status: 'confirmed' },
  ];
  const staff = [{ id: 'felipe', status: 'active' }];
  const result = computeAvailability({ bookings, staff, barberId: 'felipe' });
  assert.deepStrictEqual(result.barberBusy.felipe, [
    { start: '10:00', end: '10:50', kind: 'booking' },
    { start: '15:00', end: '15:30', kind: 'booking' },
  ]);
});
```

- [ ] **Step 2: Correr los tests y verificar que el primero falla**

Run: `cd functions && node --test test/availability.test.js`
Expected: FAIL en `computeAvailability excluye reservas con status "declined"...` (hoy la declinada también queda en `barberBusy`).

- [ ] **Step 3: Implementar el fix**

En `functions/shared/availability.js`, ubicar esta línea (dentro de `computeAvailability`):

```js
  relevant.forEach(b => addBusy(b.barberId, b.time, addMinutesToTime(b.time, b.dur || 0), 'booking'));
```

Reemplazar por:

```js
  // 'declined' libera el horario (recordatorio de citas, 2026-09) --
  // 'pending' y 'confirmed' siguen ocupando el slot igual que antes.
  relevant
    .filter(b => b.status !== 'declined')
    .forEach(b => addBusy(b.barberId, b.time, addMinutesToTime(b.time, b.dur || 0), 'booking'));
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd functions && node --test test/availability.test.js`
Expected: PASS (todos, incluidos los 2 nuevos)

- [ ] **Step 5: Commit**

```bash
git add functions/shared/availability.js functions/test/availability.test.js
git commit -m "fix(functions): computeAvailability excluye reservas declinadas"
```

---

### Task 3: `functions/reminders.js` — lógica pura de la ventana rodante

**Files:**
- Create: `functions/reminders.js`
- Test: `functions/test/reminders.test.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `functions/test/reminders.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const {
  REMINDER_LEAD_MS, REMINDER_WINDOW_MS, generateReminderToken, findBookingsNeedingReminder,
} = require('../reminders.js');

test('generateReminderToken devuelve 32 caracteres hexadecimales', () => {
  const token = generateReminderToken();
  assert.strictEqual(token.length, 32);
  assert.match(token, /^[0-9a-f]{32}$/);
});

test('generateReminderToken no repite el mismo valor entre llamadas', () => {
  assert.notStrictEqual(generateReminderToken(), generateReminderToken());
});

test('findBookingsNeedingReminder incluye una reserva justo en el borde inicial de la ventana (now+24h)', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  // now+24h = 2026-06-11T12:00:00Z -- en America/Santiago, junio es invierno
  // (GMT-4), así que el instante real es 08:00 hora local.
  const bookings = [
    { code: 'SW-1', status: 'pending', date: '2026-06-11', time: '08:00', tz: 'America/Santiago' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].code, 'SW-1');
});

test('findBookingsNeedingReminder excluye una reserva justo en el borde final de la ventana (now+24h+15min)', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  // now+24h+15min = 08:15 local -- la ventana es [start, end), así que el
  // borde final queda afuera.
  const bookings = [
    { code: 'SW-2', status: 'pending', date: '2026-06-11', time: '08:15', tz: 'America/Santiago' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 0);
});

test('findBookingsNeedingReminder excluye reservas antes o después de la ventana', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    { code: 'SW-antes', status: 'pending', date: '2026-06-11', time: '07:59', tz: 'America/Santiago' },
    { code: 'SW-despues', status: 'pending', date: '2026-06-11', time: '08:16', tz: 'America/Santiago' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 0);
});

test('findBookingsNeedingReminder respeta el tz propio de cada reserva, no un tz global', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  // Misma hora de pared (08:00) pero en Punta Arenas (GMT-3 fijo): el
  // instante real es UNA HORA ANTES que en Santiago (GMT-4 en junio) --
  // cae fuera de la ventana [now+24h, now+24h+15min).
  const bookings = [
    { code: 'SW-otra-tz', status: 'pending', date: '2026-06-11', time: '08:00', tz: 'America/Punta_Arenas' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 0);
});

test('findBookingsNeedingReminder excluye reservas que ya tienen reminderSentAt', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    {
      code: 'SW-ya-enviado', status: 'pending', date: '2026-06-11', time: '08:00',
      tz: 'America/Santiago', reminderSentAt: '2026-06-10T12:00:00.000Z',
    },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 0);
});

test('findBookingsNeedingReminder excluye reservas que no están pending', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    { code: 'SW-confirmed', status: 'confirmed', date: '2026-06-11', time: '08:00', tz: 'America/Santiago' },
    { code: 'SW-declined', status: 'declined', date: '2026-06-11', time: '08:00', tz: 'America/Santiago' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 0);
});

test('findBookingsNeedingReminder usa DEFAULT_TZ cuando la reserva no trae tz (reservas de antes de Fase 2)', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    { code: 'SW-sin-tz', status: 'pending', date: '2026-06-11', time: '08:00' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 1);
});

test('REMINDER_WINDOW_MS es 15 minutos (mismo ancho que el intervalo de la corrida programada)', () => {
  assert.strictEqual(REMINDER_WINDOW_MS, 15 * 60 * 1000);
});

test('REMINDER_LEAD_MS es 24 horas', () => {
  assert.strictEqual(REMINDER_LEAD_MS, 24 * 60 * 60 * 1000);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd functions && node --test test/reminders.test.js`
Expected: FAIL con `Cannot find module '../reminders.js'`

- [ ] **Step 3: Implementar**

Crear `functions/reminders.js`:

```js
// functions/reminders.js — lógica pura del recordatorio de citas (24h
// antes, confirmar/declinar). Sin dependencia de firebase-admin: mismo
// patrón que shared/availability.js y shared/timezone.js, testeable con
// node --test sin emulador. functions/index.js hace todo el I/O (query a
// Firestore, envío de email) y le pasa a findBookingsNeedingReminder() los
// datos ya leídos; esta función solo decide.
'use strict';
const crypto = require('crypto');
const { DEFAULT_TZ, zonedInstant } = require('./shared/timezone.js');
const { dateKeyOf } = require('./shared/availability.js');

// Ventana rodante: se envía el recordatorio exactamente 24h antes de la hora
// real de la cita. 15 min de ancho == el intervalo de la corrida programada
// (ver exports.sendBookingReminders, functions/index.js) -- sin huecos ni
// duplicados por diseño; reminderSentAt es el respaldo si una corrida se
// atrasa o se reintenta.
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
const REMINDER_WINDOW_MS = 15 * 60 * 1000;

// 32 hex, alta entropía -- crypto.randomBytes (nunca Math.random, que ya se
// usa para `code` y no es apto como secreto de un link de acción).
function generateReminderToken() {
  return crypto.randomBytes(16).toString('hex');
}

// De un array de reservas candidatas (ya filtradas por Firestore a un rango
// de fechas amplio -- ver sendBookingReminders), decide cuáles caen
// EXACTAMENTE en la ventana [now+24h, now+24h+15min). Firestore no puede
// calcular zonedInstant() en una query, así que ese filtro fino ocurre acá,
// en JS puro. Respeta el `tz` propio de cada reserva -- nunca un tz global
// del negocio -- aunque en la práctica coincidan salvo reservas de antes de
// Fase 2 sin `tz`, que caen a DEFAULT_TZ igual que el resto del código.
function findBookingsNeedingReminder(bookings, now) {
  const windowStart = now.getTime() + REMINDER_LEAD_MS;
  const windowEnd = windowStart + REMINDER_WINDOW_MS;
  return (bookings || []).filter((b) => {
    if (b.status !== 'pending') return false;
    if (b.reminderSentAt) return false;
    const tz = b.tz || DEFAULT_TZ;
    const instant = zonedInstant(dateKeyOf(b.date), b.time, tz);
    const t = instant.getTime();
    return t >= windowStart && t < windowEnd;
  });
}

module.exports = {
  REMINDER_LEAD_MS, REMINDER_WINDOW_MS, generateReminderToken, findBookingsNeedingReminder,
};
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd functions && node --test test/reminders.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/reminders.js functions/test/reminders.test.js
git commit -m "feat(functions): agregar reminders.js (ventana rodante 24h + reminderToken)"
```

---

### Task 4: `functions/email.js` — template del recordatorio

**Files:**
- Modify: `functions/email.js`
- Test: `functions/test/email.test.js`

- [ ] **Step 1: Agregar los tests que fallan**

Agregar al final de `functions/test/email.test.js`:

```js
test('renderReminderEmail incluye ambos botones con code+token+r correctos', () => {
  const { subject, html } = renderReminderEmail(booking, 'abc123token');
  assert.match(subject, /11:00/);
  assert.match(html, /confirmar-cita\.html\?code=SW-AB12345&t=abc123token&r=confirm/);
  assert.match(html, /confirmar-cita\.html\?code=SW-AB12345&t=abc123token&r=decline/);
  assert.match(html, /CONFIRMAR ASISTENCIA/);
  assert.match(html, /NO PODRÉ IR/);
});

test('renderReminderEmail muestra fecha/hora en la zona de la reserva', () => {
  const { html } = renderReminderEmail(booking, 'tok');
  assert.match(html, /MIÉRCOLES/);
  assert.match(html, />10</);
  assert.match(html, /JUNIO 2026/);
  assert.match(html, /11:00 HRS/);
});

test('renderReminderEmail escapa el código para evitar inyección de HTML', () => {
  const { html } = renderReminderEmail({ ...booking, code: '<script>x</script>' }, 'tok');
  assert.doesNotMatch(html, /<script>x/);
});
```

Y actualizar el `require` del principio del archivo:

```js
const { renderClientEmail, renderShopEmail, parseRecipients, assertResendOk } = require('../email.js');
```

por:

```js
const { renderClientEmail, renderShopEmail, renderReminderEmail, parseRecipients, assertResendOk } = require('../email.js');
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd functions && node --test test/email.test.js`
Expected: FAIL — `renderReminderEmail is not a function`

- [ ] **Step 3: Implementar**

En `functions/email.js`, insertar la función nueva justo antes de `function assertResendOk(results) {` (después de `renderShopEmail`):

```js
// Template "SW Studio — Recordatorio de cita": mismo sistema visual que
// renderClientEmail (hero oscuro + tarjeta de detalle + banda de marca +
// footer), pero con dos CTA (Confirmar/Declinar) en vez de un solo botón --
// cierra el flujo de recordatorio 24h antes (ver functions/reminders.js y
// exports.sendBookingReminders en index.js). Cargar el link NUNCA ejecuta
// la acción: ambos apuntan a confirmar-cita.html, que exige un tap
// explícito antes de llamar a respondToBookingReminder -- necesario porque
// clientes de correo (Gmail, Outlook Safe Links) siguen/prefetchean links
// automáticamente por seguridad, y un link que ejecutara la acción con un
// simple GET se dispararía solo.
function renderReminderEmail(b, token) {
  const tz = b.tz || DEFAULT_TZ;
  const subject = `¿Confirmas tu cita de mañana a las ${b.time}? — Scissor White`;
  const d = dateParts(b.date, b.time, tz);
  const confirmUrl = `${SITE_URL}/confirmar-cita.html?code=${encodeURIComponent(b.code)}&t=${encodeURIComponent(token)}&r=confirm`;
  const declineUrl = `${SITE_URL}/confirmar-cita.html?code=${encodeURIComponent(b.code)}&t=${encodeURIComponent(token)}&r=decline`;
  const rows = [
    detailRow('PROFESIONAL', esc(b.barberName)),
    detailRow('SERVICIO', esc(b.svcName)),
    detailRow('CÓDIGO', esc(b.code), true),
  ].join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,500&family=Jost:wght@200;300;400;500;600&display=swap');
  body { margin:0; padding:0; background:#cfccc7; -webkit-font-smoothing:antialiased; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; }
  a { color:inherit; text-decoration:none; }
  @media only screen and (max-width:640px) {
    .sw-wrap { width:100% !important; }
    .sw-col { display:block !important; width:100% !important; }
    .sw-title { font-size:26px !important; letter-spacing:7px !important; }
    .sw-card { padding:26px 18px 22px !important; }
    .sw-datecell { padding:0 0 22px 0 !important; }
    .sw-datebox { width:100% !important; }
    .sw-cta-col { display:block !important; width:100% !important; padding:0 0 10px 0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#cfccc7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#cfccc7;">
<tr><td align="center" style="padding:32px 10px;">

<table role="presentation" class="sw-wrap" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;background:#0e0e0e;border-radius:2px;overflow:hidden;">

  <!-- HERO -->
  <tr><td style="background:#0e0e0e;padding:38px 32px 40px;">
    <img src="${ASSETS_URL}/logo.png" alt="SW Studio" width="64" height="64" style="display:block;border-radius:50%;margin-bottom:28px;">
    <h1 class="sw-title" style="margin:0;font-family:${FONT_SANS};font-weight:300;font-size:33px;letter-spacing:10px;color:#ffffff;line-height:1.4;">TU CITA<br>ES MAÑANA</h1>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:44px;height:1px;background:rgba(255,255,255,.45);font-size:0;line-height:0;padding:0;margin:0;" height="1"></td></tr></table>
    <p style="margin:20px 0 0;font-family:${FONT_SERIF};font-style:italic;font-weight:500;font-size:20px;color:#f2f2f2;line-height:1.3;">¿Nos confirmas tu asistencia?</p>
  </td></tr>

  <!-- DETAIL CARD -->
  <tr><td class="sw-card" style="background:#f3f2f0;padding:34px 30px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td class="sw-col sw-datecell" width="150" valign="top" style="padding:0 22px 0 0;">
          <table role="presentation" width="150" class="sw-datebox" cellpadding="0" cellspacing="0" style="background:#161616;border-radius:14px;">
            <tr><td align="center" style="padding:26px 14px;">
              <div style="font-family:${FONT_SANS};font-weight:400;font-size:12px;letter-spacing:4px;color:#e9e9e9;">${esc(d.weekday)}</div>
              <div style="font-family:${FONT_SANS};font-weight:200;font-size:72px;letter-spacing:2px;line-height:1;color:#ffffff;margin:8px 0 6px;">${esc(d.day)}</div>
              <div style="font-family:${FONT_SANS};font-weight:400;font-size:12px;letter-spacing:3px;color:#e9e9e9;">${esc(d.monthYear)}</div>
              <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:16px auto;"><tr><td style="width:26px;height:1px;background:rgba(255,255,255,.4);font-size:0;line-height:0;" height="1"></td></tr></table>
              <div style="font-family:${FONT_SANS};font-weight:500;font-size:15px;letter-spacing:.5px;color:#ffffff;white-space:nowrap;">${esc(b.time)} HRS</div>
            </td></tr>
          </table>
        </td>
        <td class="sw-col" valign="middle">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
          </table>
        </td>
      </tr>
    </table>

    <!-- CTA: Confirmar / Declinar -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
      <tr>
        <td class="sw-cta-col" width="50%" style="padding-right:6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#161616;border-radius:8px;">
            <tr><td align="center" style="padding:18px 10px;">
              <a href="${confirmUrl}" target="_blank" style="font-family:${FONT_SANS};font-weight:500;font-size:13px;letter-spacing:2px;color:#ffffff;">CONFIRMAR ASISTENCIA</a>
            </td></tr>
          </table>
        </td>
        <td class="sw-cta-col" width="50%" style="padding-left:6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:transparent;border:1px solid #161616;border-radius:8px;">
            <tr><td align="center" style="padding:18px 10px;">
              <a href="${declineUrl}" target="_blank" style="font-family:${FONT_SANS};font-weight:500;font-size:13px;letter-spacing:2px;color:#161616;">NO PODRÉ IR</a>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- BANDA OSCURA -->
  <tr><td style="background:#0e0e0e;padding:30px 32px;">
    <div style="font-family:${FONT_SANS};font-weight:500;font-size:13px;letter-spacing:4px;color:#ffffff;margin-bottom:8px;">VISAGISMO · ESTILO · CONFIANZA</div>
    <p style="margin:0;font-family:${FONT_SERIF};font-weight:400;font-size:16px;color:#b9b7b4;line-height:1.5;">Te esperamos en SW Studio. Si necesitas reagendar, escríbenos por <a href="https://wa.me/56982514114" target="_blank" style="color:#ffffff;text-decoration:underline;">WhatsApp</a>.</p>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#f3f2f0;padding:20px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="44" valign="middle"><img src="${ASSETS_URL}/logo.png" alt="SW Studio" width="44" height="44" style="display:block;border-radius:50%;"></td>
        <td valign="middle" style="padding:0 0 0 18px;font-family:${FONT_SERIF};font-weight:400;font-size:16px;color:#4a4a4a;">Más que cortes, creamos identidad</td>
      </tr>
    </table>
  </td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;
  return { subject, html };
}

async function sendReminderEmail(b, token, { apiKey, fromEmail }) {
  const resend = new Resend(apiKey);
  const { subject, html } = renderReminderEmail(b, token);
  const result = await resend.emails.send({ from: fromEmail, to: b.email, subject, html });
  assertResendOk([result]);
}
```

Y actualizar el `module.exports` al final del archivo:

```js
module.exports = { renderClientEmail, renderShopEmail, sendBookingEmails, parseRecipients, assertResendOk };
```

por:

```js
module.exports = {
  renderClientEmail, renderShopEmail, renderReminderEmail,
  sendBookingEmails, sendReminderEmail, parseRecipients, assertResendOk,
};
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd functions && node --test test/email.test.js`
Expected: PASS (todos, incluidos los 3 nuevos)

- [ ] **Step 5: Correr toda la suite de functions**

Run: `cd functions && node --test`
Expected: PASS (todos — sin regresiones en el resto de módulos)

- [ ] **Step 6: Commit**

```bash
git add functions/email.js functions/test/email.test.js
git commit -m "feat(functions): renderReminderEmail + sendReminderEmail"
```

---

### Task 5: `functions/index.js` — Cloud Functions nuevas

**Files:**
- Modify: `functions/index.js`

Sin `node:test` propio (mismo criterio que el resto de `exports.*` en este archivo — es I/O real contra Firestore/Resend, se verifica con el emulador en el Task 10). El objetivo de este task es dejar el código completo y consistente; la corrida manual es la que confirma que funciona de punta a punta.

- [ ] **Step 1: Actualizar los `require` del principio del archivo**

Ubicar:

```js
const { sendBookingEmails } = require('./email.js');
const { buildPatientUpsert, countClubVisits } = require('./patients.js');
const { computeAvailability, dateKeyOf, dayBoundsOf } = require('./shared/availability.js');
const { resolveCreateBooking } = require('./createBooking.js');
const { resolveBusinessTz, resolveBufferMin } = require('./shared/timezone.js');
const { searchPlaceId, fetchPlaceDetails, isFresh } = require('./googleReviews.js');
```

Reemplazar por:

```js
const { sendBookingEmails, sendReminderEmail } = require('./email.js');
const { buildPatientUpsert, countClubVisits } = require('./patients.js');
const { computeAvailability, dateKeyOf, dayBoundsOf } = require('./shared/availability.js');
const { resolveCreateBooking } = require('./createBooking.js');
const { resolveBusinessTz, resolveBufferMin, dateKeyInZone } = require('./shared/timezone.js');
const { searchPlaceId, fetchPlaceDetails, isFresh } = require('./googleReviews.js');
const { REMINDER_LEAD_MS, REMINDER_WINDOW_MS, generateReminderToken, findBookingsNeedingReminder } = require('./reminders.js');
```

- [ ] **Step 2: Agregar las tres funciones nuevas**

Insertar el siguiente bloque **inmediatamente después** de `exports.onScheduleBlockWritten` (después de su llave de cierre `);`) y **antes** del comentario `// ══ RESEÑAS DE GOOGLE ══`:

```js
// ══ RECORDATORIO DE CITAS (confirmar/declinar) ══
// Ventana rodante: se envía exactamente 24h antes de la hora real de cada
// cita (ver functions/reminders.js). Cada corrida cubre 15 minutos, el
// mismo ancho que el intervalo del schedule -- sin huecos ni duplicados por
// diseño; reminderSentAt es el respaldo si una corrida se atrasa o se
// reintenta. Mismo criterio de resiliencia que refreshGoogleReviews: un
// fallo individual no debe tirar la función a estado de error ni bloquear
// el resto de la corrida.
exports.sendBookingReminders = onSchedule(
  { schedule: 'every 15 minutes', region: 'southamerica-east1', secrets: [RESEND_API_KEY, FROM_EMAIL] },
  async () => {
    const db = getFirestore(app);
    const now = new Date();
    const businessInfoSnap = await db.collection('businessInfo').doc('main').get();
    const businessTz = resolveBusinessTz(businessInfoSnap.exists ? businessInfoSnap.data() : null);

    // Ventana amplia por fecha calendario (puede spanear dos días si la
    // ventana de 15 min cruza medianoche local) -- el filtro fino por
    // instante real ocurre en findBookingsNeedingReminder(), en JS puro.
    // Mismo patrón de "query amplia por date + filtro preciso en memoria"
    // que ya usa createBooking.js.
    const windowStart = new Date(now.getTime() + REMINDER_LEAD_MS);
    const windowEnd = new Date(windowStart.getTime() + REMINDER_WINDOW_MS);
    const startDateKey = dateKeyInZone(windowStart, businessTz);
    const endDateKey = dateKeyInZone(windowEnd, businessTz);
    const { end: endBound } = dayBoundsOf(endDateKey);

    const snap = await db.collection('bookings')
      .where('status', '==', 'pending')
      .where('date', '>=', startDateKey)
      .where('date', '<', endBound)
      .get();

    const items = snap.docs
      .map((d) => ({ ref: d.ref, data: d.data() }))
      .filter((item) => !item.data.reminderSentAt);
    const toRemindData = findBookingsNeedingReminder(items.map((item) => item.data), now);
    const toRemind = items.filter((item) => toRemindData.includes(item.data));

    for (const item of toRemind) {
      const b = item.data;
      // Sin email no hay a quién recordarle -- mismo criterio que
      // onBookingCreated (una reserva tomada por teléfono puede no traer
      // email).
      if (!b.email) continue;
      const token = generateReminderToken();
      try {
        await sendReminderEmail(b, token, {
          apiKey: RESEND_API_KEY.value(),
          fromEmail: FROM_EMAIL.value(),
        });
        await item.ref.update({ reminderToken: token, reminderSentAt: new Date().toISOString() });
        logger.info('Recordatorio enviado', { code: b.code });
      } catch (err) {
        logger.error('Fallo al enviar recordatorio', err);
        try {
          await db.collection('adminLog').add({
            action: 'reminder_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
          });
        } catch (err2) {
          logger.error('Fallo al registrar adminLog de reminder_failed', err2);
        }
        // No relanzar: un fallo individual no debe abortar el resto de la
        // corrida -- la reserva queda elegible para reintento en 15 min
        // porque reminderSentAt nunca se escribió.
      }
    }
  }
);

// respondToBookingReminder: el cliente nunca puede leer ni escribir
// `bookings` directo (ver firestore.rules) -- esta función valida el
// reminderToken (búsqueda por el TOKEN, no por `code`: es único por
// diseño, así la seguridad no depende de que `code` lo sea) y aplica la
// transición de estado. Idempotente: un segundo tap del mismo link no
// rompe nada, cae en la rama `already`.
exports.respondToBookingReminder = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const data = request.data || {};
    const code = typeof data.code === 'string' ? data.code.trim() : '';
    const token = typeof data.token === 'string' ? data.token.trim() : '';
    const action = data.action;
    if (!token || (action !== 'confirm' && action !== 'decline')) {
      throw new HttpsError('invalid-argument', 'Datos inválidos.');
    }

    const db = getFirestore(app);
    const snap = await db.collection('bookings').where('reminderToken', '==', token).limit(1).get();
    // Mismo mensaje genérico si el token no existe o si el `code` no calza
    // con el que sí se encontró -- no revelar cuál de las dos cosas falló.
    if (snap.empty || snap.docs[0].data().code !== code) {
      throw new HttpsError('not-found', 'No encontramos esa reserva.');
    }

    const doc = snap.docs[0];
    const b = doc.data();
    if (b.status !== 'pending') {
      return { ok: true, already: true, status: b.status };
    }

    const status = action === 'confirm' ? 'confirmed' : 'declined';
    await doc.ref.update({ status, respondedAt: new Date().toISOString() });
    return { ok: true, already: false, status };
  }
);

// getBookingForReminderAction: lectura de solo lo necesario para pintar
// confirmar-cita.html antes de que el cliente decida -- nunca devuelve
// reminderToken de vuelta. Mismo criterio de búsqueda por reminderToken que
// respondToBookingReminder.
exports.getBookingForReminderAction = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const data = request.data || {};
    const code = typeof data.code === 'string' ? data.code.trim() : '';
    const token = typeof data.token === 'string' ? data.token.trim() : '';
    if (!token) throw new HttpsError('invalid-argument', 'Datos inválidos.');

    const db = getFirestore(app);
    const snap = await db.collection('bookings').where('reminderToken', '==', token).limit(1).get();
    if (snap.empty || snap.docs[0].data().code !== code) {
      throw new HttpsError('not-found', 'No encontramos esa reserva.');
    }

    const b = snap.docs[0].data();
    return {
      code: b.code, date: b.date, time: b.time, svcName: b.svcName,
      barberName: b.barberName, status: b.status,
    };
  }
);
```

- [ ] **Step 3: Correr toda la suite de functions (confirmar que el archivo sigue cargando sin errores de sintaxis)**

Run: `cd functions && node --test`
Expected: PASS (todos — `node --test` ejecuta `require('../index.js')` indirectamente en ningún test hoy, pero un error de sintaxis en `index.js` rompería igual el arranque de Node si algún test lo importara; para chequear sintaxis explícitamente:)

Run: `cd functions && node --check index.js`
Expected: sin salida (sintaxis válida)

- [ ] **Step 4: Commit**

```bash
git add functions/index.js
git commit -m "feat(functions): sendBookingReminders, respondToBookingReminder, getBookingForReminderAction"
```

---

### Task 6: Índice compuesto + documentación de deploy

**Files:**
- Modify: `firestore.indexes.json`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Agregar el índice compuesto candidato**

En `firestore.indexes.json`, dentro del array `indexes`, agregar (después del índice existente de `scheduleBlocks`):

```json
    { "collectionGroup": "bookings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "date", "order": "ASCENDING" }
    ]}
```

(la query de `sendBookingReminders` combina `where('status','==',...)` con un rango en `date` — combinación de igualdad + rango que Firestore normalmente exige indexar. Si al desplegar a staging el emulador/consola pide un índice con otra forma exacta, usar el que indique el link de error de Firebase en vez de este — mismo criterio que ya pasó con el índice de `scheduleBlocks`, ver `f69b583` en el historial).

- [ ] **Step 2: Actualizar la lista manual de deploy en README.md**

Ubicar (sección `## Deploy`):

```bash
# Hosting + reglas/índices de Firestore + solo las funciones de este repo
# (nombres explícitos: evita que el CLI ofrezca borrar `api`, ver nota arriba)
firebase deploy --project scissor-white --only \
  hosting,firestore:rules,firestore:indexes,\
functions:onBookingCreated,functions:createBooking,functions:getClubStatus,\
functions:getAvailability,functions:onBookingWritten,functions:onScheduleBlockWritten,\
functions:refreshGoogleReviews,functions:syncGoogleReviews
```

Reemplazar por:

```bash
# Hosting + reglas/índices de Firestore + solo las funciones de este repo
# (nombres explícitos: evita que el CLI ofrezca borrar `api`, ver nota arriba)
firebase deploy --project scissor-white --only \
  hosting,firestore:rules,firestore:indexes,\
functions:onBookingCreated,functions:createBooking,functions:getClubStatus,\
functions:getAvailability,functions:onBookingWritten,functions:onScheduleBlockWritten,\
functions:refreshGoogleReviews,functions:syncGoogleReviews,\
functions:sendBookingReminders,functions:respondToBookingReminder,functions:getBookingForReminderAction
```

Y la línea justo debajo:

```
Son **8 nombres — uno por cada `exports.` de `functions/index.js`**. Antes de
```

por:

```
Son **11 nombres — uno por cada `exports.` de `functions/index.js`**. Antes de
```

- [ ] **Step 3: Verificar el conteo con el grep que el propio README recomienda**

Run: `grep -oE "^exports\.[a-zA-Z]+" functions/index.js | wc -l`
Expected: `11`

- [ ] **Step 4: Actualizar `CLAUDE.md`**

Ubicar:

```
  Estado: functions/shared/status.js centraliza DEFAULT_BOOKING_STATUS
  ('pending'), pero sigue sin existir ninguna transición de estado en el
  repo -- eso no cambió con este goal.
```

Reemplazar por:

```
  Estado: functions/shared/status.js centraliza BOOKING_STATUSES
  ('pending'/'confirmed'/'declined') y DEFAULT_BOOKING_STATUS ('pending').
  Primera transición de estado real del repo: pending -> confirmed/declined,
  vía el recordatorio de citas (functions/reminders.js,
  exports.respondToBookingReminder en functions/index.js). Cancelar sigue
  siendo deleteDoc (destruye el registro) -- eso no cambió con este goal.
```

Ubicar:

```
- computeAvailability no filtra por status.
```

Reemplazar por:

```
- computeAvailability excluye status:'declined' de barberBusy (recordatorio
  de citas, 2026-09); 'pending' y 'confirmed' siguen ocupando el horario
  igual que antes.
```

Ubicar:

```
- Despliegue manual con ocho nombres de función a mano; createBooking ya quedó
  fuera de esa lista una vez y se congeló en silencio.
```

Reemplazar por:

```
- Despliegue manual con once nombres de función a mano (ver README.md);
  createBooking ya quedó fuera de esa lista una vez y se congeló en silencio.
```

Ubicar (dentro de `PROHIBIDO en todas las etapas 0 y A:`):

```
- Migrar a React, Vue o cualquier framework.
- Reescribir los HTML monolíticos: sustituir funciones, no reestructurar.
- Implementar holds, recordatorios, autogestión o WhatsApp (eso es etapa B y C).
- Tocar el módulo de reseñas de Google.
- Cambiar el diseño visual.
- Desplegar a producción. Todo va a staging; los despliegues los hace Aldo.
```

Reemplazar por:

```
- Migrar a React, Vue o cualquier framework.
- Reescribir los HTML monolíticos: sustituir funciones, no reestructurar.
- Tocar el módulo de reseñas de Google.
- Cambiar el diseño visual.
- Desplegar a producción. Todo va a staging; los despliegues los hace Aldo.

Nota (2026-09-01): el proyecto avanzó a etapa B/C -- "holds, recordatorios,
autogestión o WhatsApp" dejó de estar prohibido. El recordatorio de citas
(confirmar/declinar 24h antes) ya está implementado (ver
docs/superpowers/specs/2026-09-01-recordatorio-citas-design.md); holds,
autogestión completa (modificar/cancelar) y WhatsApp como canal siguen sin
construirse, pero ya no están bloqueados por etapa.
```

- [ ] **Step 5: Commit**

```bash
git add firestore.indexes.json README.md CLAUDE.md
git commit -m "docs: actualizar deploy, índices y CLAUDE.md para el recordatorio de citas"
```

---

### Task 7: `public/js/data.js` — wrappers de la capa de datos

**Files:**
- Modify: `public/js/data.js`

`public/js/data.js` es la única capa que habla con Firestore/Storage/Functions (invariante del proyecto) — `confirmar-cita.html` no debe llamar `httpsCallable` directo, pasa por acá.

- [ ] **Step 1: Agregar los dos wrappers**

Insertar después de `getAvailability` (antes de `subscribeAvailability`):

```js
// Recordatorio de citas: lee el resumen de una reserva para pintar
// confirmar-cita.html, vía Cloud Function (el cliente no puede leer
// `bookings` directo -- ver firestore.rules). Nunca devuelve reminderToken.
async function getBookingForReminderAction(code, token) {
  const call = httpsCallable(functions, 'getBookingForReminderAction');
  const { data } = await call({ code, token });
  return data; // { code, date, time, svcName, barberName, status }
}

// Aplica la respuesta del cliente (confirmar/declinar) al recordatorio.
// `action` es 'confirm' | 'decline'. Idempotente: un segundo tap del mismo
// link devuelve { already: true, status } sin volver a escribir.
async function respondToBookingReminder(code, token, action) {
  const call = httpsCallable(functions, 'respondToBookingReminder');
  const { data } = await call({ code, token, action });
  return data; // { ok, already, status }
}
```

- [ ] **Step 2: Sumarlas a `window.SWData` y al `export`**

Ubicar:

```js
window.SWData = {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBooking, deleteBooking, subscribeBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus, getAvailability, subscribeAvailability,
  loadSiteImages, saveSiteImage, deleteSiteImage,
  getScheduleBlocks, saveScheduleBlock, deleteScheduleBlock,
  loadGoogleReviews, saveManualReviews, syncGoogleReviews,
};
export {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBooking, deleteBooking, subscribeBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus, getAvailability, subscribeAvailability,
  loadSiteImages, saveSiteImage, deleteSiteImage,
  getScheduleBlocks, saveScheduleBlock, deleteScheduleBlock,
  loadGoogleReviews, saveManualReviews, syncGoogleReviews,
};
```

Reemplazar ambos bloques (agregando `getBookingForReminderAction, respondToBookingReminder` a cada uno):

```js
window.SWData = {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBooking, deleteBooking, subscribeBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus, getAvailability, subscribeAvailability,
  loadSiteImages, saveSiteImage, deleteSiteImage,
  getScheduleBlocks, saveScheduleBlock, deleteScheduleBlock,
  loadGoogleReviews, saveManualReviews, syncGoogleReviews,
  getBookingForReminderAction, respondToBookingReminder,
};
export {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBooking, deleteBooking, subscribeBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus, getAvailability, subscribeAvailability,
  loadSiteImages, saveSiteImage, deleteSiteImage,
  getScheduleBlocks, saveScheduleBlock, deleteScheduleBlock,
  loadGoogleReviews, saveManualReviews, syncGoogleReviews,
  getBookingForReminderAction, respondToBookingReminder,
};
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check public/js/data.js`
Expected: sin salida (sintaxis válida — es un módulo ES, `node --check` valida la sintaxis igual aunque el `import`/`export` no se resuelva en Node puro)

- [ ] **Step 4: Commit**

```bash
git add public/js/data.js
git commit -m "feat(web): wrappers de data.js para el recordatorio de citas"
```

---

### Task 8: `public/confirmar-cita.html` — página nueva

**Files:**
- Create: `public/confirmar-cita.html`

- [ ] **Step 1: Crear el archivo completo**

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Confirmar cita — SW Studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,500&family=Jost:wght@200;300;400;500;600&display=swap" rel="stylesheet">
<style>
  :root{ --bg:#0e0e0e; --card:#f3f2f0; --txt:#161616; --meta:#6b6b6b; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);font-family:'Jost',Arial,sans-serif;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{max-width:420px;width:100%;background:var(--card);color:var(--txt);border-radius:14px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.35)}
  .hero{background:var(--bg);color:#fff;padding:32px 28px 26px;text-align:center}
  .hero h1{margin:0;font-weight:300;font-size:22px;letter-spacing:4px;font-family:'Jost',sans-serif}
  .body{padding:28px}
  .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #e5e4e1;font-family:'Cormorant Garamond',serif;font-size:17px}
  .row:last-child{border-bottom:none}
  .row .lbl{font-family:'Jost',sans-serif;font-size:11px;letter-spacing:2px;color:var(--meta);text-transform:uppercase}
  .actions{margin-top:24px}
  button{width:100%;padding:16px;border:none;border-radius:8px;font-family:'Jost',sans-serif;font-weight:500;font-size:14px;letter-spacing:2px;cursor:pointer}
  .btn-confirm{background:var(--bg);color:#fff}
  .btn-decline{background:transparent;color:var(--bg);border:1px solid var(--bg)}
  .msg{font-family:'Cormorant Garamond',serif;font-size:19px;text-align:center;padding:12px 0}
  .err{color:#C44545}
  [hidden]{display:none!important}
</style>
</head>
<body>
<div class="card">
  <div class="hero"><h1>SW STUDIO</h1></div>
  <div class="body">
    <div id="cc-loading" class="msg">Cargando tu reserva…</div>
    <div id="cc-error" class="msg err" hidden></div>
    <div id="cc-summary" hidden>
      <div class="row"><span class="lbl">Fecha</span><span id="cc-date"></span></div>
      <div class="row"><span class="lbl">Hora</span><span id="cc-time"></span></div>
      <div class="row"><span class="lbl">Servicio</span><span id="cc-svc"></span></div>
      <div class="row"><span class="lbl">Profesional</span><span id="cc-barber"></span></div>
      <div class="actions">
        <button id="cc-action-btn"></button>
      </div>
    </div>
    <div id="cc-done" class="msg" hidden></div>
  </div>
</div>
<script type="module">
  import { getBookingForReminderAction, respondToBookingReminder } from './js/data.js';

  const params = new URLSearchParams(location.search);
  const code = params.get('code') || '';
  const token = params.get('t') || '';
  const r = params.get('r') === 'decline' ? 'decline' : 'confirm';

  const els = {
    loading: document.getElementById('cc-loading'),
    error: document.getElementById('cc-error'),
    summary: document.getElementById('cc-summary'),
    done: document.getElementById('cc-done'),
    date: document.getElementById('cc-date'),
    time: document.getElementById('cc-time'),
    svc: document.getElementById('cc-svc'),
    barber: document.getElementById('cc-barber'),
    btn: document.getElementById('cc-action-btn'),
  };

  function showError(msg) {
    els.loading.hidden = true;
    els.error.hidden = false;
    els.error.textContent = msg;
  }

  async function init() {
    if (!code || !token) {
      showError('Este link no es válido.');
      return;
    }
    let booking;
    try {
      booking = await getBookingForReminderAction(code, token);
    } catch (e) {
      showError('No encontramos esa reserva. El link puede haber expirado.');
      return;
    }

    els.loading.hidden = true;

    if (booking.status !== 'pending') {
      els.done.hidden = false;
      els.done.textContent = booking.status === 'confirmed'
        ? 'Ya habías confirmado esta cita. ¡Te esperamos!'
        : booking.status === 'declined'
          ? 'Ya habías avisado que no podías ir a esta cita.'
          : 'Esta cita ya no admite cambios desde este link.';
      return;
    }

    els.date.textContent = booking.date;
    els.time.textContent = booking.time + ' hrs';
    els.svc.textContent = booking.svcName || '';
    els.barber.textContent = booking.barberName || '';
    els.summary.hidden = false;

    els.btn.textContent = r === 'confirm' ? 'SÍ, CONFIRMO MI ASISTENCIA' : 'NO PODRÉ IR, DECLINAR CITA';
    els.btn.className = r === 'confirm' ? 'btn-confirm' : 'btn-decline';
    els.btn.addEventListener('click', onAct, { once: true });
  }

  async function onAct() {
    els.btn.disabled = true;
    els.btn.textContent = 'Enviando…';
    try {
      await respondToBookingReminder(code, token, r);
      els.summary.hidden = true;
      els.done.hidden = false;
      els.done.textContent = r === 'confirm'
        ? '¡Gracias, te esperamos!'
        : 'Listo, liberamos tu horario.';
    } catch (e) {
      showError('No pudimos registrar tu respuesta. Intenta de nuevo o escríbenos por WhatsApp.');
    }
  }

  init();
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/confirmar-cita.html
git commit -m "feat(web): página confirmar-cita.html (confirmar/declinar recordatorio)"
```

---

### Task 9: `public/admin/index.html` — badges en la Agenda + fix de `checkConflict`

**Files:**
- Modify: `public/admin/index.html`

- [ ] **Step 1: `checkConflict` excluye reservas declinadas**

Ubicar (dentro de `function checkConflict`):

```js
  for(var i=0; i<bookings.length; i++){
    var b = bookings[i];
    if(ignoreId && b.code === ignoreId) continue;
    if(b.barberId !== barberId) continue;
```

Reemplazar por:

```js
  for(var i=0; i<bookings.length; i++){
    var b = bookings[i];
    if(ignoreId && b.code === ignoreId) continue;
    if(b.status === 'declined') continue;
    if(b.barberId !== barberId) continue;
```

- [ ] **Step 2: CSS de los badges de status**

Ubicar (justo después de la regla `.a-bk-card-over-tag{...}`, línea ~523):

```css
.a-bk-card-over-tag{font-family:'Barlow Condensed',sans-serif;font-size:8px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#fff;background:var(--a-warn);padding:1px 5px;border-radius:3px}
```

Agregar inmediatamente después (misma indentación, sin tocar la línea de arriba):

```css
.a-bk-card-status-tag{font-family:'Barlow Condensed',sans-serif;font-size:8px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#fff;padding:1px 5px;border-radius:3px}
.a-bk-card-status-tag.confirmed{background:var(--a-ok)}
.a-bk-card-status-tag.declined{background:var(--a-err)}
.a-bk-card-status-tag.noresponse{background:var(--a-warn)}
.a-bk-card.declined{opacity:.55}
.a-bk-card.declined .a-bk-card-name{text-decoration:line-through}
```

- [ ] **Step 3: Agregar el badge al render de cada tarjeta en `renderCalendar`**

Ubicar este bloque completo (dentro de `renderCalendar`, en el `.map` que arma `cardsHtml`):

```js
    var inner;
    if(dens === ' mini'){
      inner = '<div class="a-bk-card-line">'+
                '<span class="a-bk-card-name">'+esc(b.name||'Cliente')+'</span>'+
                '<span class="a-bk-card-time">'+esc(b.time||'')+'</span>'+
              '</div>';
    } else if(dens === ' compact'){
      inner = '<div class="a-bk-card-name">'+esc(b.name||'Cliente')+'</div>'+
              '<div class="a-bk-card-line">'+
                '<span class="a-bk-card-time">'+esc(b.time||'')+' · '+e.dur+'min</span>'+
                (b.over ? '<span class="a-bk-card-over-tag">!</span>' : '')+
              '</div>';
    } else {
      inner = '<div class="a-bk-card-name">'+esc(b.name||'Cliente')+'</div>'+
              '<div class="a-bk-card-svc">'+esc(b.svcName||'')+'</div>'+
              '<div class="a-bk-card-meta">'+
                '<span class="a-bk-card-time">'+esc(b.time||'')+' · '+e.dur+'min</span>'+
                (b.over ? '<span class="a-bk-card-over-tag">Sobrecupo</span>' : '')+
              '</div>';
    }
    return '<div class="a-bk-card'+(b.over?' over':'')+dens+'" style="'+style+'" '+
             'data-code="'+esc(b.code)+'" '+
             'title="'+esc((b.time||'')+' · '+(b.name||'Cliente')+' · '+(b.svcName||'')+' · '+bn)+'">'+
             inner+
           '</div>';
```

Reemplazar por:

```js
    // Badge de status del recordatorio de citas: confirmada/declinada gana
    // sobre "sin respuesta" -- reminderSentAt queda seteado para siempre
    // una vez enviado el recordatorio, así que sin este orden de prioridad
    // una cita ya respondida seguiría mostrando "Sin respuesta" además de
    // su badge real.
    var statusTag = '';
    if(b.status === 'confirmed'){
      statusTag = '<span class="a-bk-card-status-tag confirmed">✓ Confirmada</span>';
    } else if(b.status === 'declined'){
      statusTag = '<span class="a-bk-card-status-tag declined">✗ Declinada</span>';
    } else if(b.reminderSentAt){
      statusTag = '<span class="a-bk-card-status-tag noresponse">Sin respuesta</span>';
    }
    var inner;
    if(dens === ' mini'){
      inner = '<div class="a-bk-card-line">'+
                '<span class="a-bk-card-name">'+esc(b.name||'Cliente')+'</span>'+
                '<span class="a-bk-card-time">'+esc(b.time||'')+'</span>'+
              '</div>';
    } else if(dens === ' compact'){
      inner = '<div class="a-bk-card-name">'+esc(b.name||'Cliente')+'</div>'+
              '<div class="a-bk-card-line">'+
                '<span class="a-bk-card-time">'+esc(b.time||'')+' · '+e.dur+'min</span>'+
                (b.over ? '<span class="a-bk-card-over-tag">!</span>' : '')+
                statusTag+
              '</div>';
    } else {
      inner = '<div class="a-bk-card-name">'+esc(b.name||'Cliente')+'</div>'+
              '<div class="a-bk-card-svc">'+esc(b.svcName||'')+'</div>'+
              '<div class="a-bk-card-meta">'+
                '<span class="a-bk-card-time">'+esc(b.time||'')+' · '+e.dur+'min</span>'+
                (b.over ? '<span class="a-bk-card-over-tag">Sobrecupo</span>' : '')+
                statusTag+
              '</div>';
    }
    return '<div class="a-bk-card'+(b.over?' over':'')+(b.status==='declined'?' declined':'')+dens+'" style="'+style+'" '+
             'data-code="'+esc(b.code)+'" '+
             'title="'+esc((b.time||'')+' · '+(b.name||'Cliente')+' · '+(b.svcName||'')+' · '+bn)+'">'+
             inner+
           '</div>';
```

- [ ] **Step 4: Verificar sintaxis del archivo**

`public/admin/index.html` no es JS puro (es HTML con `<script>` inline), así que no se puede correr `node --check` directo sobre él. Verificar en su lugar:

Run: `grep -c "function checkConflict" public/admin/index.html`
Expected: `1` (la función sigue definida una sola vez, sin duplicados accidentales por el edit)

- [ ] **Step 5: Commit**

```bash
git add public/admin/index.html
git commit -m "feat(admin): badges de confirmar/declinar en la Agenda + checkConflict excluye declined"
```

---

### Task 10: Verificación final (suite completa + prueba manual en emulador)

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Correr toda la suite de `functions`**

Run: `cd functions && node --test`
Expected: PASS — todos los tests (los 130 originales + los nuevos de los Tasks 1-4)

- [ ] **Step 2: Confirmar el conteo de funciones exportadas**

Run: `grep -oE "^exports\.[a-zA-Z]+" functions/index.js`
Expected: 11 líneas, incluyendo `exports.sendBookingReminders`, `exports.respondToBookingReminder`, `exports.getBookingForReminderAction`

- [ ] **Step 3: Levantar los emuladores**

Run: `firebase emulators:start` (dejar corriendo; usar otra terminal para los pasos siguientes)

- [ ] **Step 4: Crear una reserva de prueba dentro de la ventana de recordatorio**

Desde la UI del emulador de Firestore (`http://localhost:4000/firestore`) o desde el widget público en `http://localhost:5000`, crear una reserva con `date`/`time` tales que su instante real (considerando `businessInfo.tz`, o `America/Santiago` si no hay `businessInfo/main`) caiga dentro de `[ahora+24h, ahora+24h+15min)`. Confirmar que el doc tiene `status:'pending'` y un `email` válido.

- [ ] **Step 5: Invocar `sendBookingReminders` manualmente**

Run: `cd functions && firebase functions:shell`, luego dentro del shell: `sendBookingReminders()`

Expected: en la consola del shell no hay error; en Firestore (`http://localhost:4000/firestore`) el doc de la reserva ahora tiene `reminderToken` (32 hex) y `reminderSentAt`. Si el emulador de Resend/red no está disponible, verificar en su lugar el log de la función en la terminal de `emulators:start` (debe mostrar el intento de envío, no una excepción no capturada).

- [ ] **Step 6: Confirmar desde `confirmar-cita.html`**

Abrir `http://localhost:5000/confirmar-cita.html?code=<code de la reserva>&t=<reminderToken>&r=confirm`. Verificar:
- La página muestra el resumen (fecha/hora/servicio/barbero) sin ejecutar nada solo con cargar.
- Al tocar el botón, el doc en Firestore pasa a `status:'confirmed'` con `respondedAt` seteado.
- Recargar la misma URL: debe mostrar "Ya habías confirmado esta cita", sin volver a escribir.

- [ ] **Step 7: Declinar una segunda reserva**

Repetir Steps 4-5 con una segunda reserva de prueba, luego abrir `confirmar-cita.html?...&r=decline`, tocar el botón, y verificar:
- `status:'declined'` en el doc.
- La vista `availability/{fecha}` (o `getAvailability` para esa fecha/barbero) ya no marca ese horario como ocupado.

- [ ] **Step 8: Verificar los badges en la Agenda del admin**

Iniciar sesión en `http://localhost:5000/admin/` (usuario admin del emulador) y abrir la Agenda del día de ambas reservas de prueba. Verificar:
- La reserva confirmada muestra el badge verde "✓ Confirmada".
- La reserva declinada muestra el badge rojo "✗ Declinada", el nombre tachado, y ya no aparece como conflicto al intentar crear una cita nueva en ese mismo horario/barbero.
- Una tercera reserva de prueba con `reminderSentAt` seteado pero sin responder muestra el badge ámbar "Sin respuesta".

- [ ] **Step 9: Probar el caso de error (token inválido)**

Abrir `confirmar-cita.html?code=SW-0000&t=tokenquenoexiste&r=confirm`. Verificar que se muestra el mensaje de error genérico ("No encontramos esa reserva...") sin distinguir si el problema fue el código o el token.

- [ ] **Step 10: Detener los emuladores y hacer el commit final si hubo ajustes**

Si algún paso manual reveló un ajuste necesario (ej. el índice compuesto real difiere del propuesto en el Task 6), aplicarlo y commitear por separado antes de cerrar el goal.
