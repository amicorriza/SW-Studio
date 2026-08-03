# Bloqueo de horarios por hora (colación + puntuales) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir bloquear horas específicas dentro de un día abierto (colación recurrente por día de semana + bloqueos puntuales por fecha), quitando esas horas tanto de la disponibilidad del widget público de reservas como advirtiendo (estilo "Sobrecupo") al admin si agenda una cita ahí.

**Architecture:** Una sola fuente de verdad server-side: `computeAvailability()` (`functions/availability.js`) se extiende para fusionar reservas + colación recurrente + bloqueos puntuales en el mismo mapa `barberBusy` que ya usa el widget público — nada cambia en la lógica de disponibilidad del cliente (`isSlotAvailable`/`renderSlots`). El admin gana una nueva colección `scheduleBlocks` (CRUD directo por documento, sin el patrón de array completo que usan las reservas), un campo `break` opcional en `staff.schedule[dow]`, y una segunda verificación de advertencia (reusando la caja/checkbox de "Sobrecupo") en el modal de citas.

**Tech Stack:** Firebase (Firestore + Cloud Functions v2 `onCall`), JS vanilla ES5 (sin build step) en `public/index.html`, `node:test` para `functions/`, `vitest` + `@firebase/rules-unit-testing` para `firestore.rules`.

**Nota sobre testing:** `functions/availability.js` y `firestore.rules` ya tienen suites automatizadas reales (`node --test`, `npm run test:rules`) — esas tareas siguen TDD de verdad (test que falla → implementación → test que pasa). El resto (UI del admin en `public/index.html`, sin build step ni test runner de frontend) sigue el mismo criterio que el plan anterior de este proyecto (`docs/superpowers/plans/2026-07-30-agenda-lista-vista-plan.md`): verificación manual/razonada por tarea, y un pase end-to-end real en el emulador de Firebase al final — acá con más peso porque este feature sí toca el flujo de reserva público, no solo el admin.

**Spec de referencia:** `docs/superpowers/specs/2026-07-31-bloqueo-horarios-design.md`

---

## Antes de empezar

- [ ] **Paso 0: Confirmar dependencias instaladas**

Run: `cd functions && node --test test/availability.test.js`
Expected: `ℹ pass 10` (los 10 tests ya existentes, sin fallar). Si `node_modules` falta, correr `npm install` en `functions/` primero.

---

### Task 1: Extender `computeAvailability` para incluir colación y bloqueos puntuales

**Files:**
- Modify: `functions/availability.js`
- Test: `functions/test/availability.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `functions/test/availability.test.js` (después del último `test(...)` existente):

```js
test('computeAvailability agrega la colación recurrente del barbero como rango ocupado', () => {
  const staff = [{ id: 'victoria', status: 'active', schedule: [null, null, { open: true, start: '10:00', end: '20:00', break: { start: '13:00', end: '14:00' } }] }];
  const result = computeAvailability({ bookings: [], staff, barberId: 'victoria', dow: 2, scheduleBlocks: [] });
  assert.deepStrictEqual(result.barberBusy.victoria, [{ start: '13:00', end: '14:00' }]);
});

test('computeAvailability ignora la colación de otro día de la semana', () => {
  const staff = [{ id: 'victoria', status: 'active', schedule: [null, null, { open: true, start: '10:00', end: '20:00', break: { start: '13:00', end: '14:00' } }] }];
  const result = computeAvailability({ bookings: [], staff, barberId: 'victoria', dow: 3, scheduleBlocks: [] });
  assert.deepStrictEqual(result.barberBusy.victoria || [], []);
});

test('computeAvailability agrega los scheduleBlocks del barbero como rangos ocupados', () => {
  const staff = [{ id: 'victoria', status: 'active', schedule: [] }];
  const scheduleBlocks = [{ barberId: 'victoria', date: '2026-08-05', start: '15:00', end: '16:00', reason: 'Trámite' }];
  const result = computeAvailability({ bookings: [], staff, barberId: 'victoria', dow: 3, scheduleBlocks });
  assert.deepStrictEqual(result.barberBusy.victoria, [{ start: '15:00', end: '16:00' }]);
});

test('computeAvailability combina reservas, colación y bloqueos puntuales sin pisarse', () => {
  const bookings = [{ barberId: 'victoria', date: '2026-08-05', time: '10:00', dur: 50 }];
  const staff = [{ id: 'victoria', status: 'active', schedule: [null, null, null, { open: true, start: '10:00', end: '20:00', break: { start: '13:00', end: '14:00' } }] }];
  const scheduleBlocks = [{ barberId: 'victoria', date: '2026-08-05', start: '17:00', end: '18:00', reason: 'Trámite' }];
  const result = computeAvailability({ bookings, staff, barberId: 'victoria', dow: 3, scheduleBlocks });
  assert.deepStrictEqual(result.barberBusy.victoria, [
    { start: '10:00', end: '10:50' },
    { start: '13:00', end: '14:00' },
    { start: '17:00', end: '18:00' },
  ]);
});

test('computeAvailability con barberId "any" agrega colación/bloqueos de todos los barberos activos', () => {
  const staff = [
    { id: 'victoria', status: 'active', schedule: [null, null, null, { open: true, start: '10:00', end: '20:00', break: { start: '13:00', end: '14:00' } }] },
    { id: 'esteban', status: 'active', schedule: [] },
  ];
  const scheduleBlocks = [{ barberId: 'esteban', date: '2026-08-05', start: '11:00', end: '11:30', reason: 'x' }];
  const result = computeAvailability({ bookings: [], staff, barberId: 'any', dow: 3, scheduleBlocks });
  assert.deepStrictEqual(result.barberBusy.victoria, [{ start: '13:00', end: '14:00' }]);
  assert.deepStrictEqual(result.barberBusy.esteban, [{ start: '11:00', end: '11:30' }]);
});

test('computeAvailability ignora un scheduleBlock de un barbero distinto al filtrado', () => {
  const staff = [{ id: 'victoria', status: 'active' }, { id: 'esteban', status: 'active' }];
  const scheduleBlocks = [{ barberId: 'esteban', date: '2026-08-05', start: '11:00', end: '11:30', reason: 'x' }];
  const result = computeAvailability({ bookings: [], staff, barberId: 'victoria', dow: 3, scheduleBlocks });
  assert.deepStrictEqual(result.barberBusy.victoria || [], []);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result.barberBusy, 'esteban'), false);
});

test('computeAvailability sin dow/scheduleBlocks se comporta exactamente igual que antes (compatibilidad)', () => {
  const bookings = [{ barberId: 'felipe', date: '2026-07-10', time: '10:00', dur: 50 }];
  const staff = [{ id: 'felipe', status: 'active' }];
  const result = computeAvailability({ bookings, staff, barberId: 'felipe' });
  assert.deepStrictEqual(result.barberBusy.felipe, [{ start: '10:00', end: '10:50' }]);
});
```

- [ ] **Step 2: Confirmar que los tests nuevos fallan**

Run: `cd functions && node --test test/availability.test.js`
Expected: los 7 tests nuevos fallan (los primeros 5 con `AssertionError` porque `barberBusy` no incluye colación/bloqueos todavía; el de compatibilidad debería pasar igual — no lo rompe nada aún). Los 10 tests originales siguen en verde.

- [ ] **Step 3: Implementar la extensión de `computeAvailability`**

Buscar en `functions/availability.js`:

```js
function computeAvailability({ bookings, staff, barberId }) {
  const wantsAny = !barberId || barberId === 'any';
  const relevant = wantsAny
    ? (bookings || [])
    : (bookings || []).filter(b => b.barberId === barberId);

  const barberBusy = {};
  relevant.forEach(b => {
    const id = b.barberId;
    if (!id) return;
    if (!barberBusy[id]) barberBusy[id] = [];
    barberBusy[id].push({ start: b.time, end: addMinutesToTime(b.time, b.dur || 0) });
  });

  const activeBarberIds = (staff || [])
    .filter(s => s.status === 'active')
    .map(s => s.id);

  return { barberBusy, activeBarberIds };
}
```

Reemplazar por:

```js
function computeAvailability({ bookings, staff, barberId, dow, scheduleBlocks }) {
  const wantsAny = !barberId || barberId === 'any';
  const relevant = wantsAny
    ? (bookings || [])
    : (bookings || []).filter(b => b.barberId === barberId);

  const barberBusy = {};
  function addBusy(id, start, end) {
    if (!id) return;
    if (!barberBusy[id]) barberBusy[id] = [];
    barberBusy[id].push({ start, end });
  }

  relevant.forEach(b => addBusy(b.barberId, b.time, addMinutesToTime(b.time, b.dur || 0)));

  const activeBarberIds = (staff || [])
    .filter(s => s.status === 'active')
    .map(s => s.id);

  // Mismo criterio de filtrado que ya aplica a `relevant` para las
  // reservas: si se pidió un barbero específico, solo su colación/sus
  // bloqueos entran a barberBusy; si es 'any', los de todos los activos.
  const relevantStaffIds = wantsAny ? activeBarberIds : activeBarberIds.filter(id => id === barberId);

  // Colación recurrente (staff.schedule[dow].break) -- solo si se pasó
  // `dow` (día de semana 0-6 de la fecha consultada). Si no se pasa,
  // comportamiento idéntico al de antes de este cambio (compatibilidad).
  if (typeof dow === 'number') {
    (staff || []).forEach(s => {
      if (relevantStaffIds.indexOf(s.id) === -1) return;
      const day = Array.isArray(s.schedule) ? s.schedule[dow] : null;
      if (day && day.break && day.break.start && day.break.end) {
        addBusy(s.id, day.break.start, day.break.end);
      }
    });
  }

  // Bloqueos puntuales de la fecha consultada (ya filtrados por el
  // llamador -- ver getAvailability en index.js).
  (scheduleBlocks || []).forEach(blk => {
    if (!blk.barberId) return;
    if (relevantStaffIds.indexOf(blk.barberId) === -1) return;
    addBusy(blk.barberId, blk.start, blk.end);
  });

  return { barberBusy, activeBarberIds };
}
```

- [ ] **Step 4: Confirmar que todos los tests pasan**

Run: `cd functions && node --test test/availability.test.js`
Expected: `ℹ tests 17` / `ℹ pass 17` / `ℹ fail 0` (los 10 originales + los 7 nuevos).

- [ ] **Step 5: Commit**

```bash
git add functions/availability.js functions/test/availability.test.js
git commit -m "feat(availability): fusionar colación recurrente y bloqueos puntuales en barberBusy"
```

---

### Task 2: Colección `scheduleBlocks` — reglas, test de reglas y wiring en `getAvailability`

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/rules/firestore.rules.test.js`
- Modify: `functions/index.js`

- [ ] **Step 1: Agregar la regla de Firestore**

Buscar en `firestore.rules`:

```
    // Clientes (v19): nombre, contacto, historial de visitas y fotos (PII).
    // Nunca hay escritura pública directa — el único creador/actualizador es
    // la Cloud Function onBookingCreated (Admin SDK, no sujeta a estas reglas).
    match /patients/{id} { allow read, write: if isAdmin(); }
```

Reemplazar por:

```
    // Clientes (v19): nombre, contacto, historial de visitas y fotos (PII).
    // Nunca hay escritura pública directa — el único creador/actualizador es
    // la Cloud Function onBookingCreated (Admin SDK, no sujeta a estas reglas).
    match /patients/{id} { allow read, write: if isAdmin(); }

    // Bloqueos de horario (colación puntual, trámites, etc.): solo admin.
    // El público nunca lee esta colección directo -- se refleja
    // indirectamente como rangos ocupados (sin `reason`) a través de
    // getAvailability, mismo patrón de privacidad que bookings.
    match /scheduleBlocks/{id} { allow read, write: if isAdmin(); }
```

- [ ] **Step 2: Escribir el test de reglas que falla**

Agregar al final de `tests/rules/firestore.rules.test.js`:

```js
test('anónimo NO puede leer scheduleBlocks', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'scheduleBlocks/sb1')));
});

test('anónimo NO puede crear scheduleBlocks', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'scheduleBlocks/sb1'), { barberId: 'victoria', date: '2026-08-05', start: '13:00', end: '14:00', reason: 'Colación' }));
});

test('admin (custom claim) SÍ puede leer y escribir scheduleBlocks', async () => {
  const db = env.authenticatedContext('admin1', { admin: true }).firestore();
  await assertSucceeds(setDoc(doc(db, 'scheduleBlocks/sb1'), { barberId: 'victoria', date: '2026-08-05', start: '13:00', end: '14:00', reason: 'Colación' }));
  await assertSucceeds(getDoc(doc(db, 'scheduleBlocks/sb1')));
});
```

Nota: a diferencia de los tests "staff autenticado SÍ puede leer reservas/patients" ya existentes en este archivo (que fallan hoy, de forma preexistente y no relacionada a este plan, porque usan `env.authenticatedContext('staff1')` **sin** pasar el custom claim `admin`), este test nuevo pasa `{ admin: true }` como segundo argumento — así valida el control de acceso real en vez de heredar el mismo problema. No se toca ni se arregla el problema preexistente de los otros tests: fuera de alcance de este plan.

- [ ] **Step 3: Confirmar que los 2 primeros tests pasan y el tercero falla**

Run: `npm run test:rules`
Expected: "anónimo NO puede leer scheduleBlocks" y "anónimo NO puede crear scheduleBlocks" en verde (la regla `allow read, write: if isAdmin()` ya las satisface). "admin (custom claim) SÍ puede leer y escribir scheduleBlocks" también debería pasar en este punto, ya que la regla ya está puesta — este paso solo confirma que no quedó nada mal escrito en la regla del Step 1. (Las 2 fallas preexistentes no relacionadas — "staff autenticado SÍ puede leer reservas" y "...patients" — se siguen viendo, ignóralas.)

- [ ] **Step 4: Consultar `scheduleBlocks` desde `getAvailability`**

Buscar en `functions/index.js`:

```js
exports.getAvailability = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    // Solo se valida que `date`/`barberId` no vengan vacíos, no su formato:
    // el widget siempre los arma desde su propio date-picker/selector de
    // barbero, nunca desde texto libre. Un `date` con formato inesperado o
    // un `barberId` que ya no corresponde a ningún staff activo NO tira
    // error acá -- simplemente no calzan con ninguna reserva/activeBarberIds
    // y la respuesta "parece" plena disponibilidad. Es responsabilidad de
    // quien llama (el cliente) tratar un barberId ausente de
    // `activeBarberIds` como no disponible, no de esta función.
    const date = (request.data && request.data.date || '').trim();
    if (!date) throw new HttpsError('invalid-argument', 'date es requerido');
    const barberId = ((request.data && request.data.barberId) || '').trim();

    const db = admin.firestore();
    let bookingsQuery = db.collection('bookings').where('date', '==', date);
    if (barberId && barberId !== 'any') {
      bookingsQuery = bookingsQuery.where('barberId', '==', barberId);
    }
    const [bookingsSnap, staffSnap] = await Promise.all([
      bookingsQuery.get(),
      db.collection('staff').where('status', '==', 'active').get(),
    ]);
    const bookings = bookingsSnap.docs.map(d => d.data());
    const staff = staffSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    return computeAvailability({ bookings, staff, barberId });
  }
);
```

Reemplazar por:

```js
exports.getAvailability = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    // Solo se valida que `date`/`barberId` no vengan vacíos, no su formato:
    // el widget siempre los arma desde su propio date-picker/selector de
    // barbero, nunca desde texto libre. Un `date` con formato inesperado o
    // un `barberId` que ya no corresponde a ningún staff activo NO tira
    // error acá -- simplemente no calzan con ninguna reserva/activeBarberIds
    // y la respuesta "parece" plena disponibilidad. Es responsabilidad de
    // quien llama (el cliente) tratar un barberId ausente de
    // `activeBarberIds` como no disponible, no de esta función.
    const date = (request.data && request.data.date || '').trim();
    if (!date) throw new HttpsError('invalid-argument', 'date es requerido');
    const barberId = ((request.data && request.data.barberId) || '').trim();

    // `date` (el que ya usa la query de bookings, sin tocar) puede traer
    // hora además del día -- ver el comentario largo en
    // docs/superpowers/specs/2026-07-31-bloqueo-horarios-design.md sobre la
    // inconsistencia preexistente de ese campo entre reservas públicas y de
    // admin. `scheduleBlocks` es una colección nueva propia de este plan:
    // se guarda y consulta siempre por el día puro 'YYYY-MM-DD', sin ese
    // problema. `dow` se deriva igual, parseando solo esos primeros 10
    // caracteres (Date-only ISO parsea como medianoche UTC de ese día --
    // getDay() da el día de semana correcto sin depender de zona horaria).
    const dayStr = date.substring(0, 10);
    const dow = new Date(dayStr).getDay();

    const db = admin.firestore();
    let bookingsQuery = db.collection('bookings').where('date', '==', date);
    if (barberId && barberId !== 'any') {
      bookingsQuery = bookingsQuery.where('barberId', '==', barberId);
    }
    let blocksQuery = db.collection('scheduleBlocks').where('date', '==', dayStr);
    if (barberId && barberId !== 'any') {
      blocksQuery = blocksQuery.where('barberId', '==', barberId);
    }
    const [bookingsSnap, staffSnap, blocksSnap] = await Promise.all([
      bookingsQuery.get(),
      db.collection('staff').where('status', '==', 'active').get(),
      blocksQuery.get(),
    ]);
    const bookings = bookingsSnap.docs.map(d => d.data());
    const staff = staffSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const scheduleBlocks = blocksSnap.docs.map(d => d.data());
    return computeAvailability({ bookings, staff, barberId, dow, scheduleBlocks });
  }
);
```

- [ ] **Step 5: Verificar que `functions/` sigue compilando/cargando sin errores**

Run: `cd functions && node -e "require('./index.js')" 2>&1 | head -20`
Expected: sin errores de sintaxis. Es normal que tire un error de credenciales de Firebase Admin al intentar inicializar (`admin.initializeApp()` fuera de un entorno de Cloud Functions) -- eso confirma que el archivo al menos *parsea y llega a ejecutar* `admin.initializeApp()`, que es lo que interesa verificar acá (no hay `SyntaxError` ni `ReferenceError` antes de esa línea).

- [ ] **Step 6: Commit**

```bash
git add firestore.rules tests/rules/firestore.rules.test.js functions/index.js
git commit -m "feat(availability): agregar colección scheduleBlocks y consultarla en getAvailability"
```

---

### Task 3: Capa de datos — CRUD de `scheduleBlocks` en `public/js/data.js`

**Files:**
- Modify: `public/js/data.js`

- [ ] **Step 1: Agregar las funciones de acceso a `scheduleBlocks`**

Buscar en `public/js/data.js`:

```js
async function deletePatient(id) {
  await deleteDoc(doc(db, 'patients', id));
}
```

Reemplazar por:

```js
async function deletePatient(id) {
  await deleteDoc(doc(db, 'patients', id));
}

// Bloqueos de horario (colación puntual, trámites, etc.). Un doc por
// bloqueo -- a diferencia de bookings/patients no se usa el patrón "array
// completo + diff de borrados", porque acá cada mutación (crear/editar/
// eliminar un bloqueo) ya es una operación puntual sobre un solo doc.
async function getScheduleBlocks() {
  return await readCol('scheduleBlocks');
}

async function saveScheduleBlock(block) {
  const id = block.id || ('sb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  await setDoc(doc(db, 'scheduleBlocks', id), stripId({ ...block, id }), { merge: true });
  return id;
}

async function deleteScheduleBlock(id) {
  await deleteDoc(doc(db, 'scheduleBlocks', id));
}
```

- [ ] **Step 2: Exponer las nuevas funciones en `window.SWData` y en el export**

Buscar:

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

Reemplazar por:

```js
window.SWData = {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus, getAvailability,
  loadSiteImages, saveSiteImage, deleteSiteImage,
  getScheduleBlocks, saveScheduleBlock, deleteScheduleBlock,
};
export {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus, getAvailability,
  loadSiteImages, saveSiteImage, deleteSiteImage,
  getScheduleBlocks, saveScheduleBlock, deleteScheduleBlock,
};
```

- [ ] **Step 3: Verificar que el módulo sigue parseando**

Run: `node --check public/js/data.js`
Expected: sin output (Node acepta `--check` sobre sintaxis ES module solo si el archivo es válido; si tira `SyntaxError`, revisar el paso anterior). Si el proyecto no tiene `"type":"module"` configurado para que `node --check` reconozca `import`/`export` fuera de una carpeta con eso declarado, usar en su lugar: `node --input-type=module --check < public/js/data.js`.

- [ ] **Step 4: Commit**

```bash
git add public/js/data.js
git commit -m "feat(data): CRUD de scheduleBlocks en la capa de datos"
```

---

### Task 4: Cache y carga de `scheduleBlocks` en el admin

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Agregar la variable de cache**

Buscar:

```js
var BK=[]; var PT=[];
```

Reemplazar por:

```js
var BK=[]; var PT=[]; var SB=[];
```

- [ ] **Step 2: Cargarla en `loadFromCloud()`**

Buscar:

```js
    BK = await window.SWData.getBookings();    // cache de reservas (ver Task 5.5)
    PT = await window.SWData.getPatients();    // cache de clientes (ver Task 5.6)
  } catch(e){ console.error('Error cargando datos', e); defaults(); }
```

Reemplazar por:

```js
    BK = await window.SWData.getBookings();    // cache de reservas (ver Task 5.5)
    PT = await window.SWData.getPatients();    // cache de clientes (ver Task 5.6)
    SB = await window.SWData.getScheduleBlocks(); // cache de bloqueos de horario
  } catch(e){ console.error('Error cargando datos', e); defaults(); }
```

- [ ] **Step 3: Agregar los helpers de lectura/escritura**

Buscar:

```js
function getBookings(){
  return getBk();
}
function saveBookings(arr){
  setBk(arr);
  updateBadges();
}
```

Reemplazar por:

```js
function getBookings(){
  return getBk();
}
function saveBookings(arr){
  setBk(arr);
  updateBadges();
}

// ═══ SCHEDULE BLOCKS HELPERS ═══
// Lectura: devuelve la cache poblada en loadFromCloud(). A diferencia de
// bookings, la escritura es por documento individual (crear/editar/
// eliminar un bloqueo), no un array completo -- ver public/js/data.js.
function getScheduleBlocks(){ return SB; }
function getScheduleBlocksForDate(dateStr){
  return SB.filter(function(b){ return b.date === dateStr; });
}
function createScheduleBlock(block){
  var id = 'sb_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  var full = {id:id, barberId:block.barberId, barberName:block.barberName||'', date:block.date, start:block.start, end:block.end, reason:block.reason||'', createdAt:new Date().toISOString()};
  SB.push(full);
  window.SWData.saveScheduleBlock(full).catch(function(e){ console.error('Error guardando bloqueo', e); });
  return full;
}
function updateScheduleBlock(id, changes){
  // `changes` nunca trae `createdAt` (ver Task 6) -- Object.assign no lo
  // toca, así que la fecha de creación original se preserva en cada edición.
  var b = SB.find(function(x){ return x.id === id; });
  if(!b) return;
  Object.assign(b, changes);
  window.SWData.saveScheduleBlock(b).catch(function(e){ console.error('Error guardando bloqueo', e); });
}
function deleteScheduleBlockLocal(id){
  SB = SB.filter(function(b){ return b.id !== id; });
  window.SWData.deleteScheduleBlock(id).catch(function(e){ console.error('Error eliminando bloqueo', e); });
}
```

- [ ] **Step 4: Verificación**

Run: `node --check public/index.html 2>&1 | head -5` (esto fallará porque el archivo es HTML, no JS puro -- **no** es la forma de verificar acá). En su lugar, extraer el bloque `<script>` principal (el que contiene `var BK=[]`) y verificar solo ese fragmento:

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const main = scripts.find(s => s.includes('var BK=[]'));
new Function(main);
console.log('OK, ' + main.length + ' chars, sin errores de sintaxis');
"
```

Expected: `OK, <N> chars, sin errores de sintaxis`.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(agenda): cache y carga de scheduleBlocks en el admin"
```

---

### Task 5: Admin — colación recurrente en Horarios

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: CSS — separar `.a-sch-day` en fila principal + fila de colación**

Buscar:

```css
.a-sch-day{display:grid;grid-template-columns:90px 80px 1fr 1fr;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--a-g1)}
.a-sch-day:last-child{border-bottom:none}
```

Reemplazar por:

```css
.a-sch-day{padding:10px 16px;border-bottom:1px solid var(--a-g1)}
.a-sch-day:last-child{border-bottom:none}
.a-sch-day-row{display:grid;grid-template-columns:90px 80px 1fr 1fr;gap:8px;align-items:center}
.a-sch-break-row{display:grid;grid-template-columns:90px 80px 1fr 1fr;gap:8px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px dashed var(--a-g1)}
.a-sch-break-lbl{font-size:11px;color:var(--a-meta)}
```

- [ ] **Step 2: Markup — agregar la fila de colación dentro de cada día**

Buscar:

```js
  var body = g('a-sch-body');
  var dayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  body.innerHTML = '<div class="a-sch-card">'+
    '<div class="a-sch-card-hd">'+esc(barber.name)+' — horario de atención</div>'+
    dayNames.map(function(dn, di){
      var slot = barber.schedule[di] || {open:false};
      return '<div class="a-sch-day">'+
        '<div class="a-sch-dnm">'+dn+'</div>'+
        '<label class="a-tog">'+
          '<div class="a-tt '+(slot.open?'on':'')+'" data-tog="'+di+'"><div class="a-tth"></div></div>'+
          '<span class="a-tl">'+(slot.open?'Abierto':'Cerrado')+'</span>'+
        '</label>'+
        '<input type="time" class="a-sch-time" data-set="start" data-di="'+di+'" value="'+esc(slot.start||'10:00')+'" '+(slot.open?'':'disabled')+'>'+
        '<input type="time" class="a-sch-time" data-set="end" data-di="'+di+'" value="'+esc(slot.end||'20:00')+'" '+(slot.open?'':'disabled')+'>'+
      '</div>';
    }).join('')+
  '</div>';
```

Reemplazar por:

```js
  var body = g('a-sch-body');
  var dayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  body.innerHTML = '<div class="a-sch-card">'+
    '<div class="a-sch-card-hd">'+esc(barber.name)+' — horario de atención</div>'+
    dayNames.map(function(dn, di){
      var slot = barber.schedule[di] || {open:false};
      var brk = slot.break || null;
      var breakRow = slot.open ? (
        '<div class="a-sch-break-row">'+
          '<div class="a-sch-break-lbl">Colación</div>'+
          '<label class="a-tog">'+
            '<div class="a-tt '+(brk?'on':'')+'" data-brktog="'+di+'"><div class="a-tth"></div></div>'+
            '<span class="a-tl">'+(brk?'Con colación':'Sin colación')+'</span>'+
          '</label>'+
          '<input type="time" class="a-sch-time" data-brkset="start" data-di="'+di+'" value="'+esc(brk?brk.start:'13:00')+'" '+(brk?'':'disabled')+'>'+
          '<input type="time" class="a-sch-time" data-brkset="end" data-di="'+di+'" value="'+esc(brk?brk.end:'14:00')+'" '+(brk?'':'disabled')+'>'+
        '</div>'
      ) : '';
      return '<div class="a-sch-day">'+
        '<div class="a-sch-day-row">'+
          '<div class="a-sch-dnm">'+dn+'</div>'+
          '<label class="a-tog">'+
            '<div class="a-tt '+(slot.open?'on':'')+'" data-tog="'+di+'"><div class="a-tth"></div></div>'+
            '<span class="a-tl">'+(slot.open?'Abierto':'Cerrado')+'</span>'+
          '</label>'+
          '<input type="time" class="a-sch-time" data-set="start" data-di="'+di+'" value="'+esc(slot.start||'10:00')+'" '+(slot.open?'':'disabled')+'>'+
          '<input type="time" class="a-sch-time" data-set="end" data-di="'+di+'" value="'+esc(slot.end||'20:00')+'" '+(slot.open?'':'disabled')+'>'+
        '</div>'+
        breakRow+
      '</div>';
    }).join('')+
  '</div>';
```

- [ ] **Step 3: Hacer más específico el listener existente de `.a-sch-time` (evita que se dispare sobre los inputs de colación)**

Buscar:

```js
  body.querySelectorAll('.a-sch-time').forEach(function(el){
    el.addEventListener('change', function(){
      var di = parseInt(el.dataset.di);
      var k = el.dataset.set;
      var b = D.staff.find(function(s){return s.id===schTabBarber});
      if(!b.schedule[di]) b.schedule[di] = {open:true, start:'10:00', end:'20:00'};
      b.schedule[di][k] = el.value;
      admSave();
    });
  });
}
```

Reemplazar por (el cambio real es agregar `[data-set]` al selector, para que este listener solo capture los inputs de apertura/cierre y no los de colación, que comparten la misma clase `.a-sch-time` para heredar el estilo pero llevan `data-brkset` en vez de `data-set` -- sin este ajuste, este listener también se dispararía sobre los inputs de colación con `k = el.dataset.set = undefined`):

```js
  body.querySelectorAll('.a-sch-time[data-set]').forEach(function(el){
    el.addEventListener('change', function(){
      var di = parseInt(el.dataset.di);
      var k = el.dataset.set;
      var b = D.staff.find(function(s){return s.id===schTabBarber});
      if(!b.schedule[di]) b.schedule[di] = {open:true, start:'10:00', end:'20:00'};
      b.schedule[di][k] = el.value;
      admSave();
    });
  });
  body.querySelectorAll('[data-brktog]').forEach(function(el){
    el.addEventListener('click', function(){
      var di = parseInt(el.dataset.brktog);
      var b = D.staff.find(function(s){return s.id===schTabBarber});
      if(!b.schedule[di]) return;
      if(b.schedule[di].break){
        delete b.schedule[di].break;
      } else {
        b.schedule[di].break = {start:'13:00', end:'14:00'};
      }
      log('Editó colación', b.name + ' — ' + dayNames[di]);
      renderSchedule(); admSave();
    });
  });
  body.querySelectorAll('.a-sch-time[data-brkset]').forEach(function(el){
    el.addEventListener('change', function(){
      var di = parseInt(el.dataset.di);
      var k = el.dataset.brkset;
      var b = D.staff.find(function(s){return s.id===schTabBarber});
      if(!b.schedule[di] || !b.schedule[di].break) return;
      b.schedule[di].break[k] = el.value;
      admSave();
    });
  });
}
```

- [ ] **Step 4: Verificación manual (razonada, sin credenciales de admin)**

No hay navegador/credenciales disponibles en este paso del plan (igual que en el plan anterior de este proyecto). Verificar por lectura:
- Confirmar que `.a-sch-time[data-set]` y `.a-sch-time[data-brkset]` son selectores mutuamente excluyentes (ningún `<input>` generado tiene ambos atributos a la vez) -- revisar el HTML generado en el Step 2.
- Confirmar que `data-brktog` solo se agrega dentro del `breakRow`, que solo se renderiza cuando `slot.open` es `true` -- un día cerrado nunca muestra el toggle de colación.
- Confirmar que quitar la colación (`delete b.schedule[di].break`) deja `schedule[di]` con las mismas claves `open/start/end` que ya tenía, sin registro huérfano.
- Repetir la verificación de sintaxis del Task 4 Step 4 (extraer el script principal con `new Function(...)`).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(horarios): colación recurrente por día de semana"
```

---

### Task 6: Admin — bloqueos puntuales desde la Agenda (modal + línea de tiempo)

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: CSS de la tarjeta de bloqueo**

Buscar:

```css
.a-bk-card-over-tag{font-family:'Barlow Condensed',sans-serif;font-size:8px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#fff;background:var(--a-warn);padding:1px 5px;border-radius:3px}
```

Reemplazar por:

```css
.a-bk-card-over-tag{font-family:'Barlow Condensed',sans-serif;font-size:8px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#fff;background:var(--a-warn);padding:1px 5px;border-radius:3px}
.a-blk-card{
  position:absolute;left:4px;right:4px;
  background:var(--a-ink);color:#fff;
  border-radius:7px;padding:7px 9px;
  box-shadow:0 1px 4px rgba(120,130,145,.18);
  cursor:pointer;transition:all .18s;
  overflow:hidden;z-index:2;
  font-size:11px;font-weight:600;white-space:nowrap;text-overflow:ellipsis;
  display:flex;align-items:center;gap:5px
}
.a-blk-card:hover{
  box-shadow:0 4px 14px rgba(120,130,145,.32);
  transform:translateY(-1px);z-index:3
}
```

- [ ] **Step 2: Botón "+ Bloquear horario" junto a "+ Nueva cita"**

Buscar:

```html
              <button class="a-btn a-btn-p" id="a-bk-new">+ Nueva cita</button>
            </div>
          </div>
          <div id="a-bk-day-view">
```

Reemplazar por:

```html
              <button class="a-btn a-btn-g" id="a-bk-block-new">+ Bloquear horario</button>
              <button class="a-btn a-btn-p" id="a-bk-new">+ Nueva cita</button>
            </div>
          </div>
          <div id="a-bk-day-view">
```

- [ ] **Step 3: Markup del modal de bloqueo**

Buscar:

```html
<!-- ─ MODAL: REASSIGN BARBER ─ -->
<div id="a-rm" class="a-mb">
```

Reemplazar por:

```html
<!-- ─ MODAL: SCHEDULE BLOCK (bloqueo puntual de horario) ─ -->
<div id="a-blkm" class="a-mb">
  <div class="a-mo" style="max-width:480px">
    <div class="a-mh"><div class="a-mt" id="a-blkm-t">Bloquear horario</div><button class="a-mc" data-close="a-blkm">✕</button></div>
    <div class="a-mb2">
      <input type="hidden" id="a-blkm-id">
      <div class="a-f"><label class="a-lbl">Barbero *</label><select class="a-in" id="a-blkm-barber"></select><span class="a-fe">Selecciona barbero.</span></div>
      <div class="a-f"><label class="a-lbl">Fecha *</label><input class="a-in" id="a-blkm-date" type="date"><span class="a-fe">Selecciona fecha.</span></div>
      <div class="a-fr">
        <div class="a-f"><label class="a-lbl">Hora inicio *</label><input class="a-in" id="a-blkm-start" type="time"><span class="a-fe">Selecciona hora.</span></div>
        <div class="a-f"><label class="a-lbl">Hora fin *</label><input class="a-in" id="a-blkm-end" type="time"><span class="a-fe">Selecciona hora.</span></div>
      </div>
      <div class="a-f"><label class="a-lbl">Motivo</label><input class="a-in" id="a-blkm-reason" placeholder="Ej: Trámite personal"></div>
    </div>
    <div class="a-mf">
      <button class="a-btn a-btn-danger" id="a-blkm-del" style="margin-right:auto;display:none">Eliminar bloqueo</button>
      <button class="a-btn a-btn-g" data-close="a-blkm">Cancelar</button>
      <button class="a-btn a-btn-p" id="a-blkm-save">Guardar bloqueo</button>
    </div>
  </div>
</div>

<!-- ─ MODAL: REASSIGN BARBER ─ -->
<div id="a-rm" class="a-mb">
```

- [ ] **Step 4: Sumar `a-blkm` al cierre por clic en el fondo del modal**

Buscar:

```js
['a-sm','a-stm','a-bkm','a-rm','a-dm'].forEach(function(id){
```

Reemplazar por:

```js
['a-sm','a-stm','a-bkm','a-blkm','a-rm','a-dm'].forEach(function(id){
```

- [ ] **Step 5: JS del modal — abrir, guardar, eliminar**

Buscar (el cierre de `g('a-bkm-del').addEventListener` -- justo antes de la sección de Stats):

```js
g('a-bkm-del').addEventListener('click', function(){
  var code = g('a-bkm-id').value;
  if(!code) return;
  openDel('¿Eliminar esta cita? Esta acción no se puede deshacer.', function(){
    var bookings = getBookings().filter(function(b){return b.code !== code});
    saveBookings(bookings);
    closeModal('a-bkm');
    refreshBookingViews();
    log('Eliminó cita', code);
    showAlert('a-bk-alert','ok','Cita eliminada.');
  });
});

// ═══ STATS ═══
```

Reemplazar por:

```js
g('a-bkm-del').addEventListener('click', function(){
  var code = g('a-bkm-id').value;
  if(!code) return;
  openDel('¿Eliminar esta cita? Esta acción no se puede deshacer.', function(){
    var bookings = getBookings().filter(function(b){return b.code !== code});
    saveBookings(bookings);
    closeModal('a-bkm');
    refreshBookingViews();
    log('Eliminó cita', code);
    showAlert('a-bk-alert','ok','Cita eliminada.');
  });
});

// ═══ SCHEDULE BLOCK MODAL ═══
function openBlockModal(blk){
  g('a-blkm-t').textContent = blk ? 'Editar bloqueo' : 'Bloquear horario';
  g('a-blkm-id').value = blk ? blk.id : '';
  var bSel = g('a-blkm-barber');
  bSel.innerHTML = '<option value="">— Selecciona —</option>' +
    D.staff.filter(function(s){return s.status==='active'}).map(function(s){
      return '<option value="'+esc(s.id)+'" data-name="'+esc(s.name)+'">'+esc(s.name)+'</option>';
    }).join('');
  bSel.value = blk ? blk.barberId : (bkFilter || '');
  g('a-blkm-date').value = blk ? blk.date : ymd(bkDate);
  g('a-blkm-start').value = blk ? blk.start : '13:00';
  g('a-blkm-end').value = blk ? blk.end : '14:00';
  g('a-blkm-reason').value = blk ? (blk.reason||'') : '';
  g('a-blkm-del').style.display = blk ? 'inline-flex' : 'none';
  document.querySelectorAll('#a-blkm .a-f').forEach(function(f){f.classList.remove('a-err')});
  g('a-blkm').classList.add('a-open');
}
g('a-bk-block-new').addEventListener('click', function(){ openBlockModal(null); });

g('a-blkm-save').addEventListener('click', function(){
  var bSel = g('a-blkm-barber');
  var da = g('a-blkm-date');
  var st = g('a-blkm-start');
  var en = g('a-blkm-end');
  var ok = true;
  [bSel,da,st,en].forEach(function(el){el.parentElement.classList.remove('a-err')});
  if(!bSel.value){ bSel.parentElement.classList.add('a-err'); ok=false; }
  if(!da.value){ da.parentElement.classList.add('a-err'); ok=false; }
  if(!st.value){ st.parentElement.classList.add('a-err'); ok=false; }
  if(!en.value){ en.parentElement.classList.add('a-err'); ok=false; }
  if(!ok) return;
  var bOpt = bSel.options[bSel.selectedIndex];
  var editId = g('a-blkm-id').value;
  var payload = {
    barberId: bSel.value,
    barberName: bOpt.dataset.name || bOpt.textContent,
    date: da.value,
    start: st.value,
    end: en.value,
    reason: g('a-blkm-reason').value.trim()
  };
  if(editId){
    updateScheduleBlock(editId, payload);
    log('Editó bloqueo de horario', payload.barberName + ' — ' + payload.date);
  } else {
    createScheduleBlock(payload);
    log('Creó bloqueo de horario', payload.barberName + ' — ' + payload.date);
  }
  closeModal('a-blkm');
  renderCalendar();
  showAlert('a-bk-alert','ok','Bloqueo guardado.');
});

g('a-blkm-del').addEventListener('click', function(){
  var id = g('a-blkm-id').value;
  if(!id) return;
  openDel('¿Eliminar este bloqueo de horario? Esta acción no se puede deshacer.', function(){
    deleteScheduleBlockLocal(id);
    closeModal('a-blkm');
    renderCalendar();
    log('Eliminó bloqueo de horario', id);
    showAlert('a-bk-alert','ok','Bloqueo eliminado.');
  });
});

// ═══ STATS ═══
```

- [ ] **Step 6: Renderizar los bloqueos en la línea de tiempo del día**

Buscar:

```js
  // Get bookings for this date (matching filter)
  var dStr = ymd(bkDate);
  var all = getBookings();
  var todays = all.filter(function(b){
    var bDay = b.date ? b.date.substring(0,10) : '';
    if(bDay !== dStr) return false;
    if(bkFilter && b.barberId !== bkFilter) return false;
    return true;
  });

  var tl = g('a-bk-timeline');
  if(!todays.length){
    tl.innerHTML = '<div class="a-tl-empty">Sin reservas para este día.<br><button class="a-btn a-btn-p" onclick="document.getElementById(\'a-bk-new\').click()" style="margin-top:14px">+ Crear primera cita</button></div>';
    return;
  }

  // Determine hour range from earliest to latest+duration
  var minH = 8, maxH = 22;
  todays.forEach(function(b){
    var t = b.time ? b.time.split(':') : ['10','00'];
    var h = parseInt(t[0]);
    var end = h + Math.ceil((b.dur||30)/60) + 1;
    if(h < minH) minH = h;
    if(end > maxH) maxH = end;
  });
  if(minH < 8) minH = 8;
  if(maxH > 23) maxH = 23;
  if(maxH - minH < 6) maxH = minH + 6;
```

Reemplazar por:

```js
  // Get bookings for this date (matching filter)
  var dStr = ymd(bkDate);
  var all = getBookings();
  var todays = all.filter(function(b){
    var bDay = b.date ? b.date.substring(0,10) : '';
    if(bDay !== dStr) return false;
    if(bkFilter && b.barberId !== bkFilter) return false;
    return true;
  });
  var blocksToday = getScheduleBlocksForDate(dStr).filter(function(b){
    if(bkFilter && b.barberId !== bkFilter) return false;
    return true;
  });

  var tl = g('a-bk-timeline');
  if(!todays.length && !blocksToday.length){
    tl.innerHTML = '<div class="a-tl-empty">Sin reservas para este día.<br><button class="a-btn a-btn-p" onclick="document.getElementById(\'a-bk-new\').click()" style="margin-top:14px">+ Crear primera cita</button></div>';
    return;
  }

  // Determine hour range from earliest to latest+duration
  var minH = 8, maxH = 22;
  todays.forEach(function(b){
    var t = b.time ? b.time.split(':') : ['10','00'];
    var h = parseInt(t[0]);
    var end = h + Math.ceil((b.dur||30)/60) + 1;
    if(h < minH) minH = h;
    if(end > maxH) maxH = end;
  });
  blocksToday.forEach(function(b){
    var t = b.start ? b.start.split(':') : ['10','00'];
    var h = parseInt(t[0]);
    var te = b.end ? b.end.split(':') : ['11','00'];
    var end = parseInt(te[0]) + 1;
    if(h < minH) minH = h;
    if(end > maxH) maxH = end;
  });
  if(minH < 8) minH = 8;
  if(maxH > 23) maxH = 23;
  if(maxH - minH < 6) maxH = minH + 6;
```

- [ ] **Step 7: Sumar los bloqueos al sombreado de "ocupado" y a la tarjeta en el DOM**

Buscar:

```js
  // Rangos ocupados (en minutos) para sombrear las medias horas, igual que antes
  var busyRanges = evs.map(function(e){ return [e.start, e.end]; });
```

Reemplazar por:

```js
  // Rangos ocupados (en minutos) para sombrear las medias horas, igual que antes
  var busyRanges = evs.map(function(e){ return [e.start, e.end]; }).concat(
    blocksToday.map(function(b){
      var t = (b.start||'10:00').split(':'), te = (b.end||'11:00').split(':');
      return [(parseInt(t[0])-minH)*60+parseInt(t[1]), (parseInt(te[0])-minH)*60+parseInt(te[1])];
    })
  );
```

Buscar:

```js
  tl.innerHTML = '<div class="a-tl-grid"><div class="a-tl-hours">'+hoursHtml+'</div><div class="a-tl-col">'+slotsHtml+cardsHtml+'</div></div>';

  // Hook card clicks (edit booking)
  tl.querySelectorAll('.a-bk-card').forEach(function(c){
    c.addEventListener('click', function(){
      var code = c.dataset.code;
      var bk = getBookings().find(function(x){return x.code===code});
      if(bk) openBookingModal(bk);
    });
  });
```

Reemplazar por:

```js
  var blocksHtml = blocksToday.map(function(b){
    var t = (b.start || '10:00').split(':');
    var startMin = (parseInt(t[0]) - minH)*60 + parseInt(t[1]);
    var te = (b.end || '11:00').split(':');
    var endMin = (parseInt(te[0]) - minH)*60 + parseInt(te[1]);
    var top = startMin * PXM;
    var height = Math.max(26, (endMin - startMin) * PXM);
    var barber = D.staff.find(function(s){return s.id===b.barberId});
    var bn = barber ? barber.name : (b.barberName || '?');
    var label = '⏱ '+esc(bn)+(b.reason?' · '+esc(b.reason):'')+' · '+esc(b.start||'')+'–'+esc(b.end||'');
    return '<div class="a-blk-card" style="top:'+top.toFixed(1)+'px;height:'+height.toFixed(1)+'px" '+
             'data-blk-id="'+esc(b.id)+'" '+
             'title="'+esc((b.start||'')+' – '+(b.end||'')+' · '+bn+(b.reason?' · '+b.reason:''))+'">'+
             label+
           '</div>';
  }).join('');

  tl.innerHTML = '<div class="a-tl-grid"><div class="a-tl-hours">'+hoursHtml+'</div><div class="a-tl-col">'+slotsHtml+cardsHtml+blocksHtml+'</div></div>';

  // Hook card clicks (edit booking)
  tl.querySelectorAll('.a-bk-card').forEach(function(c){
    c.addEventListener('click', function(){
      var code = c.dataset.code;
      var bk = getBookings().find(function(x){return x.code===code});
      if(bk) openBookingModal(bk);
    });
  });
  // Hook block card clicks (edit block) -- deliberadamente NO abre
  // openBookingModal: un bloqueo no es una cita.
  tl.querySelectorAll('.a-blk-card').forEach(function(c){
    c.addEventListener('click', function(){
      var id = c.dataset.blkId;
      var blk = getScheduleBlocks().find(function(x){return x.id===id});
      if(blk) openBlockModal(blk);
    });
  });
```

Nota deliberada (decisión #6 de la spec): los bloqueos **no** se agregan a `renderBookingList()` (la vista de Lista de la Agenda, del plan anterior) ni a `refreshBookingViews()` -- solo se ven en la línea de tiempo del día. No hace falta tocar ninguna de esas dos funciones en este task.

- [ ] **Step 8: Verificación manual (razonada)**

- Confirmar que `blocksToday` se calcula ANTES del `if(!todays.length && !blocksToday.length)` (si no, un día sin citas pero con un bloqueo mostraría igual "Sin reservas para este día" y el bloqueo nunca se vería).
- Confirmar que `.a-blk-card` no tiene `data-code`, así que el listener de `.a-bk-card` (que busca `data-code`) nunca lo captura por error -- son selectores CSS de clase distintos (`.a-bk-card` vs `.a-blk-card`), no hay solapamiento.
- Repetir la verificación de sintaxis (Task 4 Step 4).

- [ ] **Step 9: Commit**

```bash
git add public/index.html
git commit -m "feat(agenda): bloqueos puntuales de horario (botón, modal y línea de tiempo)"
```

---

### Task 7: Admin — advertencia al agendar sobre un horario bloqueado

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Agregar `checkScheduleBlock`**

Buscar:

```js
function parseDt(dateStr, timeStr){
  if(!dateStr || !timeStr) return null;
  var d = dateStr.length > 10 ? new Date(dateStr) : parseYmd(dateStr);
  if(isNaN(d.getTime())) return null;
  var p = timeStr.split(':');
  d.setHours(parseInt(p[0]||0), parseInt(p[1]||0), 0, 0);
  return d;
}
```

Reemplazar por:

```js
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

- [ ] **Step 2: Integrar en `checkBookingConflict`**

Buscar:

```js
function checkBookingConflict(){
  var svcSel = g('a-bkm-svc');
  var sOpt = svcSel.options[svcSel.selectedIndex];
  var dur = sOpt ? parseInt(sOpt.dataset.dur||30) : 30;
  var barberId = g('a-bkm-barber').value;
  var dateStr = g('a-bkm-date').value;
  var timeStr = g('a-bkm-time').value;
  var editId = g('a-bkm-id').value || null;
  var box = g('a-bkm-conflict');
  if(!barberId || !dateStr || !timeStr){
    box.classList.remove('show');
    return;
  }
  var conflict = checkConflict(barberId, dateStr, timeStr, dur, editId);
  if(conflict){
    var barber = D.staff.find(function(s){return s.id===barberId});
    box.innerHTML = '⚠ <strong>Conflicto de horario:</strong> '+esc(barber?barber.name:'')+' ya tiene a "'+esc(conflict.name||'')+'" para el servicio "'+esc(conflict.svcName||'')+'" a las '+esc(conflict.time||'')+'. Marca "Sobrecupo" si deseas agendar de todas formas, o cambia la hora/barbero.';
    box.classList.add('show');
  } else {
    box.classList.remove('show');
  }
}
```

Reemplazar por:

```js
function checkBookingConflict(){
  var svcSel = g('a-bkm-svc');
  var sOpt = svcSel.options[svcSel.selectedIndex];
  var dur = sOpt ? parseInt(sOpt.dataset.dur||30) : 30;
  var barberId = g('a-bkm-barber').value;
  var dateStr = g('a-bkm-date').value;
  var timeStr = g('a-bkm-time').value;
  var editId = g('a-bkm-id').value || null;
  var box = g('a-bkm-conflict');
  if(!barberId || !dateStr || !timeStr){
    box.classList.remove('show');
    return;
  }
  var conflict = checkConflict(barberId, dateStr, timeStr, dur, editId);
  if(conflict){
    var barber = D.staff.find(function(s){return s.id===barberId});
    box.innerHTML = '⚠ <strong>Conflicto de horario:</strong> '+esc(barber?barber.name:'')+' ya tiene a "'+esc(conflict.name||'')+'" para el servicio "'+esc(conflict.svcName||'')+'" a las '+esc(conflict.time||'')+'. Marca "Sobrecupo" si deseas agendar de todas formas, o cambia la hora/barbero.';
    box.classList.add('show');
    return;
  }
  var blocked = checkScheduleBlock(barberId, dateStr, timeStr, dur);
  if(blocked){
    box.innerHTML = '⚠ <strong>Horario bloqueado:</strong> ese horario cae dentro de '+esc(blocked.label)+'. Marca "Sobrecupo" si deseas agendar de todas formas, o cambia la hora/barbero.';
    box.classList.add('show');
  } else {
    box.classList.remove('show');
  }
}
```

- [ ] **Step 3: Integrar en el guardado (`a-bkm-save`)**

Buscar:

```js
  var sOpt = sv.options[sv.selectedIndex];
  var bOpt = br.options[br.selectedIndex];
  var conflict = checkConflict(br.value, da.value, ti.value, parseInt(sOpt.dataset.dur), g('a-bkm-id').value||null);
  var isOver = g('a-bkm-over').checked;
  if(conflict && !isOver){
    showAlert('a-bk-alert','err','Hay un conflicto de horario. Marca "Sobrecupo" para forzar el agendamiento.');
    return;
  }
```

Reemplazar por:

```js
  var sOpt = sv.options[sv.selectedIndex];
  var bOpt = br.options[br.selectedIndex];
  var conflict = checkConflict(br.value, da.value, ti.value, parseInt(sOpt.dataset.dur), g('a-bkm-id').value||null);
  var blocked = checkScheduleBlock(br.value, da.value, ti.value, parseInt(sOpt.dataset.dur));
  var isOver = g('a-bkm-over').checked;
  if((conflict || blocked) && !isOver){
    showAlert('a-bk-alert','err', conflict ? 'Hay un conflicto de horario. Marca "Sobrecupo" para forzar el agendamiento.' : 'Ese horario está bloqueado. Marca "Sobrecupo" para forzar el agendamiento.');
    return;
  }
```

Buscar:

```js
    over: !!conflict || isOver,
```

Reemplazar por:

```js
    over: !!conflict || !!blocked || isOver,
```

- [ ] **Step 4: Verificación manual (razonada)**

- Confirmar que `checkScheduleBlock` usa `newStart.getDay()` (fecha ya construida vía `parseDt`, en la zona horaria local del navegador del admin) para el día de semana -- consistente con cómo el resto del admin ya maneja fechas (`parseYmd`), no con el cálculo server-side de `functions/index.js` (que corre en UTC) -- son cálculos independientes, cada uno correcto en su propio contexto (cliente admin vs. Cloud Function), y ninguno depende del otro.
- Confirmar que un conflicto de reserva (`checkConflict`) sigue teniendo prioridad de mensaje sobre un bloqueo (`checkScheduleBlock`) si ambos aplicaran a la vez -- el `return` temprano en `checkBookingConflict` después de mostrar el conflicto de reserva evita que se pise con el mensaje de bloqueo.
- Repetir la verificación de sintaxis (Task 4 Step 4).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(agenda): advertir en el modal de citas si el horario está bloqueado"
```

---

### Task 8: Verificación final end-to-end (navegador real + widget público)

**Files:** ninguno (solo verificación; fixes puntuales si surgen)

- [ ] **Step 1: Recorrido completo en el emulador**

Con `firebase emulators:start --only hosting,firestore,auth` corriendo y datos de prueba sembrados (mismo enfoque que el plan anterior: usuario admin de prueba con custom claim `admin:true` en el emulador de Auth, `seed/seed.js` para services/staff), recorrer en un navegador real (Playwright):

1. **Colación recurrente:** en Horarios, activar colación para un barbero un día que esté abierto (ej. 13:00-14:00). Guardar.
2. **Efecto en el admin:** en Agenda, intentar crear una cita para ese barbero a las 13:15 ese mismo día de semana → debe aparecer la advertencia "Horario bloqueado" con el checkbox de Sobrecupo; guardar sin marcarlo debe fallar con el mensaje de error; marcándolo, debe guardar igual (con `over:true`).
3. **Efecto en el público:** abrir el widget público de reservas (`openBK()`), elegir ese barbero y esa fecha → el horario 13:00 (o el que se solape con la colación) NO debe aparecer como seleccionable (o debe aparecer tachado/deshabilitado, según el comportamiento ya existente de `bk-taken`).
4. **Bloqueo puntual:** desde la Agenda (vista Día), "+ Bloquear horario" para el mismo barbero, una fecha futura, con motivo. Guardar → debe verse la tarjeta oscura en la línea de tiempo de ese día.
5. **Efecto en el admin (puntual):** crear una cita para ese barbero en ese horario exacto → misma advertencia que el punto 2, mencionando el motivo del bloqueo.
6. **Efecto en el público (puntual):** el widget público, para ese barbero/fecha, no debe ofrecer ese horario.
7. **Editar/eliminar bloqueo:** clic en la tarjeta del bloqueo → modal de edición con los datos correctos; cambiar el motivo y guardar → se refleja en la tarjeta. Eliminar → desaparece de la línea de tiempo y el widget público vuelve a ofrecer ese horario.
8. **Sin regresión:** confirmar que la vista de Lista de la Agenda (feature anterior) sigue funcionando exactamente igual, y que crear/editar/eliminar una cita normal (sin bloqueo de por medio) sigue funcionando como antes.
9. **Bloqueos fuera de la Lista:** confirmar que el bloqueo puntual creado en el punto 4 **no** aparece como fila en la vista de Lista de la Agenda (solo se ve en la línea de tiempo del día) y que el contador "Reservas" del Dashboard no cambia al crear/eliminar un bloqueo (los bloqueos no son reservas).

Expected: los 9 puntos pasan sin errores de consola ni comportamiento inesperado.

- [ ] **Step 2: Si algo falla, corregir y volver a commitear**

Si algún punto falla, arreglar el código correspondiente, repetir el punto que falló, y commitear el fix por separado (no amend):

```bash
git add <archivos>
git commit -m "fix(bloqueo-horarios): <describir el fix puntual>"
```

- [ ] **Step 3: Correr toda la suite automatizada una vez más**

Run: `cd functions && node --test test/availability.test.js` (esperado: 17/17 en verde) y `npm run test:rules` desde la raíz (esperado: mismas 2 fallas preexistentes ya documentadas, ninguna nueva).

- [ ] **Step 4: Detener el emulador**

Run: `Ctrl+C` en la terminal donde corre `firebase emulators:start` (o cerrar esa terminal).
