# Autogestión de citas (confirmar / modificar / cancelar) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a client confirm attendance, modify, or cancel their own booking via a tokenized link (no login), with backup emails for cancel/modify and a 24h reminder — matching `docs/superpowers/specs/2026-07-30-autogestion-citas-design.md` (Spec 1 of 2; push-to-admin is Spec 2, out of scope here).

**Architecture:** All client actions go through new `onCall` Cloud Functions (Admin SDK, bypasses Firestore rules — `bookings` stays admin-only for read/update). A high-entropy `manageToken` (not the visible `code`) authorizes each action. Business rules (3h cutoff, 2-modification cap) live in a new pure module `functions/bookingRules.js`, reused by the Cloud Functions, the reminder scheduler, and their tests. A new static page `public/mi-reserva.html` is the client's landing page; "Modificar cita" reuses the existing booking widget in `public/index.html` via an edit-mode flag.

**Tech Stack:** Firebase Cloud Functions v2 (Node 22, `onCall`/`onSchedule`), Firestore, Resend (email), vanilla JS (no framework) for `public/`, `node:test` for backend unit tests.

---

## File Structure

| File | Change |
|---|---|
| `functions/bookingRules.js` | **Create.** Pure business rules: Chile-timezone datetime math, `canCancel`, `canModify`. |
| `functions/availability.js` | **Modify.** Exclude `status:'cancelled'` bookings from busy-time calculation. |
| `functions/email.js` | **Modify (full rewrite).** Extract a shared HTML shell; add `renderCancelEmail`, `renderModifyEmail`, `renderReminderEmail`, `renderManageButtons`, and their `send*` wrappers. |
| `functions/reminders.js` | **Create.** Pure reminder-window/query logic (`reminderWindow`, `candidateDays`, `runReminders`), testable without Firebase. |
| `functions/index.js` | **Modify.** Register `getBookingForManage`, `confirmBookingAttendance`, `cancelBooking`, `modifyBooking` (onCall) and `sendBookingReminders` (onSchedule, calls into `reminders.js`). |
| `functions/test/bookingRules.test.js` | **Create.** |
| `functions/test/reminders.test.js` | **Create.** |
| `functions/test/availability.test.js` | **Modify.** Add cancelled-exclusion case. |
| `functions/test/email.test.js` | **Modify.** Add cases for the 3 new renders + shell refactor regression coverage. |
| `firestore.rules` | **Modify.** Require `manageToken` on booking `create`. |
| `public/index.html` | **Modify.** Token generation (public + admin booking creation), `checkConflict` cancelled-exclusion, booking-widget edit-mode (prefill + modify submit branch), Agenda cancelled/confirmed styling. |
| `public/js/data.js` | **Modify.** Add `getBookingForManage`, `confirmBookingAttendance`, `cancelBooking`, `modifyBooking` wrappers. |
| `public/mi-reserva.html` | **Create.** Client self-service landing page. |
| `public/js/manage-booking.js` | **Create.** Logic for `mi-reserva.html`. |

---

### Task 1: `bookingRules.js` — business rules (TDD)

**Files:**
- Create: `functions/bookingRules.js`
- Test: `functions/test/bookingRules.test.js`

- [ ] **Step 1: Write the failing test**

```js
// functions/test/bookingRules.test.js
const test = require('node:test');
const assert = require('node:assert');
const {
  santiagoWallTimeToUtc, appointmentInstant, hoursUntilAppointment, canCancel, canModify,
} = require('../bookingRules.js');

test('santiagoWallTimeToUtc calcula el offset de invierno (UTC-4)', () => {
  // 10 de junio de 2026 es invierno en Chile (UTC-4) -- mismo supuesto que
  // ya documenta functions/test/email.test.js para el campo `date`.
  const d = santiagoWallTimeToUtc('2026-06-10', '11:00');
  assert.strictEqual(d.toISOString(), '2026-06-10T15:00:00.000Z');
});

test('santiagoWallTimeToUtc calcula el offset de verano (UTC-3)', () => {
  const d = santiagoWallTimeToUtc('2026-01-10', '11:00');
  assert.strictEqual(d.toISOString(), '2026-01-10T14:00:00.000Z');
});

test('appointmentInstant combina date (medianoche Chile) + time', () => {
  const booking = { date: '2026-06-10T04:00:00.000Z', time: '11:00' };
  assert.strictEqual(appointmentInstant(booking).toISOString(), '2026-06-10T15:00:00.000Z');
});

test('hoursUntilAppointment devuelve horas positivas si la cita es futura', () => {
  const booking = { date: '2026-06-10T04:00:00.000Z', time: '15:00' }; // 19:00 UTC
  const now = new Date('2026-06-10T15:00:00.000Z'); // 4 horas antes
  assert.strictEqual(hoursUntilAppointment(booking, now), 4);
});

test('canCancel permite cancelar con más de 3 horas de anticipación', () => {
  const booking = { date: '2026-06-10T04:00:00.000Z', time: '15:00', status: 'pending' };
  const now = new Date('2026-06-10T15:00:01.000Z');
  assert.deepStrictEqual(canCancel(booking, now), { ok: true });
});

test('canCancel bloquea a menos de 3 horas de la cita', () => {
  const booking = { date: '2026-06-10T04:00:00.000Z', time: '15:00', status: 'pending' };
  const now = new Date('2026-06-10T16:30:00.000Z'); // cita 19:00 UTC, faltan 2.5h
  assert.deepStrictEqual(canCancel(booking, now), { ok: false, reason: 'too_late' });
});

test('canCancel bloquea si ya está cancelada', () => {
  const booking = { date: '2026-06-10T04:00:00.000Z', time: '15:00', status: 'cancelled' };
  const now = new Date('2026-06-01T00:00:00.000Z');
  assert.deepStrictEqual(canCancel(booking, now), { ok: false, reason: 'already_cancelled' });
});

test('canModify permite modificar con menos de 2 modificaciones y más de 3 horas', () => {
  const booking = { date: '2026-06-10T04:00:00.000Z', time: '15:00', status: 'pending', modifyCount: 1 };
  const now = new Date('2026-06-10T15:00:00.000Z');
  assert.deepStrictEqual(canModify(booking, now), { ok: true });
});

test('canModify bloquea al llegar al tope de 2 modificaciones', () => {
  const booking = { date: '2026-06-10T04:00:00.000Z', time: '15:00', status: 'pending', modifyCount: 2 };
  const now = new Date('2026-06-10T00:00:00.000Z');
  assert.deepStrictEqual(canModify(booking, now), { ok: false, reason: 'max_modifications' });
});

test('canModify bloquea a menos de 3 horas aunque queden modificaciones disponibles', () => {
  const booking = { date: '2026-06-10T04:00:00.000Z', time: '15:00', status: 'pending', modifyCount: 0 };
  const now = new Date('2026-06-10T16:30:00.000Z');
  assert.deepStrictEqual(canModify(booking, now), { ok: false, reason: 'too_late' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && node --test test/bookingRules.test.js`
Expected: FAIL — `Cannot find module '../bookingRules.js'`

- [ ] **Step 3: Write the implementation**

```js
// functions/bookingRules.js — reglas de negocio puras de autogestión de
// citas (confirmar/modificar/cancelar). Sin dependencias de Firebase Admin,
// mismo espíritu que availability.js: fácil de testear.
'use strict';

const TZ = 'America/Santiago';
const MIN_HOURS_BEFORE_CHANGE = 3;
const MAX_MODIFICATIONS = 2;

// Convierte una hora de pared ('YYYY-MM-DD', 'HH:MM') en America/Santiago a
// un instante UTC real, respetando el cambio de horario de verano/invierno
// de Chile. No hay librería de zonas horarias en las dependencias (ver
// functions/package.json) -- Node 22 trae ICU completo, así que
// Intl.DateTimeFormat alcanza para leer el offset vigente en esa fecha.
function santiagoWallTimeToUtc(dayStr, hhmm) {
  const [hh, mm] = String(hhmm || '00:00').split(':').map(Number);
  const guess = new Date(`${dayStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = {};
  dtf.formatToParts(guess).forEach((p) => { if (p.type !== 'literal') parts[p.type] = Number(p.value); });
  const hour = parts.hour === 24 ? 0 : parts.hour; // Intl a veces devuelve "24" para medianoche
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);
  const offsetMs = guess.getTime() - asIfUtc;
  return new Date(guess.getTime() + offsetMs);
}

// El campo `date` de una reserva guarda medianoche en Chile serializada con
// toISOString() (ver public/index.html: new Date(y,m,d).toISOString()) --
// `time` guarda la hora 'HH:MM' aparte. Combinando ambos con
// santiagoWallTimeToUtc se obtiene el instante real de la cita.
function appointmentInstant(booking) {
  const day = String((booking && booking.date) || '').slice(0, 10);
  return santiagoWallTimeToUtc(day, booking && booking.time);
}

function hoursUntilAppointment(booking, now) {
  return (appointmentInstant(booking).getTime() - now.getTime()) / 3600000;
}

function canCancel(booking, now) {
  if (booking.status === 'cancelled') return { ok: false, reason: 'already_cancelled' };
  if (hoursUntilAppointment(booking, now) < MIN_HOURS_BEFORE_CHANGE) return { ok: false, reason: 'too_late' };
  return { ok: true };
}

function canModify(booking, now) {
  if (booking.status === 'cancelled') return { ok: false, reason: 'already_cancelled' };
  if ((booking.modifyCount || 0) >= MAX_MODIFICATIONS) return { ok: false, reason: 'max_modifications' };
  if (hoursUntilAppointment(booking, now) < MIN_HOURS_BEFORE_CHANGE) return { ok: false, reason: 'too_late' };
  return { ok: true };
}

module.exports = {
  TZ, MIN_HOURS_BEFORE_CHANGE, MAX_MODIFICATIONS,
  santiagoWallTimeToUtc, appointmentInstant, hoursUntilAppointment,
  canCancel, canModify,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && node --test test/bookingRules.test.js`
Expected: PASS (11 tests). If the DST tests fail, print the actual offset Node's ICU reports for that date (`node -e "console.log(new Intl.DateTimeFormat('en-US',{timeZone:'America/Santiago',timeZoneName:'longOffset'}).format(new Date('2026-01-10T12:00:00Z')))"`) and adjust the expected ISO strings in the test to match reality — the logic is correct by construction, only the hardcoded expectations could be off if Chile's DST calendar differs from assumed.

- [ ] **Step 5: Commit**

```bash
git add functions/bookingRules.js functions/test/bookingRules.test.js
git commit -m "feat(functions): agregar reglas de negocio de autogestión (canCancel/canModify)"
```

---

### Task 2: `availability.js` — excluir reservas canceladas

**Files:**
- Modify: `functions/availability.js:48-53`
- Test: `functions/test/availability.test.js`

- [ ] **Step 1: Write the failing test**

Add to `functions/test/availability.test.js`:

```js
test('computeAvailability excluye reservas canceladas de barberBusy', () => {
  const bookings = [
    { barberId: 'felipe', date: '2026-07-10', time: '10:00', dur: 50, status: 'pending' },
    { barberId: 'felipe', date: '2026-07-10', time: '15:00', dur: 60, status: 'cancelled' },
  ];
  const staff = [{ id: 'felipe', status: 'active' }];
  const result = computeAvailability({ bookings, staff, barberId: 'felipe' });
  assert.deepStrictEqual(result.barberBusy.felipe, [{ start: '10:00', end: '10:50' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && node --test test/availability.test.js`
Expected: FAIL — `barberBusy.felipe` includes both the 10:00 and 15:00 ranges (cancelled one not excluded yet).

- [ ] **Step 3: Implement the fix**

In `functions/availability.js`, replace:

```js
  const wantsAny = !barberId || barberId === 'any';
  const relevant = wantsAny
    ? (bookings || [])
    : (bookings || []).filter(b => b.barberId === barberId);
```

with:

```js
  const wantsAny = !barberId || barberId === 'any';
  const relevant = (wantsAny
    ? (bookings || [])
    : (bookings || []).filter(b => b.barberId === barberId)
  ).filter(b => b.status !== 'cancelled');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && node --test test/availability.test.js`
Expected: PASS (all tests, including the existing 8).

- [ ] **Step 5: Commit**

```bash
git add functions/availability.js functions/test/availability.test.js
git commit -m "fix(functions): excluir reservas canceladas de la disponibilidad"
```

---

### Task 3: `firestore.rules` — exigir `manageToken`

**Files:**
- Modify: `firestore.rules:32-42`

- [ ] **Step 1: Modify `isValidBooking()`**

Replace:

```
    function isValidBooking() {
      let d = request.resource.data;
      return d.status == 'pending'
        && d.name is string  && d.name.size() > 1
        && d.email is string && d.email.matches('^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')
        && d.phone is string && d.phone.size() >= 7
        && d.svcId is string && d.barberId is string
        && d.date is string  && d.time is string
        && d.code is string
        && d.club is string  && (d.club == 'member' || d.club == 'guest');
    }
```

with:

```
    function isValidBooking() {
      let d = request.resource.data;
      return d.status == 'pending'
        && d.name is string  && d.name.size() > 1
        && d.email is string && d.email.matches('^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')
        && d.phone is string && d.phone.size() >= 7
        && d.svcId is string && d.barberId is string
        && d.date is string  && d.time is string
        && d.code is string
        // manageToken autoriza el link de autogestión (confirmar/modificar/
        // cancelar) sin login -- a diferencia de `code`, nunca se muestra en
        // pantalla ni se comparte de palabra, por eso exige más longitud.
        && d.manageToken is string && d.manageToken.size() >= 24
        && d.club is string  && (d.club == 'member' || d.club == 'guest');
    }
```

- [ ] **Step 2: Manual verification (no rules-test harness exists in this repo yet)**

Run: `firebase emulators:start --only firestore` in one terminal, and in another, confirm via the emulator UI (`http://localhost:4000/firestore`) or a quick script that:
- A booking payload missing `manageToken` is rejected on `create`.
- A booking payload with a 32-char `manageToken` is accepted.

This is folded into the end-to-end checklist in Task 13 once Task 4 wires up real token generation — no need to hand-craft a throwaway payload now if Task 13 will exercise this anyway.

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat(rules): exigir manageToken de alta entropía al crear una reserva"
```

---

### Task 4: Generar `manageToken` en el widget público y en el admin

**Files:**
- Modify: `public/index.html:3063-3103` (widget público), `public/index.html:4751-4769` (modal admin)

- [ ] **Step 1: Agregar `genManageToken()` junto a `genCode()`**

In `public/index.html`, replace:

```js
function genCode(){
  return `SW-${Date.now().toString(36).toUpperCase().slice(-4)}${Math.floor(Math.random()*900+100)}`;
}
```

with:

```js
function genCode(){
  return `SW-${Date.now().toString(36).toUpperCase().slice(-4)}${Math.floor(Math.random()*900+100)}`;
}

// Token de acceso al link de autogestión (confirmar/modificar/cancelar) --
// NO reusar `code`: ese es solo un identificador visible (se comparte de
// palabra, aparece en el email a la barbería), nunca pensado como secreto.
// crypto.getRandomValues (no Math.random) para que sea realmente
// impredecible. Se expone en window porque el admin (otro IIFE más abajo en
// este mismo archivo) también necesita generarlo al crear una reserva.
function genManageToken(){
  const bytes = new Uint8Array(16); // 128 bits
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
window.genManageToken = genManageToken;
```

- [ ] **Step 2: Incluirlo en la creación pública de reservas**

Replace:

```js
      await withTimeout(window.SWData.createBooking({
        code, name:fullname, email, phone,
        svcId:S.svc?.id, svcName:S.svc?.name, svcCat:S.svc?.cat||'',
        price:S.svc?.price||0, dur:S.svc?.dur||0,
        barberId:S.barber?.id, barberName:S.barber?.name,
        date:S.date?S.date.toISOString():'', time:S.time,
        club:S.club||'guest',
        createdAt:new Date().toISOString()
      }), 15000, 'createBooking');
```

with:

```js
      await withTimeout(window.SWData.createBooking({
        code, manageToken: genManageToken(), name:fullname, email, phone,
        svcId:S.svc?.id, svcName:S.svc?.name, svcCat:S.svc?.cat||'',
        price:S.svc?.price||0, dur:S.svc?.dur||0,
        barberId:S.barber?.id, barberName:S.barber?.name,
        date:S.date?S.date.toISOString():'', time:S.time,
        club:S.club||'guest',
        createdAt:new Date().toISOString()
      }), 15000, 'createBooking');
```

- [ ] **Step 3: Incluirlo en la creación/edición admin, preservando el token existente al editar**

Replace:

```js
  var editId = g('a-bkm-id').value;
  var bookings = getBookings();
  var bkData = {
    code: editId || ('SW-' + Date.now().toString(36).toUpperCase().slice(-5) + Math.floor(Math.random()*900+100)),
    name: ne.value.trim(),
    phone: g('a-bkm-phone').value.trim(),
    email: g('a-bkm-email').value.trim(),
    svcId: sv.value,
    svcName: sOpt.dataset.name,
    price: parseInt(sOpt.dataset.price),
    dur: parseInt(sOpt.dataset.dur),
    barberId: br.value,
    barberName: bOpt.dataset.name,
    date: da.value + 'T' + ti.value + ':00.000Z',
    time: ti.value,
    notes: g('a-bkm-notes').value.trim(),
    over: !!conflict || isOver,
    createdAt: editId ? (bookings.find(function(b){return b.code===editId})||{}).createdAt || new Date().toISOString() : new Date().toISOString()
  };
```

with:

```js
  var editId = g('a-bkm-id').value;
  var bookings = getBookings();
  var existingBk = editId ? (bookings.find(function(b){return b.code===editId})||{}) : {};
  var bkData = {
    code: editId || ('SW-' + Date.now().toString(36).toUpperCase().slice(-5) + Math.floor(Math.random()*900+100)),
    // Preserva el manageToken si ya existía -- regenerarlo invalidaría un
    // link de autogestión que ya se le pudo haber enviado al cliente.
    manageToken: existingBk.manageToken || window.genManageToken(),
    name: ne.value.trim(),
    phone: g('a-bkm-phone').value.trim(),
    email: g('a-bkm-email').value.trim(),
    svcId: sv.value,
    svcName: sOpt.dataset.name,
    price: parseInt(sOpt.dataset.price),
    dur: parseInt(sOpt.dataset.dur),
    barberId: br.value,
    barberName: bOpt.dataset.name,
    date: da.value + 'T' + ti.value + ':00.000Z',
    time: ti.value,
    notes: g('a-bkm-notes').value.trim(),
    over: !!conflict || isOver,
    createdAt: existingBk.createdAt || new Date().toISOString()
  };
```

- [ ] **Step 4: Verificación manual**

Run: `firebase emulators:start` and create a booking from the public widget. In the emulator Firestore UI, confirm the new `bookings/{id}` doc has a `manageToken` field, 32 hex chars.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(web): generar manageToken de alta entropía al crear/editar una reserva"
```

---

### Task 5: `email.js` — shell compartido + emails de cancelación/modificación/recordatorio

**Files:**
- Modify (full rewrite): `functions/email.js`
- Modify: `functions/test/email.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `functions/test/email.test.js` (keep all existing tests as-is — they must keep passing, proving the shell refactor didn't change `renderClientEmail`'s output):

```js
const { renderCancelEmail, renderModifyEmail, renderReminderEmail, renderManageButtons } = require('../email.js');

const cancelledBooking = { ...booking, status: 'cancelled', manageToken: 'a'.repeat(32) };

test('renderCancelEmail marca CANCELADA y tacha fecha/hora/barbero', () => {
  const { subject, html } = renderCancelEmail(cancelledBooking);
  assert.match(subject, /cancelada/i);
  assert.match(subject, /SW-AB12345/);
  assert.match(html, /RESERVA<br>CANCELADA/);
  assert.match(html, /CANCELADA/);
  assert.match(html, /text-decoration:line-through[^"]*">Felipe/); // barbero tachado
  assert.match(html, /MIÉRCOLES/); // el bloque de fecha grande se omite, pero la fila de fecha se mantiene
});

test('renderCancelEmail incluye botón para volver a reservar', () => {
  const { html } = renderCancelEmail(cancelledBooking);
  assert.match(html, /scissorwhite\.cl/);
  assert.match(html, /RESERVAR DE NUEVO/i);
});

const newBooking = {
  ...booking, barberName: 'Victoria', date: '2026-06-11T04:00:00.000Z', time: '16:00',
  modifyCount: 1, manageToken: 'b'.repeat(32),
};

test('renderModifyEmail muestra el valor anterior tachado y el nuevo debajo', () => {
  const { subject, html } = renderModifyEmail(booking, newBooking);
  assert.match(subject, /modificada/i);
  assert.match(html, /RESERVA<br>MODIFICADA/);
  assert.match(html, /text-decoration:line-through[^"]*">Felipe/); // barbero anterior
  assert.match(html, />Victoria</); // barbero nuevo
  assert.match(html, /text-decoration:line-through[^"]*">11:00 hrs/); // hora anterior
  assert.match(html, />16:00 hrs</); // hora nueva
});

test('renderModifyEmail incluye el bloque de gestión (confirmar/modificar/cancelar) con el token nuevo', () => {
  const { html } = renderModifyEmail(booking, newBooking);
  assert.match(html, new RegExp(`t=${newBooking.manageToken}`));
});

test('renderReminderEmail incluye la fecha, hora y el bloque de gestión', () => {
  const b = { ...booking, manageToken: 'c'.repeat(32) };
  const { subject, html } = renderReminderEmail(b);
  assert.match(subject, /mañana|recordatorio/i);
  assert.match(html, /11:00 HRS/);
  assert.match(html, new RegExp(`t=${b.manageToken}`));
});

test('renderManageButtons arma los 3 botones apuntando todos a mi-reserva.html con code y token', () => {
  const b = { code: 'SW-AB12345', manageToken: 'deadbeef'.repeat(4) };
  const html = renderManageButtons(b);
  assert.match(html, /CONFIRMAR CITA/);
  assert.match(html, /MODIFICAR CITA/);
  assert.match(html, /CANCELAR CITA/);
  const url = `mi-reserva.html?code=SW-AB12345&t=${b.manageToken}`;
  const occurrences = html.split(url).length - 1;
  assert.strictEqual(occurrences, 3); // los 3 botones enlazan a la misma URL -- ninguno ejecuta la acción por GET
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd functions && node --test test/email.test.js`
Expected: FAIL — `renderCancelEmail is not a function` (and similar for the other 3).

- [ ] **Step 3: Rewrite `functions/email.js`**

Replace the entire file with:

```js
// functions/email.js — render + envío de emails vía Resend.
'use strict';
const { Resend } = require('resend');

const SITE_URL = 'https://scissorwhite.cl';
const ASSETS_URL = SITE_URL + '/assets/email'; // logo.png / salon.png (Gmail bloquea data-URIs)
const TZ = 'America/Santiago';
const ADDRESS_LINE = 'Cochrane 635, Of. 303, Torre B, Concepción';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long', timeZone: TZ }); }
  catch { return iso; }
}
// Piezas de fecha para el bloque calendario del template (VIERNES / 07 / JULIO 2025).
function dateParts(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) throw new Error('bad date');
    const weekday = d.toLocaleDateString('es-CL', { weekday:'long', timeZone: TZ }).toUpperCase();
    const day = d.toLocaleDateString('es-CL', { day:'2-digit', timeZone: TZ });
    const month = d.toLocaleDateString('es-CL', { month:'long', timeZone: TZ }).toUpperCase();
    const year = d.toLocaleDateString('es-CL', { year:'numeric', timeZone: TZ });
    return { weekday, day, monthYear: month + ' ' + year };
  } catch { return { weekday:'', day:'', monthYear: String(iso || '') }; }
}
function fmtCLP(n) { return '$' + Number(n || 0).toLocaleString('es-CL'); }

// SHOP_EMAIL puede traer varios destinatarios separados por coma (ej. dueño + recepción).
function parseRecipients(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

const FONT_SANS = "'Jost','Trebuchet MS',Arial,sans-serif";
const FONT_SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";

// Envuelve un valor de fila en tachado gris -- usado por los emails de
// cancelación/modificación para marcar el dato anterior/inválido.
function strike(html) {
  return `<span style="text-decoration:line-through;color:#8a8a8a;">${html}</span>`;
}

// Fila etiqueta/valor de la tarjeta de detalle.
function detailRow(label, valueHtml, last) {
  const border = last ? '' : 'border-bottom:1px solid #e5e4e1;';
  return `
    <tr>
      <td style="padding:15px 4px;${border}white-space:nowrap;font-family:${FONT_SANS};font-weight:400;font-size:11px;letter-spacing:2px;color:#6b6b6b;vertical-align:middle;width:110px;">${label}</td>
      <td style="padding:15px 4px;${border}font-family:${FONT_SERIF};font-weight:600;font-size:19px;color:#161616;vertical-align:middle;">${valueHtml}</td>
    </tr>`;
}

// URL del portal de autogestión (public/mi-reserva.html) -- `code` es solo
// legible por humanos, `manageToken` es el secreto que autoriza la acción.
function manageUrl(b) {
  return `${SITE_URL}/mi-reserva.html?code=${encodeURIComponent(b.code)}&t=${encodeURIComponent(b.manageToken)}`;
}

// Bloque de 3 botones (confirmar/modificar/cancelar). Los 3 enlazan a la
// MISMA url -- ninguno ejecuta la acción con un simple GET: clientes de
// correo (Gmail, Outlook Safe Links) prefetchean/siguen links por seguridad,
// y un link que cancelara solo con visitarlo dispararía la acción sin que
// el cliente hiciera nada. mi-reserva.html es quien ejecuta la acción real,
// tras un tap explícito (y el modal de confirmación en el caso de cancelar).
function renderManageButtons(b) {
  const url = manageUrl(b);
  const btn = (bg, label) => `
      <tr><td style="padding-bottom:10px;">
        <a href="${url}" target="_blank" style="display:block;background:${bg};border-radius:8px;padding:14px 20px;text-align:center;font-family:${FONT_SANS};font-weight:500;font-size:13px;letter-spacing:2px;color:#ffffff;">${label}</a>
      </td></tr>`;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
      ${btn('#1f8a4c', '✓ CONFIRMAR CITA')}
      ${btn('#c8842a', '✎ MODIFICAR CITA')}
      ${btn('#b3402f', '✕ CANCELAR CITA')}
    </table>`;
}

// ── Shell compartido: hero + tarjeta de detalle + banda oscura + footer ──
// Todos los emails de reserva (confirmada/cancelada/modificada/recordatorio)
// comparten esta estructura visual SW Studio; solo cambian título, subtítulo
// del hero, filas de la tarjeta, el bloque de fecha grande (opcional) y el
// contenido bajo la tarjeta (aviso y/o CTA).
function renderEmailShell({ titleHtml, heroSubtitleHtml, dateBox, rows, belowRowsHtml }) {
  const dateBoxHtml = !dateBox ? '' : `
        <td class="sw-col sw-datecell" width="150" valign="top" style="padding:0 22px 0 0;">
          <table role="presentation" width="150" class="sw-datebox" cellpadding="0" cellspacing="0" style="background:#161616;border-radius:14px;">
            <tr><td align="center" style="padding:26px 14px;">
              <div style="font-family:${FONT_SANS};font-weight:400;font-size:12px;letter-spacing:4px;color:#e9e9e9;">${esc(dateBox.weekday)}</div>
              <div style="font-family:${FONT_SANS};font-weight:200;font-size:72px;letter-spacing:2px;line-height:1;color:#ffffff;margin:8px 0 6px;">${esc(dateBox.day)}</div>
              <div style="font-family:${FONT_SANS};font-weight:400;font-size:12px;letter-spacing:3px;color:#e9e9e9;">${esc(dateBox.monthYear)}</div>
              <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:16px auto;"><tr><td style="width:26px;height:1px;background:rgba(255,255,255,.4);font-size:0;line-height:0;" height="1"></td></tr></table>
              <div style="font-family:${FONT_SANS};font-weight:500;font-size:15px;letter-spacing:.5px;color:#ffffff;white-space:nowrap;">${esc(dateBox.time)} HRS</div>
            </td></tr>
          </table>
        </td>`;

  return `<!DOCTYPE html>
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
    .sw-hero-img { height:260px !important; }
    .sw-hero-txt { padding:32px 24px 36px !important; }
    .sw-title { font-size:26px !important; letter-spacing:7px !important; }
    .sw-card { padding:26px 18px 22px !important; }
    .sw-datecell { padding:0 0 22px 0 !important; }
    .sw-datebox { width:100% !important; }
    .sw-foot-links { display:block !important; width:100% !important; text-align:left !important; padding-top:12px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#cfccc7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#cfccc7;">
<tr><td align="center" style="padding:32px 10px;">

<table role="presentation" class="sw-wrap" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;background:#0e0e0e;border-radius:2px;overflow:hidden;">

  <!-- HERO -->
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td class="sw-col sw-hero-txt" width="52%" valign="top" style="background:#0e0e0e;padding:38px 32px 44px;">
          <img src="${ASSETS_URL}/logo.png" alt="SW Studio" width="82" height="82" style="display:block;border-radius:50%;margin-bottom:44px;">
          <h1 class="sw-title" style="margin:0;font-family:${FONT_SANS};font-weight:300;font-size:33px;letter-spacing:10px;color:#ffffff;line-height:1.4;">${titleHtml}</h1>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:44px;height:1px;background:rgba(255,255,255,.45);font-size:0;line-height:0;padding:0;margin:0;" height="1"></td></tr></table>
          <p style="margin:20px 0 0;font-family:${FONT_SERIF};font-style:italic;font-weight:500;font-size:22px;color:#f2f2f2;line-height:1.3;">Más que cortes,<br>creamos identidad</p>
          <p style="margin:26px 0 0;font-family:${FONT_SERIF};font-weight:400;font-size:17px;color:#c9c7c4;line-height:1.55;">${heroSubtitleHtml}</p>
        </td>
        <td class="sw-col" width="48%" valign="top" style="background:#0e0e0e;padding:0;">
          <img src="${ASSETS_URL}/salon.png" alt="Salón SW Studio" width="307" class="sw-hero-img" style="display:block;width:100%;height:486px;object-fit:cover;">
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- DETAIL CARD -->
  <tr><td class="sw-card" style="background:#f3f2f0;padding:34px 30px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>${dateBoxHtml}
        <td class="sw-col" valign="middle">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
          </table>
        </td>
      </tr>
    </table>
    ${belowRowsHtml}
  </td></tr>

  <!-- BANDA OSCURA -->
  <tr><td style="background:#0e0e0e;padding:30px 32px;">
    <div style="font-family:${FONT_SANS};font-weight:500;font-size:13px;letter-spacing:4px;color:#ffffff;margin-bottom:8px;">VISAGISMO · ESTILO · CONFIANZA</div>
    <p style="margin:0;font-family:${FONT_SERIF};font-weight:400;font-size:16px;color:#b9b7b4;line-height:1.5;">En SW Studio combinamos técnica, precisión y visagismo para realzar tu imagen y potenciar tu mejor versión.</p>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#f3f2f0;padding:20px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="44" valign="middle"><img src="${ASSETS_URL}/logo.png" alt="SW Studio" width="44" height="44" style="display:block;border-radius:50%;"></td>
        <td valign="middle" style="padding:0 0 0 18px;font-family:${FONT_SERIF};font-weight:400;font-size:16px;color:#4a4a4a;">Más que cortes, creamos identidad</td>
        <td align="right" valign="middle" class="sw-foot-links" style="font-family:${FONT_SANS};font-size:13px;letter-spacing:1px;">
          <a href="https://www.instagram.com/scissorwhite.cl" target="_blank" style="color:#161616;text-decoration:underline;">Instagram</a>
          &nbsp;·&nbsp;
          <a href="https://wa.me/56982514114" target="_blank" style="color:#161616;text-decoration:underline;">WhatsApp</a>
        </td>
      </tr>
    </table>
  </td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;
}

// Nota "aviso" reutilizada por confirmación/modificación/recordatorio (no
// aplica a cancelación, ya no queda nada que modificar/cancelar).
function manageNoteHtml() {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
      <tr><td style="background:#e7e6e3;border-radius:10px;padding:20px 22px;">
        <p style="margin:0;font-family:${FONT_SERIF};font-weight:400;font-size:17px;color:#3a3a3a;line-height:1.45;">Si necesitas modificar o cancelar tu cita, puedes hacerlo hasta <strong style="font-weight:600;">3 horas</strong> antes de la hora reservada desde el botón de abajo.</p>
      </td></tr>
    </table>`;
}

function renderClientEmail(b) {
  const subject = `Tu reserva en Scissor White — ${b.code}`;
  const d = dateParts(b.date);
  const rows = [
    detailRow('CLIENTE', esc(b.name)),
    detailRow('PROFESIONAL', esc(b.barberName)),
    detailRow('SERVICIO', esc(b.svcName)),
    b.dur ? detailRow('DURACIÓN', esc(b.dur) + ' minutos') : '',
    detailRow('VALOR', esc(fmtCLP(b.price))),
    detailRow('CÓDIGO', esc(b.code)),
    detailRow('SUCURSAL',
      `<span style="display:block;line-height:1.2;">SW Studio · Concepción</span>
       <span style="display:block;font-weight:400;font-size:15px;color:#8a8a8a;">${esc(ADDRESS_LINE)}</span>`, true),
  ].join('');
  const html = renderEmailShell({
    titleHtml: 'RESERVA<br>CONFIRMADA',
    heroSubtitleHtml: 'Tu hora ha sido reservada correctamente.<br>Gracias por elegir SW Studio.<br>Te esperamos.',
    dateBox: { ...d, time: b.time },
    rows,
    belowRowsHtml: manageNoteHtml() + renderManageButtons(b),
  });
  return { subject, html };
}

function renderCancelEmail(b) {
  const subject = `Tu reserva en Scissor White fue cancelada — ${b.code}`;
  const d = dateParts(b.date);
  const badge = `<span style="display:inline-block;margin-left:10px;padding:3px 10px;border-radius:20px;background:#b3402f;color:#fff;font-family:${FONT_SANS};font-size:10px;letter-spacing:1px;vertical-align:middle;">CANCELADA</span>`;
  const rows = [
    detailRow('CLIENTE', esc(b.name)),
    detailRow('PROFESIONAL', strike(esc(b.barberName))),
    detailRow('SERVICIO', esc(b.svcName)),
    detailRow('FECHA', strike(`${esc(d.weekday)} ${esc(d.day)} de ${esc(d.monthYear)}`)),
    detailRow('HORA', strike(esc(b.time) + ' hrs')),
    detailRow('CÓDIGO', esc(b.code) + badge),
    detailRow('SUCURSAL', strike(
      `<span style="display:block;line-height:1.2;">SW Studio · Concepción</span>
       <span style="display:block;font-weight:400;font-size:15px;color:#8a8a8a;">${esc(ADDRESS_LINE)}</span>`), true),
  ].join('');
  const rebookCta = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
      <tr><td style="background:#161616;border:1px solid rgba(255,255,255,.1);border-radius:8px;">
        <a href="${SITE_URL}" target="_blank" style="display:block;padding:21px 30px;text-align:center;font-family:${FONT_SANS};font-weight:500;font-size:14px;letter-spacing:4px;color:#ffffff;">RESERVAR DE NUEVO</a>
      </td></tr>
    </table>`;
  const html = renderEmailShell({
    titleHtml: 'RESERVA<br>CANCELADA',
    heroSubtitleHtml: 'Tu cita fue cancelada exitosamente.<br>Cuando quieras, te esperamos<br>para agendar una nueva hora.',
    dateBox: null,
    rows,
    belowRowsHtml: rebookCta,
  });
  return { subject, html };
}

function renderModifyEmail(oldB, newB) {
  const subject = `Tu reserva en Scissor White fue modificada — ${newB.code}`;
  const oldD = dateParts(oldB.date);
  const newD = dateParts(newB.date);
  const changedRow = (label, oldVal, newVal, changed) => changed
    ? detailRow(label, `${strike(esc(oldVal))}<br>${esc(newVal)}`)
    : detailRow(label, esc(newVal));
  const rows = [
    detailRow('CLIENTE', esc(newB.name)),
    changedRow('PROFESIONAL', oldB.barberName, newB.barberName, oldB.barberId !== newB.barberId),
    changedRow('SERVICIO', oldB.svcName, newB.svcName, oldB.svcId !== newB.svcId),
    changedRow('FECHA',
      `${oldD.weekday} ${oldD.day} de ${oldD.monthYear}`, `${newD.weekday} ${newD.day} de ${newD.monthYear}`,
      oldB.date !== newB.date),
    changedRow('HORA', `${oldB.time} hrs`, `${newB.time} hrs`, oldB.time !== newB.time),
    detailRow('CÓDIGO', esc(newB.code)),
    detailRow('SUCURSAL',
      `<span style="display:block;line-height:1.2;">SW Studio · Concepción</span>
       <span style="display:block;font-weight:400;font-size:15px;color:#8a8a8a;">${esc(ADDRESS_LINE)}</span>`, true),
  ].join('');
  const html = renderEmailShell({
    titleHtml: 'RESERVA<br>MODIFICADA',
    heroSubtitleHtml: 'Actualizamos tu hora según lo que pediste.<br>Revisa el detalle actualizado abajo.',
    dateBox: { ...newD, time: newB.time },
    rows,
    belowRowsHtml: manageNoteHtml() + renderManageButtons(newB),
  });
  return { subject, html };
}

function renderReminderEmail(b) {
  const subject = `Tu cita en Scissor White es mañana — ${b.code}`;
  const d = dateParts(b.date);
  const rows = [
    detailRow('CLIENTE', esc(b.name)),
    detailRow('PROFESIONAL', esc(b.barberName)),
    detailRow('SERVICIO', esc(b.svcName)),
    detailRow('CÓDIGO', esc(b.code)),
    detailRow('SUCURSAL',
      `<span style="display:block;line-height:1.2;">SW Studio · Concepción</span>
       <span style="display:block;font-weight:400;font-size:15px;color:#8a8a8a;">${esc(ADDRESS_LINE)}</span>`, true),
  ].join('');
  const html = renderEmailShell({
    titleHtml: 'TU CITA<br>ES MAÑANA',
    heroSubtitleHtml: 'Este es tu recordatorio.<br>Si algo cambió, confirma, modifica<br>o cancela desde aquí.',
    dateBox: { ...d, time: b.time },
    rows,
    belowRowsHtml: manageNoteHtml() + renderManageButtons(b),
  });
  return { subject, html };
}

function renderShopEmail(b) {
  const subject = `Nueva reserva — ${b.svcName} (${b.code})`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif">
      <h3>Nueva reserva</h3>
      <p><strong>${esc(b.name)}</strong> — ${esc(b.phone)} · ${esc(b.email)}</p>
      <p>${esc(b.svcName)} con ${esc(b.barberName)}<br>${esc(fmtDate(b.date))} · ${esc(b.time)} hrs · ${esc(fmtCLP(b.price))}</p>
      <p>Código: ${esc(b.code)}</p>
    </div>`;
  return { subject, html };
}

// El SDK de Resend no lanza en errores de API: resuelve con {data, error}.
// Hay que inspeccionar `error` o los envíos rechazados pasarían por exitosos.
function assertResendOk(results) {
  const errs = results.map(r => r && r.error).filter(Boolean);
  if (errs.length) {
    throw new Error('Resend rechazó el envío: ' + errs.map(e => e.message || JSON.stringify(e)).join(' | '));
  }
}

async function sendBookingEmails(b, { apiKey, fromEmail, shopEmail }) {
  const resend = new Resend(apiKey);
  const client = renderClientEmail(b);
  const shop = renderShopEmail(b);
  const results = await Promise.all([
    resend.emails.send({ from: fromEmail, to: b.email, subject: client.subject, html: client.html }),
    resend.emails.send({ from: fromEmail, to: parseRecipients(shopEmail), subject: shop.subject, html: shop.html }),
  ]);
  assertResendOk(results);
}

async function sendCancelEmail(b, { apiKey, fromEmail }) {
  const resend = new Resend(apiKey);
  const { subject, html } = renderCancelEmail(b);
  const result = await resend.emails.send({ from: fromEmail, to: b.email, subject, html });
  assertResendOk([result]);
}

async function sendModifyEmail(oldB, newB, { apiKey, fromEmail }) {
  const resend = new Resend(apiKey);
  const { subject, html } = renderModifyEmail(oldB, newB);
  const result = await resend.emails.send({ from: fromEmail, to: newB.email, subject, html });
  assertResendOk([result]);
}

async function sendReminderEmail(b, { apiKey, fromEmail }) {
  const resend = new Resend(apiKey);
  const { subject, html } = renderReminderEmail(b);
  const result = await resend.emails.send({ from: fromEmail, to: b.email, subject, html });
  assertResendOk([result]);
}

module.exports = {
  renderClientEmail, renderShopEmail, renderCancelEmail, renderModifyEmail, renderReminderEmail,
  renderManageButtons, sendBookingEmails, sendCancelEmail, sendModifyEmail, sendReminderEmail,
  parseRecipients, assertResendOk,
};
```

- [ ] **Step 4: Run all email tests to verify pass**

Run: `cd functions && node --test test/email.test.js`
Expected: PASS — all pre-existing tests (unchanged assertions) plus the new ones from Step 1.

- [ ] **Step 5: Commit**

```bash
git add functions/email.js functions/test/email.test.js
git commit -m "feat(functions): shell de email compartido + templates de cancelación/modificación/recordatorio"
```

---

### Task 6: `reminders.js` — lógica pura del recordatorio 24h (TDD)

**Files:**
- Create: `functions/reminders.js`
- Test: `functions/test/reminders.test.js`

- [ ] **Step 1: Write the failing test**

```js
// functions/test/reminders.test.js
const test = require('node:test');
const assert = require('node:assert');
const { reminderWindow, candidateDays, runReminders } = require('../reminders.js');

test('reminderWindow devuelve una ventana de 15 minutos, 24 horas adelante', () => {
  const now = new Date('2026-06-10T15:00:00.000Z');
  const { start, end } = reminderWindow(now);
  assert.strictEqual(start.toISOString(), '2026-06-11T15:00:00.000Z');
  assert.strictEqual(end.toISOString(), '2026-06-11T15:15:00.000Z');
});

test('candidateDays devuelve un solo día cuando la ventana no cruza medianoche Chile', () => {
  const now = new Date('2026-06-10T15:00:00.000Z'); // 11:00 Chile invierno, lejos de medianoche
  assert.deepStrictEqual(candidateDays(now), ['2026-06-11']);
});

test('candidateDays devuelve dos días cuando la ventana cruza medianoche Chile', () => {
  // Medianoche Chile invierno = 04:00 UTC. now+24h = 03:50 UTC (día X+1),
  // +15min = 04:05 UTC (cruza a día X+2 en hora de Chile).
  const now = new Date('2026-06-10T03:50:00.000Z');
  assert.deepStrictEqual(candidateDays(now), ['2026-06-11', '2026-06-12']);
});

function makeDoc(data) {
  const updates = [];
  return { doc: { data: () => data, ref: { update: async (patch) => updates.push(patch) } }, updates };
}

test('runReminders envía solo las reservas dentro de la ventana y sin recordatorio previo', async () => {
  const now = new Date('2026-06-10T15:00:00.000Z'); // candidateDays(now) = ['2026-06-11']
  const inWindow = { date: '2026-06-11T04:00:00.000Z', time: '11:00', status: 'pending', email: 'in@x.com', code: 'SW-IN001' };
  const outOfWindow = { date: '2026-06-11T04:00:00.000Z', time: '09:00', status: 'pending', email: 'out@x.com', code: 'SW-OUT01' };
  const alreadySent = { date: '2026-06-11T04:00:00.000Z', time: '11:00', status: 'pending', email: 'done@x.com', code: 'SW-DONE1', reminderSentAt: '2026-06-10T00:00:00.000Z' };
  const inDoc = makeDoc(inWindow);
  const outDoc = makeDoc(outOfWindow);
  const doneDoc = makeDoc(alreadySent);
  const db = {
    collection: () => ({
      where: () => ({
        where: () => ({ get: async () => ({ docs: [inDoc.doc, outDoc.doc, doneDoc.doc] }) }),
      }),
    }),
  };
  const emailed = [];
  const sent = await runReminders({ db, now, sendEmail: async (b) => emailed.push(b.code) });
  assert.deepStrictEqual(emailed, ['SW-IN001']);
  assert.strictEqual(sent, 1);
  assert.strictEqual(inDoc.updates.length, 1);
  assert.ok(inDoc.updates[0].reminderSentAt);
  assert.strictEqual(outDoc.updates.length, 0);
  assert.strictEqual(doneDoc.updates.length, 0);
});

test('runReminders no lanza si un envío falla -- sigue con el resto y reporta el error', async () => {
  const now = new Date('2026-06-10T15:00:00.000Z');
  const a = { date: '2026-06-11T04:00:00.000Z', time: '11:00', status: 'pending', email: 'a@x.com', code: 'SW-A' };
  const b = { date: '2026-06-11T04:00:00.000Z', time: '11:00', status: 'pending', email: 'b@x.com', code: 'SW-B' };
  const docA = makeDoc(a);
  const docB = makeDoc(b);
  const db = {
    collection: () => ({
      where: () => ({ where: () => ({ get: async () => ({ docs: [docA.doc, docB.doc] }) }) }),
    }),
  };
  const emailed = [];
  const errors = [];
  const sent = await runReminders({
    db, now,
    sendEmail: async (booking) => {
      if (booking.code === 'SW-A') throw new Error('Resend caído');
      emailed.push(booking.code);
    },
    onError: (err, booking) => errors.push({ code: booking.code, message: err.message }),
  });
  assert.deepStrictEqual(emailed, ['SW-B']);
  assert.strictEqual(sent, 1);
  assert.strictEqual(docA.updates.length, 0); // no se marca reminderSentAt si el envío falló
  assert.strictEqual(docB.updates.length, 1);
  assert.deepStrictEqual(errors, [{ code: 'SW-A', message: 'Resend caído' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && node --test test/reminders.test.js`
Expected: FAIL — `Cannot find module '../reminders.js'`

- [ ] **Step 3: Write the implementation**

```js
// functions/reminders.js — lógica pura del recordatorio 24h antes de la
// cita. Sin dependencias de Firebase Admin/Functions: el trigger real
// (onSchedule) se registra en functions/index.js, igual que el resto de
// Cloud Functions del proyecto -- este archivo solo expone lo testeable.
'use strict';
const { TZ, appointmentInstant, santiagoWallTimeToUtc } = require('./bookingRules.js');

const REMINDER_HOURS_BEFORE = 24;
const WINDOW_MINUTES = 15;

// Ventana rodante [ahora + 24h, ahora + 24h + 15min) -- coincide con el
// intervalo de la corrida (cada 15 min), sin huecos ni duplicados por diseño.
function reminderWindow(now) {
  const start = new Date(now.getTime() + REMINDER_HOURS_BEFORE * 3600000);
  const end = new Date(start.getTime() + WINDOW_MINUTES * 60000);
  return { start, end };
}

// La ventana puede caer en uno o dos días calendario de Chile (cruza
// medianoche solo en los últimos ~15 min de cada día) -- se devuelven los
// días candidatos sin duplicar, para consultar `bookings` por cada uno.
function candidateDays(now) {
  const { start, end } = reminderWindow(now);
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return [...new Set([dayFmt.format(start), dayFmt.format(end)])];
}

// db: instancia de Admin Firestore. sendEmail: async (booking) => enviar el
// recordatorio -- inyectado para poder testear runReminders con un stub,
// sin tocar Firestore/Resend reales. onError(err, booking): opcional, se
// invoca por cada envío fallido -- mismo criterio que el resto del proyecto
// (un fallo de envío se loguea, nunca se relanza ni frena a los demás).
// Devuelve cuántos se enviaron.
async function runReminders({ db, now, sendEmail, onError }) {
  const { start, end } = reminderWindow(now);
  const days = candidateDays(now);
  const snaps = await Promise.all(days.map((day) =>
    db.collection('bookings')
      .where('status', '==', 'pending')
      .where('date', '==', santiagoWallTimeToUtc(day, '00:00').toISOString())
      .get()
  ));
  let sent = 0;
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const b = doc.data();
      if (b.reminderSentAt) continue;
      const instant = appointmentInstant(b);
      if (instant < start || instant >= end) continue;
      try {
        await sendEmail(b);
        await doc.ref.update({ reminderSentAt: new Date().toISOString() });
        sent += 1;
      } catch (err) {
        if (onError) onError(err, b);
      }
    }
  }
  return sent;
}

module.exports = { reminderWindow, candidateDays, runReminders };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && node --test test/reminders.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/reminders.js functions/test/reminders.test.js
git commit -m "feat(functions): lógica pura del recordatorio 24h antes de la cita"
```

---

### Task 7: `functions/index.js` — registrar las 4 Cloud Functions + el scheduler

**Files:**
- Modify: `functions/index.js`

- [ ] **Step 1: Actualizar los imports**

Replace:

```js
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { sendBookingEmails } = require('./email.js');
const { buildPatientUpsert, countClubVisits } = require('./patients.js');
const { computeAvailability } = require('./availability.js');
```

with:

```js
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { sendBookingEmails, sendCancelEmail, sendModifyEmail, sendReminderEmail } = require('./email.js');
const { buildPatientUpsert, countClubVisits } = require('./patients.js');
const { computeAvailability, toMinutes } = require('./availability.js');
const { canCancel, canModify } = require('./bookingRules.js');
const { runReminders } = require('./reminders.js');
```

- [ ] **Step 2: Agregar las 4 Cloud Functions de autogestión + el scheduler, al final del archivo**

Append after the existing `getAvailability` export:

```js

// Busca la reserva dueña de un manageToken. El público nunca lee `bookings`
// directo (ver firestore.rules); esta consulta corre con el Admin SDK.
async function findBookingByToken(db, token) {
  const snap = await db.collection('bookings').where('manageToken', '==', token).limit(1).get();
  if (snap.empty) throw new HttpsError('not-found', 'Reserva no encontrada');
  return snap.docs[0];
}

// Datos de solo lectura para pintar mi-reserva.html. Nunca devuelve
// manageToken de vuelta ni datos de otras reservas.
exports.getBookingForManage = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const token = ((request.data && request.data.token) || '').trim();
    if (!token) throw new HttpsError('invalid-argument', 'token es requerido');
    const db = admin.firestore();
    const doc = await findBookingByToken(db, token);
    const b = doc.data();
    const now = new Date();
    return {
      code: b.code, name: b.name, email: b.email, phone: b.phone,
      svcId: b.svcId, svcName: b.svcName, barberId: b.barberId, barberName: b.barberName,
      price: b.price, dur: b.dur, date: b.date, time: b.time,
      status: b.status || 'pending',
      attendanceConfirmed: !!b.attendanceConfirmed,
      modifyCount: b.modifyCount || 0,
      canCancel: canCancel(b, now).ok,
      canModify: canModify(b, now).ok,
    };
  }
);

exports.confirmBookingAttendance = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const token = ((request.data && request.data.token) || '').trim();
    if (!token) throw new HttpsError('invalid-argument', 'token es requerido');
    const db = admin.firestore();
    const doc = await findBookingByToken(db, token);
    await doc.ref.update({ attendanceConfirmed: true, attendanceConfirmedAt: new Date().toISOString() });
    return { ok: true };
  }
);

exports.cancelBooking = onCall(
  { region: 'southamerica-east1', secrets: [RESEND_API_KEY, FROM_EMAIL] },
  async (request) => {
    const token = ((request.data && request.data.token) || '').trim();
    if (!token) throw new HttpsError('invalid-argument', 'token es requerido');
    const db = admin.firestore();
    const doc = await findBookingByToken(db, token);
    const b = doc.data();
    const check = canCancel(b, new Date());
    if (!check.ok) throw new HttpsError('failed-precondition', check.reason);
    await doc.ref.update({ status: 'cancelled', cancelledAt: new Date().toISOString() });
    try {
      await sendCancelEmail(b, { apiKey: RESEND_API_KEY.value(), fromEmail: FROM_EMAIL.value() });
    } catch (err) {
      logger.error('Fallo al enviar email de cancelación', err);
    }
    // Gancho para el Spec 2 (push a admin): se dispara sobre este mismo
    // cambio de status a 'cancelled', no sobre este adminLog.
    await db.collection('adminLog').add({
      action: 'client_cancelled_booking', item: b.code || '', date: new Date().toLocaleString('es-CL'),
    });
    return { ok: true };
  }
);

exports.modifyBooking = onCall(
  { region: 'southamerica-east1', secrets: [RESEND_API_KEY, FROM_EMAIL] },
  async (request) => {
    const data = request.data || {};
    const token = (data.token || '').trim();
    if (!token) throw new HttpsError('invalid-argument', 'token es requerido');
    const svcId = (data.svcId || '').trim();
    const barberId = (data.barberId || '').trim();
    const date = (data.date || '').trim();
    const time = (data.time || '').trim();
    const svcName = (data.svcName || '').trim();
    const barberName = (data.barberName || '').trim();
    const price = Number(data.price) || 0;
    const dur = Number(data.dur) || 0;
    if (!svcId || !barberId || !date || !time) {
      throw new HttpsError('invalid-argument', 'svcId, barberId, date y time son requeridos');
    }
    const db = admin.firestore();
    const doc = await findBookingByToken(db, token);
    const oldB = doc.data();
    const check = canModify(oldB, new Date());
    if (!check.ok) throw new HttpsError('failed-precondition', check.reason);

    // Validar disponibilidad real del nuevo horario -- mismo motor que
    // getAvailability, excluyendo la propia reserva (por code) y las canceladas.
    const [bookingsSnap, staffSnap] = await Promise.all([
      db.collection('bookings').where('date', '==', date).get(),
      db.collection('staff').where('status', '==', 'active').get(),
    ]);
    const otherBookings = bookingsSnap.docs.map((d) => d.data()).filter((b) => b.code !== oldB.code);
    const staff = staffSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const { barberBusy, activeBarberIds } = computeAvailability({ bookings: otherBookings, staff, barberId });
    if (!activeBarberIds.includes(barberId)) throw new HttpsError('failed-precondition', 'barber_inactive');
    const newStart = toMinutes(time);
    const newEnd = newStart + dur;
    const busy = barberBusy[barberId] || [];
    const conflict = busy.some((r) => newStart < toMinutes(r.end) && newEnd > toMinutes(r.start));
    if (conflict) throw new HttpsError('failed-precondition', 'slot_unavailable');

    const newB = { ...oldB, svcId, svcName, barberId, barberName, date, time, price, dur, modifyCount: (oldB.modifyCount || 0) + 1 };
    await doc.ref.update({
      svcId, svcName, barberId, barberName, date, time, price, dur,
      modifyCount: (oldB.modifyCount || 0) + 1,
    });
    try {
      await sendModifyEmail(oldB, newB, { apiKey: RESEND_API_KEY.value(), fromEmail: FROM_EMAIL.value() });
    } catch (err) {
      logger.error('Fallo al enviar email de modificación', err);
    }
    return { ok: true };
  }
);

// Recordatorio 24h antes de la cita -- ver functions/reminders.js para la
// lógica testeable (ventana rodante + query + filtro). Este trigger solo
// conecta esa lógica con Firestore/Resend reales.
exports.sendBookingReminders = onSchedule(
  { schedule: 'every 15 minutes', region: 'southamerica-east1', secrets: [RESEND_API_KEY, FROM_EMAIL] },
  async () => {
    const db = admin.firestore();
    const sent = await runReminders({
      db,
      now: new Date(),
      sendEmail: (b) => sendReminderEmail(b, { apiKey: RESEND_API_KEY.value(), fromEmail: FROM_EMAIL.value() }),
      onError: (err, b) => logger.error('Fallo al enviar recordatorio', { code: b.code, err }),
    });
    logger.info('Recordatorios enviados', { sent });
  }
);
```

- [ ] **Step 3: Verificación manual (emulador)**

Run: `firebase emulators:start`
- Create a booking from the public widget, note its `manageToken` from the emulator Firestore UI.
- From the browser console (any page connected to the emulator), call:
  ```js
  const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js');
  ```
  or simpler: wait for Task 9/10 (client wrappers + `mi-reserva.html`) and exercise it end-to-end there — this manual check is folded into Task 13.

- [ ] **Step 4: Commit**

```bash
git add functions/index.js
git commit -m "feat(functions): Cloud Functions de autogestión (confirmar/modificar/cancelar) + recordatorio 24h"
```

---

### Task 8: `checkConflict` (admin) — excluir canceladas

**Files:**
- Modify: `public/index.html:4462-4479`

- [ ] **Step 1: Modify `checkConflict`**

Replace:

```js
function checkConflict(barberId, dateStr, timeStr, durMin, ignoreId){
  var bookings = getBookings();
  var newStart = parseDt(dateStr, timeStr);
  if(!newStart) return null;
  var newEnd = new Date(newStart.getTime() + durMin*60000);
  for(var i=0; i<bookings.length; i++){
    var b = bookings[i];
    if(ignoreId && b.code === ignoreId) continue;
    if(b.barberId !== barberId) continue;
    var bStart = parseDt(b.date ? b.date.substring(0,10) : '', b.time);
    if(!bStart) continue;
    var bEnd = new Date(bStart.getTime() + (b.dur||30)*60000);
    if(newStart < bEnd && newEnd > bStart){
      return b;
    }
  }
  return null;
}
```

with:

```js
function checkConflict(barberId, dateStr, timeStr, durMin, ignoreId){
  var bookings = getBookings();
  var newStart = parseDt(dateStr, timeStr);
  if(!newStart) return null;
  var newEnd = new Date(newStart.getTime() + durMin*60000);
  for(var i=0; i<bookings.length; i++){
    var b = bookings[i];
    if(ignoreId && b.code === ignoreId) continue;
    if(b.status === 'cancelled') continue;
    if(b.barberId !== barberId) continue;
    var bStart = parseDt(b.date ? b.date.substring(0,10) : '', b.time);
    if(!bStart) continue;
    var bEnd = new Date(bStart.getTime() + (b.dur||30)*60000);
    if(newStart < bEnd && newEnd > bStart){
      return b;
    }
  }
  return null;
}
```

- [ ] **Step 2: Verificación manual**

In the admin panel, cancel a booking (once Task 12 wires up cancelled bookings; for now, manually set `status:'cancelled'` on a test doc via the emulator UI), then try to create a new booking for the same barber/date/time from the admin modal — it should no longer report a conflict.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "fix(admin): excluir reservas canceladas del chequeo de conflicto de horario"
```

---

### Task 9: `public/js/data.js` — wrappers de las 4 Cloud Functions

**Files:**
- Modify: `public/js/data.js`

- [ ] **Step 1: Agregar los wrappers**

Add after `getAvailability`:

```js
// Autogestión de citas (confirmar/modificar/cancelar) -- el cliente nunca
// lee/escribe `bookings` directo (ver firestore.rules), todo pasa por estas
// Cloud Functions vía token, igual que getAvailability/getClubStatus.
async function getBookingForManage(token) {
  const call = httpsCallable(functions, 'getBookingForManage');
  const { data } = await call({ token });
  return data;
}

async function confirmBookingAttendance(token) {
  const call = httpsCallable(functions, 'confirmBookingAttendance');
  const { data } = await call({ token });
  return data;
}

async function cancelBooking(token) {
  const call = httpsCallable(functions, 'cancelBooking');
  const { data } = await call({ token });
  return data;
}

async function modifyBooking(token, changes) {
  const call = httpsCallable(functions, 'modifyBooking');
  const { data } = await call({ token, ...changes });
  return data;
}
```

- [ ] **Step 2: Exponerlos en `window.SWData` y en el `export`**

Replace:

```js
window.SWData = {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus, getAvailability,
  loadSiteImages, saveSiteImage, deleteSiteImage,
};
export {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus, getAvailability,
  loadSiteImages, saveSiteImage, deleteSiteImage,
};
```

with:

```js
window.SWData = {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus, getAvailability,
  loadSiteImages, saveSiteImage, deleteSiteImage,
  getBookingForManage, confirmBookingAttendance, cancelBooking, modifyBooking,
};
export {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus, getAvailability,
  loadSiteImages, saveSiteImage, deleteSiteImage,
  getBookingForManage, confirmBookingAttendance, cancelBooking, modifyBooking,
};
```

- [ ] **Step 3: Commit**

```bash
git add public/js/data.js
git commit -m "feat(web): wrappers de datos para las Cloud Functions de autogestión"
```

---

### Task 10: `public/mi-reserva.html` + `public/js/manage-booking.js`

**Files:**
- Create: `public/mi-reserva.html`
- Create: `public/js/manage-booking.js`

- [ ] **Step 1: Create `public/mi-reserva.html`**

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mi reserva — SW Studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,500&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  :root{ --ink:#0e0e0e; --cream:#f3f2f0; --line:#e5e4e1; --meta:#6b6b6b; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--cream);font-family:'Jost',sans-serif;color:var(--ink);display:flex;justify-content:center;padding:32px 16px}
  .card{width:100%;max-width:480px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.08);align-self:flex-start}
  .hero{background:var(--ink);color:#fff;padding:28px 26px}
  .hero h1{margin:0 0 6px;font-family:'Cormorant Garamond',serif;font-weight:600;font-size:26px}
  .hero p{margin:0;font-size:13px;color:#c9c7c4}
  .body{padding:24px 26px}
  .row{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid var(--line);font-size:14px}
  .row:last-child{border-bottom:none}
  .row .lbl{color:var(--meta);letter-spacing:.05em;text-transform:uppercase;font-size:11px;white-space:nowrap}
  .row .val{font-family:'Cormorant Garamond',serif;font-weight:600;font-size:16px;text-align:right}
  .actions{display:flex;flex-direction:column;gap:10px;margin-top:22px}
  .btn{display:block;width:100%;border:none;border-radius:8px;padding:14px;font-family:'Jost',sans-serif;font-weight:500;font-size:14px;letter-spacing:.05em;color:#fff;cursor:pointer;text-align:center;text-decoration:none}
  .btn:disabled{opacity:.4;cursor:not-allowed}
  .btn-confirm{background:#1f8a4c}
  .btn-modify{background:#c8842a}
  .btn-cancel{background:#b3402f}
  .note{margin-top:14px;font-size:12px;color:var(--meta);line-height:1.5}
  .note a{color:var(--ink)}
  .msg{padding:40px 26px;text-align:center}
  .msg h2{font-family:'Cormorant Garamond',serif;margin:0 0 8px}
  .modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:20px}
  .modal-backdrop.show{display:flex}
  .modal{background:#fff;border-radius:12px;padding:24px;max-width:360px;width:100%}
  .modal p{font-size:14px;line-height:1.5;margin:0}
  .modal .row2{display:flex;gap:10px;margin-top:16px}
  .modal button{flex:1;padding:12px;border:none;border-radius:8px;font-family:'Jost',sans-serif;cursor:pointer;font-size:13px}
</style>
</head>
<body>
  <div class="card" id="app">
    <div class="hero"><h1>SW Studio</h1><p>Gestiona tu reserva</p></div>
    <div class="body" id="content">Cargando tu reserva…</div>
  </div>

  <div class="modal-backdrop" id="cancel-modal">
    <div class="modal">
      <p id="cancel-modal-text">¿Seguro que quieres cancelar tu cita?</p>
      <div class="row2">
        <button id="cancel-modal-back" style="background:var(--line)">Volver</button>
        <button id="cancel-modal-ok" style="background:#b3402f;color:#fff">Sí, cancelar</button>
      </div>
    </div>
  </div>

  <script type="module" src="/js/manage-booking.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/js/manage-booking.js`**

```js
// public/js/manage-booking.js — lógica de public/mi-reserva.html: lee
// ?code=...&t=<manageToken> de la URL y llama a las Cloud Functions de
// autogestión (nunca lee/escribe `bookings` directo, ver firestore.rules).
import './firebase-init.js';
import './data.js';

const params = new URLSearchParams(location.search);
const token = params.get('t') || '';
const content = document.getElementById('content');

const DOW = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// El campo `date` guarda medianoche en Chile serializada con toISOString();
// leer los componentes UTC directo da el día calendario correcto porque
// Santiago siempre está detrás de UTC (medianoche Chile cae en horas de la
// MADRUGADA UTC del MISMO día, nunca cruza al día anterior).
function fmtFecha(b) {
  const d = new Date(b.date);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
}

function renderError(msg) {
  content.innerHTML = `<div class="msg"><h2>No pudimos cargar tu reserva</h2><p>${msg}</p></div>`;
}

function renderCancelledState(b) {
  content.innerHTML = `<div class="msg"><h2>Esta cita ya fue cancelada</h2>
    <p>Código ${b.code}. Si fue un error, agenda una nueva hora desde nuestra web.</p></div>`;
}

function renderSuccess(text) {
  content.innerHTML = `<div class="msg"><h2>${text}</h2></div>`;
}

function renderBooking(b) {
  if (b.status === 'cancelled') { renderCancelledState(b); return; }
  const rows = `
    <div class="row"><span class="lbl">Servicio</span><span class="val">${b.svcName}</span></div>
    <div class="row"><span class="lbl">Barbero</span><span class="val">${b.barberName}</span></div>
    <div class="row"><span class="lbl">Fecha</span><span class="val">${fmtFecha(b)}</span></div>
    <div class="row"><span class="lbl">Hora</span><span class="val">${b.time} hrs</span></div>
    <div class="row"><span class="lbl">Código</span><span class="val">${b.code}</span></div>
  `;
  const tooLate = !b.canCancel && !b.canModify && b.modifyCount < 2;
  content.innerHTML = `
    ${rows}
    <div class="actions">
      <button class="btn btn-confirm" id="btn-confirm" ${b.attendanceConfirmed ? 'disabled' : ''}>
        ${b.attendanceConfirmed ? '✓ Ya confirmaste tu asistencia' : '✓ Confirmar cita'}
      </button>
      <button class="btn btn-modify" id="btn-modify" ${b.canModify ? '' : 'disabled'}>✎ Modificar cita</button>
      <button class="btn btn-cancel" id="btn-cancel" ${b.canCancel ? '' : 'disabled'}>✕ Cancelar cita</button>
    </div>
    ${!b.canModify && b.modifyCount >= 2 ? '<p class="note">Ya alcanzaste el máximo de 2 modificaciones. Para cambios adicionales, escríbenos por <a href="https://wa.me/56982514114" target="_blank">WhatsApp</a>.</p>' : ''}
    ${tooLate ? '<p class="note">Para cambios de último minuto (menos de 3 horas antes de tu cita), escríbenos por <a href="https://wa.me/56982514114" target="_blank">WhatsApp</a>.</p>' : ''}
  `;

  document.getElementById('btn-confirm').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirm');
    btn.disabled = true; btn.textContent = 'Confirmando…';
    try {
      await window.SWData.confirmBookingAttendance(token);
      renderSuccess('¡Gracias, te esperamos!');
    } catch (e) {
      renderError('No se pudo confirmar tu asistencia. Intenta de nuevo o escríbenos por WhatsApp.');
    }
  });

  document.getElementById('btn-modify').addEventListener('click', () => {
    location.href = `/index.html#reservar&editCode=${encodeURIComponent(b.code)}&editToken=${encodeURIComponent(token)}`;
  });

  document.getElementById('btn-cancel').addEventListener('click', () => {
    document.getElementById('cancel-modal-text').textContent =
      `¿Seguro que quieres cancelar tu cita del ${fmtFecha(b)} a las ${b.time} hrs?`;
    document.getElementById('cancel-modal').classList.add('show');
  });
}

document.getElementById('cancel-modal-back').addEventListener('click', () => {
  document.getElementById('cancel-modal').classList.remove('show');
});
document.getElementById('cancel-modal-ok').addEventListener('click', async () => {
  document.getElementById('cancel-modal').classList.remove('show');
  try {
    await window.SWData.cancelBooking(token);
    renderSuccess('Tu cita fue cancelada exitosamente');
  } catch (e) {
    renderError('No se pudo cancelar tu cita. Intenta de nuevo o escríbenos por WhatsApp.');
  }
});

async function init() {
  if (!token) { renderError('Link inválido: falta el código de acceso.'); return; }
  try {
    const b = await window.SWData.getBookingForManage(token);
    renderBooking(b);
  } catch (e) {
    renderError('No encontramos esta reserva. Verifica el link o contáctanos por WhatsApp.');
  }
}
init();
```

- [ ] **Step 3: Verificación manual**

Run: `firebase emulators:start`, then create a booking from the public widget, copy its `code`/`manageToken` from the emulator Firestore UI, and open `http://localhost:5000/mi-reserva.html?code=<code>&t=<manageToken>` (adjust port to whatever `firebase.json` hosting rewrite uses). Confirm the card renders with the 3 buttons, "Confirmar cita" works and disables itself, and "Cancelar cita" shows the modal before calling `cancelBooking`.

- [ ] **Step 4: Commit**

```bash
git add public/mi-reserva.html public/js/manage-booking.js
git commit -m "feat(web): página mi-reserva.html para confirmar/modificar/cancelar una cita"
```

---

### Task 11: Modo edición en el widget de reserva (`public/index.html`)

**Files:**
- Modify: `public/index.html:2631` (estado `S`), `public/index.html:2715` (hook de apertura), `public/index.html:3080-3167` (submit)

- [ ] **Step 1: Agregar estado `EDIT` y `openBKForEdit`**

Replace:

```js
// STATE
let S = {step:1, svc:null, barber:null, date:null, time:null, club:'member'};
```

with:

```js
// STATE
let S = {step:1, svc:null, barber:null, date:null, time:null, club:'member'};
let EDIT = null; // {code, token} cuando el widget se abre para MODIFICAR una reserva existente
```

Then, after `document.addEventListener('DOMContentLoaded', hookButtons);` / `setTimeout(hookButtons, 500);`, add:

```js
// ══ MODO EDICIÓN (link "Modificar cita" desde mi-reserva.html) ══
// mi-reserva.html redirige acá con #reservar&editCode=...&editToken=...;
// se precarga la reserva actual y se deja elegir un nuevo horario con el
// mismo motor de disponibilidad real -- ver Task 6 del spec.
async function openBKForEdit(code, token){
  openBK();
  EDIT = { code, token };
  try{
    const info = await window.SWData.getBookingForManage(token);
    const allItems = CATS.flatMap(c => c.items);
    S.svc = allItems.find(i => i.id === info.svcId) || null;
    S.barber = BARBERS.find(b => b.id === info.barberId) || null;
    S.date = new Date(info.date);
    S.time = info.time;
    renderSvcs(); renderBarbers(); renderCal(); updateSummary();
    const nameEl = document.getElementById('bkf-name');
    const emailEl = document.getElementById('bkf-email');
    const phoneEl = document.getElementById('bkf-phone');
    if(nameEl) { nameEl.value = info.name || ''; nameEl.disabled = true; }
    if(emailEl) { emailEl.value = info.email || ''; emailEl.disabled = true; }
    if(phoneEl) { phoneEl.value = info.phone || ''; phoneEl.disabled = true; }
    bkGoTo(3);
  }catch(e){
    console.error('No se pudo cargar la reserva para editar', e);
    closeBK();
    alert('No pudimos cargar tu reserva para modificarla. Verifica el link o escríbenos por WhatsApp.');
  }
}

function checkEditModeFromHash(){
  const m = location.hash.match(/^#reservar&editCode=([^&]+)&editToken=([^&]+)/);
  if(!m) return;
  openBKForEdit(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
}
document.addEventListener('DOMContentLoaded', checkEditModeFromHash);
```

- [ ] **Step 2: Ramificar el submit para modo edición**

Replace the start of the `bk-submit` click handler:

```js
document.getElementById('bk-submit').addEventListener('click',()=>{
  if(!validate()) return;
  const btn=document.getElementById('bk-submit');
  btn.innerHTML='<span class="bk-spinner"></span> Procesando...';
  btn.disabled=true;
  setTimeout(async ()=>{
```

with:

```js
document.getElementById('bk-submit').addEventListener('click',()=>{
  if(!validate()) return;
  const btn=document.getElementById('bk-submit');
  btn.innerHTML='<span class="bk-spinner"></span> Procesando...';
  btn.disabled=true;
  if(EDIT){
    setTimeout(async ()=>{
      try{
        await withTimeout(window.SWData.modifyBooking(EDIT.token, {
          svcId:S.svc?.id, svcName:S.svc?.name, barberId:S.barber?.id, barberName:S.barber?.name,
          date:S.date?S.date.toISOString():'', time:S.time,
          price:S.svc?.price||0, dur:S.svc?.dur||0,
        }), 15000, 'modifyBooking');
        document.getElementById('bk-confirm-h').textContent='¡Tu cita fue modificada!';
        document.getElementById('bk-confirm-code').textContent=EDIT.code;
        document.getElementById('bk-confirm-sub').textContent=
          'Tu nueva hora quedó agendada. Te enviamos un correo con el detalle actualizado.';
        document.getElementById('bk-confirm-details').innerHTML=`
          <div class="bk-sum-row"><div class="bk-sum-lbl">Servicio</div><div class="bk-sum-val">${S.svc.name}</div></div>
          <div class="bk-sum-row"><div class="bk-sum-lbl">Barbero</div><div class="bk-sum-val">${S.barber.name}</div></div>
          <div class="bk-sum-row"><div class="bk-sum-lbl">Fecha & Hora</div><div class="bk-sum-val">${S.date.toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'})} · ${S.time} hrs</div></div>
          <div class="bk-sum-row"><div class="bk-sum-lbl">Código</div><div class="bk-sum-val">${EDIT.code}</div></div>
        `;
        document.getElementById('bk-stepper').style.display='none';
        bkGoTo('done');
      }catch(e){
        console.error('No se pudo modificar la reserva', e);
        btn.innerHTML='Reintentar';
        btn.disabled=false;
        alert('No pudimos guardar el cambio (el horario puede que ya no esté disponible). Intenta con otro horario o escríbenos por WhatsApp.');
      }
    },900);
    return;
  }
  setTimeout(async ()=>{
```

(The rest of the original `setTimeout(async ()=>{ ... }, 900);` body — the creation path — is unchanged; only the new `if(EDIT){...return;}` guard is inserted before it.)

- [ ] **Step 3: Verificación manual**

From `mi-reserva.html` (Task 10), click "Modificar cita" on a booking with `canModify:true`. Confirm the widget opens on step 3 (Fecha) with the correct service/barber pre-selected and the name/email/phone fields pre-filled and disabled. Pick a new date/time and submit; confirm the success screen shows "¡Tu cita fue modificada!" and the booking doc's `modifyCount` incremented in the emulator UI.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat(web): modo edición en el widget de reserva para modificar una cita existente"
```

---

### Task 12: Agenda admin — estilo "cancelada" + badge "Confirmada por cliente"

**Files:**
- Modify: `public/index.html:4575` (busyRanges), `public/index.html:4610-4614` (card render), admin `<style>` block

- [ ] **Step 1: Excluir canceladas del sombreado libre/ocupado**

Replace:

```js
  var busyRanges = evs.map(function(e){ return [e.start, e.end]; });
```

with:

```js
  // Las citas canceladas siguen visibles en el timeline (trazabilidad), pero
  // no cuentan como "ocupado" -- mismo criterio que el fix de disponibilidad.
  var busyRanges = evs.filter(function(e){ return e.bk.status !== 'cancelled'; }).map(function(e){ return [e.start, e.end]; });
```

- [ ] **Step 2: Agregar clase "cancelled" y badge de confirmación a la tarjeta**

Replace:

```js
    return '<div class="a-bk-card'+(b.over?' over':'')+dens+'" style="'+style+'" '+
             'data-code="'+esc(b.code)+'" '+
             'title="'+esc((b.time||'')+' · '+(b.name||'Cliente')+' · '+(b.svcName||'')+' · '+bn)+'">'+
             inner+
           '</div>';
```

with:

```js
    var confirmedBadge = b.attendanceConfirmed ? '<span class="a-bk-card-confirmed" title="Confirmada por el cliente">✓</span>' : '';
    return '<div class="a-bk-card'+(b.over?' over':'')+(b.status==='cancelled'?' cancelled':'')+dens+'" style="'+style+'" '+
             'data-code="'+esc(b.code)+'" '+
             'title="'+esc((b.time||'')+' · '+(b.name||'Cliente')+' · '+(b.svcName||'')+' · '+bn)+(b.status==='cancelled'?' · CANCELADA':'')+'">'+
             confirmedBadge+inner+
           '</div>';
```

- [ ] **Step 3: Localizar el bloque CSS `.a-bk-card` y agregar las 2 reglas nuevas**

Run: `grep -n "\.a-bk-card{" public/index.html` to find the exact line of the base rule.

Add immediately after that rule's closing `}`:

```css
.a-bk-card.cancelled{opacity:.45;text-decoration:line-through}
.a-bk-card-confirmed{position:absolute;top:3px;right:5px;font-size:11px;color:#1f8a4c;font-weight:700}
```

(If `.a-bk-card` is not `position:relative`, add `position:relative` to it too — the badge needs a positioned ancestor. Check with `grep -n "\.a-bk-card{" -A5 public/index.html` before editing.)

- [ ] **Step 4: Verificación manual**

Cancel a test booking via `mi-reserva.html` (Task 10), then open the admin Agenda for that day: the card should show struck-through/dimmed, not count as a conflict when creating a new booking at the same slot, and a booking with `attendanceConfirmed:true` should show the "✓" badge.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(admin): mostrar citas canceladas y badge de confirmación en la Agenda"
```

---

### Task 13: Verificación end-to-end (emulador)

**Files:** none (manual QA pass over everything above)

- [ ] **Step 1: Levantar el emulador**

Run: `firebase emulators:start`

- [ ] **Step 2: Ejecutar toda la suite de tests backend**

Run: `cd functions && npm test`
Expected: PASS — all suites (`bookingRules`, `availability`, `email`, `reminders`, `patients`).

- [ ] **Step 3: Flujo confirmar**

Create a booking from the public widget → open its `mi-reserva.html` link (built from the emulator doc's `code`+`manageToken`) → click "Confirmar cita" → verify `attendanceConfirmed:true` in Firestore and the "✓" badge in the admin Agenda.

- [ ] **Step 4: Flujo cancelar**

On a different booking, click "Cancelar cita" → confirm the modal appears → confirm → verify `status:'cancelled'` in Firestore, the cancellation email arrives (check Resend logs or a test inbox), and the slot shows as available again via `getAvailability` (e.g. by reopening the public widget and checking that hour is selectable).

- [ ] **Step 5: Flujo modificar (dos veces, y el tope)**

Modify a booking's date/time via "Modificar cita" → verify `modifyCount:1`, the widget was correctly prefilled, and the modification email shows the old value struck through and the new one below. Repeat once more (`modifyCount:2`) and verify a third attempt shows "Modificar" disabled with the WhatsApp message.

- [ ] **Step 6: Regla de 3 horas**

Manually edit a test booking's `date`/`time` in the emulator Firestore UI to fall less than 3 hours from now, reload `mi-reserva.html`, and verify both "Modificar" and "Cancelar" render disabled with the WhatsApp message.

- [ ] **Step 7: Recordatorio 24h**

Create a booking with `date`/`time` inside the current `[now+24h, now+24h+15min)` window (compute it from the current wall clock), then manually invoke the scheduled function once via the emulator's Functions shell (`firebase functions:shell`, call `sendBookingReminders()`), and verify the reminder email arrives and `reminderSentAt` is set (and that invoking it again does not resend).

- [ ] **Step 8: Reglas de Firestore**

Attempt to create a `bookings` doc via the client SDK (browser console, connected to the emulator) without a `manageToken` field — confirm it's rejected. Confirm one with a 32-char `manageToken` is accepted.

- [ ] **Step 9: No further commit needed**

This task is verification-only. If any step surfaces a bug, fix it in the relevant task's file, re-run that task's automated tests, and commit the fix with a message describing what was wrong (e.g. `fix(functions): ...`).

---

## Fuera de alcance (recordatorio)

Push real a admin al cancelar (Spec 2 — se engancha al cambio de `status` a `'cancelled'` que `cancelBooking` ya escribe en Task 7), avisos por WhatsApp, reintentos automáticos de email, autenticación real de cliente, y el bug preexistente de "Eliminar cita" en el admin. Ver `docs/superpowers/specs/2026-07-30-autogestion-citas-design.md` para el detalle.
