# Suspensión del servicio por falta de pago — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aldo puede suspender o reactivar SW Studio cambiando `license/main.status`, sin desplegar y sin perder datos. Con `suspended` se detienen el panel, la PWA, el widget y los envíos automáticos; el landing sigue en línea.

**Architecture:** Documento `license/main` de lectura pública y escritura `false`. Lo normaliza una función pura (`functions/shared/license.js`, con copia deliberada en `public/js/data.js`). El corte real ocurre en el servidor (`assertActive()` en los callables operativos y salida temprana en tres `onSchedule`) y en las reglas (escrituras del admin sujetas a `licenseActive()`). Los frontends solo pintan: overlay o banner en el panel, pantalla en la PWA y texto neutro en el widget.

**Tech Stack:** Firebase (Firestore rules CEL, Cloud Functions v2 Node 22, Hosting), JS vanilla sin bundler, `node:test`, vitest + `@firebase/rules-unit-testing`, Playwright (scripts standalone), e2e contra el emulador por REST.

**Spec:** `docs/superpowers/specs/2026-10-05-suspension-servicio-design.md` (leer también su "Fe de erratas").

## Global Constraints

- Ausente o desconocido = activo. En todas las capas: rules, functions y frontends.
- `license/main`: `allow read: if true; allow write: if false;`.
- Estados válidos: exactamente `'active'`, `'warning'` y `'suspended'`.
- El `HttpsError` de suspensión es `failed-precondition` con `details` **exactamente** `{ license: 'suspended' }`, sin `message`.
- El público nunca ve el motivo. El widget dice: "Las reservas online no están disponibles por ahora." + WhatsApp `https://wa.me/56982514114`.
- Las lecturas del admin **no** se gatean, solo las escrituras.
- No tocar `refreshGoogleReviews`, `syncGoogleReviews`, `functions/googleReviews.js` ni el módulo de reseñas (prohibición de CLAUDE.md).
- `respondToBookingReminder`, `getBookingForReminderAction`, `getAvailability` y `getClubStatus` quedan **sin** gatear.
- Dentro de transacciones solo `tx.get()`, así que `assertActive()` siempre va **antes** de `runTransaction`.
- No cambiar el diseño visual: las piezas nuevas reutilizan los tokens y clases existentes (`--a-warn`, `.a-alert`, `.bk-btn`, `.b-ghost`).
- No desplegar. Todo se prueba en local o en el emulador; los despliegues los hace Aldo.
- Los frontends llaman `window.SWData.readLicense` solo si `typeof === 'function'`. Los tests de navegador existentes stubbean `SWData` sin esa función y deben seguir pasando.
- Commits en español, estilo `feat(scope): ...`, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Batch grande del panel con licencia activa:** `saveAdmin()` escribe todo el catálogo en un batch. Si el `get()` de `licenseActive()` choca con el límite de accesos de las reglas, el panel deja de guardar en producción **aunque la licencia esté activa**. Lo fija un test en la Task 2; si falla, detenerse y avisar a Aldo, sin buscar una alternativa por cuenta propia.
2. **Un admin que no es barbero llama `getMyDay` estando suspendido:** debe seguir recibiendo `permission-denied`, no la suspensión, porque `/login` decide la ruta con eso. Lo fija la Task 3, en el e2e.
3. **Suspender con el panel abierto:** el siguiente callable que falle con `details.license` debe mostrar el overlay. Lo fija la Task 6, en el navegador, despachando `sw:license-suspended`.
4. **Reactivar sin recargar el widget:** `openBK()` debe volver a mostrar el wizard si la licencia ya no está suspendida. Lo fija la Task 8, en el navegador.
5. **La lectura de la licencia falla** (offline o reglas): todo funciona como activo. Lo fijan la Task 5 (normalización con `null`) y la Task 8 (`readLicense` que rechaza).

---

### Task 1: Lógica pura de la licencia

**Files:**
- Create: `functions/shared/license.js`
- Test: `functions/test/license.test.js`

**Interfaces:**
- Produces: `normalizeLicense(data: any) -> { status: 'active'|'warning'|'suspended', message: string, suspendAt: string }`, `isSuspended(lic) -> boolean`, `LICENSE_STATUSES: string[]`.

- [ ] **Step 1: Write the failing test**

```js
// functions/test/license.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeLicense, isSuspended, LICENSE_STATUSES } = require('../shared/license.js');

test('LICENSE_STATUSES son exactamente los tres estados del spec', () => {
  assert.deepStrictEqual(LICENSE_STATUSES, ['active', 'warning', 'suspended']);
});

// Ausente = activo: desplegar esto antes de crear license/main no puede
// apagar producción.
test('normalizeLicense: documento ausente o basura es activo', () => {
  for (const d of [undefined, null, {}, 'x', 42, { status: 'SUSPENDED' }, { status: 'inventado' }]) {
    assert.deepStrictEqual(normalizeLicense(d), { status: 'active', message: '', suspendAt: '' }, JSON.stringify(d));
  }
});

test('normalizeLicense: conserva estado, mensaje y fecha válidos', () => {
  assert.deepStrictEqual(
    normalizeLicense({ status: 'warning', message: 'Contacta a soporte', suspendAt: '2026-10-15', extra: 1 }),
    { status: 'warning', message: 'Contacta a soporte', suspendAt: '2026-10-15' });
});

test('normalizeLicense: descarta mensaje no-string y fecha mal formada', () => {
  assert.deepStrictEqual(
    normalizeLicense({ status: 'suspended', message: 7, suspendAt: '15/10/2026' }),
    { status: 'suspended', message: '', suspendAt: '' });
});

test('isSuspended: solo suspended', () => {
  assert.strictEqual(isSuspended(normalizeLicense({ status: 'suspended' })), true);
  assert.strictEqual(isSuspended(normalizeLicense({ status: 'warning' })), false);
  assert.strictEqual(isSuspended(normalizeLicense(null)), false);
  assert.strictEqual(isSuspended(null), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && node --test test/license.test.js`
Expected: FAIL con `Cannot find module '../shared/license.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// functions/shared/license.js
//
// Interruptor de suspensión del servicio por falta de pago (spec
// 2026-10-05-suspension-servicio-design.md). La fuente es license/main, que
// NINGÚN cliente puede escribir (firestore.rules: write false) -- ni siquiera
// el admin del salón. Va aparte de businessInfo a propósito: saveAdmin()
// reescribe businessInfo/main entero y borraría la marca al primer guardado.
//
// Regla única en todas las capas: ausente o desconocido = ACTIVO. Así
// desplegar esto no cambia nada hasta que Aldo cree el documento, y un typo
// en la consola no apaga producción.
//
// Copia deliberada en public/js/data.js (normalizeLicense): el navegador no
// puede importar este archivo. Cualquier cambio va en las dos.
'use strict';

const LICENSE_STATUSES = ['active', 'warning', 'suspended'];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeLicense(data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    status: LICENSE_STATUSES.indexOf(d.status) !== -1 ? d.status : 'active',
    message: typeof d.message === 'string' ? d.message : '',
    suspendAt: typeof d.suspendAt === 'string' && FECHA_RE.test(d.suspendAt) ? d.suspendAt : '',
  };
}

function isSuspended(lic) {
  return !!lic && lic.status === 'suspended';
}

module.exports = { LICENSE_STATUSES, normalizeLicense, isSuspended };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && node --test test/license.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/shared/license.js functions/test/license.test.js
git commit -m "feat(functions): agregar shared/license.js (normalización de la licencia)"
```

---

### Task 2: Reglas de Firestore

**Files:**
- Modify: `firestore.rules` (función nueva junto a `isAdmin()`, líneas ~17-19; `allow` de las líneas 23-25, 30, 44, 69-70, 103, 109, 112 y 119; match nuevo `license`)
- Test: `tests/rules/license.test.js` (nuevo)

**Interfaces:**
- Produces: función CEL `licenseActive()` y función CEL `canAdminWrite()` = `isAdmin() && licenseActive()`.

- [ ] **Step 1: Write the failing test**

```js
// tests/rules/license.test.js
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { beforeAll, afterAll, beforeEach, test } from 'vitest';

let env;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'scissor-white-license-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

// license/main tiene write:false, así que solo se siembra saltándose las reglas.
async function licencia(data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    if (data === null) await deleteDoc(doc(ctx.firestore(), 'license/main'));
    else await setDoc(doc(ctx.firestore(), 'license/main'), data);
  });
}
const admin = () => env.authenticatedContext('admin1', { admin: true }).firestore();

test('licencia ausente: el admin escribe', async () => {
  await assertSucceeds(setDoc(doc(admin(), 'services/lp'), { name: 'x' }));
});

for (const status of ['active', 'warning', 'inventado']) {
  test(`licencia ${status}: el admin escribe`, async () => {
    await licencia({ status });
    await assertSucceeds(setDoc(doc(admin(), 'services/lp'), { name: 'x' }));
  });
}

const RUTAS_ADMIN = ['services/a', 'staff/a', 'businessInfo/main', 'siteImages/a', 'googleReviews/main',
  'patients/a', 'scheduleBlocks/a', 'adminLog/a', 'staffAccounts/a'];

for (const ruta of RUTAS_ADMIN) {
  test(`licencia suspended: el admin NO escribe ${ruta}`, async () => {
    await licencia({ status: 'suspended' });
    await assertFails(setDoc(doc(admin(), ruta), { x: 1 }));
  });
}

test('licencia suspended: el admin NO borra reservas', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'bookings/b1'), { status: 'pending' });
  });
  await licencia({ status: 'suspended' });
  await assertFails(deleteDoc(doc(admin(), 'bookings/b1')));
});

// Los datos de los clientes del salón son de la dueña: suspender no se los niega.
test('licencia suspended: el admin SÍ lee', async () => {
  await licencia({ status: 'suspended' });
  await assertSucceeds(getDoc(doc(admin(), 'bookings/b1')));
  await assertSucceeds(getDoc(doc(admin(), 'patients/a')));
});

test('license/main: lectura pública', async () => {
  await licencia({ status: 'active' });
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'license/main')));
});

test('license/main: nadie la escribe, ni el admin', async () => {
  await licencia({ status: 'suspended' });
  await assertFails(setDoc(doc(admin(), 'license/main'), { status: 'active' }));
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'license/main'), { status: 'active' }));
  await licencia(null);
  await assertFails(setDoc(doc(admin(), 'license/main'), { status: 'active' }));
});

// Review Focus #1: saveAdmin() escribe el catálogo entero en un batch. Si el
// get() de licenseActive() rompe el límite de accesos por request, el panel deja
// de guardar con la licencia ACTIVA. 40 escrituras > cualquier catálogo real.
test('licencia active: un batch de 40 escrituras del admin pasa', async () => {
  await licencia({ status: 'active' });
  const db = admin();
  const b = writeBatch(db);
  for (let i = 0; i < 30; i++) b.set(doc(db, `services/s${i}`), { name: 'S' + i });
  for (let i = 0; i < 9; i++) b.set(doc(db, `staff/p${i}`), { name: 'P' + i });
  b.set(doc(db, 'businessInfo/main'), { tz: 'America/Santiago' });
  await assertSucceeds(b.commit());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx firebase emulators:exec --only firestore "npx vitest run tests/rules/license.test.js"`
Expected: FAIL. Los tests "suspended: el admin NO escribe ..." fallan porque hoy la escritura pasa, y "license/main: lectura pública" falla porque no hay match.

- [ ] **Step 3: Implement the rules**

En `firestore.rules`, justo después del cierre de `function isAdmin() { ... }`:

```
    // Interruptor de suspensión por falta de pago (spec
    // 2026-10-05-suspension-servicio-design.md). license/main lo escribe SOLO
    // Aldo (consola o functions/scripts/license.js): write:false abajo. Ausente
    // o con un status que no sea exactamente 'suspended' = activo, misma regla
    // que normalizeLicense() en functions/shared/license.js.
    //
    // NO es una sexta copia de isAdmin(): es otro predicado. Gatea solo las
    // ESCRITURAS del admin; las lecturas quedan, porque los datos de los
    // clientes del salón son de la dueña y suspender no se los niega.
    function licenseActive() {
      let p = /databases/$(database)/documents/license/main;
      return !exists(p) || get(p).data.get('status', 'active') != 'suspended';
    }
    function canAdminWrite() {
      return isAdmin() && licenseActive();
    }
```

Reemplazos exactos (dejar los comentarios existentes como están):

```
    match /services/{id}   { allow read: if true; allow write: if canAdminWrite(); }
    match /staff/{id}      { allow read: if true; allow write: if canAdminWrite(); }
    match /businessInfo/{id}{ allow read: if true; allow write: if canAdminWrite(); }
```
```
    match /siteImages/{slot} { allow read: if true; allow write: if canAdminWrite(); }
```
```
    match /googleReviews/{id} { allow read: if true; allow write: if canAdminWrite(); }
```
```
    match /bookings/{id} {
      allow read: if isAdmin();
      allow delete: if canAdminWrite();
      allow create, update: if false;
    }
```
```
    match /patients/{id} { allow read: if isAdmin(); allow write: if canAdminWrite(); }
```
```
    match /scheduleBlocks/{id} { allow read: if isAdmin(); allow write: if canAdminWrite(); }
```
```
    match /adminLog/{id} { allow read: if isAdmin(); allow write: if canAdminWrite(); }
```
```
    match /staffAccounts/{staffId} { allow read: if isAdmin(); allow write: if canAdminWrite(); }
```

Y un match nuevo, después del de `availability`:

```
    // Ver licenseActive(). Lectura pública porque el widget la necesita para
    // decidir si muestra el wizard -- por eso license/main.message debe ser
    // neutro. Escritura de NADIE desde un cliente.
    match /license/{id} { allow read: if true; allow write: if false; }
```

`staffDevices` no cambia.

- [ ] **Step 4: Run all rules tests**

Run: `npm run test:rules`
Expected: PASS en `license.test.js` **y** en los archivos existentes (`firestore.rules.test.js`, `staffDevices.test.js`, `storage.rules.test.js`). Si el test del batch de 40 falla por límite de accesos, **detenerse y avisar a Aldo** (Review Focus #1).

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/rules/license.test.js
git commit -m "feat(rules): gatear escrituras del admin con license/main"
```

---

### Task 3: Functions: `assertActive()` en callables y tareas programadas

**Files:**
- Modify: `functions/index.js` (imports ~línea 23; helper después de `assertAdmin` ~línea 43; `createBooking` :151, `adminLogEvent` :929, `adminSaveBooking` :963, `getMyDay` :874, `getMyRange` :1040, `getMyClients` :1077, `markAttendance` :1099, `linkStaffAccount` :1157; `sendBookingReminders` ~:400, `sendSatisfactionSurveys` ~:527, `staffAttendanceNudges` ~:1242)
- Modify: `tests/e2e/emulator.mjs` (helpers `ownerSetDoc` y `ownerDeleteDoc`)
- Create: `tests/e2e/suspension.mjs`
- Modify: `tests/e2e/todos.mjs` (agregar la suite)

**Interfaces:**
- Consumes: `normalizeLicense`, `isSuspended` de `./shared/license.js` (Task 1).
- Produces: `readLicense(db) -> Promise<{status,message,suspendAt}>` y `assertActive(db) -> Promise<void>` (lanza `HttpsError('failed-precondition','Servicio suspendido.',{license:'suspended'})`), internos de `functions/index.js`. Helpers e2e `ownerSetDoc(path, data)` y `ownerDeleteDoc(path)`.

- [ ] **Step 1: Add the e2e helpers**

En `tests/e2e/emulator.mjs`, antes de `export const sleep`:

```js
// Escritura con privilegios de dueño del proyecto: el emulador acepta el token
// literal "owner" y se salta firestore.rules. Solo para documentos que ningún
// cliente puede escribir (license/main tiene write:false). Sin updateMask, el
// PATCH reemplaza el documento entero.
export async function ownerSetDoc(path, data) {
  const fields = {};
  Object.entries(data).forEach(([k, v]) => { fields[k] = typed(v); });
  const r = await fetch(`${FS}/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error('ownerSetDoc ' + path + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

export async function ownerDeleteDoc(path) {
  await fetch(`${FS}/${path}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
}
```

- [ ] **Step 2: Write the failing e2e suite**

```js
// tests/e2e/suspension.mjs
//
// Suspensión del servicio (spec 2026-10-05-suspension-servicio-design.md)
// contra el EMULADOR real. Requiere lo mismo que callables.mjs (emulador +
// seed). Deja license/main BORRADO al terminar, pase lo que pase: el seed no
// lo toca y una licencia suspendida contaminaría las otras suites.
//
// Uso: node tests/e2e/suspension.mjs
import { makeChecker, token, call, getDoc, patchDoc, ownerSetDoc, ownerDeleteDoc } from './emulator.mjs';

const check = makeChecker();
const tVic = await token('victoria@scissorwhite.cl', 'barbero123');
const tAdm = await token('admin@scissorwhite.cl', 'admin123');

const esSusp = (r) => !!(r.error && /FAILED_PRECONDITION/i.test(r.error.status || '')
  && r.error.details && r.error.details.license === 'suspended');

try {
  await ownerSetDoc('license/main', { status: 'suspended', message: 'Prueba e2e' });

  // ── callables gateados ──
  const cb = await call('createBooking', { svcId: 'cualquiera' }, null);
  check('createBooking rechaza con licencia suspendida', esSusp(cb), cb.error);
  check('createBooking NO devuelve el mensaje al público',
    !!(cb.error && cb.error.details) && !('message' in cb.error.details), cb.error);

  const asb = await call('adminSaveBooking', { booking: {} }, tAdm);
  check('adminSaveBooking rechaza', esSusp(asb), asb.error);

  const antes = await getDoc('bookings/E2E-PROX', tAdm);
  const ma = await call('markAttendance', { bookingId: 'E2E-PROX', action: 'arrive' }, tVic);
  check('markAttendance rechaza', esSusp(ma), ma.error);
  const despues = await getDoc('bookings/E2E-PROX', tAdm);
  check('y la cita no cambió', antes && despues && antes.status === despues.status, { antes: antes && antes.status, despues: despues && despues.status });

  for (const [fn, data] of [['getMyDay', {}], ['getMyRange', { from: '2026-10-01', to: '2026-10-02' }], ['getMyClients', {}]]) {
    const r = await call(fn, data, tVic);
    check(`${fn} rechaza al barbero`, esSusp(r), r.error);
  }

  // Review Focus #2: /login decide la ruta con este permission-denied.
  const adm = await call('getMyDay', {}, tAdm);
  check('getMyDay a una cuenta sin ficha sigue siendo permission-denied',
    !!(adm.error && /PERMISSION_DENIED/i.test(adm.error.status || '')), adm.error);

  const le = await call('adminLogEvent', { action: 'x' }, tAdm);
  check('adminLogEvent rechaza', esSusp(le), le.error);
  const ls = await call('linkStaffAccount', { staffId: 'victoria', email: 'victoria@scissorwhite.cl' }, tAdm);
  check('linkStaffAccount rechaza', esSusp(ls), ls.error);

  // ── NO gateados a propósito ──
  const rr = await call('respondToBookingReminder', { code: 'NOEXISTE', token: 'x', action: 'confirm' }, null);
  check('respondToBookingReminder NO está gateado (correos ya enviados)', !esSusp(rr), rr.error);
  const av = await call('getAvailability', { date: '2026-10-10', barberId: 'victoria' }, null);
  check('getAvailability NO está gateado', !esSusp(av), av.error);

  // ── reglas por REST ──
  let catBloq = false;
  try { await patchDoc('services/e2e-susp', { name: 'x' }, tAdm); } catch (e) { catBloq = /403/.test(e.message); }
  check('el admin NO escribe el catálogo', catBloq);
  check('el admin SÍ lee reservas', !!(await getDoc('bookings/E2E-PROX', tAdm)));
  let licBloq = false;
  try { await patchDoc('license/main', { status: 'active' }, tAdm); } catch (e) { licBloq = /403/.test(e.message); }
  check('el admin NO puede reactivarse solo', licBloq);

  // ── reactivar ──
  // En el emulador la caché de readLicense está en 0 ms (ver functions/index.js).
  await ownerSetDoc('license/main', { status: 'active' });
  const ok = await call('getMyDay', {}, tVic);
  check('reactivado: getMyDay vuelve a responder', ok.status === 200, ok.error);
} finally {
  await ownerDeleteDoc('license/main');
}

check.done();
```

En `tests/e2e/todos.mjs` cambiar:

```js
const SUITES = ['callables', 'nudges', 'navegador', 'suspension'];
```

- [ ] **Step 3: Run it to verify it fails**

Run, con el emulador corriendo (`npx firebase emulators:start --project scissor-white` en otra terminal):
```bash
cd seed && FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=scissor-white npm run seed && cd ../functions && node scripts/seedEmulatorE2E.mjs && cd .. && node tests/e2e/suspension.mjs
```
Expected: FAIL. Los checks "... rechaza" fallan, y los de reglas pasan porque ya hay rules de la Task 2.

- [ ] **Step 4: Implement in `functions/index.js`**

Import, junto a los demás `require` de `./shared/`:

```js
const { normalizeLicense, isSuspended } = require('./shared/license.js');
```

Después de `function assertAdmin(request) { ... }`:

```js
// Suspensión por falta de pago (spec 2026-10-05-suspension-servicio-design.md).
// license/main lo escribe solo Aldo. Se cachea por instancia para no sumar una
// lectura a cada llamada: suspender o reactivar tarda hasta un minuto en verse.
// En el emulador la caché va en 0 para que el e2e pueda alternar estados.
//
// Si la lectura FALLA, se asume activo y no se cachea: es un interruptor de
// cobro, no de seguridad, y apagar el salón por un hiccup de Firestore sería
// peor que dejarlo andar un minuto más.
const LICENSE_TTL_MS = process.env.FUNCTIONS_EMULATOR === 'true' ? 0 : 60 * 1000;
let licenseCache = { at: 0, value: null };

async function readLicense(db) {
  const now = Date.now();
  if (licenseCache.value && now - licenseCache.at < LICENSE_TTL_MS) return licenseCache.value;
  try {
    const snap = await db.collection('license').doc('main').get();
    const value = normalizeLicense(snap.exists ? snap.data() : null);
    licenseCache = { at: now, value };
    return value;
  } catch (e) {
    logger.error('readLicense: no se pudo leer license/main, se asume activo', e);
    return normalizeLicense(null);
  }
}

// Va SIEMPRE fuera de runTransaction (usa db.get suelto). El mensaje de
// license/main NO viaja en el error: createBooking lo devolvería a cualquier
// visitante del sitio.
async function assertActive(db) {
  if (isSuspended(await readLicense(db))) {
    throw new HttpsError('failed-precondition', 'Servicio suspendido.', { license: 'suspended' });
  }
}
```

Inserciones (una línea cada una, exactamente en estos puntos):

- `createBooking`: primera línea del handler, antes de `const payload = ...`:
  ```js
      await assertActive(getFirestore(app));
  ```
- `adminLogEvent`, `adminSaveBooking`, `linkStaffAccount`: justo después de `assertAdmin(request);`:
  ```js
      await assertActive(getFirestore(app));
  ```
- `getMyDay`, `getMyRange`, `getMyClients`: justo después de `if (!staff) throw new HttpsError('permission-denied', ...);`. Debe ir **después**, para que una cuenta sin ficha siga recibiendo `permission-denied` (Review Focus #2):
  ```js
      await assertActive(db);
  ```
- `markAttendance`: justo después de `if (at && !isAdmin) throw new HttpsError(...);` y antes de `const ref = ...`:
  ```js
      await assertActive(db);
  ```

En las tres tareas programadas, justo **después** del `if (... !== true) { ...; return; }` de su interruptor:

```js
      if (isSuspended(await readLicense(db))) {
        logger.info('sendBookingReminders: servicio suspendido (license/main), no se envía nada.');
        return;
      }
```

Usar el nombre propio de cada función en el log: `sendBookingReminders`, `sendSatisfactionSurveys` o `staffAttendanceNudges`.

- [ ] **Step 5: Run unit + e2e**

Run: `cd functions && npm test`. Expected: PASS (todos, incluido `license.test.js`).
Reiniciar el emulador para que cargue el código nuevo y volver a ejecutar el comando del Step 3. Expected: `== TODO OK ==`.
Run: `node tests/e2e/todos.mjs`. Expected: `4/4 SUITES E2E OK`.

- [ ] **Step 6: Commit**

```bash
git add functions/index.js tests/e2e/emulator.mjs tests/e2e/suspension.mjs tests/e2e/todos.mjs
git commit -m "feat(functions): cortar callables y envíos con license/main suspendida"
```

---

### Task 4: Script para suspender o reactivar

**Files:**
- Create: `functions/scripts/license.js`
- Test: `functions/test/licenseScript.test.js`

**Interfaces:**
- Consumes: `LICENSE_STATUSES` de `../shared/license.js`.
- Produces: `buildLicenseDoc(argv: string[], nowIso: string) -> { status, message, suspendAt, updatedAt }` (lanza `Error` con texto de uso si el input es inválido), exportado; CLI `node scripts/license.js <active|warning|suspended> [--message "..."] [--suspend-at YYYY-MM-DD]`.

- [ ] **Step 1: Write the failing test**

```js
// functions/test/licenseScript.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildLicenseDoc } = require('../scripts/license.js');

const NOW = '2026-10-05T12:00:00.000Z';

test('buildLicenseDoc: suspended con mensaje', () => {
  assert.deepStrictEqual(buildLicenseDoc(['suspended', '--message', 'Contacta a soporte'], NOW),
    { status: 'suspended', message: 'Contacta a soporte', suspendAt: '', updatedAt: NOW });
});

test('buildLicenseDoc: warning con fecha', () => {
  assert.deepStrictEqual(buildLicenseDoc(['warning', '--suspend-at', '2026-10-15'], NOW),
    { status: 'warning', message: '', suspendAt: '2026-10-15', updatedAt: NOW });
});

test('buildLicenseDoc: active limpia mensaje y fecha', () => {
  assert.deepStrictEqual(buildLicenseDoc(['active'], NOW),
    { status: 'active', message: '', suspendAt: '', updatedAt: NOW });
});

test('buildLicenseDoc: rechaza estado desconocido, vacío o fecha mala', () => {
  assert.throws(() => buildLicenseDoc([], NOW), /Uso:/);
  assert.throws(() => buildLicenseDoc(['pausado'], NOW), /Uso:/);
  assert.throws(() => buildLicenseDoc(['warning', '--suspend-at', '15-10-2026'], NOW), /YYYY-MM-DD/);
  assert.throws(() => buildLicenseDoc(['suspended', '--message'], NOW), /--message/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && node --test test/licenseScript.test.js`
Expected: FAIL con `Cannot find module '../scripts/license.js'`.

- [ ] **Step 3: Write implementation**

```js
// functions/scripts/license.js
//
// Suspende o reactiva SW Studio escribiendo license/main (spec
// 2026-10-05-suspension-servicio-design.md). Es la alternativa a editar el
// campo a mano en la consola de Firebase; las dos sirven.
//
// Requisitos (una de las dos):
//   a) gcloud auth application-default login   (usa tus credenciales)
//   b) GOOGLE_APPLICATION_CREDENTIALS=/ruta/service-account.json
// Con FIRESTORE_EMULATOR_HOST definido escribe en el emulador.
//
// Uso:
//   cd functions
//   node scripts/license.js warning --suspend-at 2026-10-15 --message "Contacta a soporte"
//   node scripts/license.js suspended --message "Contacta a soporte para reactivar"
//   node scripts/license.js active
//
// OJO: license/main es de LECTURA PÚBLICA (el widget la lee), así que el
// mensaje lo puede ver cualquiera. Que sea neutro.
//
// Las funciones lo ven en hasta 1 minuto (caché por instancia).
'use strict';
const { LICENSE_STATUSES } = require('../shared/license.js');

const USO = 'Uso: node scripts/license.js <active|warning|suspended> [--message "..."] [--suspend-at YYYY-MM-DD]';

function buildLicenseDoc(argv, nowIso) {
  const [status, ...rest] = argv;
  if (LICENSE_STATUSES.indexOf(status) === -1) throw new Error(USO);
  let message = '';
  let suspendAt = '';
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const val = rest[i + 1];
    if (flag !== '--message' && flag !== '--suspend-at') throw new Error(USO);
    if (val === undefined || val.startsWith('--')) throw new Error(`Falta el valor de ${flag}. ${USO}`);
    if (flag === '--message') message = val;
    else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) throw new Error('--suspend-at debe ser YYYY-MM-DD.');
      suspendAt = val;
    }
    i++;
  }
  if (status === 'active') { message = ''; suspendAt = ''; }
  return { status, message, suspendAt, updatedAt: nowIso };
}

async function main() {
  let data;
  try {
    data = buildLicenseDoc(process.argv.slice(2), new Date().toISOString());
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp(process.env.FIRESTORE_EMULATOR_HOST
    ? { projectId: 'scissor-white' }
    : { credential: applicationDefault(), projectId: 'scissor-white' });
  const ref = getFirestore().collection('license').doc('main');
  await ref.set(data);
  const snap = await ref.get();
  console.log('OK: license/main =', snap.data());
  console.log('Las funciones lo ven en hasta 1 minuto.');
}

if (require.main === module) {
  main().catch((err) => { console.error('Error:', err.message); process.exit(1); });
}

module.exports = { buildLicenseDoc };
```

- [ ] **Step 4: Run tests**

Run: `cd functions && npm test`
Expected: PASS.
Probarlo a mano contra el emulador: `cd functions && FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/license.js warning --suspend-at 2026-10-15` debe imprimir `OK: license/main = { status: 'warning', ... }`. Después, `... node scripts/license.js active`.

- [ ] **Step 5: Commit**

```bash
git add functions/scripts/license.js functions/test/licenseScript.test.js
git commit -m "feat(scripts): agregar license.js para suspender/reactivar el servicio"
```

---

### Task 5: Capa de datos del navegador (`data.js`)

**Files:**
- Modify: `public/js/data.js` (helper nuevo cerca de `loadCatalog` ~línea 83; `createBooking` :144, `getMyDay` :343, `getMyRange` :351, `adminLogEvent` :366, `adminSaveBooking` :372, `getMyClients` :378, `markAttendance` :388, `linkStaffAccount` :396; `window.SWData` y `export` :412-433)

**Interfaces:**
- Produces: `window.SWData.readLicense() -> Promise<{status,message,suspendAt}>`, que nunca rechaza. Evento `window` `'sw:license-suspended'` (sin `detail`), despachado cuando un callable gateado responde con `details.license === 'suspended'`.

- [ ] **Step 1: Implement**

Después de `loadCatalog()`:

```js
// Licencia del servicio (spec 2026-10-05-suspension-servicio-design.md).
// Copia DELIBERADA de normalizeLicense() de functions/shared/license.js: el
// navegador no puede importar ese archivo. Misma regla: ausente o desconocido
// = activo. Cualquier cambio va en las dos.
const LICENSE_STATUSES = ['active', 'warning', 'suspended'];
function normalizeLicense(data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    status: LICENSE_STATUSES.indexOf(d.status) !== -1 ? d.status : 'active',
    message: typeof d.message === 'string' ? d.message : '',
    suspendAt: typeof d.suspendAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.suspendAt) ? d.suspendAt : '',
  };
}

// Nunca rechaza: si la lectura falla (offline, reglas), se asume activo. El
// widget falla abierto (invariante) y el corte real lo hace el servidor.
async function readLicense() {
  try {
    const snap = await getDoc(doc(db, 'license', 'main'));
    return normalizeLicense(snap.exists() ? snap.data() : null);
  } catch (e) {
    console.warn('readLicense: no se pudo leer license/main, se asume activo', e);
    return normalizeLicense(null);
  }
}

// Envuelve un callable gateado por assertActive(): si el servidor dice que el
// servicio está suspendido, avisa a la página (el panel muestra su overlay aunque
// la suspensión haya ocurrido con el panel abierto) y relanza el error igual,
// para que el llamador siga manejando su propio fallo.
async function guarded(promise) {
  try {
    return await promise;
  } catch (e) {
    if (e && e.details && e.details.license === 'suspended') {
      window.dispatchEvent(new CustomEvent('sw:license-suspended'));
    }
    throw e;
  }
}
```

En cada uno de estos ocho, cambiar `await call(...)` por `await guarded(call(...))` sin tocar nada más: `createBooking`, `getMyDay`, `getMyRange`, `adminLogEvent`, `adminSaveBooking`, `getMyClients`, `markAttendance` y `linkStaffAccount`. Ejemplo (`getMyDay`):

```js
async function getMyDay(date) {
  const call = httpsCallable(functions, 'getMyDay');
  const { data } = await guarded(call({ date: date || null }));
  return data; // { staffId, name, date, tz, bookings: [...], schedule }
}
```

Agregar `readLicense` a la lista de `window.SWData = { ... }` **y** a la de `export { ... }`, en la línea de `loadAdmin, saveAdmin, loadCatalog, ...`:

```js
  loadAdmin, saveAdmin, loadCatalog, readLicense, getBookings, saveBooking, deleteBooking, subscribeBookings, createBooking,
```

- [ ] **Step 2: Verify nothing broke**

Run: `npm test && for f in tests/browser/*.mjs; do node "$f" || echo "FALLÓ $f"; done`
Expected: todos PASS y ninguna línea `FALLÓ`. Los stubs no usan `data.js`, pero así se confirma que nada más depende de su forma.
Además, chequear la sintaxis. `data.js` es un ES module, así que se copia a `.mjs` para que `node --check` lo parsee como módulo; `--check` no resuelve los imports por URL: `cp public/js/data.js "$TMPDIR/data-check.mjs" && node --check "$TMPDIR/data-check.mjs" && echo SINTAXIS_OK`. Expected: `SINTAXIS_OK`.

- [ ] **Step 3: Commit**

```bash
git add public/js/data.js
git commit -m "feat(data): readLicense() y aviso sw:license-suspended en callables gateados"
```

---

### Task 6: Panel admin: banner de `warning` y overlay de `suspended`

**Files:**
- Modify: `public/admin/index.html` (CSS junto a `.a-alert.a-err-t` línea ~429; markup junto a `#adm-load-err-banner` línea ~1163 y antes del cierre de `#adm-shell`; JS: `redirigirSiEsBarbero` ~1817, `abrirPanel` ~1827)
- Create: `tests/browser/suspension.mjs`

**Interfaces:**
- Consumes: `window.SWData.readLicense()` (Task 5), evento `'sw:license-suspended'` (Task 5), `details.license` en errores de `getMyDay` (Task 3).
- Produces: `#adm-license-banner` (con `.a-show` cuando está en warning), `#adm-license-banner-t`, `#adm-susp` (con `style.display === 'flex'` cuando está suspendido), `#adm-susp-msg`, `#adm-susp-out`.

- [ ] **Step 1: Write the failing browser test**

```js
// tests/browser/suspension.mjs
//
// Suspensión del servicio (spec 2026-10-05-suspension-servicio-design.md):
// lo que PINTA cada frontend según license/main. El corte real lo prueban
// tests/rules/license.test.js y tests/e2e/suspension.mjs; acá SWAuth/SWData
// van stubbeados con addInitScript, igual que en admin-redirect-barbero.mjs.
//
// Script standalone: `node tests/browser/suspension.mjs`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const PORT = 4491;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif',
  '.ico':'image/x-icon','.webmanifest':'application/manifest+json','.svg':'image/svg+xml' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p==='/') p='/index.html';
  if(p.endsWith('/')) p += 'index.html';
  if(!path.extname(p)) p += '/index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{ if(e){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'}); res.end(b); });
});
await new Promise(r=>server.listen(PORT,r));
const browser = await chromium.launch();

let fails = 0;
const check = (name, cond, detail) => {
  if(!cond){ fails++; console.log(`✗ ${name}` + (detail!==undefined?` -> ${JSON.stringify(detail)}`:'')); }
  else console.log(`✓ ${name}`);
};

async function nuevaPagina(viewport){
  const ctx = await browser.newContext({ viewport });
  await ctx.route('**gstatic.com/**', r=>r.abort());
  await ctx.route('**googleapis.com/**', r=>r.abort());
  return { ctx, page: await ctx.newPage() };
}

// ═══════════════ PANEL ADMIN ═══════════════
async function abrirAdmin(lic){
  const { ctx, page } = await nuevaPagina({ width:1200, height:900 });
  await page.addInitScript((lic) => {
    window.SWAuth = { signIn: async () => ({uid:'a'}), signOut: async () => {}, onChange: (cb) => { cb({uid:'a'}); return () => {}; } };
    window.SWData = {
      loadAdmin: async () => ({ services:[], staff:[], staffAccounts:{}, info:{}, log:[], schedule:[] }),
      readLicense: async () => lic,
      getMyDay: async () => { const e = new Error('x'); e.code = 'functions/permission-denied'; throw e; },
      subscribeBookings: (cb) => { cb([]); return { unsubscribe(){}, ready: Promise.resolve() }; },
      getPatients: async () => [], getScheduleBlocks: async () => [],
      saveAdmin: async () => {}, loadGoogleReviews: async () => null,
    };
  }, lic);
  await page.goto(`http://localhost:${PORT}/admin/`, { waitUntil:'load' });
  await page.waitForTimeout(900);
  return { ctx, page };
}

{
  const { ctx, page } = await abrirAdmin({ status:'active', message:'', suspendAt:'' });
  check('admin activo: panel visible', await page.isVisible('#adm-app'));
  check('admin activo: sin overlay', !(await page.isVisible('#adm-susp')));
  check('admin activo: sin banner', !(await page.isVisible('#adm-license-banner')));
  // Review Focus #3: suspensión con el panel ya abierto.
  await page.evaluate(() => {
    window.SWData.readLicense = async () => ({ status:'suspended', message:'Escribe a soporte', suspendAt:'' });
    window.dispatchEvent(new CustomEvent('sw:license-suspended'));
  });
  await page.waitForTimeout(300);
  check('admin: sw:license-suspended con el panel abierto muestra el overlay', await page.isVisible('#adm-susp'));
  check('y trae el mensaje de license/main', (await page.textContent('#adm-susp-msg')).includes('Escribe a soporte'));
  await ctx.close();
}

{
  const { ctx, page } = await abrirAdmin({ status:'warning', message:'', suspendAt:'2026-10-15' });
  check('admin warning: banner visible', await page.isVisible('#adm-license-banner'));
  check('admin warning: banner con la fecha', (await page.textContent('#adm-license-banner-t')).includes('15-10-2026'));
  check('admin warning: sin overlay', !(await page.isVisible('#adm-susp')));
  await ctx.close();
}

{
  const { ctx, page } = await abrirAdmin({ status:'suspended', message:'', suspendAt:'' });
  check('admin suspendido: overlay visible', await page.isVisible('#adm-susp'));
  check('admin suspendido: mensaje por defecto si no hay message',
    (await page.textContent('#adm-susp-msg')).trim().length > 10);
  check('admin suspendido: botón cerrar sesión', await page.isVisible('#adm-susp-out'));
  await ctx.close();
}

// Un barbero que cae en el panel estando suspendido: loadAdmin falla y getMyDay
// dice "suspendido". Debe ir a /barbero/ (ahí ve la pantalla de suspensión), no
// quedarse en el panel con el banner de error.
{
  const { ctx, page } = await nuevaPagina({ width:1200, height:900 });
  await page.addInitScript(() => {
    window.SWAuth = { signIn: async () => ({uid:'b'}), signOut: async () => {}, onChange: (cb) => { cb({uid:'b'}); return () => {}; } };
    window.SWData = {
      loadAdmin: async () => { const e = new Error('perm'); e.code = 'permission-denied'; throw e; },
      getMyDay: async () => { const e = new Error('Servicio suspendido.'); e.code = 'functions/failed-precondition'; e.details = { license:'suspended' }; throw e; },
      subscribeBookings: (cb) => { cb([]); return { unsubscribe(){}, ready: Promise.resolve() }; },
      getPatients: async () => [], getScheduleBlocks: async () => [],
    };
  });
  await page.goto(`http://localhost:${PORT}/admin/`, { waitUntil:'load' });
  await page.waitForTimeout(900);
  check('barbero en el panel con licencia suspendida termina en /barbero/', /\/barbero\/$/.test(page.url()), page.url());
  await ctx.close();
}

// ── fin ──
await browser.close();
server.close();
console.log(fails === 0 ? '\n== TODO OK ==' : `\n== ${fails} FALLAS ==`);
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/browser/suspension.mjs`
Expected: FAIL en los checks de overlay, banner y redirección.

- [ ] **Step 3: Implement**

CSS, justo después de `.a-alert.a-err-t{...}`. Son los mismos colores que `.a-conflict`, así que no hay diseño nuevo:

```css
.a-alert.a-warn-t{background:#FFF6E0;color:var(--a-warn);border:1px solid #F0DBA0}
#adm-susp{position:fixed;inset:0;z-index:10200;background:rgba(10,10,10,.6);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:16px}
#adm-susp-box{background:#fff;border-radius:12px;max-width:420px;width:100%;padding:28px 24px;text-align:center;color:var(--a-txt)}
#adm-susp-box h2{font-size:18px;font-weight:600;margin-bottom:10px}
#adm-susp-box p{font-size:13.5px;color:var(--a-body);line-height:1.55;margin-bottom:18px}
```

Markup: justo después del `</div>` de `#adm-load-err-banner`:

```html
      <div id="adm-license-banner" class="a-alert a-warn-t" role="status" style="margin:12px 16px 0">
        <span id="adm-license-banner-t"></span>
      </div>
```

Y como último hijo de `#adm-shell` (antes de su `</div>` de cierre):

```html
  <!-- Suspensión por falta de pago (license/main). No se puede cerrar: el
       servidor y las reglas ya cortaron la operación, esto solo lo explica. -->
  <div id="adm-susp" role="alertdialog" aria-modal="true" aria-labelledby="adm-susp-h">
    <div id="adm-susp-box">
      <h2 id="adm-susp-h">Servicio suspendido</h2>
      <p id="adm-susp-msg"></p>
      <button class="a-btn a-btn-p" id="adm-susp-out">Cerrar sesión</button>
    </div>
  </div>
```

JS, en `redirigirSiEsBarbero`: cambiar el `catch(e){ return false; }` por el siguiente, y agregar este párrafo al final del comentario que la precede: `// Si getMyDay responde "suspendido" (license/main) también es un barbero vinculado: en /barbero/ ve la pantalla de suspensión en vez de este panel vacío.`

```js
  catch(e){ if (!(e && e.details && e.details.license === 'suspended')) return false; }
```

JS, nueva sección justo antes de `// ═══ LOGIN ═══`:

```js
// ═══ LICENCIA (suspensión por falta de pago) ═══
// license/main lo controla Aldo, no este panel (write:false en las reglas).
// Esto solo PINTA: el corte real lo hacen las Functions y firestore.rules.
// readLicense() nunca rechaza y devuelve 'active' si no pudo leer.
function fechaDMA(k){ return String(k).split('-').reverse().join('-'); }
function mostrarSuspension(message){
  g('adm-susp-msg').textContent = message ||
    'Para reactivar el sistema, comunícate con soporte. Tus datos se conservan.';
  g('adm-susp').style.display = 'flex';
  // Sin esto la suscripción a bookings sigue viva detrás del overlay.
  if (bkUnsubscribe) { bkUnsubscribe(); bkUnsubscribe = null; }
}
function pintarLicencia(lic){
  var l = lic || { status:'active', message:'', suspendAt:'' };
  var ban = g('adm-license-banner');
  if (l.status === 'warning') {
    g('adm-license-banner-t').textContent = '⚠ Pago pendiente.' +
      (l.suspendAt ? ' El servicio se suspenderá el ' + fechaDMA(l.suspendAt) + '.' : '') +
      (l.message ? ' ' + l.message : '');
    ban.classList.add('a-show');
  } else {
    ban.classList.remove('a-show');
  }
  if (l.status === 'suspended') mostrarSuspension(l.message);
}
async function leerLicencia(){
  if (!window.SWData || typeof window.SWData.readLicense !== 'function') return null;
  return window.SWData.readLicense();
}
// La suspensión puede llegar con el panel abierto: el próximo callable gateado
// lo avisa (public/js/data.js, guarded()).
window.addEventListener('sw:license-suspended', async function(){
  var l = await leerLicencia();
  mostrarSuspension(l && l.message);
});
g('adm-susp-out').addEventListener('click', function(){ g('adm-lgout').click(); });
```

En `abrirPanel()`, después de `renderAll();`:

```js
  pintarLicencia(await leerLicencia());
```

- [ ] **Step 4: Run tests**

Run: `node tests/browser/suspension.mjs && node tests/browser/admin-redirect-barbero.mjs && node tests/browser/admin-gate-timing.mjs && node tests/browser/dashboard.mjs`
Expected: todos `TODO OK` (o el equivalente de cada script, con exit 0).

- [ ] **Step 5: Commit**

```bash
git add public/admin/index.html tests/browser/suspension.mjs
git commit -m "feat(admin): banner de pago pendiente y overlay de servicio suspendido"
```

---

### Task 7: PWA del barbero y `/login`

**Files:**
- Modify: `public/barbero/index.html` (markup `#b-login` ~línea 276; `loadDay` catch ~674; listener junto a `b-signout` ~1015)
- Modify: `public/login/index.html` (`esBarbero` ~línea 106)
- Modify: `tests/browser/suspension.mjs` (agregar casos antes de `// ── fin ──`)

**Interfaces:**
- Consumes: `details.license === 'suspended'` en el error de `getMyDay` (Task 3).
- Produces: `#b-susp-out` (visible solo en suspensión) y el texto de `#b-login-err` con la palabra "suspendido".

- [ ] **Step 1: Add failing browser cases**

En `tests/browser/suspension.mjs`, justo antes de `// ── fin ──`:

```js
// ═══════════════ PWA BARBERO ═══════════════
{
  const { ctx, page } = await nuevaPagina({ width:420, height:840 });
  await page.addInitScript(() => {
    const u = { uid:'b', getIdTokenResult: async () => ({ claims:{} }) };
    window.__SALIDAS = 0;
    window.SWAuth = { signIn: async () => u, signOut: async () => { window.__SALIDAS++; }, onChange: (f) => { f(u); return () => {}; } };
    window.SWData = {
      getMyDay: async () => { const e = new Error('Servicio suspendido.'); e.code = 'functions/failed-precondition'; e.details = { license:'suspended' }; throw e; },
      saveMyPushToken: async () => {},
    };
  });
  await page.goto(`http://localhost:${PORT}/barbero/`, { waitUntil:'load' });
  await page.waitForTimeout(900);
  check('PWA suspendida: pantalla de suspensión', /suspendido/i.test(await page.textContent('#b-login-err')));
  check('PWA suspendida: la agenda NO se ve', !(await page.isVisible('#b-app')));
  check('PWA suspendida: botón Salir visible', await page.isVisible('#b-susp-out'));
  await page.click('#b-susp-out');
  check('PWA suspendida: Salir cierra la sesión', (await page.evaluate(() => window.__SALIDAS)) === 1);
  await ctx.close();
}

// ═══════════════ /login ═══════════════
// Un barbero con licencia suspendida debe ir a /barbero/ (ve la explicación),
// no recibir "tu cuenta no tiene acceso" y quedar deslogueado.
{
  const { ctx, page } = await nuevaPagina({ width:420, height:820 });
  await page.addInitScript(() => {
    const u = { uid:'b', getIdTokenResult: async () => ({ claims:{} }) };
    window.SWAuth = { signIn: async () => u, signOut: async () => {}, onChange: () => () => {} };
    window.SWData = {
      getMyDay: async () => { const e = new Error('Servicio suspendido.'); e.code = 'functions/failed-precondition'; e.details = { license:'suspended' }; throw e; },
    };
  });
  await page.goto(`http://localhost:${PORT}/login/`, { waitUntil:'load' });
  await page.fill('#email', 'victoria@scissorwhite.cl');
  await page.fill('#pass', 'buena');
  await page.click('#btn');
  await page.waitForTimeout(900);
  check('login con licencia suspendida manda al barbero a /barbero/', /\/barbero\/$/.test(page.url()), page.url());
  await ctx.close();
}
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `node tests/browser/suspension.mjs`
Expected: los casos de la Task 6 PASS; los de PWA y login FAIL.

- [ ] **Step 3: Implement**

`public/barbero/index.html`, dentro de `<section class="b-login" id="b-login" hidden>`, después de `<p id="b-login-err">…</p>`:

```html
    <button class="b-ghost" id="b-susp-out" hidden>Salir</button>
```

Función nueva, justo antes de `async function loadDay(silencioso) {`:

```js
// Suspensión por falta de pago (license/main). El servidor ya cortó getMyDay y
// markAttendance; acá solo se explica y se para el polling, que si no
// reintentaría cada pocos segundos contra un servidor que va a decir lo mismo.
// El motivo NO se muestra: eso es entre Aldo y la dueña del salón.
function mostrarSuspension() {
  if (ticker) { clearInterval(ticker); ticker = null; }
  if (poller) { clearInterval(poller); poller = null; }
  show('login');
  els.loginErr.textContent = 'El servicio está suspendido temporalmente. Consulta con la administración del salón.';
  g('b-susp-out').hidden = false;
}
```

En el `catch (e)` de `loadDay`, como **primera** sentencia después de `console.error('getMyDay', e);`:

```js
    if (e && e.details && e.details.license === 'suspended') { mostrarSuspension(); return; }
```

Junto a `g('b-signout').addEventListener(...)`:

```js
g('b-susp-out').addEventListener('click', () => window.SWAuth.signOut());
```

`public/login/index.html`, reemplazar `esBarbero`:

```js
// Se le pregunta al servidor si tiene ficha de profesional, en vez de leerlo
// del cliente: `staffAccounts` es admin-only justamente para que un barbero no
// pueda enumerar al equipo.
//
// "Suspendido" (license/main) también cuenta como barbero: getMyDay solo
// responde eso DESPUÉS de verificar la ficha, y en /barbero/ la persona ve por
// qué no puede trabajar en vez de "tu cuenta no tiene acceso".
async function esBarbero(){
  try { await window.SWData.getMyDay(); return true; }
  catch(e){ return !!(e && e.details && e.details.license === 'suspended'); }
}
```

- [ ] **Step 4: Run tests**

Run: `node tests/browser/suspension.mjs && node tests/browser/barbero.mjs && node tests/browser/login.mjs && node tests/browser/admin-redirect-barbero.mjs`
Expected: todos exit 0.

- [ ] **Step 5: Commit**

```bash
git add public/barbero/index.html public/login/index.html tests/browser/suspension.mjs
git commit -m "feat(barbero,login): pantalla de servicio suspendido"
```

---

### Task 8: Widget de reservas

**Files:**
- Modify: `public/index.html` (markup dentro de `#bk-panel`, entre el `</div>` de `#bk-hd` y `<!-- STEPPER -->`, línea ~2269)
- Modify: `public/js/booking-widget.js` (`openBK` ~línea 219; catch de `#bk-submit` ~990)
- Modify: `tests/browser/suspension.mjs` (agregar casos antes de `// ── fin ──`)

**Interfaces:**
- Consumes: `window.SWData.readLicense()` (Task 5) y `details.license` en el error de `createBooking` (Task 3).
- Produces: `#bk-suspended` (visible solo en suspensión). `#bk-stepper` y `#bk-body` quedan ocultos mientras tanto.

- [ ] **Step 1: Add failing browser cases**

En `tests/browser/suspension.mjs`, justo antes de `// ── fin ──`:

```js
// ═══════════════ WIDGET ═══════════════
async function abrirWidget(licFn){
  const { ctx, page } = await nuevaPagina({ width:1200, height:900 });
  await page.addInitScript((licFn) => {
    window.__LIC = licFn;
    window.SWAuth = { onChange: () => () => {} };
    window.SWData = {
      loadCatalog: async () => ({ services:[], staff:[], tz:'America/Santiago', bufferMin:0 }),
      readLicense: async () => {
        if (window.__LIC === 'falla') throw new Error('offline');
        return { status: window.__LIC, message:'motivo interno', suspendAt:'' };
      },
      subscribeAvailability: () => () => {},
      loadGoogleReviews: async () => null, loadSiteImages: async () => ({}),
    };
  }, licFn);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil:'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.openBK());
  await page.waitForTimeout(400);
  return { ctx, page };
}

{
  const { ctx, page } = await abrirWidget('suspended');
  check('widget suspendido: aviso visible', await page.isVisible('#bk-suspended'));
  check('widget suspendido: wizard oculto', !(await page.isVisible('#bk-body')));
  const txt = await page.textContent('#bk-suspended');
  check('widget suspendido: NO muestra el motivo interno', !txt.includes('motivo interno'), txt);
  check('widget suspendido: ofrece WhatsApp', await page.isVisible('#bk-suspended a[href*="wa.me/56982514114"]'));
  // Review Focus #4: reactivar sin recargar.
  await page.evaluate(() => { window.closeBK(); window.__LIC = 'active'; window.openBK(); });
  await page.waitForTimeout(400);
  check('widget: reabrir con licencia activa vuelve a mostrar el wizard', await page.isVisible('#bk-body'));
  check('widget: y esconde el aviso', !(await page.isVisible('#bk-suspended')));
  await ctx.close();
}

// Review Focus #5: si no se puede leer la licencia, el widget falla abierto.
{
  const { ctx, page } = await abrirWidget('falla');
  check('widget con lectura fallida: wizard visible', await page.isVisible('#bk-body'));
  check('widget con lectura fallida: sin aviso', !(await page.isVisible('#bk-suspended')));
  await ctx.close();
}
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `node tests/browser/suspension.mjs`
Expected: los casos del widget FAIL; el resto PASS. Si `public/index.html` tira un `TypeError` al cargar porque llama a una función de `SWData` que el stub no tiene (por ejemplo, otra lectura del landing), agregarla al stub como `async () => null` o `() => () => {}`, según sea promesa o suscripción. No tocar el código del landing por eso.

- [ ] **Step 3: Implement**

`public/index.html`, entre el `</div>` que cierra `#bk-hd` y `<!-- STEPPER -->`:

```html
  <!-- Servicio suspendido (license/main). Texto neutro a propósito: el público
       no tiene por qué saber el motivo. Lo muestra booking-widget.js. -->
  <div id="bk-suspended" hidden style="padding:48px 24px;text-align:center">
    <h2 class="bk-screen-title">Reservas online no disponibles</h2>
    <p style="margin:12px auto 24px;max-width:420px;line-height:1.6">Las reservas online no están disponibles por ahora. Escríbenos y coordinamos tu hora.</p>
    <a href="https://wa.me/56982514114?text=Hola%2C%20quiero%20agendar%20una%20hora" target="_blank" rel="noopener" class="bk-btn bk-btn-p">Escribir por WhatsApp</a>
  </div>
```

`public/js/booking-widget.js`, justo antes de `let lastFocusedBK = null;`:

```js
// Servicio suspendido por falta de pago (license/main; spec
// 2026-10-05-suspension-servicio-design.md). Se lee al ABRIR el wizard, no al
// cargar la página, para que una reactivación se vea sin recargar. Si la
// lectura falla, el wizard queda como está: el widget falla abierto
// (invariante) y createBooking igual rechaza en el servidor.
function bkSetSuspended(on){
  document.getElementById('bk-suspended').hidden = !on;
  document.getElementById('bk-stepper').style.display = on ? 'none' : '';
  document.getElementById('bk-body').style.display = on ? 'none' : '';
}
function bkCheckLicense(){
  bkSetSuspended(false);
  if(!window.SWData || typeof window.SWData.readLicense !== 'function') return;
  window.SWData.readLicense()
    .then(l=>{ if(l && l.status==='suspended') bkSetSuspended(true); })
    .catch(()=>{});
}
```

En `openBK()`, justo después de `bkGoTo(1);`:

```js
  bkCheckLicense();
```

En el `catch(e)` del submit (`console.error('No se pudo guardar la reserva', e);`), como primera rama, antes de `const slotMsg = ...`:

```js
      // La página se cargó antes de suspender: se muestra el mismo aviso
      // neutro en vez de "problema de conexión".
      if(e && e.details && e.details.license === 'suspended'){ bkSetSuspended(true); return; }
```

Al hacer `return` dentro del `try/catch`, el `finally` restaura el botón igual. `saved` queda en `false`, así que no se pinta la confirmación.

- [ ] **Step 4: Run tests**

Run: `node tests/browser/suspension.mjs && node tests/browser/resenas.mjs && npm test`
Expected: todos exit 0.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/js/booking-widget.js tests/browser/suspension.mjs
git commit -m "feat(widget): aviso neutro de reservas no disponibles con licencia suspendida"
```

---

### Task 9: Documentación

**Files:**
- Modify: `CLAUDE.md` (sección "Estado conocido", antes de `- Despliegue manual con diecinueve...`)
- Modify: `README.md` (sección nueva antes de `## Deploy`)

- [ ] **Step 1: CLAUDE.md**

Insertar antes de la viñeta `- Despliegue manual con diecinueve nombres...`:

```
- Suspensión por falta de pago: license/main {status: active|warning|suspended,
  message, suspendAt}. Lo escribe SOLO Aldo (consola o
  functions/scripts/license.js); las reglas lo dejan en write:false incluso
  para el admin. NO va en businessInfo porque saveAdmin() reescribe
  businessInfo/main entero y borraría la marca. Ausente o desconocido = ACTIVO
  en todas las capas (functions/shared/license.js; copia deliberada en
  public/js/data.js). El corte real: assertActive() en createBooking,
  adminSaveBooking, markAttendance, getMyDay/Range/Clients, linkStaffAccount y
  adminLogEvent (failed-precondition, details {license:'suspended'} SIN el
  mensaje), las tres onSchedule de envío salen temprano, y canAdminWrite() en
  firestore.rules gatea las ESCRITURAS del admin (las lecturas no: los datos
  son de la dueña). syncGoogleReviews queda sin gatear (prohibido tocar
  reseñas). En getMyDay va DESPUÉS del chequeo de ficha: /login decide con el
  permission-denied. Caché de 60 s por instancia (0 en el emulador).
  license/main es de lectura pública: message debe ser neutro.
```

- [ ] **Step 2: README.md**

Antes de `## Deploy`:

```markdown
## Suspender / reactivar el servicio

El documento `license/main` controla si SW Studio opera. Solo lo puede
escribir el dueño del proyecto (las reglas lo dejan en `write: false`).

| `status` | Efecto |
|---|---|
| ausente / `active` | normal |
| `warning` | banner "Pago pendiente" en el panel, sin bloquear nada (`suspendAt` = fecha del texto) |
| `suspended` | panel y app del barbero muestran "servicio suspendido"; el widget muestra "reservas online no disponibles"; no salen recordatorios, encuestas ni avisos. El landing sigue en línea y no se borra ningún dato. |

```bash
cd functions
node scripts/license.js warning --suspend-at 2026-10-15
node scripts/license.js suspended --message "Contacta a soporte para reactivar"
node scripts/license.js active
```

También se puede editar `status` a mano en la consola de Firestore. Las
funciones lo ven en hasta 1 minuto. `license/main` es de lectura pública:
el `message` debe ser neutro.
```

- [ ] **Step 3: Full verification**

Run, con el emulador arriba para la última línea:
```bash
cd functions && npm test && cd .. && npm test && npm run test:rules && for f in tests/browser/*.mjs; do node "$f" > /dev/null || echo "FALLÓ $f"; done && node tests/e2e/todos.mjs
```
Expected: todo PASS, ninguna línea `FALLÓ` y `4/4 SUITES E2E OK`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: documentar license/main y cómo suspender/reactivar el servicio"
```

---

## Despliegue (lo hace Aldo, fuera de este plan)

1. `firebase deploy --only firestore:rules`
2. Funciones modificadas, con nombres explícitos y sacando antes `functions/.env` (ver README "Deploy"): `createBooking`, `adminSaveBooking`, `markAttendance`, `getMyDay`, `getMyRange`, `getMyClients`, `linkStaffAccount`, `adminLogEvent`, `sendBookingReminders`, `sendSatisfactionSurveys` y `staffAttendanceNudges`. No hay funciones nuevas.
3. `firebase deploy --only hosting`
4. `cd functions && node scripts/license.js active` para dejar el documento creado.
