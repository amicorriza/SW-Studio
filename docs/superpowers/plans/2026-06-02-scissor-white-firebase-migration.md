# Scissor White — Migración a Firebase: Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan checkbox (`- [ ]`).

**Goal:** Convertir el sitio single-file de Scissor White (hoy en `localStorage`) en una web desplegable en Firebase donde los clientes agendan y reciben confirmación por email, y el staff administra todo desde un panel protegido por login.

**Architecture:** Enfoque A — se preserva el `index.html v15` (UI + SEO) y se le conecta una capa Firebase por debajo: Firestore como base central, Firebase Auth para el panel admin, una Cloud Function que envía emails al crear una reserva, y Firebase Hosting para servir el sitio. La capa de datos (`public/js/*.js`) reemplaza los 6 puntos de `localStorage`.

**Tech Stack:** Firebase Hosting · Firestore · Firebase Auth (Email/Password) · Cloud Functions Gen2 (Node 20) · firebase-admin · Firebase JS SDK v10 (modular, vía CDN, sin build) · Resend (email) · Firebase Emulator Suite · `@firebase/rules-unit-testing` + Vitest (tests de reglas) · `firebase-functions-test` (tests de la function).

**Referencia de diseño:** [`docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md`](../specs/2026-06-01-scissor-white-firebase-design.md)

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `public/index.html` | App (copia del v15). Se parchea en 6 puntos para usar la capa de datos. |
| `public/js/firebase-init.js` | Inicializa Firebase SDK (config) y exporta `app`, `db`, `auth`. |
| `public/js/data.js` | API de datos: `loadAdmin()`, `saveAdmin(D)`, `getBookings()`, `saveBookings(arr)`, `createBooking(obj)`. Expone `window.SWData`. |
| `public/js/auth.js` | `signIn(email,pass)`, `signOut()`, `onChange(cb)`. Expone `window.SWAuth`. |
| `functions/index.js` | Cloud Function `onBookingCreated`: envía email al cliente y a la barbería. |
| `functions/email.js` | Render de plantillas HTML de email + envío vía Resend (unidad testeable). |
| `functions/package.json` | Deps de Functions (Node 20, firebase-functions v2, firebase-admin, resend). |
| `functions/test/email.test.js` | Tests unitarios del render de plantillas. |
| `seed/seed.js` | Carga inicial de `services`, `staff`, `businessInfo` a Firestore. |
| `seed/data.js` | Los 19 servicios + 4 barberos + info, extraídos del v15 (fuente única). |
| `firestore.rules` | Reglas de seguridad. |
| `firestore.indexes.json` | Índices (vacío al inicio; documentado). |
| `firebase.json` | Hosting + Functions + Emulators. |
| `.firebaserc` | Alias del proyecto. |
| `tests/rules/firestore.rules.test.js` | Tests de reglas con el emulador. |

**Puntos de integración exactos en `index.html` v15** (verificados en el código fuente):

| Punto | Línea(s) | Hoy | Pasa a |
|---|---|---|---|
| Submit reserva (público) | 2316–2334 | `localStorage.setItem('sw_bookings',…)` | `await SWData.createBooking({...})` |
| Login admin | 3207–3217 | `g('adm-pass').value === PASS` | `await SWAuth.signIn(email,pass)` |
| Carga inicial admin | 3183–3204 | `localStorage.getItem(KEY)` | `await SWData.loadAdmin()` |
| Guardar admin | 3229–3234 | `localStorage.setItem(KEY,…)` | `await SWData.saveAdmin(D)` |
| Leer bookings (admin) | 3298 | `localStorage.getItem(BKEY)` | cache poblada por `SWData.getBookings()` |
| Escribir bookings (admin) | 3302 | `localStorage.setItem(BKEY,…)` | `await SWData.saveBookings(arr)` |

---

## Fase 0 — Prerrequisitos (manual, una sola vez)

### Task 0.1: Herramientas locales

**Files:** ninguno (entorno).

- [ ] **Step 1: Instalar Node 20 LTS y Firebase CLI**

Run:
```bash
node -v          # debe ser v20.x
npm i -g firebase-tools
firebase --version   # >= 13.x
```
Expected: imprime versiones sin error.

- [ ] **Step 2: Login en Firebase**

Run: `firebase login`
Expected: abre el navegador y queda autenticado (muestra el email de la cuenta dueña del proyecto Firebase).

### Task 0.2: Crear proyecto Firebase y habilitar servicios

**Files:** ninguno (consola Firebase).

- [ ] **Step 1: Crear el proyecto** en https://console.firebase.google.com → "Add project" (nombre sugerido `scissor-white`). Anota el **Project ID** real (ej. `scissor-white-xxxx`).

- [ ] **Step 2: Plan Blaze (obligatorio).** En la consola → Upgrade → Blaze (pago por uso). **Por qué:** Cloud Functions Gen2 necesita Blaze para hacer llamadas de red salientes (a Resend). El free tier de Blaze cubre de sobra el volumen de una barbería. Configura un presupuesto/alerta de $5 USD para tranquilidad.

- [ ] **Step 3: Habilitar Firestore** → Build → Firestore Database → Create → modo **Production** → ubicación `southamerica-east1`.

- [ ] **Step 4: Habilitar Authentication** → Build → Authentication → Get started → Sign-in method → **Email/Password** → Enable.

- [ ] **Step 5: Crear cuentas del staff** en Authentication → Users → Add user. Crear al menos `admin@scissorwhite.cl` con una contraseña temporal. (El staff la cambia luego.)

### Task 0.3: Cuenta Resend (email)

**Files:** ninguno.

- [ ] **Step 1:** Crear cuenta en https://resend.com (free tier: 3.000 emails/mes, 100/día).
- [ ] **Step 2:** Verificar el dominio `scissorwhite.cl` (o usar `onboarding@resend.dev` para pruebas iniciales). Anota el `FROM_EMAIL` que usarás.
- [ ] **Step 3:** Crear una **API Key** (Resend → API Keys). Guárdala; se cargará como secreto en la Task 6.4 (no se commitea).

---

## Fase 1 — Andamiaje del repo

> Estos archivos se **crean como esqueleto** en esta sesión (alcance acordado). Las tareas siguientes los completan. Si ya existen, valida su contenido contra lo que sigue.

### Task 1.1: Conectar el repo al proyecto Firebase

**Files:**
- Modify: `.firebaserc`

- [ ] **Step 1: Poner el Project ID real** en `.firebaserc`:

```json
{
  "projects": {
    "default": "scissor-white-xxxx"
  }
}
```
Reemplaza `scissor-white-xxxx` por el Project ID de la Task 0.2.

- [ ] **Step 2: Verificar conexión**

Run: `firebase use default`
Expected: `Now using project scissor-white-xxxx`.

- [ ] **Step 3: Commit**

```bash
git add .firebaserc
git commit -m "chore: conectar repo al proyecto Firebase"
```

### Task 1.2: Colocar el index.html en Hosting

**Files:**
- Create: `public/index.html` (copia EXACTA del v15, sin modificar aún)

- [ ] **Step 1: Copiar el v15 a public/**

Run (PowerShell):
```powershell
Copy-Item "_source\scissor_white_v15.html" "public\index.html"
```
Expected: `public/index.html` existe (~1.4 MB).

- [ ] **Step 2: Verificar que sirve localmente**

Run: `firebase emulators:start --only hosting`
Abre http://localhost:5000 → debe verse la landing idéntica al v15.
Detén con Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "chore: index.html v15 como entry de Hosting"
```

---

## Fase 2 — Datos en Firestore (seed)

### Task 2.1: Extraer los datos semilla del v15 a un módulo

**Files:**
- Create: `seed/data.js`

- [ ] **Step 1: Crear `seed/data.js`** con los datos reales del v15 (arrays `DS`, `DT`, objeto `DI` de las líneas 3116–3147 del v15). Estructura:

```js
// seed/data.js — fuente única de los datos iniciales (extraídos del index.html v15)
'use strict';

const services = [
  { id:'vis',   name:'Asesoría con Visagismo',         cat:'a', dur:120, price:55000, tag:'Premium', ts:'s', status:'active', desc:'Análisis facial + corte ideal.', photo:'' },
  { id:'vis-b', name:'Asesoría Visagismo + Barba',      cat:'a', dur:120, price:65000, tag:'Premium', ts:'s', status:'active', desc:'Asesoría completa en corte y barba.', photo:'' },
  { id:'promo', name:'Promo Mayo — Corte',              cat:'c', dur:45,  price:14000, tag:'Promo',   ts:'p', status:'active', desc:'Corte + lavado con masaje craneal.', photo:'' },
  { id:'nino',  name:'Corte Niño (2-10 años)',          cat:'c', dur:45,  price:16000, tag:'',        ts:'',  status:'active', desc:'Corte para niños.', photo:'' },
  { id:'lp',    name:'Corte + Lavado Premium',          cat:'c', dur:50,  price:21000, tag:'',        ts:'',  status:'active', desc:'Corte + lavado Reuzel.', photo:'' },
  { id:'fm',    name:'Mantención Fade + Lavado',        cat:'c', dur:30,  price:12000, tag:'',        ts:'',  status:'active', desc:'Solo lados.', photo:'' },
  { id:'mu',    name:'Mullet y derivados',              cat:'c', dur:60,  price:23000, tag:'',        ts:'',  status:'active', desc:'Combinación largos y cortos.', photo:'' },
  { id:'mub',   name:'Mullet + Barba',                  cat:'c', dur:70,  price:33000, tag:'',        ts:'',  status:'active', desc:'Mullet + perfilado de barba.', photo:'' },
  { id:'tj',    name:'Corte con tijeras',               cat:'c', dur:75,  price:25000, tag:'',        ts:'',  status:'active', desc:'Corte trabajado con tijeras.', photo:'' },
  { id:'cb',    name:'Corte + Barba simple',            cat:'c', dur:60,  price:23000, tag:'',        ts:'',  status:'active', desc:'Combo clásico.', photo:'' },
  { id:'cbtc',  name:'Corte + Barba toallas calientes', cat:'c', dur:75,  price:30000, tag:'',        ts:'',  status:'active', desc:'Corte + perfilado premium.', photo:'' },
  { id:'tjbt',  name:'Tijeras + Barba toalla',          cat:'c', dur:90,  price:40000, tag:'',        ts:'',  status:'active', desc:'Corte tijeras + perfilado premium.', photo:'' },
  { id:'tjb',   name:'Tijeras + Barba simple',          cat:'c', dur:70,  price:35000, tag:'',        ts:'',  status:'active', desc:'Corte tijeras + perfilado.', photo:'' },
  { id:'ucm',   name:'Undercut mujer',                  cat:'c', dur:35,  price:8000,  tag:'',        ts:'',  status:'active', desc:'Degradado de nuca.', photo:'' },
  { id:'ras',   name:'Rasurado completo',               cat:'c', dur:30,  price:14000, tag:'',        ts:'',  status:'active', desc:'Rasurado con toallas.', photo:'' },
  { id:'bs',    name:'Perfilado barba simple',          cat:'b', dur:30,  price:13000, tag:'',        ts:'',  status:'active', desc:'Recorte y definición.', photo:'' },
  { id:'btc',   name:'Perfilado barba toallas',         cat:'b', dur:40,  price:23000, tag:'',        ts:'',  status:'active', desc:'Toallas + afeitado.', photo:'' },
  { id:'rbs',   name:'Rasurado + barba simple',         cat:'b', dur:45,  price:15000, tag:'',        ts:'',  status:'active', desc:'Rasurado + perfilado.', photo:'' },
  { id:'rbtc',  name:'Rasurado + barba toalla',         cat:'b', dur:60,  price:20000, tag:'',        ts:'',  status:'active', desc:'Rasurado + toallas + perfilado.', photo:'' },
];

// schedule indexado por Date.getDay(): 0=Dom (null=cerrado) … 6=Sáb
const staff = [
  { id:'victoria', name:'Victoria', role:'Barbera Senior · Visagismo', days:'Mar — Sáb', bio:'4 años de experiencia, especializada en asesoría con visagismo.', status:'active', photo:'',
    schedule:[null,{open:false},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'17:00'}] },
  { id:'felipe', name:'Felipe', role:'Especialista en degradados', days:'Lun — Sáb', bio:'2 años perfeccionando degradados comprimidos con textura.', status:'active', photo:'',
    schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'17:00'}] },
  { id:'esteban', name:'Esteban', role:'Barbero', days:'Lun — Vie', bio:'', status:'active', photo:'',
    schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:false}] },
  { id:'ariel', name:'Ariel', role:'Barbero', days:'Lun — Vie', bio:'', status:'active', photo:'',
    schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:false}] },
];

const businessInfo = {
  name:'Scissor White - SW Studio',
  addr:'Cochrane 635, Of. 303, Torre B, Concepción',
  phone:'+56 9 8251 4114',
  ig:'@scissorwhite.cl',
  slogan:'Más que cortes, creamos identidad',
  desc:'En SCISSOR WHITE STUDIO el servicio se vive con intención.',
  lat:-36.8270, lng:-73.0444,
};

module.exports = { services, staff, businessInfo };
```

- [ ] **Step 2: Verificar conteos**

Run: `node -e "const d=require('./seed/data.js'); console.log(d.services.length, d.staff.length)"`
Expected: `19 4`

- [ ] **Step 3: Commit**

```bash
git add seed/data.js
git commit -m "feat(seed): datos iniciales extraídos del v15"
```

### Task 2.2: Script de seed contra el emulador

**Files:**
- Create: `seed/seed.js`
- Create: `seed/package.json`

- [ ] **Step 1: Crear `seed/package.json`**

```json
{
  "name": "scissor-white-seed",
  "private": true,
  "type": "commonjs",
  "scripts": { "seed": "node seed.js" },
  "dependencies": { "firebase-admin": "^12.7.0" }
}
```

- [ ] **Step 2: Crear `seed/seed.js`**

```js
// seed/seed.js — carga services, staff, businessInfo a Firestore.
// Uso emulador:   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=scissor-white-xxxx node seed.js
// Uso producción: GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node seed.js
'use strict';
const admin = require('firebase-admin');
const { services, staff, businessInfo } = require('./data.js');

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'scissor-white-xxxx' });
const db = admin.firestore();

async function main() {
  const batch = db.batch();
  services.forEach(s => batch.set(db.collection('services').doc(s.id), s));
  staff.forEach(s => batch.set(db.collection('staff').doc(s.id), s));
  batch.set(db.collection('businessInfo').doc('main'), businessInfo);
  await batch.commit();
  console.log(`Seed OK: ${services.length} servicios, ${staff.length} barberos, businessInfo/main`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Instalar deps**

Run: `cd seed && npm install && cd ..`
Expected: crea `seed/node_modules` (ya ignorado por `.gitignore`).

- [ ] **Step 4: Probar contra el emulador** (en otra terminal: `firebase emulators:start --only firestore`)

Run:
```bash
cd seed
FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=scissor-white-xxxx npm run seed
cd ..
```
Expected: `Seed OK: 19 servicios, 4 barberos, businessInfo/main`. En la UI del emulador (http://localhost:4000/firestore) aparecen las colecciones.

- [ ] **Step 5: Commit**

```bash
git add seed/seed.js seed/package.json
git commit -m "feat(seed): script de carga inicial a Firestore"
```

---

## Fase 3 — Reglas de seguridad

### Task 3.1: Escribir las reglas

**Files:**
- Create/Modify: `firestore.rules`

- [ ] **Step 1: Escribir `firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Catálogo público: lectura libre, escritura solo staff autenticado
    match /services/{id}   { allow read: if true; allow write: if request.auth != null; }
    match /staff/{id}      { allow read: if true; allow write: if request.auth != null; }
    match /businessInfo/{id}{ allow read: if true; allow write: if request.auth != null; }

    // Reservas: el público puede CREAR (validado), solo staff lee/edita/borra
    match /bookings/{id} {
      allow read, update, delete: if request.auth != null;
      allow create: if isValidBooking();
    }
    function isValidBooking() {
      let d = request.resource.data;
      return d.status == 'pending'
        && d.name is string  && d.name.size() > 1
        && d.email is string && d.email.matches('^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')
        && d.phone is string && d.phone.size() >= 7
        && d.svcId is string && d.barberId is string
        && d.date is string  && d.time is string
        && d.code is string;
    }

    // Log de actividad: solo staff
    match /adminLog/{id} { allow read, write: if request.auth != null; }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add firestore.rules
git commit -m "feat(rules): reglas de Firestore (catálogo público, bookings validados, admin autenticado)"
```

### Task 3.2: Tests de reglas (TDD con emulador)

**Files:**
- Create: `tests/rules/firestore.rules.test.js`
- Create: `package.json` (raíz, para devDeps de test)
- Test: corre con Vitest + emulador Firestore

- [ ] **Step 1: Crear `package.json` raíz** (solo devDeps de testing)

```json
{
  "name": "scissor-white",
  "private": true,
  "scripts": {
    "test:rules": "firebase emulators:exec --only firestore \"vitest run tests/rules\""
  },
  "devDependencies": {
    "@firebase/rules-unit-testing": "^4.0.1",
    "firebase": "^10.13.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Escribir el test (debe fallar primero)** en `tests/rules/firestore.rules.test.js`

```js
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { beforeAll, afterAll, test } from 'vitest';

let env;
const valid = {
  status:'pending', name:'Juan Pérez', email:'juan@mail.com', phone:'+56912345678',
  svcId:'lp', svcName:'Corte', barberId:'felipe', barberName:'Felipe',
  date:'2026-06-10T00:00:00.000Z', time:'11:00', code:'SW-AB12345', price:21000, dur:50,
};

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'scissor-white-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

test('cualquiera puede leer services', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'services/lp')));
});

test('anónimo NO puede escribir services', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'services/lp'), { name:'x' }));
});

test('anónimo puede crear una reserva válida', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(setDoc(doc(db, 'bookings/b1'), valid));
});

test('reserva inválida (sin email) es rechazada', async () => {
  const db = env.unauthenticatedContext().firestore();
  const bad = { ...valid }; delete bad.email;
  await assertFails(setDoc(doc(db, 'bookings/b2'), bad));
});

test('anónimo NO puede leer reservas ajenas', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'bookings/b1')));
});

test('staff autenticado SÍ puede leer reservas', async () => {
  const db = env.authenticatedContext('staff1').firestore();
  await assertSucceeds(getDoc(doc(db, 'bookings/b1')));
});
```

- [ ] **Step 3: Instalar y correr — verificar que pasa**

Run:
```bash
npm install
npm run test:rules
```
Expected: 6 tests PASS (Vitest arranca el emulador, evalúa las reglas).

- [ ] **Step 4: Commit**

```bash
git add package.json tests/rules/firestore.rules.test.js
git commit -m "test(rules): suite de reglas de Firestore con emulador"
```

---

## Fase 4 — Capa de datos en el front (sin tocar la UI todavía)

### Task 4.1: Inicialización de Firebase en el cliente

**Files:**
- Create: `public/js/firebase-init.js`

- [ ] **Step 1: Crear `public/js/firebase-init.js`** (SDK modular vía CDN)

```js
// public/js/firebase-init.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

// Config pública del proyecto (Console → Project settings → SDK setup). No es secreto.
const firebaseConfig = {
  apiKey: 'REEMPLAZAR',
  authDomain: 'scissor-white-xxxx.firebaseapp.com',
  projectId: 'scissor-white-xxxx',
  storageBucket: 'scissor-white-xxxx.appspot.com',
  messagingSenderId: 'REEMPLAZAR',
  appId: 'REEMPLAZAR',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Conectar a emuladores en local
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}

export { app, db, auth };
```

- [ ] **Step 2:** Reemplazar los `REEMPLAZAR` y el `projectId` con la config real (Console → Project settings → "Your apps" → Web app → Config). Si no hay web app, créala ahí (botón `</>`).

- [ ] **Step 3: Commit**

```bash
git add public/js/firebase-init.js
git commit -m "feat(web): init de Firebase SDK en el cliente"
```

### Task 4.2: API de datos `SWData`

**Files:**
- Create: `public/js/data.js`

- [ ] **Step 1: Crear `public/js/data.js`**

```js
// public/js/data.js — capa de datos sobre Firestore. Expone window.SWData.
import { db } from './firebase-init.js';
import {
  collection, getDocs, doc, setDoc, addDoc, deleteDoc,
  writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

async function readCol(name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Carga el objeto D que usa el admin: {services, staff, info, log, schedule}
async function loadAdmin() {
  const [services, staff, infoSnap, log] = await Promise.all([
    readCol('services'), readCol('staff'),
    getDocs(collection(db, 'businessInfo')), readCol('adminLog'),
  ]);
  const infoDoc = infoSnap.docs.find(d => d.id === 'main');
  return {
    services, staff,
    info: infoDoc ? infoDoc.data() : {},
    log: log.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 30),
    schedule: [],
  };
}

// Guarda todo el objeto D (batch). Reemplaza servicios/staff/info; agrega log nuevo.
async function saveAdmin(D) {
  const batch = writeBatch(db);
  (D.services || []).forEach(s => batch.set(doc(db, 'services', s.id), stripId(s)));
  (D.staff || []).forEach(s => batch.set(doc(db, 'staff', s.id), stripId(s)));
  if (D.info) batch.set(doc(db, 'businessInfo', 'main'), D.info);
  await batch.commit();
}

function stripId(o) { const { id, ...rest } = o; return rest; }

// Reservas
async function getBookings() {
  return await readCol('bookings');
}

async function saveBookings(arr) {
  const batch = writeBatch(db);
  (arr || []).forEach(b => {
    const id = b.id || b.code;
    batch.set(doc(db, 'bookings', id), b, { merge: true });
  });
  await batch.commit();
}

// Crear UNA reserva (camino público). Dispara la Cloud Function de email.
async function createBooking(obj) {
  const payload = { ...obj, status: 'pending', emailStatus: 'pending', createdAtTs: serverTimestamp() };
  const ref = await addDoc(collection(db, 'bookings'), payload);
  return ref.id;
}

window.SWData = { loadAdmin, saveAdmin, getBookings, saveBookings, createBooking };
export { loadAdmin, saveAdmin, getBookings, saveBookings, createBooking };
```

- [ ] **Step 2: Commit**

```bash
git add public/js/data.js
git commit -m "feat(web): capa de datos SWData sobre Firestore"
```

### Task 4.3: API de auth `SWAuth`

**Files:**
- Create: `public/js/auth.js`

- [ ] **Step 1: Crear `public/js/auth.js`**

```js
// public/js/auth.js — login del panel admin. Expone window.SWAuth.
import { auth } from './firebase-init.js';
import {
  signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}
async function signOut() { await fbSignOut(auth); }
function onChange(cb) { return onAuthStateChanged(auth, cb); }

window.SWAuth = { signIn, signOut, onChange };
export { signIn, signOut, onChange };
```

- [ ] **Step 2: Commit**

```bash
git add public/js/auth.js
git commit -m "feat(web): capa de auth SWAuth (Firebase Auth)"
```

---

## Fase 5 — Parchear `index.html` (los 6 puntos)

> Carga los módulos al final del `<body>` y cambia cada punto. Como los IIFE del v15 usan `var`, el puente es vía `window.SWData` / `window.SWAuth`. Tras cada parche, prueba en el emulador.

### Task 5.1: Cargar los módulos

**Files:**
- Modify: `public/index.html` (antes de `</body>`)

- [ ] **Step 1:** Insertar antes de `</body>`:

```html
<script type="module" src="/js/firebase-init.js"></script>
<script type="module" src="/js/data.js"></script>
<script type="module" src="/js/auth.js"></script>
```

- [ ] **Step 2: Verificar** que `window.SWData` y `window.SWAuth` existen (consola del navegador en el emulador de hosting). Commit:

```bash
git add public/index.html
git commit -m "feat(web): cargar módulos Firebase en index.html"
```

### Task 5.2: Persistir la reserva del cliente (líneas 2316–2334)

**Files:**
- Modify: `public/index.html:2316-2334`

- [ ] **Step 1:** Convertir el callback en `async` y reemplazar el bloque `try{...}catch` de `localStorage` por:

```js
  setTimeout(async ()=>{
    const code=genCode();
    const fullname=document.getElementById('bkf-name').value.trim();
    const name=fullname.split(' ')[0];
    const email=document.getElementById('bkf-email').value.trim();
    const phone=document.getElementById('bkf-phone').value.trim();
    // ── Persistir la reserva en Firestore (dispara email) ──
    try{
      await window.SWData.createBooking({
        code, name:fullname, email, phone,
        svcId:S.svc?.id, svcName:S.svc?.name, svcCat:S.svc?.cat||'',
        price:S.svc?.price||0, dur:S.svc?.dur||0,
        barberId:S.barber?.id, barberName:S.barber?.name,
        date:S.date?S.date.toISOString():'', time:S.time,
        createdAt:new Date().toISOString()
      });
    }catch(e){
      console.error('No se pudo guardar la reserva', e);
      // Fallback: mantener el link de WhatsApp visible para contacto manual
    }
    document.getElementById('bk-confirm-code').textContent=code;
    // … (resto del render de confirmación sin cambios)
```
(El resto del bloque de confirmación, líneas 2335–2349, queda igual.)

- [ ] **Step 2: Verificar en emulador.** Arranca `firebase emulators:start`, completa una reserva en http://localhost:5000, y confirma en http://localhost:4000/firestore que aparece un doc en `bookings` con `status:pending`.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(web): la reserva del cliente se guarda en Firestore"
```

### Task 5.3: Login admin con Firebase Auth (líneas 3207–3217)

**Files:**
- Modify: `public/index.html:3207-3219`

- [ ] **Step 1:** Reemplazar `login()` por versión asíncrona. El campo `adm-pass` se usa como contraseña; agrega arriba un input de email `adm-email` (o usa un email fijo del staff). Versión con email + pass:

```js
async function login(){
  var email = (g('adm-email') ? g('adm-email').value.trim() : 'admin@scissorwhite.cl');
  try {
    await window.SWAuth.signIn(email, g('adm-pass').value);
    auth = true;
    g('adm-login').style.display = 'none';
    g('adm-app').style.display = 'flex';
    await loadFromCloud();   // ver Task 5.4
    renderAll();
  } catch(e) {
    g('adm-login-err').style.display = 'block';
    g('adm-pass').style.borderColor = 'rgba(220,80,80,.6)';
  }
}
```

- [ ] **Step 2:** Agregar el input de email en el HTML del login (junto a `adm-pass`):

```html
<input id="adm-email" type="email" placeholder="email" autocomplete="username" />
```

- [ ] **Step 3:** Actualizar logout para usar `window.SWAuth.signOut()` (línea 3220):

```js
g('adm-lgout').addEventListener('click', async function(){
  await window.SWAuth.signOut();
  auth = false;
  g('adm-app').style.display = 'none';
  g('adm-login').style.display = 'flex';
  g('adm-pass').value = '';
  g('adm-login-err').style.display = 'none';
});
```

- [ ] **Step 4: Verificar** login con la cuenta creada en Task 0.2 Step 5 contra el emulador de Auth (crea el usuario en la UI del emulador en http://localhost:4000/auth). Commit:

```bash
git add public/index.html
git commit -m "feat(web): login del panel admin vía Firebase Auth"
```

### Task 5.4: Carga y guardado del admin desde Firestore (líneas 3183–3204, 3229–3234)

**Files:**
- Modify: `public/index.html:3183-3204` y `:3229-3234`

- [ ] **Step 1:** Convertir `loadInitial()` en una función `loadFromCloud()` llamada tras el login (Task 5.3), reemplazando la lectura de `localStorage`:

```js
async function loadFromCloud(){
  try {
    D = await window.SWData.loadAdmin();
    if(!D.services) D.services = [];
    if(!D.staff) D.staff = [];
    if(!D.log) D.log = [];
    if(!D.info) D.info = {};
    D.staff.forEach(function(s){
      if(!s.schedule){ s.schedule = JSON.parse(JSON.stringify(DT[0].schedule)); }
    });
    BK = await window.SWData.getBookings();   // cache de reservas (ver Task 5.5)
  } catch(e){ console.error('Error cargando datos', e); defaults(); }
}
```
(La asignación de logos de las líneas 3195–3203 se conserva, ejecutándose tras `loadFromCloud()`.)

- [ ] **Step 2:** Reemplazar `admSave()` (línea 3229) por:

```js
async function admSave(){
  try { await window.SWData.saveAdmin(D); }
  catch(e){ console.error('Error guardando', e); }
  var el = g('adm-ss');
  el.textContent = '✓ ' + new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});
  setTimeout(function(){ el.textContent = ''; }, 2500);
}
```

- [ ] **Step 3: Verificar:** editar un servicio en el admin → guardar → recargar → el cambio persiste (consultar Firestore en la UI del emulador). Commit:

```bash
git add public/index.html
git commit -m "feat(web): admin carga/guarda datos desde Firestore"
```

### Task 5.5: Lectura/escritura de reservas en el admin (líneas 3298–3302)

**Files:**
- Modify: `public/index.html:3296-3303`

- [ ] **Step 1:** Declarar una cache `var BK=[];` junto a `var D=...` (línea ~3113) y reemplazar las funciones que hoy leen/escriben `BKEY`:

```js
// Lectura: devuelve la cache poblada en loadFromCloud()
function getBk(){ return BK; }

// Escritura: actualiza cache y persiste en Firestore
function setBk(arr){
  BK = arr || [];
  window.SWData.saveBookings(BK).catch(function(e){ console.error('Error guardando reservas', e); });
}
```
Sustituye las llamadas previas `JSON.parse(localStorage.getItem(BKEY)||'[]')` por `getBk()` y `localStorage.setItem(BKEY,...)` por `setBk(arr)` en las líneas 3298 y 3302.

- [ ] **Step 2: Verificar:** crear una reserva como cliente → entrar al admin → aparece en la Agenda; mover/reasignar una cita → persiste tras recargar. Commit:

```bash
git add public/index.html
git commit -m "feat(web): admin lee/escribe reservas en Firestore"
```

---

## Fase 6 — Cloud Function de email

### Task 6.1: Estructura de Functions

**Files:**
- Create: `functions/package.json`

- [ ] **Step 1: Crear `functions/package.json`**

```json
{
  "name": "scissor-white-functions",
  "private": true,
  "engines": { "node": "20" },
  "main": "index.js",
  "scripts": { "test": "node --test" },
  "dependencies": {
    "firebase-admin": "^12.7.0",
    "firebase-functions": "^6.1.0",
    "resend": "^4.0.0"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2:** `cd functions && npm install && cd ..` → crea `functions/node_modules` (ignorado). Commit:

```bash
git add functions/package.json
git commit -m "chore(functions): package.json (Node 20, firebase-functions v2, resend)"
```

### Task 6.2: Render de plantillas de email (unidad testeable, TDD)

**Files:**
- Create: `functions/email.js`
- Test: `functions/test/email.test.js`

- [ ] **Step 1: Escribir el test primero** en `functions/test/email.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const { renderClientEmail, renderShopEmail } = require('../email.js');

const booking = {
  code:'SW-AB12345', name:'Juan Pérez', email:'juan@mail.com', phone:'+56912345678',
  svcName:'Corte + Lavado Premium', barberName:'Felipe',
  date:'2026-06-10T00:00:00.000Z', time:'11:00', price:21000,
};

test('email al cliente incluye nombre, código y servicio', () => {
  const { subject, html } = renderClientEmail(booking);
  assert.match(subject, /SW-AB12345/);
  assert.match(html, /Juan Pérez/);
  assert.match(html, /Corte \+ Lavado Premium/);
  assert.match(html, /Felipe/);
});

test('email a la barbería incluye teléfono y email del cliente', () => {
  const { subject, html } = renderShopEmail(booking);
  assert.match(subject, /Nueva reserva/i);
  assert.match(html, /\+56912345678/);
  assert.match(html, /juan@mail.com/);
});
```

- [ ] **Step 2: Correr — debe fallar**

Run: `cd functions && node --test && cd ..`
Expected: FAIL (`Cannot find module '../email.js'`).

- [ ] **Step 3: Implementar `functions/email.js`**

```js
// functions/email.js — render + envío de emails vía Resend.
'use strict';
const { Resend } = require('resend');

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long' }); }
  catch { return iso; }
}
function fmtCLP(n) { return '$' + Number(n || 0).toLocaleString('es-CL'); }

function renderClientEmail(b) {
  const subject = `Tu reserva en Scissor White — ${b.code}`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;color:#111">
      <h2 style="font-family:Orbitron,Arial,sans-serif">Scissor White · SW Studio</h2>
      <p>Hola <strong>${b.name}</strong>, tu reserva está confirmada.</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td>Servicio</td><td><strong>${b.svcName}</strong></td></tr>
        <tr><td>Barbero</td><td>${b.barberName}</td></tr>
        <tr><td>Fecha</td><td>${fmtDate(b.date)} · ${b.time} hrs</td></tr>
        <tr><td>Total</td><td>${fmtCLP(b.price)}</td></tr>
        <tr><td>Código</td><td><strong>${b.code}</strong></td></tr>
      </table>
      <p>Te esperamos en Cochrane 635, Of. 303, Torre B, Concepción.</p>
    </div>`;
  return { subject, html };
}

function renderShopEmail(b) {
  const subject = `Nueva reserva — ${b.svcName} (${b.code})`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif">
      <h3>Nueva reserva</h3>
      <p><strong>${b.name}</strong> — ${b.phone} · ${b.email}</p>
      <p>${b.svcName} con ${b.barberName}<br>${fmtDate(b.date)} · ${b.time} hrs · ${fmtCLP(b.price)}</p>
      <p>Código: ${b.code}</p>
    </div>`;
  return { subject, html };
}

async function sendBookingEmails(b, { apiKey, fromEmail, shopEmail }) {
  const resend = new Resend(apiKey);
  const client = renderClientEmail(b);
  const shop = renderShopEmail(b);
  await Promise.all([
    resend.emails.send({ from: fromEmail, to: b.email, subject: client.subject, html: client.html }),
    resend.emails.send({ from: fromEmail, to: shopEmail, subject: shop.subject, html: shop.html }),
  ]);
}

module.exports = { renderClientEmail, renderShopEmail, sendBookingEmails };
```

- [ ] **Step 4: Correr — debe pasar**

Run: `cd functions && node --test && cd ..`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/email.js functions/test/email.test.js
git commit -m "feat(functions): plantillas de email + tests"
```

### Task 6.3: Trigger `onBookingCreated`

**Files:**
- Create: `functions/index.js`

- [ ] **Step 1: Crear `functions/index.js`**

```js
// functions/index.js — envía emails al crear una reserva.
'use strict';
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { sendBookingEmails } = require('./email.js');

admin.initializeApp();
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const FROM_EMAIL = defineSecret('FROM_EMAIL');
const SHOP_EMAIL = defineSecret('SHOP_EMAIL');

exports.onBookingCreated = onDocumentCreated(
  { document: 'bookings/{id}', region: 'southamerica-east1', secrets: [RESEND_API_KEY, FROM_EMAIL, SHOP_EMAIL] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const b = snap.data();
    try {
      await sendBookingEmails(b, {
        apiKey: RESEND_API_KEY.value(),
        fromEmail: FROM_EMAIL.value(),
        shopEmail: SHOP_EMAIL.value(),
      });
      await snap.ref.update({ emailStatus: 'sent' });
      logger.info('Emails enviados', { code: b.code });
    } catch (err) {
      logger.error('Fallo al enviar emails', err);
      await snap.ref.update({ emailStatus: 'failed' });
      await admin.firestore().collection('adminLog').add({
        action: 'email_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
      });
      // No relanzar: la reserva ya está guardada.
    }
  }
);
```

- [ ] **Step 2: Crear `functions/.env.example`**

```
RESEND_API_KEY=re_xxx
FROM_EMAIL=reservas@scissorwhite.cl
SHOP_EMAIL=hola@scissorwhite.cl
```

- [ ] **Step 3: Commit**

```bash
git add functions/index.js functions/.env.example
git commit -m "feat(functions): trigger onBookingCreated que envía los emails"
```

### Task 6.4: Cargar secretos y probar end-to-end

**Files:** ninguno (config de secretos).

- [ ] **Step 1: Cargar los secretos en Firebase**

Run:
```bash
firebase functions:secrets:set RESEND_API_KEY   # pega la API key de Resend
firebase functions:secrets:set FROM_EMAIL       # ej. reservas@scissorwhite.cl
firebase functions:secrets:set SHOP_EMAIL       # ej. hola@scissorwhite.cl
```
Expected: cada uno confirma "Secret created/updated".

- [ ] **Step 2: Probar con emuladores** (para local, crea `functions/.env` con valores reales — está gitignored). Run: `firebase emulators:start`. Crea una reserva en http://localhost:5000 y revisa en la consola del emulador que la function corrió y `emailStatus` pasó a `sent` (con una API key válida llega el email; con key de prueba revisa los logs).

---

## Fase 7 — Configuración de Firebase y verificación integral

### Task 7.1: `firebase.json` y `firestore.indexes.json`

**Files:**
- Create: `firebase.json`
- Create: `firestore.indexes.json`

- [ ] **Step 1: Crear `firebase.json`**

```json
{
  "hosting": {
    "public": "public",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "headers": [
      { "source": "/js/**", "headers": [{ "key": "Cache-Control", "value": "max-age=3600" }] }
    ]
  },
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": [
    { "source": "functions", "codebase": "default", "runtime": "nodejs20" }
  ],
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "hosting": { "port": 5000 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

- [ ] **Step 2: Crear `firestore.indexes.json`** (vacío al inicio)

```json
{ "indexes": [], "fieldOverrides": [] }
```

- [ ] **Step 3: Commit**

```bash
git add firebase.json firestore.indexes.json
git commit -m "chore: configuración de Hosting, Firestore, Functions y emuladores"
```

### Task 7.2: QA integral en emuladores

**Files:** ninguno.

- [ ] **Step 1:** `firebase emulators:start` y seed contra el emulador (Task 2.2 Step 4).
- [ ] **Step 2: Checklist manual** (anota PASS/FAIL):
  - [ ] La landing carga idéntica al v15 en http://localhost:5000
  - [ ] Reserva completa de los 4 pasos → aparece doc en `bookings` (`status:pending`)
  - [ ] La function corre y deja `emailStatus:sent` (o `failed` + log si la key es de prueba)
  - [ ] Login admin con la cuenta de prueba (email+pass) entra al panel
  - [ ] La reserva aparece en la Agenda del admin
  - [ ] Editar un servicio → guardar → recargar → persiste
  - [ ] Mover/reasignar una cita → persiste
  - [ ] Logout cierra sesión
- [ ] **Step 3:** `npm run test:rules` y `cd functions && node --test` → todo PASS.

---

## Fase 8 — Deploy a producción

### Task 8.1: Deploy

**Files:** ninguno.

- [ ] **Step 1: Desplegar reglas e índices**

Run: `firebase deploy --only firestore:rules,firestore:indexes`
Expected: "Deploy complete!".

- [ ] **Step 2: Seed de producción.** Genera una service account (Console → Project settings → Service accounts → Generate new private key → guarda como `serviceAccountKey.json`, **gitignored**). Run:
```bash
cd seed
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json GCLOUD_PROJECT=scissor-white-xxxx node seed.js
cd ..
```
Expected: `Seed OK: 19 servicios, 4 barberos, businessInfo/main`.

- [ ] **Step 3: Desplegar Functions y Hosting**

Run: `firebase deploy --only functions,hosting`
Expected: imprime la URL `https://scissor-white-xxxx.web.app`.

- [ ] **Step 4: Smoke test en producción:** abre la URL, completa una reserva real con tu email → llega el email de confirmación; verifica en la consola Firestore que el doc existe y `emailStatus:sent`.

- [ ] **Step 5 (opcional): Dominio.** Hosting → Add custom domain → `scissorwhite.cl` → seguir instrucciones de DNS. Luego cambiar las URLs `https://scissorwhite.cl` del `<head>` del index si corresponde.

---

## Fase 9 — Mejoras posteriores (fuera del MVP, anotadas)

> No bloquean el lanzamiento. Cada una es su propio mini-ciclo spec→plan si se aborda.

- **Externalizar imágenes base64** a `/public/assets/*.webp` para bajar el HTML de 1.4 MB (mejora carga y SEO).
- **Catálogo público dinámico:** que la landing lea `services`/`staff` desde Firestore (hoy están hardcodeadas; el admin ya las gestiona).
- **Recordatorio 24h antes:** Cloud Function programada (`onSchedule`) que envía email de recordatorio.
- **Notificación WhatsApp:** sumar canal vía Twilio/Meta cuando haya cuenta WhatsApp Business aprobada.
- **Estados de reserva en el email:** enviar email también al confirmar/cancelar desde el admin.

---

## Auto-revisión del plan (cobertura del spec)

- ✅ Email automático al cliente y a la barbería → Fase 6 (function + plantillas + tests).
- ✅ Firebase Auth para el admin → Task 5.3.
- ✅ Firestore como base central (services/staff/businessInfo/bookings/adminLog) → Fases 2, 4, 5.
- ✅ Reglas (catálogo público, bookings validados, admin autenticado) → Fase 3 + tests.
- ✅ Hosting + región `southamerica-east1` → Tasks 0.2, 6.3, 7.1, 8.1.
- ✅ Modelo de datos con nombres reales del v15 → Task 2.1, 4.2.
- ✅ Manejo de errores (reserva guardada aunque falle email; fallback WhatsApp) → Tasks 5.2, 6.3.
- ✅ Testing (reglas + function + QA emulador) → Tasks 3.2, 6.2, 7.2.
- ✅ Fase 2 (imágenes, WhatsApp, recordatorio) anotada → Fase 9.
