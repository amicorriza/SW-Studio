# Consolidar solape/timezone/validación/estado en shared/ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la lógica de solape de horarios, zona horaria, validación de payload y estado de reserva viva en un solo lugar (`functions/shared/availability.js`, `functions/shared/timezone.js`, `functions/shared/validate.js`, `functions/shared/status.js`), importado directamente por `functions/`, y que el panel admin deje de calcular solapes con la hora local del navegador.

**Architecture:** `functions/availability.js` y `functions/timezone.js` ya son módulos puros, testeados y correctos — se **mueven tal cual** a `functions/shared/` (`git mv`, sin reescribir lógica) y se actualizan los `require()` que ya existen en `functions/`. `functions/shared/validate.js` es una extracción mecánica de `isValidBookingPayload()` (hoy inline en `createBooking.js`). `functions/shared/status.js` es un módulo nuevo y mínimo (una constante + un enum), porque hoy no existe lógica de estado que "unificar" — solo un `'pending'` repetido en dos sitios. El panel admin (`public/admin/index.html`) no puede hacer `require()` (script plano, sin bundler) — sus copias siguen siendo copias a mano, documentadas como tales, pero se **reescribe `checkConflict()`/`checkScheduleBlock()`** para usar el mismo criterio de minutos-desde-medianoche que `overlaps()`/`isRangeFree()`, en vez de construir objetos `Date` con la hora del navegador. `public/index.html` no se toca: su copia de solape (`isBarberFreeAt`) y de zona horaria ya son fieles al original.

**Tech Stack:** Node 22 (`functions/`, CommonJS, `node --test`), HTML/JS plano sin bundler (`public/index.html`, `public/admin/index.html`), Firestore rules (CEL, sin cambios en este plan).

**Decisiones ya tomadas con el usuario (no reabrir):**
1. El panel admin se corrige ahora para dejar de usar hora del navegador en `checkConflict()`/`checkScheduleBlock()` — es un cambio de comportamiento real, se verifica a mano en el emulador antes de dar la tarea por cerrada.
2. `shared/validate.js` solo extrae `isValidBookingPayload()` tal cual vive hoy. NO se toca el camino de escritura directa del admin a Firestore, ni `firestore.rules` (`isValidEmail()` sigue siendo el único gate real de ese camino — brecha conocida, fuera de alcance).
3. `shared/status.js` es mínimo: la constante por defecto y un enum de estados válidos, sin transiciones ni máquina de estados (eso es autogestión/etapa B, prohibido en esta etapa).
4. Los 4 módulos viven en `functions/shared/`, no en `shared/` en la raíz del repo — `firebase.json` solo empaqueta `functions/` al desplegar; ponerlos en la raíz rompería el deploy en silencio.

---

## File Structure

- `functions/shared/availability.js` — **mover** desde `functions/availability.js` (git mv, sin cambios de contenido salvo el comentario de cabecera).
- `functions/shared/timezone.js` — **mover** desde `functions/timezone.js` (idem).
- `functions/shared/validate.js` — **crear**. Extrae `EMAIL_RE` + `isValidBookingPayload()` desde `functions/createBooking.js`.
- `functions/shared/status.js` — **crear**. `DEFAULT_BOOKING_STATUS`, `BOOKING_STATUSES`, `isValidBookingStatus()`.
- `functions/createBooking.js` — **modificar**: imports apuntan a `./shared/*.js`; `buildBookingDoc()` usa `DEFAULT_BOOKING_STATUS`.
- `functions/email.js`, `functions/index.js` — **modificar**: imports apuntan a `./shared/*.js`.
- `functions/scripts/backfillAvailability.js` — **modificar**: import apunta a `../shared/availability.js`.
- `functions/test/availability.test.js`, `functions/test/timezone.test.js`, `functions/test/createBooking.test.js` — **modificar**: imports apuntan a `../shared/*.js`.
- `functions/test/status.test.js` — **crear**.
- `public/admin/index.html` — **modificar**: `checkConflict()`/`checkScheduleBlock()` reescritas (líneas ~1696-1760); nuevo `toMin()`/`dowOfDateKey()` locales; `status: prev.status || 'pending'` (línea 2342) usa una constante local documentada.
- `public/index.html`, `public/js/data.js` — **modificar solo comentarios** (rutas a `functions/timezone.js`/`functions/availability.js` desactualizadas tras el `git mv`).
- `CLAUDE.md` — **modificar**: la sección "Estado conocido" ya no debe decir que hay 3 copias sin registrar del solape/tz — se reemplaza por el estado real post-consolidación.

---

### Task 1: Mover availability.js y timezone.js a functions/shared/

**Files:**
- Move: `functions/availability.js` → `functions/shared/availability.js`
- Move: `functions/timezone.js` → `functions/shared/timezone.js`
- Modify: `functions/createBooking.js:9-10`
- Modify: `functions/email.js:4-5`
- Modify: `functions/index.js:12,14`
- Modify: `functions/scripts/backfillAvailability.js:34`
- Modify: `functions/test/availability.test.js:6`
- Modify: `functions/test/timezone.test.js:3`
- Modify: `functions/test/createBooking.test.js:4`

- [ ] **Step 1: Crear el directorio y mover los dos archivos con git mv**

```bash
cd functions
git mv availability.js shared/availability.js
git mv timezone.js shared/timezone.js
cd ..
```

- [ ] **Step 2: Actualizar la cabecera de cada archivo movido**

En `functions/shared/availability.js`, línea 1:

```js
// functions/availability.js — lógica pura de disponibilidad de horarios.
```
→
```js
// functions/shared/availability.js — lógica pura de disponibilidad de
// horarios. Módulo único: functions/createBooking.js, functions/index.js y
// functions/email.js lo importan de acá. public/index.html mantiene una
// copia deliberada de isBarberFreeAt() (mismo criterio, documentado ahí) por
// ser <script> plano sin bundler. public/admin/index.html YA NO tiene una
// copia divergente: checkConflict()/checkScheduleBlock() usan el mismo
// criterio de minutos-desde-medianoche que overlaps()/isRangeFree() acá
// (antes usaban objetos Date en hora del navegador — ver el comentario en
// public/admin/index.html junto a checkConflict()).
```

En `functions/shared/timezone.js`, línea 1:

```js
// functions/timezone.js — conversión entre hora de pared del negocio y el
```
→
```js
// functions/shared/timezone.js — conversión entre hora de pared del negocio
// y el
```

(el resto del comentario de cabecera de `timezone.js` sigue igual, solo cambia la primera línea con la ruta).

- [ ] **Step 3: Actualizar los imports en functions/createBooking.js**

```js
} = require('./availability.js');
const { zonedInstant } = require('./timezone.js');
```
→
```js
} = require('./shared/availability.js');
const { zonedInstant } = require('./shared/timezone.js');
```

- [ ] **Step 4: Actualizar los imports en functions/email.js**

```js
const { DEFAULT_TZ, zonedInstant } = require('./timezone.js');
const { dateKeyOf } = require('./availability.js');
```
→
```js
const { DEFAULT_TZ, zonedInstant } = require('./shared/timezone.js');
const { dateKeyOf } = require('./shared/availability.js');
```

- [ ] **Step 5: Actualizar los imports en functions/index.js**

```js
const { computeAvailability, dateKeyOf, dayBoundsOf } = require('./availability.js');
const { resolveCreateBooking } = require('./createBooking.js');
const { resolveBusinessTz, resolveBufferMin } = require('./timezone.js');
```
→
```js
const { computeAvailability, dateKeyOf, dayBoundsOf } = require('./shared/availability.js');
const { resolveCreateBooking } = require('./createBooking.js');
const { resolveBusinessTz, resolveBufferMin } = require('./shared/timezone.js');
```

- [ ] **Step 6: Actualizar functions/scripts/backfillAvailability.js**

```js
const { computeAvailability, dateKeyOf } = require('../availability.js');
```
→
```js
const { computeAvailability, dateKeyOf } = require('../shared/availability.js');
```

- [ ] **Step 7: Actualizar los tests**

`functions/test/availability.test.js`, línea 6:
```js
} = require('../availability.js');
```
→
```js
} = require('../shared/availability.js');
```

`functions/test/timezone.test.js`, línea 3:
```js
const { DEFAULT_TZ, resolveBusinessTz, zonedInstant, dateKeyInZone, timeKeyInZone } = require('../timezone.js');
```
→
```js
const { DEFAULT_TZ, resolveBusinessTz, zonedInstant, dateKeyInZone, timeKeyInZone } = require('../shared/timezone.js');
```

`functions/test/createBooking.test.js`, línea 4:
```js
const { dateKeyOf } = require('../availability.js');
```
→
```js
const { dateKeyOf } = require('../shared/availability.js');
```

- [ ] **Step 8: Correr la suite completa de functions/**

Run: `cd functions && npm test`
Expected: todos los tests pasan (mismo resultado que antes del `git mv` — este paso no cambia comportamiento, solo rutas).

- [ ] **Step 9: Commit**

```bash
git add functions/shared/availability.js functions/shared/timezone.js functions/availability.js functions/timezone.js functions/createBooking.js functions/email.js functions/index.js functions/scripts/backfillAvailability.js functions/test/availability.test.js functions/test/timezone.test.js functions/test/createBooking.test.js
git commit -m "refactor(functions): mover availability.js y timezone.js a functions/shared/"
```

---

### Task 2: Crear functions/shared/validate.js

**Files:**
- Create: `functions/shared/validate.js`
- Modify: `functions/createBooking.js:12-34`
- Test: `functions/test/createBooking.test.js` (sin cambios — sigue importando `isValidBookingPayload` desde `createBooking.js`, que la re-exporta)

- [ ] **Step 1: Crear functions/shared/validate.js**

```js
// functions/shared/validate.js — validación del payload de una reserva
// nueva. Reemplaza la implementación que vivía inline en
// functions/createBooking.js (mismo código, mismo criterio, solo movida acá
// para ser la fuente única).
//
// Réplica EXACTA (mismo criterio, campo a campo) de isValidBooking() en
// firestore.rules -- no se puede compartir código entre CEL (reglas) y JS,
// así que sigue siendo deuda de sincronización manual con esa regla. Esa
// regla (isValidBooking) hoy es código muerto: ningún `allow` la invoca, ver
// el comentario ahí.
//
// El panel admin NO pasa por esta función: escribe reservas directo a
// Firestore (public/admin/index.html → SWData.saveBooking), gateado en
// servidor solo por isValidEmail() en firestore.rules -- un criterio mucho
// más débil (solo formato de email, y opcional). Cerrar esa brecha es
// trabajo aparte, fuera de alcance acá.
'use strict';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isValidBookingPayload(payload) {
  const p = payload || {};
  return typeof p.name === 'string' && p.name.length > 1
    && typeof p.email === 'string' && EMAIL_RE.test(p.email)
    && typeof p.phone === 'string' && p.phone.length >= 7
    && typeof p.svcId === 'string'
    && typeof p.barberId === 'string'
    && typeof p.date === 'string'
    && typeof p.time === 'string'
    && typeof p.code === 'string'
    && typeof p.club === 'string' && (p.club === 'member' || p.club === 'guest');
}

module.exports = { EMAIL_RE, isValidBookingPayload };
```

- [ ] **Step 2: Reemplazar el bloque inline en functions/createBooking.js**

```js
const {
  addMinutesToTime, computeAvailability, dateKeyOf, isRangeFree, isWithinOpenHours,
} = require('./shared/availability.js');
const { zonedInstant } = require('./shared/timezone.js');

// Mismo regex que isValidBooking() en firestore.rules.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Réplica EXACTA (mismo criterio, campo a campo) de isValidBooking() en
// firestore.rules -- no se puede compartir código entre CEL (reglas) y JS,
// así que esto es deuda de sincronización manual desde el minuto uno.
// tests/rules/createBooking.crosscheck.test.js prueba el mismo set de
// payloads contra ambos caminos para detectar divergencia. A propósito NO
// exige que svcId/barberId/date/time/code sean no-vacíos -- la regla
// tampoco lo exige (`is string` acepta ''); ver el guard de svcId vacío en
// index.js, que evita que eso llegue a un .doc('') de Firestore.
function isValidBookingPayload(payload) {
  const p = payload || {};
  return typeof p.name === 'string' && p.name.length > 1
    && typeof p.email === 'string' && EMAIL_RE.test(p.email)
    && typeof p.phone === 'string' && p.phone.length >= 7
    && typeof p.svcId === 'string'
    && typeof p.barberId === 'string'
    && typeof p.date === 'string'
    && typeof p.time === 'string'
    && typeof p.code === 'string'
    && typeof p.club === 'string' && (p.club === 'member' || p.club === 'guest');
}
```
→
```js
const {
  addMinutesToTime, computeAvailability, dateKeyOf, isRangeFree, isWithinOpenHours,
} = require('./shared/availability.js');
const { zonedInstant } = require('./shared/timezone.js');
const { isValidBookingPayload } = require('./shared/validate.js');
```

- [ ] **Step 3: Confirmar que module.exports sigue exportando isValidBookingPayload**

`functions/createBooking.js`, al final del archivo, ya tiene:

```js
module.exports = {
  isValidBookingPayload, orderCandidateBarbers, resolveBarber, buildBookingDoc, resolveCreateBooking,
};
```

No cambia — ahora reexporta el `isValidBookingPayload` importado en vez del que estaba definido inline. Esto mantiene sin cambios tanto `functions/test/createBooking.test.js` (que importa `isValidBookingPayload` desde `../createBooking.js`) como `tests/rules/createBooking.crosscheck.test.js` (que importa desde `../../functions/createBooking.js`).

- [ ] **Step 4: Crear functions/test/validate.test.js**

```js
const test = require('node:test');
const assert = require('node:assert');
const { EMAIL_RE, isValidBookingPayload } = require('../shared/validate.js');

function basePayload(overrides) {
  return Object.assign({
    name: 'Juan Pérez', email: 'juan@mail.com', phone: '+56912345678',
    svcId: 'lp', barberId: 'felipe', date: '2026-06-10', time: '11:00',
    code: 'SW-AB12345', club: 'guest',
  }, overrides || {});
}

test('isValidBookingPayload acepta un payload completo', () => {
  assert.strictEqual(isValidBookingPayload(basePayload()), true);
});

test('isValidBookingPayload rechaza email con formato inválido', () => {
  assert.strictEqual(isValidBookingPayload(basePayload({ email: 'no-es-email' })), false);
});

test('isValidBookingPayload rechaza phone corto (<7)', () => {
  assert.strictEqual(isValidBookingPayload(basePayload({ phone: '123' })), false);
});

test('isValidBookingPayload rechaza name de un solo carácter', () => {
  assert.strictEqual(isValidBookingPayload(basePayload({ name: 'J' })), false);
});

test('isValidBookingPayload rechaza club fuera de member/guest', () => {
  assert.strictEqual(isValidBookingPayload(basePayload({ club: 'vip' })), false);
});

test('EMAIL_RE es el mismo regex que usa isValidBooking() en firestore.rules', () => {
  assert.strictEqual(EMAIL_RE.source, '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$');
});
```

Este test duplica a propósito parte de la cobertura que ya existe en `functions/test/createBooking.test.js` (líneas 385-390) — esa suite prueba `isValidBookingPayload` importado desde `createBooking.js` (integración con el resto del resolver); este archivo nuevo la prueba importada directamente desde `shared/validate.js` (unidad, en su ubicación real). No se elimina la cobertura existente en `createBooking.test.js`.

- [ ] **Step 5: Correr los tests**

Run: `cd functions && npm test`
Expected: PASS, incluyendo los tests nuevos en `test/validate.test.js`.

- [ ] **Step 6: Commit**

```bash
git add functions/shared/validate.js functions/createBooking.js functions/test/validate.test.js
git commit -m "refactor(functions): extraer isValidBookingPayload a functions/shared/validate.js"
```

---

### Task 3: Crear functions/shared/status.js

**Files:**
- Create: `functions/shared/status.js`
- Modify: `functions/createBooking.js` (buildBookingDoc)
- Test: `functions/test/status.test.js` (nuevo)

- [ ] **Step 1: Crear functions/shared/status.js**

```js
// functions/shared/status.js — estado de una reserva.
//
// Hoy existe UN solo valor posible ('pending') y NADA lo cambia después de
// crear la reserva: cancelar hace deleteDoc (destruye el registro), no un
// cambio de estado -- ver CLAUDE.md, "Estado conocido". No hay divergencia
// real que reconciliar acá (a diferencia de solape/timezone/validación):
// antes de este módulo, el valor 'pending' vivía repetido suelto en
// functions/createBooking.js (buildBookingDoc) y en
// public/admin/index.html (al guardar/editar una reserva).
//
// Este módulo NO introduce transiciones ni una máquina de estados -- eso es
// autogestión/etapa B, fuera de alcance en las etapas 0 y A (ver CLAUDE.md).
// Solo centraliza el valor por defecto y la lista de estados reconocidos
// para que los dos sitios de escritura no repitan el string suelto.
'use strict';

const BOOKING_STATUSES = ['pending'];
const DEFAULT_BOOKING_STATUS = 'pending';

function isValidBookingStatus(status) {
  return BOOKING_STATUSES.indexOf(status) !== -1;
}

module.exports = { BOOKING_STATUSES, DEFAULT_BOOKING_STATUS, isValidBookingStatus };
```

- [ ] **Step 2: Usar la constante en functions/createBooking.js**

Agregar el import junto a los otros de `./shared/`:

```js
const { isValidBookingPayload } = require('./shared/validate.js');
```
→
```js
const { isValidBookingPayload } = require('./shared/validate.js');
const { DEFAULT_BOOKING_STATUS } = require('./shared/status.js');
```

En `buildBookingDoc()`:

```js
    club: payload.club,
    status: 'pending',
    emailStatus: 'pending',
```
→
```js
    club: payload.club,
    status: DEFAULT_BOOKING_STATUS,
    emailStatus: 'pending',
```

(`emailStatus` es el estado de ENVÍO DE CORREO, un concepto distinto al estado de la reserva -- no lo toca este módulo.)

- [ ] **Step 3: Crear functions/test/status.test.js**

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

test('isValidBookingStatus acepta pending y rechaza cualquier otro valor', () => {
  assert.strictEqual(isValidBookingStatus('pending'), true);
  assert.strictEqual(isValidBookingStatus('confirmed'), false);
  assert.strictEqual(isValidBookingStatus(''), false);
  assert.strictEqual(isValidBookingStatus(undefined), false);
});
```

- [ ] **Step 4: Correr los tests**

Run: `cd functions && npm test`
Expected: PASS. `functions/test/createBooking.test.js:44` (`assert.strictEqual(result.doc.status, 'pending')`) sigue pasando sin modificarlo, porque `DEFAULT_BOOKING_STATUS === 'pending'`.

- [ ] **Step 5: Commit**

```bash
git add functions/shared/status.js functions/createBooking.js functions/test/status.test.js
git commit -m "feat(functions): crear functions/shared/status.js y usarlo en buildBookingDoc"
```

---

### Task 4: Reescribir checkConflict()/checkScheduleBlock() en el panel admin

**Files:**
- Modify: `public/admin/index.html:1696-1760` (checkConflict, parseDt usage, checkScheduleBlock)
- Modify: `public/admin/index.html:2338-2344` (constante de estado, ver Task 5 — se hace junto porque toca el mismo bloque)

Este es el único cambio de **comportamiento real** del plan: hoy `checkConflict()`/`checkScheduleBlock()` arman objetos `Date` con `parseDt()`/`parseYmd()`, que interpretan la hora en el huso del NAVEGADOR del admin, no en el del negocio. Además, `checkConflict()` no filtra explícitamente por día — confía en que la resta de timestamps absolutos separe naturalmente reservas de otros días. Al pasar a aritmética de minutos-desde-medianoche (mismo criterio que `overlaps()`/`isRangeFree()` en `functions/shared/availability.js` e `isBarberFreeAt()` en `public/index.html`), ese filtro de día deja de ser implícito y hay que agregarlo a mano.

- [ ] **Step 1: Leer el bloque actual completo para tenerlo de referencia exacta**

```bash
grep -n "" public/admin/index.html | sed -n '1696,1760p'
```

(Verificar que el contenido coincide con lo documentado en el diagnóstico antes de tocar nada — si no coincide, DETENERSE y avisar, no asumir.)

- [ ] **Step 2: Reemplazar el bloque checkConflict/parseDt/checkScheduleBlock**

Buscar en `public/admin/index.html`:

```js
// Check if a proposed booking conflicts with existing ones (same barber, overlapping time).
// bufferMin (D.info.bufferMin, default 0) es el margen de limpieza contra
// OTRAS RESERVAS -- checkScheduleBlock (colación/bloqueos) no lo usa, son
// límites duros e independientes del buffer.
function checkConflict(barberId, dateStr, timeStr, durMin, ignoreId, bufferMin){
  bufferMin = bufferMin || 0;
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
    var bStartBuf = new Date(bStart.getTime() - bufferMin*60000);
    var bEndBuf = new Date(bEnd.getTime() + bufferMin*60000);
    if(newStart < bEndBuf && newEnd > bStartBuf){
      return b;
    }
  }
  return null;
}
function parseDt(dateStr, timeStr){
  if(!dateStr || !timeStr) return null;
  var d = dateStr.length > 10 ? new Date(dateStr) : parseYmd(dateStr);
  if(isNaN(d.getTime())) return null;
  var p = timeStr.split(':');
  d.setHours(parseInt(p[0]||0), parseInt(p[1]||0), 0, 0);
  return d;
}
// Igual que checkConflict, pero contra colación recurrente + bloqueos
// puntuales en vez de otras reservas. Devuelve null (sin bloqueo) o
// {type, label} para armar el mensaje de advertencia.
function checkScheduleBlock(barberId, dateStr, timeStr, durMin){
  var newStart = parseDt(dateStr, timeStr);
  if(!newStart) return null;
  var newEnd = new Date(newStart.getTime() + durMin*60000);

  var barber = D.staff.find(function(s){return s.id===barberId});
  if(barber && Array.isArray(barber.schedule)){
    var dow = newStart.getDay();
    var day = barber.schedule[dow];
    if(day && day.break && day.break.start && day.break.end){
      var brkStart = parseDt(dateStr, day.break.start);
      var brkEnd = parseDt(dateStr, day.break.end);
      if(brkStart && brkEnd && newStart < brkEnd && newEnd > brkStart){
        return {type:'break', label:'la colación de '+(barber.name||'')};
      }
    }
  }

  var blocks = getScheduleBlocksForDate(dateStr).filter(function(b){ return b.barberId === barberId; });
  for(var i=0; i<blocks.length; i++){
    var b = blocks[i];
    var bStart = parseDt(dateStr, b.start);
    var bEnd = parseDt(dateStr, b.end);
    if(bStart && bEnd && newStart < bEnd && newEnd > bStart){
      return {type:'block', label: b.reason ? ('un bloqueo de horario ("'+b.reason+'")') : 'un bloqueo de horario'};
    }
  }
  return null;
}
```

Reemplazar por:

```js
// Check if a proposed booking conflicts with existing ones (same barber, overlapping time).
// bufferMin (D.info.bufferMin, default 0) es el margen de limpieza contra
// OTRAS RESERVAS -- checkScheduleBlock (colación/bloqueos) no lo usa, son
// límites duros e independientes del buffer.
//
// Aritmética en minutos-desde-medianoche (toMin), NUNCA objetos Date -- así
// evita depender del huso horario del NAVEGADOR de quien administra. Mismo
// criterio que overlaps()/isRangeFree() en functions/shared/availability.js
// e isBarberFreeAt() en public/index.html (ver esos archivos para el
// razonamiento completo). Antes de este cambio, checkConflict() armaba
// objetos Date vía parseDt()/parseYmd() en hora local del navegador -- una
// divergencia real con el invariante "la zona del negocio gobierna, nunca
// el navegador", no solo código duplicado.
//
// Al pasar de Date absolutos a minutos-del-día, el filtro por fecha que
// antes quedaba implícito en la resta de timestamps (dos reservas en días
// distintos caen naturalmente lejos en el tiempo) hay que hacerlo explícito
// acá: sin el `continue` de fecha, dos reservas a la misma hora en días
// distintos se marcarían como conflicto entre sí.
function checkConflict(barberId, dateStr, timeStr, durMin, ignoreId, bufferMin){
  if(!dateStr || !timeStr) return null;
  bufferMin = bufferMin || 0;
  var bookings = getBookings();
  var candStart = toMin(timeStr);
  var candEnd = candStart + (durMin||0);
  for(var i=0; i<bookings.length; i++){
    var b = bookings[i];
    if(ignoreId && b.code === ignoreId) continue;
    if(b.barberId !== barberId) continue;
    if((b.date ? b.date.substring(0,10) : '') !== dateStr) continue;
    var bStart = toMin(b.time);
    var bEnd = bStart + (b.dur||30);
    if(candStart < bEnd+bufferMin && candEnd > bStart-bufferMin){
      return b;
    }
  }
  return null;
}
// 'HH:MM' -> minutos desde medianoche. Copia deliberada de toMin() en
// public/index.html (que a su vez documenta el mismo motivo que
// functions/shared/availability.js#toMinutes) -- este <script> es plano,
// sin bundler, no puede importar ningún módulo de functions/shared/.
function toMin(hhmm){
  var parts=String(hhmm||'0:0').split(':');
  return (parseInt(parts[0],10)||0)*60+(parseInt(parts[1],10)||0);
}
// 'YYYY-MM-DD' -> día de la semana (0=Dom..6=Sáb), para indexar
// staff.schedule[dow]. Zona-independiente a propósito, igual que
// dowOfDateKey() en public/index.html y el cálculo de `dow` en
// functions/createBooking.js: el día de la semana de una fecha calendario
// es el mismo mirado desde cualquier huso horario.
function dowOfDateKey(dateKey){
  return new Date(dateKey+'T00:00:00Z').getUTCDay();
}
// Igual que checkConflict, pero contra colación recurrente + bloqueos
// puntuales en vez de otras reservas. Devuelve null (sin bloqueo) o
// {type, label} para armar el mensaje de advertencia. Mismo cambio que
// checkConflict(): minutos-del-día en vez de Date en hora del navegador.
function checkScheduleBlock(barberId, dateStr, timeStr, durMin){
  if(!dateStr || !timeStr) return null;
  var candStart = toMin(timeStr);
  var candEnd = candStart + (durMin||0);

  var barber = D.staff.find(function(s){return s.id===barberId});
  if(barber && Array.isArray(barber.schedule)){
    var dow = dowOfDateKey(dateStr);
    var day = barber.schedule[dow];
    if(day && day.break && day.break.start && day.break.end){
      var brkStart = toMin(day.break.start);
      var brkEnd = toMin(day.break.end);
      if(candStart<brkEnd && candEnd>brkStart){
        return {type:'break', label:'la colación de '+(barber.name||'')};
      }
    }
  }

  var blocks = getScheduleBlocksForDate(dateStr).filter(function(b){ return b.barberId === barberId; });
  for(var i=0; i<blocks.length; i++){
    var b = blocks[i];
    var bStart = toMin(b.start);
    var bEnd = toMin(b.end);
    if(candStart<bEnd && candEnd>bStart){
      return {type:'block', label: b.reason ? ('un bloqueo de horario ("'+b.reason+'")') : 'un bloqueo de horario'};
    }
  }
  return null;
}
```

Nota: `parseDt()` y `parseYmd()` **no se eliminan** -- siguen usándose en `renderBookingList()` (líneas ~1803-1804) para filtrar la lista de reservas por rango de fechas, un caso donde SÍ hace falta comparar across días con objetos `Date` reales. Solo se les quita el uso dentro de `checkConflict`/`checkScheduleBlock`.

- [ ] **Step 3: Confirmar que no quedó ninguna llamada a parseDt/parseYmd dentro del bloque nuevo**

```bash
grep -n "parseDt\|parseYmd" public/admin/index.html
```
Expected: las únicas coincidencias son la definición de `parseYmd` (línea ~1405), la definición de `parseDt` (ahora más abajo, sin cambios), y sus usos en `renderBookingList` (~1803-1804). Ninguna dentro de `checkConflict`/`checkScheduleBlock`.

- [ ] **Step 4: Commit**

```bash
git add public/admin/index.html
git commit -m "fix(admin): checkConflict/checkScheduleBlock dejan de usar la hora del navegador"
```

---

### Task 5: Verificación manual del cambio de comportamiento en el admin

No hay arnés de test automatizado que llegue al `<script>` inline de `public/admin/index.html` sin reestructurar el archivo (prohibido por CLAUDE.md). Este cambio toca detección de conflictos de horario — hay que verificarlo a mano contra el emulador antes de dar la tarea por cerrada.

- [ ] **Step 1: Levantar el emulador**

Run: `firebase emulators:start`

- [ ] **Step 2: Abrir el panel admin apuntando al emulador y crear datos de prueba**

Crear (o usar datos existentes de seed) una reserva para un barbero activo, por ejemplo: `felipe`, `2026-09-10`, `10:00`, duración 50 min.

- [ ] **Step 3: Verificar cada escenario en el modal de nueva/editar cita**

Para el mismo barbero (`felipe`) y fecha (`2026-09-10`):

| Escenario | Hora candidata | Duración | Resultado esperado |
|---|---|---|---|
| Solape directo | 10:20 | 30 | ⚠ Conflicto de horario (con el de las 10:00) |
| Justo antes, sin buffer | 09:00 | 60 (termina 10:00) | Sin conflicto (si `bufferMin` del negocio es 0) |
| Justo después, sin buffer | 10:50 | 30 | Sin conflicto |
| Dentro del buffer configurado | según `businessInfo.bufferMin` actual | — | ⚠ Conflicto si cae dentro del margen |
| Mismo horario (10:00), **otro día** (2026-09-11) | 10:00 | 30 | **Sin conflicto** — este es el caso que valida el filtro de fecha explícito agregado en Task 4 |
| Editando la reserva de las 10:00 (mismo `code`) sin cambiar nada | 10:00 | 50 | Sin conflicto consigo misma (ignoreId funciona) |
| Colación del barbero ese día de la semana | hora dentro de `schedule[dow].break` | — | ⚠ "Horario bloqueado: colación de..." |
| Bloqueo puntual creado para esa fecha/barbero | hora dentro del bloqueo | — | ⚠ "Horario bloqueado: un bloqueo de horario..." |
| Marcar "Sobrecupo" con conflicto activo | cualquiera de los de arriba | — | Guarda igual (el override sigue funcionando) |

- [ ] **Step 4: Si algún escenario falla, volver a Task 4 y corregir antes de continuar** — no avanzar a Task 6 con un escenario roto.

- [ ] **Step 5: Anotar el resultado de la verificación** (no requiere commit — es un checkpoint manual, repórtalo en la conversación antes de seguir).

---

### Task 6: Constante de estado local en el panel admin

**Files:**
- Modify: `public/admin/index.html:2338-2344`

- [ ] **Step 1: Agregar la constante local, documentada como copia deliberada de functions/shared/status.js**

Buscar (cerca del inicio del `<script>` del admin, junto a otras constantes globales como `DEFAULT_TZ` en la línea 2831 — usar ese mismo bloque):

```js
const DEFAULT_TZ = 'America/Santiago';
const DEFAULT_BUFFER_MIN = 0;
```

Agregar justo después:

```js
// Copia deliberada de DEFAULT_BOOKING_STATUS en functions/shared/status.js
// -- mismo motivo que DEFAULT_TZ arriba: <script> plano, sin bundler, no
// puede importar. No hay ninguna transición de estado en este panel (ni en
// ningún otro lugar del repo) que reconciliar -- ver el comentario de
// functions/shared/status.js.
const DEFAULT_BOOKING_STATUS = 'pending';
```

- [ ] **Step 2: Usar la constante al guardar/editar una reserva**

Buscar:

```js
    // `status` y `club` los exige isValidBooking() en firestore.rules. El
    // payload del panel no los enviaba nunca, y como en las reglas una clave
    // ausente lanza error de evaluación (no `false`), crear una cita desde el
    // admin fallaba siempre con permission-denied.
    status: prev.status || 'pending',
```
→
```js
    // `status` y `club` los exige isValidBooking() en firestore.rules. El
    // payload del panel no los enviaba nunca, y como en las reglas una clave
    // ausente lanza error de evaluación (no `false`), crear una cita desde el
    // admin fallaba siempre con permission-denied.
    status: prev.status || DEFAULT_BOOKING_STATUS,
```

- [ ] **Step 3: Verificar en el navegador que crear y editar una cita desde el admin sigue funcionando**

(Mismo emulador de Task 5.) Crear una cita nueva desde el panel, confirmar que se guarda con `status:'pending'` (revisar en el emulador UI de Firestore, `localhost:4000`). Editar esa misma cita y confirmar que el `status` no cambia.

- [ ] **Step 4: Commit**

```bash
git add public/admin/index.html
git commit -m "refactor(admin): usar DEFAULT_BOOKING_STATUS en vez de 'pending' suelto"
```

---

### Task 7: Actualizar comentarios con rutas desactualizadas

**Files:**
- Modify: `public/index.html:3050,3075,3106`
- Modify: `public/js/data.js:244,254`

Estos son comentarios que referencian `functions/availability.js`/`functions/timezone.js` por su ruta vieja. No hay cambio de código, solo de texto — bajo riesgo, pero dejarlos desactualizados contradice el propio principio del repo de documentar con precisión qué copia reemplaza a cuál.

- [ ] **Step 1: public/index.html línea 3050**

```js
// 'HH:MM' -> minutos desde medianoche. Mismo criterio que
// functions/availability.js#toMinutes (no se puede importar acá: este
// <script> es plano, sin bundler).
```
→
```js
// 'HH:MM' -> minutos desde medianoche. Mismo criterio que
// functions/shared/availability.js#toMinutes (no se puede importar acá:
// este <script> es plano, sin bundler).
```

- [ ] **Step 2: public/index.html línea 3075**

```js
// Copia deliberada de dateKeyInZone()/DEFAULT_TZ en functions/timezone.js --
```
→
```js
// Copia deliberada de dateKeyInZone()/DEFAULT_TZ en
// functions/shared/timezone.js --
```

- [ ] **Step 3: public/index.html línea 3106**

```js
// timeKeyInZone() en functions/timezone.js -- mismo motivo que las de
```
→
```js
// timeKeyInZone() en functions/shared/timezone.js -- mismo motivo que las de
```

- [ ] **Step 4: public/js/data.js línea 244**

```js
// Contrato completo y responsabilidades del llamador documentadas en
// functions/availability.js.
```
→
```js
// Contrato completo y responsabilidades del llamador documentadas en
// functions/shared/availability.js.
```

- [ ] **Step 5: public/js/data.js línea 254**

```js
// onBookingWritten (nunca contiene PII, solo rangos ocupados derivados —
// ver functions/availability.js). `dateKey` no exista todavía = sin
```
→
```js
// onBookingWritten (nunca contiene PII, solo rangos ocupados derivados —
// ver functions/shared/availability.js). `dateKey` no exista todavía = sin
```

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/data.js
git commit -m "docs: actualizar rutas a functions/shared/ en comentarios"
```

---

### Task 8: Actualizar CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

La sección "Estado conocido" describe la situación PRE-consolidación. Dejarla así después de este trabajo confundiría a la próxima sesión (viola la propia "REGLA DE TRABAJO" del archivo: no improvisar sobre una suposición equivocada).

- [ ] **Step 1: Reemplazar el primer bullet de "Estado conocido"**

Buscar:

```
- La lógica de solape está duplicada en TRES copias: functions/availability.js,
  widget público y panel admin. Zona horaria, también tres. Validación, dos.
```

Reemplazar por:

```
- Solape y zona horaria: la fuente única es functions/shared/availability.js
  y functions/shared/timezone.js. public/index.html mantiene una copia
  deliberada y fiel (documentada como tal, <script> plano sin bundler).
  public/admin/index.html ya NO diverge: checkConflict()/checkScheduleBlock()
  usan el mismo criterio de minutos-desde-medianoche (antes usaban objetos
  Date en hora del navegador del admin -- ver el historial del goal
  2026-08-24 en docs/superpowers/plans si hace falta el detalle).
  Validación: functions/shared/validate.js es la única implementación real
  (isValidBookingPayload). firestore.rules mantiene isValidBooking() como
  copia CEL muerta (documentación) y isValidEmail() como el único gate real
  del camino de escritura directa del admin -- esa brecha (el admin no pasa
  por isValidBookingPayload) sigue sin cerrar, es trabajo aparte.
  Estado: functions/shared/status.js centraliza DEFAULT_BOOKING_STATUS
  ('pending'), pero sigue sin existir ninguna transición de estado en el
  repo -- eso no cambió con este goal.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: actualizar Estado conocido en CLAUDE.md tras consolidar shared/"
```

---

## Self-Review (spec coverage)

- ✅ `shared/availability.js`, `shared/timezone.js`, `shared/validate.js`, `shared/status.js` existen (en `functions/shared/`, por la restricción de deploy acordada) — Tasks 1-3.
- ✅ Cada módulo documenta qué copias reemplaza en su comentario de cabecera — Tasks 1 (Step 2), 2 (Step 1), 3 (Step 1).
- ✅ `functions/` los importa directamente — Tasks 1 (Steps 3-6), 2 (Step 2), 3 (Step 2).
- ✅ Diagnóstico previo mostró diferencias (admin en hora del navegador) y se esperó la decisión del usuario antes de unificar — ya resuelto en la conversación, decisiones registradas al inicio de este plan.
- ✅ El panel admin deja de divergir en el criterio de solape/zona horaria — Task 4, verificado a mano en Task 5.
- ✅ Alcance de validación limitado a lo decidido (solo extraer, no tocar el camino del admin ni firestore.rules) — Task 2.
- ✅ Alcance de estado limitado a lo decidido (solo constante/enum, sin máquina de estados) — Task 3.
- ✅ `public/index.html` no se toca funcionalmente (ya era fiel) — solo comentarios, Task 7.
- ✅ CLAUDE.md queda consistente con el nuevo estado del repo — Task 8.
