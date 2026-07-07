# WhatsApp (Kapso) — Módulo de aviso de reserva — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un segundo canal de aviso de reserva (WhatsApp vía Kapso) que se dispara en paralelo al email existente, sin bloquear ni afectar el flujo actual si falla.

**Architecture:** Nuevo módulo `functions/whatsapp.js` (funciones puras + un `fetch` a la API de Kapso), paralelo a `functions/email.js`. `functions/index.js` pasa de `try/catch` secuencial a `Promise.allSettled([...])` para disparar email y WhatsApp a la vez, y escribe `emailStatus` + `whatsappStatus` por separado en el doc de `bookings`. Reutiliza la misma Cloud Function (`onBookingCreated`), región (`southamerica-east1`) y patrón de secrets (`defineSecret`) ya usado para Resend.

**Tech Stack:** Node 20 (Cloud Functions v2, `fetch` global — sin dependencias nuevas), `node:test` + `node:assert` para unit tests, Kapso (Meta WhatsApp Cloud API) como proveedor.

**Spec de referencia:** `docs/superpowers/specs/2026-07-06-whatsapp-kapso-design.md`

---

### Task 1: `functions/whatsapp.js` — `normalizePhone`

**Files:**
- Create: `functions/whatsapp.js`
- Create: `functions/test/whatsapp.test.js`

- [ ] **Step 1: Escribir el test que falla**

```js
// functions/test/whatsapp.test.js
const test = require('node:test');
const assert = require('node:assert');
const { normalizePhone } = require('../whatsapp.js');

test('normalizePhone limpia espacios y el signo + de un número chileno', () => {
  assert.strictEqual(normalizePhone('+56 9 8251 4114'), '56982514114');
});

test('normalizePhone deja igual un número que ya viene en E.164 sin +', () => {
  assert.strictEqual(normalizePhone('56982514114'), '56982514114');
});

test('normalizePhone antepone 56 a un número local sin código de país', () => {
  assert.strictEqual(normalizePhone('982514114'), '56982514114');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd functions && node --test test/whatsapp.test.js && cd ..`
Expected: FAIL — `Cannot find module '../whatsapp.js'`

- [ ] **Step 3: Implementación mínima**

```js
// functions/whatsapp.js — render + envío de WhatsApp vía Kapso (Meta Cloud API).
'use strict';

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.startsWith('56') ? digits : '56' + digits;
}

module.exports = { normalizePhone };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd functions && node --test test/whatsapp.test.js && cd ..`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/whatsapp.js functions/test/whatsapp.test.js
git commit -m "feat(functions): normalizePhone para números de WhatsApp (Kapso)"
```

---

### Task 2: `buildTextBody` (modo texto libre, sandbox)

**Files:**
- Modify: `functions/whatsapp.js`
- Modify: `functions/test/whatsapp.test.js`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `functions/test/whatsapp.test.js` (y actualizar el `require` del tope):

```js
const { normalizePhone, buildTextBody } = require('../whatsapp.js');

const booking = {
  code: 'SW-AB12345', name: 'Juan Pérez', phone: '+56 9 8251 4114',
  svcName: 'Corte + Lavado Premium', barberName: 'Felipe',
  date: '2026-06-10T00:00:00.000Z', time: '11:00',
};

test('buildTextBody incluye nombre, servicio, barbero, fecha/hora y código', () => {
  const body = buildTextBody(booking);
  assert.match(body, /Juan Pérez/);
  assert.match(body, /Corte \+ Lavado Premium/);
  assert.match(body, /Felipe/);
  assert.match(body, /11:00/);
  assert.match(body, /SW-AB12345/);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd functions && node --test test/whatsapp.test.js && cd ..`
Expected: FAIL — `buildTextBody is not a function`

- [ ] **Step 3: Implementación mínima**

Agregar en `functions/whatsapp.js`, antes de `module.exports`:

```js
function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }); }
  catch { return iso; }
}

function buildTextBody(b) {
  return `Hola ${b.name}, tu reserva en Scissor White está confirmada.\n` +
    `Servicio: ${b.svcName}\n` +
    `Barbero: ${b.barberName}\n` +
    `Fecha: ${fmtDate(b.date)} · ${b.time} hrs\n` +
    `Código: ${b.code}\n` +
    `Te esperamos en Cochrane 635, Of. 303, Torre B, Concepción.`;
}
```

Y actualizar el `module.exports`:

```js
module.exports = { normalizePhone, buildTextBody };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd functions && node --test test/whatsapp.test.js && cd ..`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/whatsapp.js functions/test/whatsapp.test.js
git commit -m "feat(functions): buildTextBody para el aviso de WhatsApp en modo texto libre"
```

---

### Task 3: `buildTemplateComponents` (modo plantilla, producción futura)

**Files:**
- Modify: `functions/whatsapp.js`
- Modify: `functions/test/whatsapp.test.js`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `functions/test/whatsapp.test.js` (actualizar el `require` del tope para incluir `buildTemplateComponents`):

```js
const { normalizePhone, buildTextBody, buildTemplateComponents } = require('../whatsapp.js');

test('buildTemplateComponents arma los parámetros en el orden esperado', () => {
  const components = buildTemplateComponents(booking);
  assert.strictEqual(components.length, 1);
  assert.strictEqual(components[0].type, 'body');
  const params = components[0].parameters.map(p => p.text);
  assert.strictEqual(params[0], 'Juan Pérez');
  assert.strictEqual(params[1], 'Corte + Lavado Premium');
  assert.strictEqual(params[2], 'Felipe');
  assert.match(params[3], /11:00 hrs/);
  assert.strictEqual(params[4], 'SW-AB12345');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd functions && node --test test/whatsapp.test.js && cd ..`
Expected: FAIL — `buildTemplateComponents is not a function`

- [ ] **Step 3: Implementación mínima**

Agregar en `functions/whatsapp.js`, antes de `module.exports`:

```js
function buildTemplateComponents(b) {
  return [{
    type: 'body',
    parameters: [
      { type: 'text', text: b.name },
      { type: 'text', text: b.svcName },
      { type: 'text', text: b.barberName },
      { type: 'text', text: `${fmtDate(b.date)} · ${b.time} hrs` },
      { type: 'text', text: b.code },
    ],
  }];
}
```

Y actualizar el `module.exports`:

```js
module.exports = { normalizePhone, buildTextBody, buildTemplateComponents };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd functions && node --test test/whatsapp.test.js && cd ..`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/whatsapp.js functions/test/whatsapp.test.js
git commit -m "feat(functions): buildTemplateComponents para el modo plantilla de WhatsApp"
```

---

### Task 4: `sendBookingWhatsApp` (POST a Kapso)

**Files:**
- Modify: `functions/whatsapp.js`

No lleva unit test nuevo: mismo criterio que `sendBookingEmails` en `functions/email.js` — la llamada HTTP no se mockea, solo se testean las funciones puras de render (ya cubiertas en Tasks 1-3).

- [ ] **Step 1: Implementación**

Agregar en `functions/whatsapp.js`, antes de `module.exports`:

```js
async function sendBookingWhatsApp(b, { apiKey, phoneNumberId, mode, templateName, templateLang }) {
  const to = normalizePhone(b.phone);
  const body = mode === 'template'
    ? {
        messaging_product: 'whatsapp', to, type: 'template',
        template: { name: templateName, language: { code: templateLang }, components: buildTemplateComponents(b) },
      }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: buildTextBody(b) } };

  const res = await fetch(`https://api.kapso.ai/meta/whatsapp/v24.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Kapso respondió ${res.status}: ${text}`);
  }
  return res.json();
}
```

Y el `module.exports` final del archivo:

```js
module.exports = { normalizePhone, buildTextBody, buildTemplateComponents, sendBookingWhatsApp };
```

- [ ] **Step 2: Correr toda la suite y verificar que nada se rompió**

Run: `cd functions && node --test && cd ..`
Expected: PASS (todos los tests existentes + los 5 nuevos de `whatsapp.test.js`)

- [ ] **Step 3: Commit**

```bash
git add functions/whatsapp.js
git commit -m "feat(functions): sendBookingWhatsApp — POST a la API de Kapso"
```

---

### Task 5: Disparar WhatsApp en paralelo al email desde `onBookingCreated`

**Files:**
- Modify: `functions/index.js`

- [ ] **Step 1: Agregar el import y los secrets nuevos**

En `functions/index.js`, reemplazar:

```js
const { sendBookingEmails } = require('./email.js');
const { buildPatientUpsert, countClubVisits } = require('./patients.js');

admin.initializeApp();
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const FROM_EMAIL = defineSecret('FROM_EMAIL');
const SHOP_EMAIL = defineSecret('SHOP_EMAIL');
```

por:

```js
const { sendBookingEmails } = require('./email.js');
const { sendBookingWhatsApp } = require('./whatsapp.js');
const { buildPatientUpsert, countClubVisits } = require('./patients.js');

admin.initializeApp();
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const FROM_EMAIL = defineSecret('FROM_EMAIL');
const SHOP_EMAIL = defineSecret('SHOP_EMAIL');
const KAPSO_API_KEY = defineSecret('KAPSO_API_KEY');
const KAPSO_PHONE_NUMBER_ID = defineSecret('KAPSO_PHONE_NUMBER_ID');
const WHATSAPP_MODE = defineSecret('WHATSAPP_MODE');
const WHATSAPP_TEMPLATE_NAME = defineSecret('WHATSAPP_TEMPLATE_NAME');
const WHATSAPP_TEMPLATE_LANG = defineSecret('WHATSAPP_TEMPLATE_LANG');
```

- [ ] **Step 2: Reemplazar el cuerpo de `onBookingCreated`**

Reemplazar todo el bloque de la función (desde `exports.onBookingCreated = onDocumentCreated(` hasta el `);` que la cierra) por:

```js
exports.onBookingCreated = onDocumentCreated(
  {
    document: 'bookings/{id}', region: 'southamerica-east1',
    secrets: [
      RESEND_API_KEY, FROM_EMAIL, SHOP_EMAIL,
      KAPSO_API_KEY, KAPSO_PHONE_NUMBER_ID, WHATSAPP_MODE, WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG,
    ],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const b = snap.data();

    const [emailResult, waResult] = await Promise.allSettled([
      sendBookingEmails(b, { apiKey: RESEND_API_KEY.value(), fromEmail: FROM_EMAIL.value(), shopEmail: SHOP_EMAIL.value() }),
      sendBookingWhatsApp(b, {
        apiKey: KAPSO_API_KEY.value(),
        phoneNumberId: KAPSO_PHONE_NUMBER_ID.value(),
        mode: WHATSAPP_MODE.value(),
        templateName: WHATSAPP_TEMPLATE_NAME.value(),
        templateLang: WHATSAPP_TEMPLATE_LANG.value(),
      }),
    ]);

    await snap.ref.update({
      emailStatus: emailResult.status === 'fulfilled' ? 'sent' : 'failed',
      whatsappStatus: waResult.status === 'fulfilled' ? 'sent' : 'failed',
    });

    if (emailResult.status === 'fulfilled') {
      logger.info('Emails enviados', { code: b.code });
    } else {
      logger.error('Fallo al enviar emails', emailResult.reason);
      await admin.firestore().collection('adminLog').add({
        action: 'email_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
      });
      // No relanzar: la reserva ya está guardada.
    }

    if (waResult.status === 'rejected') {
      logger.error('Fallo al enviar WhatsApp', waResult.reason);
      await admin.firestore().collection('adminLog').add({
        action: 'whatsapp_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
      });
      // No relanzar: mismo criterio que el email.
    }

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
      // No relanzar: la reserva y el email/WhatsApp ya se procesaron independientemente.
    }
  }
);
```

`exports.getClubStatus` queda sin cambios, debajo de este bloque.

- [ ] **Step 3: Correr toda la suite y verificar que nada se rompió**

Run: `cd functions && node --test && cd ..`
Expected: PASS (sin cambios en el conteo de tests — `index.js` no tiene unit tests directos, mismo patrón que hoy)

- [ ] **Step 4: Commit**

```bash
git add functions/index.js
git commit -m "feat(functions): disparar WhatsApp en paralelo al email en onBookingCreated"
```

---

### Task 6: Secrets nuevos en `.env.example`

**Files:**
- Modify: `functions/.env.example`

- [ ] **Step 1: Agregar las 4 variables nuevas**

Reemplazar el contenido de `functions/.env.example` por:

```
# Copia este archivo a functions/.env (gitignored) para pruebas locales con emuladores.
# En producción se cargan como secretos: firebase functions:secrets:set NOMBRE
RESEND_API_KEY=re_xxxxxxxxxxxx
FROM_EMAIL=reservas@scissorwhite.cl
SHOP_EMAIL=hola@scissorwhite.cl
KAPSO_API_KEY=kapso_sandbox_xxxxxxxxxxxx
KAPSO_PHONE_NUMBER_ID=xxxxxxxxxxxx
WHATSAPP_MODE=text
WHATSAPP_TEMPLATE_NAME=
WHATSAPP_TEMPLATE_LANG=
```

- [ ] **Step 2: Commit**

```bash
git add functions/.env.example
git commit -m "docs(functions): documentar los secrets de Kapso en .env.example"
```

---

### Task 7: Prueba manual en el sandbox de Kapso

**Files:** ninguno (verificación manual, sin cambios de código)

Este es el "módulo de pruebas" que pide el spec: validar el flujo completo contra el sandbox real de Kapso antes de dar por cerrado el trabajo.

- [ ] **Step 1: Registrar el número de prueba en el sandbox**

En el dashboard de Kapso: **WhatsApp → Sandbox**, registrar tu número de teléfono de prueba. Kapso envía un código de 6 caracteres; respóndelo como mensaje de WhatsApp al número del sandbox para activar la sesión.

- [ ] **Step 2: Configurar `functions/.env` local (gitignored)**

```bash
cp functions/.env.example functions/.env
```

Editar `functions/.env` con los valores reales:
```
KAPSO_API_KEY=<tu api key de Kapso>
KAPSO_PHONE_NUMBER_ID=<el phone_number_id del sandbox>
WHATSAPP_MODE=text
```

- [ ] **Step 3: Levantar el emulador**

Run: `firebase emulators:start`
Expected: emulador de Functions, Firestore y Hosting arriba (UI en `http://localhost:4000`, sitio en `http://localhost:5000`).

- [ ] **Step 4: Crear una reserva de prueba con el número registrado en el sandbox**

Desde `http://localhost:5000`, completar una reserva usando como teléfono el mismo número ya registrado en la sesión de sandbox (Step 1).

- [ ] **Step 5: Verificar el camino feliz**

Confirmar:
1. Llega el mensaje de WhatsApp de texto libre al número de prueba.
2. En la UI del emulador (`http://localhost:4000/firestore`), el doc en `bookings` correspondiente tiene `whatsappStatus: 'sent'`.

- [ ] **Step 6: Verificar el camino de error**

Crear una segunda reserva de prueba con un número **no** registrado en la sesión de sandbox. Confirmar:
1. El doc de `bookings` queda con `whatsappStatus: 'failed'`.
2. Se creó una entrada en `adminLog` con `action: 'whatsapp_failed'`.
3. El `emailStatus` de esa misma reserva sigue en `'sent'` (el fallo de WhatsApp no afecta al email).

- [ ] **Step 7: Anotar el resultado**

Si los 6 pasos anteriores se cumplen, el módulo de pruebas queda validado. Si algo falla, volver a **systematic-debugging** antes de continuar — no se pasa a producción con este flujo sin verificar.

---

## Runbook: secrets en producción (antes de `firebase deploy`)

**Importante:** `onBookingCreated` declara los 8 secrets en su array `secrets:`. Con Functions v2, el deploy de la función **falla completo** si alguno no existe en Secret Manager — incluyendo los de modo template aunque se use modo text. Como email y WhatsApp comparten la misma función, un secret de Kapso faltante también bloquea desplegar cualquier fix del canal de email. Antes del primer deploy con este módulo:

```bash
firebase functions:secrets:set KAPSO_API_KEY            # API key de Kapso
firebase functions:secrets:set KAPSO_PHONE_NUMBER_ID    # phone_number_id (sandbox o producción)
firebase functions:secrets:set WHATSAPP_MODE            # "text" (sandbox) | "template" (producción)
firebase functions:secrets:set WHATSAPP_TEMPLATE_NAME   # vacío/placeholder hasta tener plantilla aprobada
firebase functions:secrets:set WHATSAPP_TEMPLATE_LANG   # ej. "es" — vacío/placeholder hasta producción
```

(Los 3 de Resend — `RESEND_API_KEY`, `FROM_EMAIL`, `SHOP_EMAIL` — ya existen del plan de migración Firebase.)

## Fuera de alcance (de este plan, ya explícito en el spec)

- Avisos de cancelación/edición de reserva por WhatsApp.
- Aviso a la barbería por WhatsApp (sigue siendo solo email).
- Reintentos automáticos ante fallo de envío.
- Creación/aprobación real de la plantilla de WhatsApp en Kapso y el paso a `WHATSAPP_MODE=template` en producción — documentado en el spec como paso futuro, se hace cambiando secrets, sin tocar código.
