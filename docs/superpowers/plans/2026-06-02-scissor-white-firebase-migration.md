# Scissor White — Migración a Firebase: Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan checkbox (`- [ ]`).

**Goal:** Convertir el sitio single-file de Scissor White (hoy en `localStorage`, versión **v19**) en una web desplegable en Firebase donde los clientes agendan y reciben confirmación por email, el staff administra todo desde un panel protegido por login, y el módulo de clientes (Club SW + fotos) vive en Firestore/Storage.

**Architecture:** Enfoque A — se preserva `index.html v19` (UI + SEO) y se le conecta una capa Firebase por debajo: Firestore como base central, Firebase Storage para fotos de clientes, Firebase Auth para el panel admin, Cloud Functions (`onBookingCreated` envía emails y sincroniza `patients`; `getClubStatus` calcula la fidelización para el cliente público), y Firebase Hosting para servir el sitio. La capa de datos (`public/js/*.js`) reemplaza los 10 puntos de `localStorage` de v19 (6 originales de v15 + 4 del módulo de clientes).

**Tech Stack:** Firebase Hosting · Firestore · Firebase Storage · Firebase Auth (Email/Password) · Cloud Functions Gen2 (Node 20, incl. `onCall`) · firebase-admin · Firebase JS SDK v10 (modular, vía CDN, sin build) · Resend (email) · Firebase Emulator Suite (Auth+Firestore+Storage+Functions) · `@firebase/rules-unit-testing` + Vitest (tests de reglas) · `firebase-functions-test` (tests de las functions).

**Referencia de diseño:** [`docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md`](../specs/2026-06-01-scissor-white-firebase-design.md) (diseño base) + [`docs/superpowers/specs/2026-07-02-scissor-white-v19-update-design.md`](../specs/2026-07-02-scissor-white-v19-update-design.md) (addendum v19: clientes, Club SW, fotos)

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `public/index.html` | App (copia del v19). Se parchea en 10 puntos para usar la capa de datos. |
| `public/js/firebase-init.js` | Inicializa Firebase SDK (config) y exporta `app`, `db`, `auth`, `storage`. |
| `public/js/data.js` | API de datos: `loadAdmin()`, `saveAdmin(D)`, `getBookings()`, `saveBookings(arr)`, `createBooking(obj)`, `getPatients()`, `uploadPatientPhoto(patientId,file)`, `deletePatientPhoto(patientId,path)`, `getClubStatus(email)`. Expone `window.SWData`. |
| `public/js/auth.js` | `signIn(email,pass)`, `signOut()`, `onChange(cb)`. Expone `window.SWAuth`. |
| `functions/index.js` | Cloud Functions: `onBookingCreated` (envía email + upsertea `patients`) y `getClubStatus` (callable, cuenta visitas Club SW). |
| `functions/email.js` | Render de plantillas HTML de email + envío vía Resend (unidad testeable). |
| `functions/patients.js` | Lógica pura de upsert de `patients` a partir de una reserva + conteo de visitas Club SW (unidad testeable). |
| `functions/package.json` | Deps de Functions (Node 20, firebase-functions v2, firebase-admin, resend). |
| `functions/test/email.test.js` | Tests unitarios del render de plantillas. |
| `functions/test/patients.test.js` | Tests unitarios del upsert de pacientes y conteo Club SW. |
| `seed/seed.js` | Carga inicial de `services`, `staff`, `businessInfo` a Firestore. |
| `seed/data.js` | Los 19 servicios + 4 barberos + info, extraídos del v15/v19 (fuente única, sin cambios entre versiones). |
| `firestore.rules` | Reglas de seguridad (incl. `patients`). |
| `firestore.indexes.json` | Índices (vacío al inicio; documentado). |
| `storage.rules` | Reglas de Storage para fotos de clientes (solo staff). |
| `firebase.json` | Hosting + Functions + Emulators (incl. Storage). |
| `.firebaserc` | Alias del proyecto. |
| `tests/rules/firestore.rules.test.js` | Tests de reglas de Firestore con el emulador. |
| `tests/rules/storage.rules.test.js` | Tests de reglas de Storage con el emulador. |

**Puntos de integración exactos en `index.html` v15 (base)** (verificados en el código fuente):

| Punto | Línea(s) | Hoy | Pasa a |
|---|---|---|---|
| Submit reserva (público) | 2316–2334 | `localStorage.setItem('sw_bookings',…)` | `await SWData.createBooking({...})` |
| Login admin | 3207–3217 | `g('adm-pass').value === PASS` | `await SWAuth.signIn(email,pass)` |
| Carga inicial admin | 3183–3204 | `localStorage.getItem(KEY)` | `await SWData.loadAdmin()` |
| Guardar admin | 3229–3234 | `localStorage.setItem(KEY,…)` | `await SWData.saveAdmin(D)` |
| Leer bookings (admin) | 3298 | `localStorage.getItem(BKEY)` | cache poblada por `SWData.getBookings()` |
| Escribir bookings (admin) | 3302 | `localStorage.setItem(BKEY,…)` | `await SWData.saveBookings(arr)` |

**Puntos nuevos en `index.html` v19** (verificados contra el zip v19; re-confirmar línea exacta una vez copiado a `public/index.html` en la Task 1.2, igual que ya se hace con los de arriba):

| Punto | Línea aprox. (v19) | Hoy | Pasa a |
|---|---|---|---|
| Submit reserva — campo club | ~2588 | `club:S.club\|\|'guest'` dentro del objeto pusheado a `sw_bookings` | mismo campo, ahora dentro del payload de `SWData.createBooking({...})` |
| Submit reserva — conteo Club SW | ~2593–2600 | filtra `bookings` locales por email para calcular `clubVisitCount` | `await SWData.getClubStatus(email)` → `{visitCount, benefitReached}` |
| `PKEY`/`getPatients`/`savePatients` | ~4462–4470 | `localStorage.getItem/setItem('sw_patients',…)` | lectura: `SWData.getPatients()` (cache poblada en `loadFromCloud()`); ya no hay escritura directa desde el admin (la sincroniza la Cloud Function) |
| Subir foto de cliente | ~4746–4775 (`compressImage` → `stored.photos.push({src,date})`) | guarda base64 en el array `photos` de `sw_patients` | `await SWData.uploadPatientPhoto(patientId, compressedBlob)` → agrega `{url,path,date}` |
| Borrar foto de cliente | ~4730–4744 | `stored.photos.splice(idx,1)` + `savePatients(patients)` | `await SWData.deletePatientPhoto(patientId, photo.path)` |

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
- Create: `_source/scissor_white_v19.html` (respaldo local, extraído del zip del usuario — `_source/` está en `.gitignore`, no se commitea)
- Create: `public/index.html` (copia EXACTA del v19, sin modificar aún)

- [ ] **Step 1: Respaldar el v19 en `_source/`**

Run (PowerShell):
```powershell
Expand-Archive -Path "$HOME\Downloads\scissor_white_v19_completo.zip" -DestinationPath "$env:TEMP\sw_v19_unzip" -Force
Copy-Item "$env:TEMP\sw_v19_unzip\scissor_white_project\1_pagina_web\index.html" "_source\scissor_white_v19.html"
Copy-Item "$HOME\Downloads\scissor_white_v19_completo.zip" "_source\scissor_white_v19_completo.zip"
```
Expected: `_source/scissor_white_v19.html` existe (~1.5 MB) y `_source/scissor_white_v19_completo.zip` existe. Si el zip está en otra ruta, ajusta el primer `-Path`.

- [ ] **Step 2: Copiar el v19 a public/**

Run (PowerShell):
```powershell
Copy-Item "_source\scissor_white_v19.html" "public\index.html"
```
Expected: `public/index.html` existe (~1.5 MB).

- [ ] **Step 3: Verificar que sirve localmente**

Run: `firebase emulators:start --only hosting`
Abre http://localhost:5000 → debe verse la landing idéntica al v19 (con el módulo Clientes disponible en el panel admin).
Detén con Ctrl+C.

- [ ] **Step 4: Commit** (`_source/` está en `.gitignore` — solo se commitea `public/index.html`)

```bash
git add public/index.html
git commit -m "chore: index.html v19 como entry de Hosting (reemplaza v15)"
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
        && d.code is string
        && d.club is string  && (d.club == 'member' || d.club == 'guest');
    }

    // Clientes (v19): nombre, contacto, historial de visitas y fotos.
    // Nunca hay escritura pública directa — el único creador/actualizador es
    // la Cloud Function onBookingCreated (Admin SDK, no sujeta a estas reglas).
    match /patients/{id} { allow read, write: if request.auth != null; }

    // Log de actividad: solo staff
    match /adminLog/{id} { allow read, write: if request.auth != null; }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add firestore.rules
git commit -m "feat(rules): reglas de Firestore (catálogo público, bookings validados con club, patients y admin autenticado)"
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
    "@firebase/rules-unit-testing": "^3.0.4",
    "firebase": "^10.13.0",
    "vitest": "^2.1.0"
  }
}
```
(`@firebase/rules-unit-testing@^4` requiere `firebase@^11` como peer, lo que chocaría con el `firebase@^10.13.0` que ya usa el front-end vía CDN — se fija la `v3.x`, la última compatible con `firebase@^10.x`.)

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
  club:'guest',
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

test('reserva con club inválido es rechazada', async () => {
  const db = env.unauthenticatedContext().firestore();
  const bad = { ...valid, club:'vip' };
  await assertFails(setDoc(doc(db, 'bookings/b3'), bad));
});

test('anónimo NO puede leer patients', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'patients/p1')));
});

test('anónimo NO puede crear patients', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'patients/p1'), { name:'Juan', email:'juan@mail.com', club:'guest', visits:[], photos:[] }));
});

test('staff autenticado SÍ puede leer y escribir patients', async () => {
  const db = env.authenticatedContext('staff1').firestore();
  await assertSucceeds(setDoc(doc(db, 'patients/p1'), { name:'Juan', email:'juan@mail.com', club:'guest', visits:[], photos:[] }));
  await assertSucceeds(getDoc(doc(db, 'patients/p1')));
});
```

- [ ] **Step 3: Instalar y correr — verificar que pasa**

Run:
```bash
npm install
npm run test:rules
```
Expected: 10 tests PASS (Vitest arranca el emulador, evalúa las reglas).

- [ ] **Step 4: Commit**

```bash
git add package.json tests/rules/firestore.rules.test.js
git commit -m "test(rules): suite de reglas de Firestore con emulador (incl. club y patients)"
```

### Task 3.3: Reglas de Storage (fotos de clientes) + tests

**Files:**
- Create: `storage.rules`
- Create: `tests/rules/storage.rules.test.js`

- [ ] **Step 1: Escribir `storage.rules`**

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Fotos de clientes: son datos personales, no material de marketing.
    // Solo staff autenticado sube/lee/borra.
    match /patients/{patientId}/{photoId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

- [ ] **Step 2: Escribir el test (debe fallar primero)** en `tests/rules/storage.rules.test.js`

```js
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { beforeAll, afterAll, test } from 'vitest';

let env;
const bytes = new Uint8Array([1, 2, 3]);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'scissor-white-test',
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

test('anónimo NO puede subir una foto de cliente', async () => {
  const storage = env.unauthenticatedContext().storage();
  await assertFails(uploadBytes(ref(storage, 'patients/p1/photo1.jpg'), bytes));
});

test('staff autenticado SÍ puede subir y leer una foto de cliente', async () => {
  const storage = env.authenticatedContext('staff1').storage();
  await assertSucceeds(uploadBytes(ref(storage, 'patients/p1/photo1.jpg'), bytes));
  await assertSucceeds(getBytes(ref(storage, 'patients/p1/photo1.jpg')));
});
```

- [ ] **Step 3: Agregar Storage a `firebase.json`** (ya existe del andamiaje previo — se modifica, no se crea). Agrega la clave `"storage"` y el puerto del emulador:

```json
{
  "hosting": { "...": "sin cambios" },
  "firestore": { "...": "sin cambios" },
  "storage": {
    "rules": "storage.rules"
  },
  "functions": [
    { "source": "functions", "codebase": "default", "runtime": "nodejs20" }
  ],
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "storage": { "port": 9199 },
    "functions": { "port": 5001 },
    "hosting": { "port": 5000 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```
(Los bloques `"hosting"` y `"firestore"` existentes no cambian — solo agrega `"storage"` y la línea `"storage": { "port": 9199 }` dentro de `"emulators"`.)

- [ ] **Step 4: Correr — debe fallar primero, luego pasar**

Run:
```bash
firebase emulators:exec --only storage "vitest run tests/rules/storage.rules.test.js"
```
Expected: sin el bloque `storage.rules` del Step 1, ambos tests FAIL; después del Step 1, 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add storage.rules tests/rules/storage.rules.test.js firebase.json
git commit -m "feat(rules): reglas de Storage para fotos de clientes (solo staff) + tests + emulador"
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
import { getStorage, connectStorageEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js';

// Config pública del proyecto (Console → Project settings → SDK setup). No es secreto.
// projectId/authDomain/storageBucket usan el mismo id que .firebaserc (Task 1.1)
// para que el desarrollo local contra los emuladores funcione sin depender de
// un proyecto Firebase real. apiKey/messagingSenderId/appId sí deben reemplazarse
// por los valores reales antes de producción — el emulador no los valida, prod sí.
const firebaseConfig = {
  apiKey: 'REEMPLAZAR',
  authDomain: 'demo-scissor-white.firebaseapp.com',
  projectId: 'demo-scissor-white',
  storageBucket: 'demo-scissor-white.appspot.com',
  messagingSenderId: 'REEMPLAZAR',
  appId: 'REEMPLAZAR',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const functions = getFunctions(app, 'southamerica-east1');

// Conectar a emuladores en local
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectStorageEmulator(storage, 'localhost', 9199);
  connectFunctionsEmulator(functions, 'localhost', 5001);
}

export { app, db, auth, storage, functions };
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
import { db, storage, functions } from './firebase-init.js';
import {
  collection, getDocs, doc, setDoc, addDoc, deleteDoc,
  writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import {
  ref, uploadBytes, getDownloadURL, deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js';

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

// Clientes (v19). El upsert automático por reserva lo hace la Cloud
// Function onBookingCreated (Task 6.6); savePatients cubre las escrituras
// manuales del admin (crear/editar/borrar cliente, notas, visita manual).
async function getPatients() {
  return await readCol('patients');
}

async function savePatients(arr) {
  const batch = writeBatch(db);
  (arr || []).forEach(p => batch.set(doc(db, 'patients', p.id), stripId(p), { merge: true }));
  await batch.commit();
}

async function deletePatient(id) {
  await deleteDoc(doc(db, 'patients', id));
}

// Sube una foto (blob ya comprimido por compressImage) a Storage y devuelve
// el objeto {url, path, date} que se agrega al array `photos` del paciente.
async function uploadPatientPhoto(patientId, blob) {
  const photoId = 'pat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const path = `patients/${patientId}/${photoId}.jpg`;
  const objRef = ref(storage, path);
  await uploadBytes(objRef, blob, { contentType: 'image/jpeg' });
  const url = await getDownloadURL(objRef);
  const photo = { url, path, date: new Date().toISOString() };
  const patientRef = doc(db, 'patients', patientId);
  const patients = await getPatients();
  const p = patients.find(x => x.id === patientId);
  const photos = [...((p && p.photos) || []), photo];
  await setDoc(patientRef, { photos }, { merge: true });
  return photo;
}

// Borra una foto de Storage y la quita del array `photos` del paciente.
async function deletePatientPhoto(patientId, path) {
  await deleteObject(ref(storage, path));
  const patientRef = doc(db, 'patients', patientId);
  const patients = await getPatients();
  const p = patients.find(x => x.id === patientId);
  const photos = ((p && p.photos) || []).filter(ph => ph.path !== path);
  await setDoc(patientRef, { photos }, { merge: true });
}

// Cuenta las visitas Club SW de un email vía Cloud Function (el cliente
// público no tiene permiso de leer `bookings` directamente — ver Task 6.7).
async function getClubStatus(email) {
  const call = httpsCallable(functions, 'getClubStatus');
  const { data } = await call({ email });
  return data; // { visitCount, benefitReached }
}

window.SWData = {
  loadAdmin, saveAdmin, getBookings, saveBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus,
};
export {
  loadAdmin, saveAdmin, getBookings, saveBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus,
};
```

- [ ] **Step 2: Commit**

```bash
git add public/js/data.js
git commit -m "feat(web): capa de datos SWData sobre Firestore (incl. patients, fotos, getClubStatus)"
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

## Fase 5 — Parchear `index.html` (los 10 puntos de v19)

> Carga los módulos al final del `<body>` y cambia cada punto. Como los IIFE del v19 usan `var`, el puente es vía `window.SWData` / `window.SWAuth`. Tras cada parche, prueba en el emulador. Los números de línea son del v15 base (Tasks 5.2–5.5) o aproximados del v19 (Tasks 5.6–5.8) — **re-verifica contra `public/index.html` real** (`grep -n "sw_patients\|S.club\|compressImage"`) antes de editar, ya que pueden variar unas líneas por los cambios previos de esta misma fase.

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

### Task 5.2: Persistir la reserva del cliente + Club SW (líneas ~2566–2649 en v19)

**Files:**
- Modify: `public/index.html:2566-2649` (aprox. — confirma con `grep -n "bk-submit" public/index.html`)

El v19 agrega el campo `club` y calcula `clubVisitCount`/`clubBenefitReached` **leyendo localStorage sincrónicamente**. Ambas cosas cambian: `club` viaja en el payload de Firestore, y el conteo pasa a `SWData.getClubStatus()` (ver hallazgo del spec — el cliente público ya no puede leer `bookings` directamente).

- [ ] **Step 1:** Reemplazar el bloque completo dentro del `setTimeout(...)` del listener de `#bk-submit` por:

```js
  setTimeout(async ()=>{
    const code=genCode();
    const fullname=document.getElementById('bkf-name').value.trim();
    const name=fullname.split(' ')[0];
    const email=document.getElementById('bkf-email').value.trim();
    const phone=document.getElementById('bkf-phone').value.trim();
    var clubVisitCount = 1;
    var clubBenefitReached = '';
    // ── Persistir la reserva en Firestore (dispara email + sync de patients) ──
    try{
      await window.SWData.createBooking({
        code, name:fullname, email, phone,
        svcId:S.svc?.id, svcName:S.svc?.name, svcCat:S.svc?.cat||'',
        price:S.svc?.price||0, dur:S.svc?.dur||0,
        barberId:S.barber?.id, barberName:S.barber?.name,
        date:S.date?S.date.toISOString():'', time:S.time,
        club:S.club||'guest',
        createdAt:new Date().toISOString()
      });
      // Conteo de visitas Club SW vía Cloud Function (bookings es solo-staff)
      if(S.club==='member' && email){
        const status = await window.SWData.getClubStatus(email);
        clubVisitCount = status.visitCount;
        clubBenefitReached = status.benefitReached || '';
      }
    }catch(e){
      console.error('No se pudo guardar la reserva', e);
      // Fallback: mantener el link de WhatsApp visible para contacto manual
    }
    document.getElementById('bk-confirm-code').textContent=code;
    // … (resto del render de confirmación — bloque de fidelización con
    // clubVisitCount/clubBenefitReached y el resumen de la reserva — sin cambios)
```
(El resto del bloque, que arma `loyaltyBlock` y `bk-confirm-details` a partir de `clubVisitCount`/`clubBenefitReached`, queda igual — esas variables ya existían con esos mismos nombres.)

- [ ] **Step 2: Verificar en emulador.** Arranca `firebase emulators:start`, completa una reserva como Miembro Club SW en http://localhost:5000, y confirma en http://localhost:4000/firestore que aparece un doc en `bookings` con `status:pending` y `club:'member'`. Repite la reserva con el mismo email un par de veces más y confirma que el contador de visitas en la tarjeta de confirmación sube (requiere que la Task 6.7 — `getClubStatus` — ya esté desplegada en el emulador).

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(web): la reserva del cliente se guarda en Firestore, club y contador vía getClubStatus"
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
    BK = await window.SWData.getBookings();    // cache de reservas (ver Task 5.5)
    PT = await window.SWData.getPatients();    // cache de clientes (ver Task 5.6)
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

### Task 5.6: Lectura/escritura de clientes en el admin (`sw_patients`, líneas ~4462–4470 en v19)

**Files:**
- Modify: `public/index.html` (confirma línea con `grep -n "PKEY\|getPatients\|savePatients" public/index.html`)

- [ ] **Step 1:** Declarar la cache `var PT=[];` junto a `var BK=[];` y reemplazar `getPatients()`/`savePatients()`:

```js
// Antes:
// var PKEY = 'sw_patients';
// function getPatients(){ try{ return JSON.parse(localStorage.getItem(PKEY)||'[]'); }catch(e){ return []; } }
// function savePatients(arr){ localStorage.setItem(PKEY, JSON.stringify(arr)); updatePatBadge(); }

// Ahora:
function getPatients(){ return PT; }
function savePatients(arr){
  PT = arr || [];
  window.SWData.savePatients(PT).catch(function(e){ console.error('Error guardando clientes', e); });
  updatePatBadge();
}
```

- [ ] **Step 2:** El módulo `syncPatientsFromBookings()` (líneas ~4479–4525) deja de ser necesario — ahora lo hace la Cloud Function `onBookingCreated` (Task 6.6) cada vez que se crea una reserva. Elimina la llamada a `syncPatientsFromBookings()` dentro de `renderPatients()` (la función queda sin uso; puedes borrarla junto con su llamada).

- [ ] **Step 3:** Los dos flujos de **borrado** de cliente (fila de la tabla y modal de ficha, líneas ~4628–4640 y ~4865–4878) hoy hacen `pts = getPatients().filter(...); savePatients(pts);` — eso funcionaba en `localStorage` porque se reescribía el array completo, pero en Firestore un `set` con el array filtrado **no borra** el documento ya persistido. Cambia ambos handlers para usar borrado explícito:

```js
// Antes (en ambos handlers):
// var pts = getPatients().filter(function(x){return x.id!==p.id});
// savePatients(pts);

// Ahora:
window.SWData.deletePatient(p.id).then(function(){
  PT = PT.filter(function(x){return x.id!==p.id});
  updatePatBadge();
}).catch(function(e){ console.error('Error eliminando cliente', e); });
```

- [ ] **Step 4: Verificar:** crear un cliente manual (+ Nuevo cliente) → guardar → recargar → persiste. Editar sus notas → persiste. Eliminarlo → desaparece y no reaparece tras recargar. Crear una reserva pública nueva → entrar al admin → el cliente aparece solo en Clientes sin necesitar abrir la pestaña dos veces (lo hizo la Cloud Function). Commit:

```bash
git add public/index.html
git commit -m "feat(web): admin lee/escribe clientes en Firestore, sync automático vía Cloud Function"
```

### Task 5.7: Fotos de clientes → Firebase Storage (líneas ~4691–4776 en v19)

**Files:**
- Modify: `public/index.html` (confirma línea con `grep -n "compressImage\|data-photo-add\|data-photo-del" public/index.html`)

- [ ] **Step 1:** En el handler de subida (dentro de `renderPatPhotos(p)`, sección `[data-photo-add]`), reemplazar el guardado en `stored.photos.push({src, date})` por la subida a Storage. `compressImage` ya produce un dataURL comprimido — se convierte a blob antes de subir:

```js
reader.onload = function(ev){
  compressImage(ev.target.result, 1200, 0.82, function(compressedSrc){
    if((p.photos||[]).length >= 4){
      alert('Ya hay 4 fotos. Elimina una antes de subir otra.');
      return;
    }
    fetch(compressedSrc).then(function(r){ return r.blob(); }).then(function(blob){
      return window.SWData.uploadPatientPhoto(p.id, blob);
    }).then(function(photo){
      if(!p.photos) p.photos = [];
      p.photos.push(photo);
      var idx = PT.findIndex(function(x){return x.id===p.id});
      if(idx>-1) PT[idx].photos = p.photos;
      renderPatPhotos(p);
      log('Subió foto', p.name);
    }).catch(function(e){ console.error('Error subiendo foto', e); alert('No se pudo subir la foto.'); });
  });
};
reader.readAsDataURL(f);
```
(El chequeo de tamaño máximo 5MB y la validación de `f` antes de este bloque no cambian.)

- [ ] **Step 2:** En el handler de borrado (`[data-photo-del]`), reemplazar `stored.photos.splice(idx,1); savePatients(patients);` por:

```js
grid.querySelectorAll('[data-photo-del]').forEach(function(b){
  b.addEventListener('click', function(e){
    e.stopPropagation();
    var idx = parseInt(b.dataset.photoDel);
    if(!confirm('¿Eliminar esta foto?')) return;
    var photo = p.photos[idx];
    if(!photo) return;
    window.SWData.deletePatientPhoto(p.id, photo.path).then(function(){
      p.photos.splice(idx, 1);
      var pidx = PT.findIndex(function(x){return x.id===p.id});
      if(pidx>-1) PT[pidx].photos = p.photos;
      renderPatPhotos(p);
    }).catch(function(e){ console.error('Error eliminando foto', e); alert('No se pudo eliminar la foto.'); });
  });
});
```

- [ ] **Step 3:** El lightbox y el resto de `renderPatPhotos` leen `photo.src`; cambia esas referencias a `photo.url` (la URL de Storage reemplaza al dataURL base64).

- [ ] **Step 4: Verificar en emulador** (con el emulador de Storage corriendo, Task 3.3): subir una foto en la ficha de un cliente → aparece en la grilla y en http://localhost:4000/storage; recargar la página → sigue ahí; eliminarla → desaparece de ambos lados. Commit:

```bash
git add public/index.html
git commit -m "feat(web): fotos de clientes suben/borran desde Firebase Storage"
```

---

## Fase 6 — Cloud Functions (email, sync de clientes, Club SW)

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

### Task 6.5: Lógica de upsert de clientes + conteo Club SW (unidad testeable, TDD)

**Files:**
- Create: `functions/patients.js`
- Test: `functions/test/patients.test.js`

- [ ] **Step 1: Escribir el test primero** en `functions/test/patients.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const { buildPatientUpsert, countClubVisits } = require('../patients.js');

const booking = {
  code:'SW-AB12345', name:'Juan Pérez', email:'Juan@Mail.com', phone:'+56912345678',
  svcId:'lp', svcName:'Corte + Lavado Premium', price:21000, barberName:'Felipe',
  club:'member', createdAt:'2026-06-10T00:00:00.000Z',
};

test('buildPatientUpsert crea un cliente nuevo si no existe', () => {
  const p = buildPatientUpsert(null, booking);
  assert.strictEqual(p.name, 'Juan Pérez');
  assert.strictEqual(p.email, 'Juan@Mail.com');
  assert.strictEqual(p.club, 'member');
  assert.strictEqual(p.visits.length, 1);
  assert.strictEqual(p.visits[0].code, 'SW-AB12345');
});

test('buildPatientUpsert agrega una visita a un cliente existente', () => {
  const existing = { id:'pat_1', name:'Juan Pérez', email:'juan@mail.com', phone:'', notes:'', club:'guest', visits:[{code:'SW-OLD01'}], createdAt:'2026-01-01T00:00:00.000Z' };
  const p = buildPatientUpsert(existing, booking);
  assert.strictEqual(p.visits.length, 2);
  assert.strictEqual(p.club, 'member'); // sube a member porque esta reserva es club:member
});

test('buildPatientUpsert no duplica una visita ya registrada (mismo code)', () => {
  const existing = { id:'pat_1', name:'Juan Pérez', email:'juan@mail.com', phone:'', notes:'', club:'member', visits:[{code:'SW-AB12345'}], createdAt:'2026-01-01T00:00:00.000Z' };
  const p = buildPatientUpsert(existing, booking);
  assert.strictEqual(p.visits.length, 1);
});

test('countClubVisits cuenta solo reservas club:member del email (case-insensitive)', () => {
  const bookings = [
    { email:'juan@mail.com', club:'member' },
    { email:'JUAN@MAIL.COM', club:'member' },
    { email:'juan@mail.com', club:'guest' },
    { email:'otro@mail.com', club:'member' },
  ];
  const { visitCount, benefitReached } = countClubVisits(bookings, 'juan@mail.com');
  assert.strictEqual(visitCount, 2);
  assert.strictEqual(benefitReached, '');
});

test('countClubVisits marca el beneficio al llegar a 10 y 20', () => {
  const tenBookings = Array.from({ length: 10 }, () => ({ email:'ana@mail.com', club:'member' }));
  assert.strictEqual(countClubVisits(tenBookings, 'ana@mail.com').benefitReached, 'premium');
  const twentyBookings = Array.from({ length: 20 }, () => ({ email:'ana@mail.com', club:'member' }));
  assert.strictEqual(countClubVisits(twentyBookings, 'ana@mail.com').benefitReached, 'asesoria');
});
```

- [ ] **Step 2: Correr — debe fallar**

Run: `cd functions && node --test && cd ..`
Expected: FAIL (`Cannot find module '../patients.js'`).

- [ ] **Step 3: Implementar `functions/patients.js`**

```js
// functions/patients.js — lógica pura de upsert de clientes y conteo Club SW.
// Sin dependencias de Firebase Admin: fácil de testear, se usa desde index.js.
'use strict';

function buildPatientUpsert(existingPatient, booking) {
  const visit = {
    code: booking.code, date: booking.date || booking.createdAt || '',
    svcId: booking.svcId || '', svcName: booking.svcName || '',
    price: booking.price || 0, barberName: booking.barberName || '',
    club: booking.club || 'guest',
  };
  if (!existingPatient) {
    return {
      name: booking.name || 'Sin nombre', email: booking.email, phone: booking.phone || '',
      notes: '', club: booking.club || 'guest', visits: [visit],
      createdAt: booking.createdAt || new Date().toISOString(),
    };
  }
  const visits = existingPatient.visits || [];
  const already = visits.some(v => v.code === booking.code);
  return {
    ...existingPatient,
    club: booking.club === 'member' ? 'member' : existingPatient.club,
    visits: already ? visits : [...visits, visit],
  };
}

function countClubVisits(bookings, email) {
  const key = (email || '').toLowerCase();
  const visitCount = (bookings || []).filter(
    b => (b.email || '').toLowerCase() === key && b.club === 'member'
  ).length;
  let benefitReached = '';
  if (visitCount === 10) benefitReached = 'premium';
  if (visitCount === 20) benefitReached = 'asesoria';
  return { visitCount, benefitReached };
}

module.exports = { buildPatientUpsert, countClubVisits };
```

- [ ] **Step 4: Correr — debe pasar**

Run: `cd functions && node --test && cd ..`
Expected: 7 tests PASS (2 de `email.test.js` + 5 de `patients.test.js`).

- [ ] **Step 5: Commit**

```bash
git add functions/patients.js functions/test/patients.test.js
git commit -m "feat(functions): lógica de upsert de clientes y conteo Club SW + tests"
```

### Task 6.6: Extender `onBookingCreated` para sincronizar `patients`

**Files:**
- Modify: `functions/index.js`

- [ ] **Step 1:** Importar `buildPatientUpsert` y agregar el upsert dentro del trigger, después de enviar los emails (si el email falla, el upsert igual debe ocurrir — la reserva ya es válida):

```js
// functions/index.js — agregar arriba, junto a los otros requires:
const { buildPatientUpsert } = require('./patients.js');

// Dentro de exports.onBookingCreated, después del bloque try/catch de emails
// (antes del cierre de la función), agregar:
    try {
      const db = admin.firestore();
      const existingSnap = await db.collection('patients').where('email', '==', b.email).limit(1).get();
      const existingDoc = existingSnap.empty ? null : existingSnap.docs[0];
      const patient = buildPatientUpsert(existingDoc ? existingDoc.data() : null, b);
      if (existingDoc) {
        await existingDoc.ref.set(patient, { merge: true });
      } else {
        await db.collection('patients').add(patient);
      }
    } catch (err) {
      logger.error('Fallo al sincronizar patients', err);
      // No relanzar: la reserva y el email ya se procesaron independientemente.
    }
```

- [ ] **Step 2: Verificar en emulador:** crear una reserva pública (Club SW o invitado) → confirmar en http://localhost:4000/firestore que aparece/actualiza un doc en `patients` con la visita agregada. Crear una segunda reserva con el mismo email → el mismo doc de `patients` gana una segunda entrada en `visits[]` (no un documento duplicado).

- [ ] **Step 3: Commit**

```bash
git add functions/index.js
git commit -m "feat(functions): onBookingCreated sincroniza patients automáticamente"
```

### Task 6.7: Cloud Function callable `getClubStatus`

**Files:**
- Modify: `functions/index.js`

- [ ] **Step 1:** Agregar la function callable, usando `countClubVisits` (ya testeado en Task 6.5):

```js
// functions/index.js — agregar arriba, junto a los otros requires:
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { countClubVisits } = require('./patients.js');

// Agregar como export nuevo, al mismo nivel que onBookingCreated:
exports.getClubStatus = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const email = (request.data && request.data.email || '').trim();
    if (!email) throw new HttpsError('invalid-argument', 'email es requerido');
    const db = admin.firestore();
    const snap = await db.collection('bookings').where('email', '==', email).where('club', '==', 'member').get();
    const bookings = snap.docs.map(d => d.data());
    return countClubVisits(bookings, email);
  }
);
```

- [ ] **Step 2: Agregar el índice compuesto necesario** en `firestore.indexes.json` (la query filtra por `email` + `club`, dos campos `==`, Firestore lo pide como índice compuesto):

```json
{
  "indexes": [
    { "collectionGroup": "bookings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "email", "order": "ASCENDING" },
      { "fieldPath": "club", "order": "ASCENDING" }
    ]}
  ],
  "fieldOverrides": []
}
```
(Este bloque reemplaza el `{ "indexes": [], ... }` vacío que crea la Task 7.1 — si esa task ya corrió, edita el archivo existente en vez de sobreescribirlo.)

- [ ] **Step 3: Verificar en emulador:** desde la consola del navegador en http://localhost:5000, tras crear 2-3 reservas de prueba como Club SW con el mismo email, llamar manualmente `await window.SWData.getClubStatus('ese@email.com')` y confirmar que `visitCount` coincide con las reservas creadas.

- [ ] **Step 4: Commit**

```bash
git add functions/index.js firestore.indexes.json
git commit -m "feat(functions): getClubStatus callable + índice compuesto bookings(email,club)"
```

---

## Fase 7 — Configuración de Firebase y verificación integral

### Task 7.1: Verificar `firebase.json` y `firestore.indexes.json`

**Files:**
- Verify: `firebase.json` (ya tiene Hosting/Firestore/Functions del andamiaje inicial + `storage` agregado en Task 3.3)
- Verify: `firestore.indexes.json` (ya tiene el índice `bookings(email,club)` agregado en Task 6.7)

- [ ] **Step 1:** Confirma que `firebase.json` tiene los 5 bloques: `hosting`, `firestore`, `storage`, `functions`, `emulators` (con `auth`, `firestore`, `storage`, `functions`, `hosting`, `ui`). Si falta alguno de los agregados en tasks anteriores, complétalo ahora con el contenido mostrado en Task 3.3 Step 3.

Run: `node -e "const j=require('./firebase.json'); console.log(Object.keys(j), Object.keys(j.emulators))"`
Expected: `[ 'hosting', 'firestore', 'storage', 'functions', 'emulators' ] [ 'auth', 'firestore', 'storage', 'functions', 'hosting', 'ui', 'singleProjectMode' ]`

- [ ] **Step 2:** Confirma que `firestore.indexes.json` tiene el índice compuesto de la Task 6.7 Step 2 (no debe estar vacío).

Run: `node -e "const j=require('./firestore.indexes.json'); console.log(j.indexes.length)"`
Expected: `1`

- [ ] **Step 3: Commit** (solo si el Step 1 o 2 requirió cambios; si ambos archivos ya estaban completos, omite este paso)

```bash
git add firebase.json firestore.indexes.json
git commit -m "chore: completar configuración de Hosting, Firestore, Storage, Functions y emuladores"
```

### Task 7.2: QA integral en emuladores

**Files:** ninguno.

- [ ] **Step 1:** `firebase emulators:start` y seed contra el emulador (Task 2.2 Step 4).
- [ ] **Step 2: Checklist manual** (anota PASS/FAIL):
  - [ ] La landing carga idéntica al v19 en http://localhost:5000 (incl. selector Miembro Club SW / Invitado en el paso 4 del booking)
  - [ ] Reserva completa de los 4 pasos como **Invitado** → aparece doc en `bookings` (`status:pending`, `club:'guest'`)
  - [ ] Reserva completa como **Miembro Club SW** → `club:'member'`; la tarjeta de confirmación muestra el contador de visitas correcto (vía `getClubStatus`)
  - [ ] Repetir la reserva Club SW con el mismo email 2-3 veces → el contador sube cada vez
  - [ ] La function `onBookingCreated` corre y deja `emailStatus:sent` (o `failed` + log si la key es de prueba)
  - [ ] Tras cada reserva, el doc correspondiente en `patients` se crea/actualiza automáticamente (sin abrir el panel admin)
  - [ ] Login admin con la cuenta de prueba (email+pass) entra al panel
  - [ ] La reserva aparece en la Agenda del admin
  - [ ] El cliente aparece en Clientes con su historial de visitas
  - [ ] Doble clic en un cliente → abre la ficha → subir una foto → aparece en la grilla y en Storage
  - [ ] Eliminar esa foto → desaparece de la grilla y de Storage
  - [ ] Crear un cliente manual (+ Nuevo cliente) → editar sus notas → eliminarlo → no reaparece tras recargar
  - [ ] Editar un servicio → guardar → recargar → persiste
  - [ ] Mover/reasignar una cita → persiste
  - [ ] Logout cierra sesión
- [ ] **Step 3:** `npm run test:rules`, `firebase emulators:exec --only storage "vitest run tests/rules/storage.rules.test.js"` y `cd functions && node --test` → todo PASS.

---

## Fase 8 — Deploy a producción

### Task 8.1: Deploy

**Files:** ninguno.

- [ ] **Step 1: Desplegar reglas e índices**

Run: `firebase deploy --only firestore:rules,firestore:indexes,storage`
Expected: "Deploy complete!". (Nota: Firebase puede tardar unos minutos en construir el índice compuesto `bookings(email,club)` de la Task 6.7 — revisa el estado en Console → Firestore → Indexes antes de probar `getClubStatus` en producción.)

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

- [ ] **Step 4: Smoke test en producción:** abre la URL, completa una reserva real como Miembro Club SW con tu email → llega el email de confirmación, la tarjeta de fidelización muestra el contador correcto, y en la consola Firestore existen `bookings` (`emailStatus:sent`, `club:'member'`) y `patients` (con la visita); en el panel admin, sube una foto al cliente y confirma que aparece en Storage.

- [ ] **Step 5 (opcional): Dominio.** Hosting → Add custom domain → `scissorwhite.cl` → seguir instrucciones de DNS. Luego cambiar las URLs `https://scissorwhite.cl` del `<head>` del index si corresponde.

---

## Fase 9 — Mejoras posteriores (fuera del MVP, anotadas)

> No bloquean el lanzamiento. Cada una es su propio mini-ciclo spec→plan si se aborda.

- **Externalizar imágenes base64** a `/public/assets/*.webp` para bajar el HTML de 1.5 MB (mejora carga y SEO). El zip v19 ya trae las 12 fotos originales sueltas (`2_imagenes_originales/`), listas para esta tarea sin tener que extraerlas del HTML.
- **Catálogo público dinámico:** que la landing lea `services`/`staff` desde Firestore (hoy están hardcodeadas; el admin ya las gestiona).
- **Recordatorio 24h antes:** Cloud Function programada (`onSchedule`) que envía email de recordatorio.
- **Notificación WhatsApp:** sumar canal vía Twilio/Meta cuando haya cuenta WhatsApp Business aprobada.
- **Estados de reserva en el email:** enviar email también al confirmar/cancelar desde el admin.

---

## Auto-revisión del plan (cobertura del spec)

**Cobertura del spec base (2026-06-01):**

- ✅ Email automático al cliente y a la barbería → Fase 6 (function + plantillas + tests).
- ✅ Firebase Auth para el admin → Task 5.3.
- ✅ Firestore como base central (services/staff/businessInfo/bookings/adminLog) → Fases 2, 4, 5.
- ✅ Reglas (catálogo público, bookings validados, admin autenticado) → Fase 3 + tests.
- ✅ Hosting + región `southamerica-east1` → Tasks 0.2, 6.3, 7.1, 8.1.
- ✅ Modelo de datos con nombres reales del v15/v19 → Task 2.1, 4.2.
- ✅ Manejo de errores (reserva guardada aunque falle email; fallback WhatsApp) → Tasks 5.2, 6.3.
- ✅ Testing (reglas + function + QA emulador) → Tasks 3.2, 6.2, 7.2.
- ✅ Fase 2 (imágenes, WhatsApp, recordatorio) anotada → Fase 9.

**Cobertura del addendum v19 (2026-07-02):**

- ✅ Reemplazo de `index.html` v15 → v19 → Task 1.2.
- ✅ Colección `patients/{id}` (name/email/phone/notes/club/visits/photos) → Task 2.1 sin cambios (no es seed), modelo definido en Task 4.2, reglas en Task 3.1.
- ✅ Campo `club` en `bookings` + validación → Task 3.1 (`isValidBooking`), Task 5.2.
- ✅ Fotos de clientes en Firebase Storage (no base64) → Tasks 3.3, 4.2, 5.7.
- ✅ Conteo de visitas Club SW sin abrir lectura pública de `bookings` → Task 6.7 (`getClubStatus` callable) + Task 5.2.
- ✅ Sincronización de `patients` server-side (sin depender de que el admin abra la pestaña) → Tasks 6.5, 6.6.
- ✅ Reglas de Storage (solo staff) → Task 3.3.
- ✅ Escrituras manuales de `patients` desde el admin (crear/editar/borrar cliente) → Task 5.6.
- ✅ Testing del addendum (reglas de `patients`, reglas de Storage, upsert/conteo Club SW, QA manual ampliado) → Tasks 3.2, 3.3, 6.5, 7.2.
