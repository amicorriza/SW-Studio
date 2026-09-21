# Encuesta de satisfacción post-atención + sorteo manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 10 minutos después de que el barbero marca "Finalizar atención", el cliente recibe un correo pidiendo calificar su visita (1-5 estrellas); responder lo deja en un sorteo mensual manual de 30% de descuento, separado de cualquier invitación a dejar reseña en Google.

**Architecture:** Mismo patrón exacto que el recordatorio de citas (`functions/reminders.js` + `sendBookingReminders`): un módulo puro que decide qué reservas están "debidas" (testeable sin emulador), una función programada que hace el I/O, un template de correo nuevo, y dos callables (lectura + escritura) que sirven una página standalone nueva. Nada de infraestructura nueva (reutiliza el índice `bookings(status, date)` que ya existe, el patrón de `onSchedule`, el patrón de correo con Resend).

**Tech Stack:** Firebase Cloud Functions v2 (Node 22), Resend, `node:test`. Spec de referencia: `docs/superpowers/specs/2026-09-20-encuesta-satisfaccion-design.md`.

---

## File Structure

| File | Change |
|---|---|
| `functions/surveys.js` | **Create.** Lógica pura: `findBookingsNeedingSurvey`. |
| `functions/test/surveys.test.js` | **Create.** Tests de `findBookingsNeedingSurvey`. |
| `functions/email.js` | **Modify.** Agrega `renderSurveyEmail`, `sendSurveyEmail`, helpers `surveyUrl`/`surveyStarsHtml`. |
| `functions/test/email.test.js` | **Modify.** Tests de `renderSurveyEmail`. |
| `functions/index.js` | **Modify.** Nuevo require de `surveys.js` y de `sendSurveyEmail`; `exports.sendSatisfactionSurveys` (programada); `exports.getBookingForSurvey` y `exports.submitSatisfactionSurvey` (callables). |
| `firestore.rules` | **Modify.** Nueva colección `surveys/{id}`. |
| `public/js/data.js` | **Modify.** Wrappers `getBookingForSurvey`/`submitSatisfactionSurvey`. |
| `public/encuesta.html` | **Create.** Página standalone, mismo patrón que `confirmar-cita.html`. |

Orden: Task 1 → Task 2 → Task 3 (depende de 1 y 2) → Task 4 (independiente de 1-3) → Task 5 (depende de 4, necesita los callables ya escritos para saber los campos exactos que devuelven).

---

### Task 1: `functions/surveys.js` — lógica pura (TDD)

**Files:**
- Create: `functions/surveys.js`
- Create: `functions/test/surveys.test.js`

- [ ] **Step 1: Escribir los tests (van a fallar porque `functions/surveys.js` no existe)**

Crear `functions/test/surveys.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { findBookingsNeedingSurvey, SURVEY_LEAD_MS, SURVEY_EXPIRY_MS } = require('../surveys.js');

const NOW = new Date('2026-09-20T15:00:00.000Z');

function booking(overrides) {
  return {
    _docId: 'b1',
    status: 'completed',
    endedAt: new Date(NOW.getTime() - 11 * 60000).toISOString(),
    ...overrides,
  };
}

test('una atención terminada hace 11 minutos está debida', () => {
  const out = findBookingsNeedingSurvey([booking()], NOW);
  assert.strictEqual(out.length, 1);
});

test('una atención terminada hace 9 minutos NO está debida todavía', () => {
  const out = findBookingsNeedingSurvey(
    [booking({ endedAt: new Date(NOW.getTime() - 9 * 60000).toISOString() })],
    NOW
  );
  assert.strictEqual(out.length, 0);
});

test('exactamente en el borde de 10 minutos SÍ está debida', () => {
  const out = findBookingsNeedingSurvey(
    [booking({ endedAt: new Date(NOW.getTime() - SURVEY_LEAD_MS).toISOString() })],
    NOW
  );
  assert.strictEqual(out.length, 1);
});

test('una atención terminada hace más de 24 horas ya no se manda', () => {
  const out = findBookingsNeedingSurvey(
    [booking({ endedAt: new Date(NOW.getTime() - SURVEY_EXPIRY_MS - 60000).toISOString() })],
    NOW
  );
  assert.strictEqual(out.length, 0);
});

test('exactamente en el borde de 24 horas ya no está debida (límite exclusivo)', () => {
  const out = findBookingsNeedingSurvey(
    [booking({ endedAt: new Date(NOW.getTime() - SURVEY_EXPIRY_MS).toISOString() })],
    NOW
  );
  assert.strictEqual(out.length, 0);
});

test('una reserva con surveySentAt ya no se vuelve a mandar', () => {
  const out = findBookingsNeedingSurvey(
    [booking({ surveySentAt: new Date().toISOString() })],
    NOW
  );
  assert.strictEqual(out.length, 0);
});

test('una reserva que no está completed se ignora', () => {
  const out = findBookingsNeedingSurvey([booking({ status: 'in_service' })], NOW);
  assert.strictEqual(out.length, 0);
});

test('endedAt corrupto no tumba el lote, y se reporta por onSkip', () => {
  const skipped = [];
  const out = findBookingsNeedingSurvey(
    [booking({ endedAt: 'no-es-una-fecha' }), booking({ _docId: 'b2' })],
    NOW,
    (id) => skipped.push(id)
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0]._docId, 'b2');
  assert.deepStrictEqual(skipped, ['b1']);
});

test('endedAt ausente se trata igual que corrupto, no revienta', () => {
  const out = findBookingsNeedingSurvey([booking({ endedAt: undefined })], NOW);
  assert.strictEqual(out.length, 0);
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd functions && node --test test/surveys.test.js`
Expected: FAIL — `Cannot find module '../surveys.js'`.

- [ ] **Step 3: Crear `functions/surveys.js`**

```js
// functions/surveys.js — lógica pura de la encuesta de satisfacción post-
// atención (10 min después de "Finalizar", tope de 24h). Sin dependencia de
// firebase-admin: mismo patrón que reminders.js, testeable con node --test
// sin emulador. functions/index.js hace todo el I/O (query a Firestore,
// envío de email) y le pasa a findBookingsNeedingSurvey() los datos ya
// leídos; esta función solo decide.
'use strict';

const SURVEY_LEAD_MS = 10 * 60 * 1000;
const SURVEY_EXPIRY_MS = 24 * 60 * 60 * 1000;

function msOf(value) {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

// Una encuesta es "debida" si la atención terminó (`completed` con
// `endedAt`) hace 10 minutos o más, todavía no se mandó (`surveySentAt`
// ausente) y no ha pasado más de 24h desde que terminó. A diferencia de
// reminders.js (donde una reserva "debida" lo sigue siendo indefinidamente
// porque la cita todavía no ocurre), acá SÍ hay techo: el evento ya pasó,
// y preguntar "¿cómo estuvo tu corte?" un día después ya no tiene sentido
// -- se descarta en vez de reintentar para siempre.
function findBookingsNeedingSurvey(bookings, now, onSkip) {
  const nowMs = now.getTime();
  return (bookings || []).filter((b) => {
    if (b.status !== 'completed') return false;
    if (b.surveySentAt) return false;
    try {
      const endedMs = msOf(b.endedAt);
      if (endedMs === null) throw new Error('endedAt inválido o ausente');
      const ageMs = nowMs - endedMs;
      return ageMs >= SURVEY_LEAD_MS && ageMs < SURVEY_EXPIRY_MS;
    } catch (e) {
      // Descartar es correcto -- no se puede decidir sin fecha -- pero en
      // silencio significa que un cliente nunca recibe su encuesta y no
      // queda rastro de por qué. El callback lo pone index.js; este módulo
      // no importa un logger para seguir siendo puro.
      if (typeof onSkip === 'function') onSkip(b && b._docId, e);
      return false;
    }
  });
}

module.exports = { SURVEY_LEAD_MS, SURVEY_EXPIRY_MS, findBookingsNeedingSurvey };
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd functions && node --test test/surveys.test.js`
Expected: `tests 9`, `pass 9`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add functions/surveys.js functions/test/surveys.test.js
git commit -m "$(cat <<'EOF'
feat(functions): agregar surveys.js (lógica pura de la encuesta de satisfacción)

findBookingsNeedingSurvey decide qué reservas completadas están
"debidas" para el correo de encuesta: 10 min o más desde endedAt,
sin surveySentAt, menos de 24h -- a diferencia de reminders.js, acá
sí hay techo porque el evento ya ocurrió. Mismo patrón puro y
testeable sin emulador que reminders.js/attendance.js.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

### Task 2: `functions/email.js` — `renderSurveyEmail` / `sendSurveyEmail` (TDD)

**Files:**
- Modify: `functions/email.js`
- Modify: `functions/test/email.test.js`

- [ ] **Step 1: Escribir los tests (van a fallar)**

En `functions/test/email.test.js`, agregar al final del archivo (antes del cierre, junto a los demás tests de render — usar el mismo fixture `booking` ya definido al principio del archivo):

```js
test('email de encuesta incluye nombre, servicio y profesional', () => {
  const { subject, html } = renderSurveyEmail(booking, 'abc123token');
  assert.match(subject, /SW-AB12345/);
  assert.match(html, /Juan Pérez/);
  assert.match(html, /Corte \+ Lavado Premium/);
  assert.match(html, /Felipe/);
});

test('email de encuesta trae 5 botones de estrella, cada uno con su rating y el mismo code\\/token', () => {
  const { html } = renderSurveyEmail(booking, 'abc123token');
  for (let n = 1; n <= 5; n++) {
    assert.match(html, new RegExp(`encuesta\\.html\\?code=SW-AB12345&t=abc123token&rating=${n}`));
  }
  // 5 estrellas rellenas es el botón destacado (1+2+3+4+5 = 15 caracteres '★' en total)
  assert.strictEqual((html.match(/★/g) || []).length, 15);
});

test('email de encuesta menciona el sorteo pero NUNCA la reseña de Google', () => {
  const { html } = renderSurveyEmail(booking, 'abc123token');
  assert.match(html, /sorteo mensual de un 30% de descuento/);
  assert.doesNotMatch(html, /[Rr]eseña/);
  assert.doesNotMatch(html, /[Gg]oogle/);
});

test('email de encuesta usa la foto real del sitio, no una imagen embebida', () => {
  const { html } = renderSurveyEmail(booking, 'abc123token');
  assert.match(html, /assets\/email\/hero-actual\.jpg/);
  assert.doesNotMatch(html, /data:image/);
});

test('los datos del cliente en el correo de encuesta se escapan para evitar inyección de HTML', () => {
  const { html } = renderSurveyEmail({ ...booking, name: 'Juan <script>alert(1)</script>' }, 'abc123token');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Juan &lt;script&gt;/);
});
```

Y actualizar el `require` del principio del archivo para incluir `renderSurveyEmail`:
```js
const { renderClientEmail, renderShopEmail, renderReminderEmail, renderReminderResponseEmail, renderConfirmationEmail, renderSurveyEmail, parseRecipients, assertResendOk } = require('../email.js');
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd functions && node --test test/email.test.js`
Expected: FAIL — `renderSurveyEmail is not a function`.

- [ ] **Step 3: Agregar `renderSurveyEmail`/`sendSurveyEmail` a `functions/email.js`**

Ubicar el cierre de `renderConfirmationEmail` (busca `// Correo al CLIENTE después de que confirma su asistencia` y el `}` que cierra esa función) y agregar justo después:

```js
// URL de una calificación de la encuesta de satisfacción -- code+token
// reutilizan el mismo reminderToken que ya usa el resto del flujo de
// confirmar/declinar (mismo criterio: un cliente puede usar el link de
// cualquier correo suyo mientras el token siga siendo válido). `rating`
// solo precarga la selección en encuesta.html -- el cliente puede
// cambiarla ahí antes de enviar.
function surveyUrl(code, token, rating) {
  return `${SITE_URL}/encuesta.html?code=${encodeURIComponent(code)}&t=${encodeURIComponent(token)}&rating=${rating}`;
}

// Fila de 5 botones de estrellas (1 a 5) para el correo de encuesta de
// satisfacción -- el de 5 va destacado (fondo negro), mismo criterio visual
// que un botón primario en el resto de los correos.
function surveyStarsHtml(code, token) {
  const cell = (n, primary) => `<td class="star-col" width="20%" style="padding:0 4px"><a href="${surveyUrl(code, token, n)}" style="display:block;text-align:center;text-decoration:none;padding:16px 0;border:1px solid ${primary ? '#111111' : '#e0e4e8'};border-radius:8px;${primary ? 'background:#111111;' : ''}color:${primary ? '#ffffff' : '#111111'}"><span style="font-size:22px;display:block;line-height:1;${primary ? 'color:#ffffff' : ''}">${'★'.repeat(n)}</span></a></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed"><tr>${[1, 2, 3, 4, 5].map((n) => cell(n, n === 5)).join('')}</tr></table>`;
}

// Template "SW Studio — Encuesta de satisfacción": correo que dispara
// exports.sendSatisfactionSurveys 10 minutos después de que el barbero
// marca "Finalizar atención" (functions/surveys.js). NO reutiliza
// renderNewDesignShell -- ese shell está armado para una cita FUTURA
// (número de hora grande, aviso de ventana de cambios de 3h); acá se avisa
// sobre una visita que YA terminó, así que este correo tiene su propio
// shell, más compacto (pensado para caber en una pantalla sin scroll --
// diseño validado con Aldo vía mockup visual durante el brainstorming del
// 2026-09-20, ver docs/superpowers/specs/2026-09-20-encuesta-satisfaccion-design.md).
// El premio del sorteo se menciona SIN mencionar la reseña de Google a
// propósito -- condicionar el premio a dejar una reseña viola las
// políticas de Google (riesgo real: eliminación de reseñas o suspensión de
// la ficha). La invitación a reseñar vive aparte, en encuesta.html,
// después de responder, sin condicionar nada.
function renderSurveyEmail(b, token) {
  const svcName = esc(b.svcName || 'tu servicio');
  const barberName = esc(b.barberName || 'nuestro equipo');
  const subject = `¿Cómo estuvo tu visita a SW Studio? — ${b.code}`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>SW Studio</title><link href="https://fonts.googleapis.com/css2?family=Audiowide&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><style>body,table,td,a{font-family:${NEW_SANS}}table{border-collapse:collapse;text-align:left}a:focus-visible{outline:3px solid #6A7888;outline-offset:4px}@media(max-width:480px){.pad{padding-left:24px!important;padding-right:24px!important}.headline{font-size:28px!important}.star-col{padding:0 2px!important}}</style></head><body style="margin:0;padding:0;background:#eef0f2;color:#111111"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">Tu opinión nos ayuda a mejorar — cuéntanos cómo estuvo tu visita, toma 30 segundos.</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef0f2"><tr><td align="center" style="padding:16px 10px"><!--[if mso]><table role="presentation" width="600"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fafafa" bgcolor="#fafafa">
<tr><td class="pad" style="padding:20px 36px;border-bottom:1px solid #d7dce2"><table role="presentation" width="100%"><tr><td style="vertical-align:middle"><img src="${SITE_URL}/assets/logo.png" width="46" alt="SW Studio" style="display:block;width:46px;height:auto;border:0"></td><td align="right" style="font-size:11px;letter-spacing:2px;color:#505965;vertical-align:middle">SCISSOR WHITE<br><span style="font-size:10px;line-height:20px">CONCEPCIÓN</span></td></tr></table></td></tr>
<tr><td background="${EMAIL_HERO_URL}" bgcolor="#24282d" width="600" height="200" valign="bottom" style="height:200px;background-color:#24282d;background-image:url('${EMAIL_HERO_URL}');background-size:cover;background-position:center 58%;background-repeat:no-repeat;padding:0;text-align:left">
<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:200px;"><v:fill type="frame" src="${EMAIL_HERO_URL}" color="#24282d"/><v:textbox inset="0,0,0,0"><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" height="200"><tr><td valign="bottom" style="background:linear-gradient(to top,rgba(10,10,10,.78) 20%,rgba(10,10,10,0));padding:22px 36px" height="200"><p style="margin:0 0 4px;font-size:10px;line-height:1.4;letter-spacing:2px;color:#dce2e9">SCISSOR WHITE · CONCEPCIÓN</p><p style="margin:0;font-size:22px;line-height:1.25;font-weight:600;color:#ffffff">Gracias por confiar<br>en nosotros.</p></td></tr></table>
<!--[if gte mso 9]></v:textbox></v:rect><![endif]--></td></tr>
<tr><td class="pad" style="padding:28px 36px 6px"><p style="margin:0 0 12px;font-size:10px;font-weight:700;letter-spacing:2px;color:#596676">TU OPINIÓN</p><h1 class="headline" style="font-family:${NEW_DISPLAY};font-size:32px;line-height:1.18;letter-spacing:-.8px;margin:0 0 14px;color:#111111">¿Cómo estuvo<br><em style="font-style:normal;background:linear-gradient(115deg,#5C6878,#9AAABB,#3A4452);-webkit-background-clip:text;background-clip:text;color:transparent">tu visita?</em></h1><p style="font-size:15px;line-height:1.65;margin:0;color:#3a3a3a">Hola, ${esc(b.name)} — gracias por venir. Cuéntanos en 30 segundos cómo estuvo tu <strong>${svcName}</strong> con <strong>${barberName}</strong>.</p></td></tr>
<tr><td class="pad" style="padding:24px 36px 6px"><p style="margin:0 0 14px;font-size:10.5px;letter-spacing:1.8px;color:#596676;text-align:center">TOCA TU CALIFICACIÓN</p>${surveyStarsHtml(b.code, token)}</td></tr>
<tr><td class="pad" style="padding:16px 36px 26px"><p style="margin:0;text-align:center;font-size:12px;line-height:1.6;color:#8a94a1">Responder te deja participando en el sorteo mensual de un 30% de descuento en tu próximo corte.</p></td></tr>
<tr><td class="pad" style="padding:20px 36px;background:#111111;color:#ffffff"><table role="presentation" width="100%"><tr><td style="font-size:13px;color:#c8d0da">Más que cortes,<br><strong style="color:#ffffff">creamos identidad.</strong></td><td align="right" valign="bottom" style="font-size:11px;color:#8a94a1"><a href="${SITE_URL}" style="color:#8a94a1;text-decoration:none">scissorwhite.cl</a></td></tr></table></td></tr>
</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  return { subject, html };
}

async function sendSurveyEmail(b, token, { apiKey, fromEmail }) {
  const resend = new Resend(apiKey);
  const { subject, html } = renderSurveyEmail(b, token);
  const result = await resend.emails.send({ from: fromEmail, to: b.email, subject, html });
  assertResendOk([result]);
}
```

En `module.exports` al final del archivo, agregar `renderSurveyEmail, sendSurveyEmail`:
```js
module.exports = {
  renderClientEmail, renderShopEmail, renderReminderEmail, renderReminderResponseEmail,
  renderConfirmationEmail, renderSurveyEmail, sendConfirmationEmail,
  sendBookingEmails, sendReminderEmail, sendReminderResponseEmail, sendSurveyEmail, parseRecipients, assertResendOk,
};
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd functions && node --test test/email.test.js`
Expected: todos los tests pasan, incluidos los 5 nuevos. Ningún test de `renderClientEmail`/`renderReminderEmail`/etc. debe romperse.

- [ ] **Step 5: Commit**

```bash
git add functions/email.js functions/test/email.test.js
git commit -m "$(cat <<'EOF'
feat(email): agregar renderSurveyEmail/sendSurveyEmail

Correo de encuesta de satisfacción post-atención: shell propio, más
compacto que renderNewDesignShell (esa está armada para una cita
futura, no para avisar sobre una visita que ya terminó). 5 botones
de estrella, cada uno precarga la calificación en encuesta.html.
Menciona el sorteo sin mencionar la reseña de Google a propósito --
condicionar el premio a dejar una reseña viola las políticas de
Google.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

### Task 3: `functions/index.js` — `exports.sendSatisfactionSurveys` (programada)

**Depends on:** Task 1 y Task 2 ya committeados.

**Files:**
- Modify: `functions/index.js`

- [ ] **Step 1: Agregar los requires nuevos**

Reemplazar (línea ~12, el require de `email.js`):
```js
const { sendBookingEmails, sendReminderEmail, sendReminderResponseEmail, sendConfirmationEmail } = require('./email.js');
```
con:
```js
const { sendBookingEmails, sendReminderEmail, sendReminderResponseEmail, sendConfirmationEmail, sendSurveyEmail } = require('./email.js');
```

Reemplazar (línea ~18, el require de `reminders.js`):
```js
const { REMINDER_LEAD_MS, REMINDER_WINDOW_MS, generateReminderToken, findBookingsNeedingReminder } = require('./reminders.js');
```
con:
```js
const { REMINDER_LEAD_MS, REMINDER_WINDOW_MS, generateReminderToken, findBookingsNeedingReminder } = require('./reminders.js');
const { findBookingsNeedingSurvey } = require('./surveys.js');
```

- [ ] **Step 2: Confirmar el punto de inserción**

Run: `grep -n "^exports.respondToBookingReminder = onCall" functions/index.js`

La nueva función programada va justo ANTES de esa línea (después del cierre de `exports.sendBookingReminders`, antes del comentario `// respondToBookingReminder:`).

- [ ] **Step 3: Agregar `exports.sendSatisfactionSurveys`**

Justo antes del comentario `// respondToBookingReminder: el cliente nunca puede leer ni escribir` (y su `exports.respondToBookingReminder`), insertar:

```js
// ══ ENCUESTA DE SATISFACCIÓN POST-ATENCIÓN ══
// 10 minutos después de que el barbero marca "Finalizar atención"
// (functions/shared/attendance.js, acción `end` -> status:'completed' +
// endedAt), se manda un correo pidiendo calificar la visita. Responder deja
// al cliente en un sorteo MENSUAL Y MANUAL de un 30% de descuento -- el
// sistema solo guarda la respuesta en `surveys/{id}`; Aldo revisa esa
// colección en la consola de Firebase para elegir al ganador. Cero canje de
// cupón, cero automatización del sorteo (decisión explícita, ver
// docs/superpowers/specs/2026-09-20-encuesta-satisfaccion-design.md). El
// premio NUNCA se menciona junto a la reseña de Google -- condicionarlo
// violaría las políticas de Google.
//
// Mismo criterio de resiliencia que sendBookingReminders: "debido" en vez
// de ventana de coincidencia única (findBookingsNeedingSurvey tiene techo
// de 24h porque el evento ya ocurrió, a diferencia de una cita futura).
exports.sendSatisfactionSurveys = onSchedule(
  { schedule: 'every 5 minutes', region: 'southamerica-east1', secrets: [RESEND_API_KEY, FROM_EMAIL] },
  async () => {
    try {
      const db = getFirestore(app);
      const now = new Date();
      const businessInfoSnap = await db.collection('businessInfo').doc('main').get();
      const businessInfoData = businessInfoSnap.exists ? businessInfoSnap.data() : null;

      // Interruptor de seguridad, mismo patrón que remindersEnabled/
      // nudgesEnabled: por defecto (campo ausente) no manda nada.
      if (!businessInfoData || businessInfoData.surveysEnabled !== true) {
        logger.info('sendSatisfactionSurveys: surveysEnabled no está activado, no se envía nada esta corrida.');
        return;
      }

      const businessTz = resolveBusinessTz(businessInfoData);

      // Ventana amplia por fecha calendario (reutiliza el índice
      // bookings(status, date) que ya existe -- no hace falta declarar uno
      // nuevo): desde ayer hasta mañana en la zona del negocio, cubre
      // sobra cualquier atención terminada dentro de las últimas 24h+ sin
      // importar en qué `date` calendario quedó agendada originalmente.
      const startDateKey = dateKeyInZone(new Date(now.getTime() - 24 * 60 * 60 * 1000), businessTz);
      const { end: endBound } = dayBoundsOf(dateKeyInZone(now, businessTz));

      const snap = await db.collection('bookings')
        .where('status', '==', 'completed')
        .where('date', '>=', startDateKey)
        .where('date', '<', endBound)
        .get();

      const items = snap.docs
        .map((d) => ({ ref: d.ref, data: { ...d.data(), _docId: d.id } }))
        .filter((item) => !item.data.surveySentAt);
      const itemsByDocId = new Map(items.map((item) => [item.data._docId, item]));
      const toSendData = findBookingsNeedingSurvey(items.map((item) => item.data), now,
        (id, err) => logger.error('Reserva ilegible al buscar encuestas de satisfacción', {
          bookingId: id || null, message: (err && err.message) || String(err),
        }));
      const toSend = toSendData.map((b) => itemsByDocId.get(b._docId)).filter(Boolean);

      for (const item of toSend) {
        const b = item.data;
        // Sin email no hay a quién encuestar -- mismo criterio que
        // onBookingCreated/sendBookingReminders.
        if (!b.email) continue;
        // Reutiliza el mismo reminderToken que ya tiene la reserva --
        // mismo criterio que sendBookingReminders: nunca se genera uno
        // nuevo, para que el cliente pueda usar el link de cualquiera de
        // sus correos indistintamente.
        const token = b.reminderToken;
        if (!token) continue; // no debería pasar -- toda reserva trae reminderToken desde su creación
        try {
          await sendSurveyEmail(b, token, {
            apiKey: RESEND_API_KEY.value(),
            fromEmail: FROM_EMAIL.value(),
          });
          await item.ref.update({ surveySentAt: new Date().toISOString() });
          logger.info('Encuesta de satisfacción enviada', { code: b.code });
        } catch (err) {
          logger.error('Fallo al enviar encuesta de satisfacción', err);
          // No relanzar: un fallo individual no debe abortar el resto de
          // la corrida, y como surveySentAt nunca se escribió, la corrida
          // siguiente (5 min después) reintenta -- mientras siga dentro de
          // la ventana de 24h de findBookingsNeedingSurvey.
        }
      }
    } catch (err) {
      logger.error('Fallo la corrida de sendSatisfactionSurveys', err);
    }
  }
);

```

- [ ] **Step 4: Verificar que el archivo sigue siendo JS válido**

Run: `cd functions && node --check index.js`
Expected: sin salida (exit 0).

- [ ] **Step 5: Correr toda la suite para confirmar que nada se rompió**

Run: `cd functions && node --test`
Expected: todos los tests pasan (los nuevos de `surveys.test.js`/`email.test.js` de las Tasks 1-2, más los que ya existían).

- [ ] **Step 6: Commit**

```bash
git add functions/index.js
git commit -m "$(cat <<'EOF'
feat(functions): agregar sendSatisfactionSurveys (encuesta cada 5 min)

Función programada que reutiliza findBookingsNeedingSurvey y
sendSurveyEmail para mandar la encuesta 10 min después de que una
atención se marca completed. Mismo patrón de resiliencia y el mismo
interruptor de seguridad (surveysEnabled, apagado por defecto) que
sendBookingReminders/remindersEnabled. Reutiliza el índice
bookings(status, date) que ya existe -- sin índice nuevo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

### Task 4: `functions/index.js` + `firestore.rules` — callables `getBookingForSurvey`/`submitSatisfactionSurvey`

**Files:**
- Modify: `functions/index.js`
- Modify: `firestore.rules`

- [ ] **Step 1: Confirmar el punto de inserción**

Run: `grep -n "^exports.getBookingForReminderAction = onCall" -A 25 functions/index.js`

Los callables nuevos van justo DESPUÉS del cierre de `exports.getBookingForReminderAction` (antes del comentario `// ══ RESEÑAS DE GOOGLE ══`).

- [ ] **Step 2: Agregar los dos callables**

Insertar, después del cierre de `exports.getBookingForReminderAction` y antes de `// ══ RESEÑAS DE GOOGLE ══`:

```js
// getBookingForSurvey: lectura de solo lo necesario para pintar
// encuesta.html antes de que el cliente responda. Mismo criterio de
// búsqueda por reminderToken que getBookingForReminderAction -- nunca por
// `code` solo, nunca devuelve el token de vuelta. Solo permite encuestar
// reservas ya `completed` (si alguien abre un link de encuesta de una
// reserva que por lo que sea no llegó a completarse, no tiene sentido
// preguntarle cómo estuvo). `writeReviewUri` sale de googleReviews/main --
// lectura best-effort: si el doc no existe o no tiene el campo, se
// devuelve '' y encuesta.html simplemente no muestra el link de reseña.
exports.getBookingForSurvey = onCall(
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
    if (b.status !== 'completed') {
      throw new HttpsError('failed-precondition', 'Esta encuesta ya no está disponible.');
    }

    let writeReviewUri = '';
    try {
      const reviewsSnap = await db.collection('googleReviews').doc('main').get();
      if (reviewsSnap.exists) writeReviewUri = reviewsSnap.data().writeReviewUri || '';
    } catch (err) {
      logger.error('No se pudo leer googleReviews/main para encuesta.html', err);
    }

    return {
      code: b.code, svcName: b.svcName, barberName: b.barberName,
      alreadyAnswered: !!b.surveyResponseAt, writeReviewUri,
    };
  }
);

// submitSatisfactionSurvey: guarda la respuesta de la encuesta. Idempotente
// -- un segundo envío (recargar encuesta.html, o volver a tocar el link del
// correo) no crea una segunda fila en `surveys`, cae en la rama `already`.
// `comment` se recorta a 500 caracteres -- suficiente para un comentario
// real, evita un payload arbitrariamente grande.
exports.submitSatisfactionSurvey = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const data = request.data || {};
    const code = typeof data.code === 'string' ? data.code.trim() : '';
    const token = typeof data.token === 'string' ? data.token.trim() : '';
    const rating = Number(data.rating);
    const comment = typeof data.comment === 'string' ? data.comment.trim().slice(0, 500) : '';
    if (!token || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new HttpsError('invalid-argument', 'Datos inválidos.');
    }

    const db = getFirestore(app);
    const snap = await db.collection('bookings').where('reminderToken', '==', token).limit(1).get();
    if (snap.empty || snap.docs[0].data().code !== code) {
      throw new HttpsError('not-found', 'No encontramos esa reserva.');
    }

    const doc = snap.docs[0];
    const b = doc.data();
    if (b.status !== 'completed') {
      throw new HttpsError('failed-precondition', 'Esta encuesta ya no está disponible.');
    }
    if (b.surveyResponseAt) {
      return { ok: true, already: true };
    }

    const nowISO = new Date().toISOString();
    await db.collection('surveys').add({
      bookingId: doc.id, code: b.code, rating, comment,
      clientName: b.name || '', clientEmail: b.email || '',
      submittedAt: nowISO,
    });
    await doc.ref.update({ surveyResponseAt: nowISO });

    return { ok: true, already: false };
  }
);

```

- [ ] **Step 3: Agregar la regla de Firestore para `surveys`**

En `firestore.rules`, justo después de la línea `match /patients/{id} { allow read, write: if isAdmin(); }`, insertar:

```
    // Respuestas de la encuesta de satisfacción post-atención. Nadie
    // escribe directo -- todo pasa por submitSatisfactionSurvey (Admin
    // SDK). Solo lectura admin: trae PII (nombre, correo) y es lo que
    // Aldo revisa a mano para el sorteo mensual.
    match /surveys/{id} { allow read: if isAdmin(); allow write: if false; }
```

- [ ] **Step 4: Verificar que ambos archivos siguen siendo válidos**

Run:
```bash
cd functions && node --check index.js
node -e "require('fs').readFileSync('../firestore.rules','utf8')" # solo confirma que el archivo se puede leer, la sintaxis CEL la valida el deploy
```
Expected: sin errores.

- [ ] **Step 5: Correr toda la suite de `functions`**

Run: `cd functions && node --test`
Expected: todos los tests pasan (esta tarea no agrega tests unitarios propios -- los callables se prueban vía la página en la Task 5 y con verificación manual, ver el spec).

- [ ] **Step 6: Commit**

```bash
git add functions/index.js firestore.rules
git commit -m "$(cat <<'EOF'
feat(functions): agregar getBookingForSurvey/submitSatisfactionSurvey

Mismo patrón que getBookingForReminderAction/respondToBookingReminder:
búsqueda por reminderToken, nunca por code solo, nunca devuelve el
token de vuelta, idempotente. Solo permite encuestar reservas ya
completed. surveys/{id} queda admin-only para lectura (tiene PII) y
sin escritura directa -- todo pasa por el callable.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

### Task 5: `public/encuesta.html` — página standalone

**Depends on:** Task 4 (necesita `getBookingForSurvey`/`submitSatisfactionSurvey` ya escritos).

**Files:**
- Modify: `public/js/data.js`
- Create: `public/encuesta.html`

- [ ] **Step 1: Confirmar el texto actual en `public/js/data.js`**

Run: `grep -n "async function respondToBookingReminder" -A5 public/js/data.js`
Expected:
```
XXXX:async function respondToBookingReminder(code, token, action) {
XXXX:  const call = httpsCallable(functions, 'respondToBookingReminder');
XXXX:  const { data } = await call({ code, token, action });
XXXX:  return data; // { ok, already, status }
XXXX:}
```

- [ ] **Step 2: Agregar los wrappers de los dos callables nuevos**

Justo después del cierre de `respondToBookingReminder` (y antes del comentario `// Disponibilidad real en tiempo real...`), insertar:

```js
// Lectura de solo lo necesario para pintar encuesta.html. Nunca devuelve
// reminderToken. Mismo patrón que getBookingForReminderAction.
async function getBookingForSurvey(code, token) {
  const call = httpsCallable(functions, 'getBookingForSurvey');
  const { data } = await call({ code, token });
  return data; // { code, svcName, barberName, alreadyAnswered, writeReviewUri }
}

// Guarda la respuesta de la encuesta de satisfacción. `rating` es 1-5,
// `comment` es opcional. Idempotente: un segundo envío devuelve
// { ok:true, already:true } sin crear una segunda fila en `surveys`.
async function submitSatisfactionSurvey(code, token, rating, comment) {
  const call = httpsCallable(functions, 'submitSatisfactionSurvey');
  const { data } = await call({ code, token, rating, comment });
  return data; // { ok, already }
}
```

- [ ] **Step 3: Agregar los dos nombres a las dos listas de exports**

Reemplazar (aparece dos veces en el archivo — una vez en el export default/objeto, una vez en el `export {}` con nombre — hay que cambiar las DOS ocurrencias):
```js
  getBookingForReminderAction, respondToBookingReminder,
```
con:
```js
  getBookingForReminderAction, respondToBookingReminder, getBookingForSurvey, submitSatisfactionSurvey,
```

- [ ] **Step 4: Verificar**

Run:
```bash
grep -c "async function getBookingForSurvey\|async function submitSatisfactionSurvey" public/js/data.js
grep -c "getBookingForSurvey, submitSatisfactionSurvey" public/js/data.js
```
Expected: `2` y `2` (las dos funciones definidas, y las dos apariciones en las listas de export).

- [ ] **Step 5: Crear `public/encuesta.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tu opinión — SW Studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Audiowide&family=Orbitron:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=Barlow+Condensed:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#0A0A0A; --white:#FAFAFA; --off:#F4F4F4;
    --g100:#F0F0F0; --g200:#E0E0E0; --g300:#C8C8C8;
    --text:#111; --body:#1E1E1E; --meta:#505050;
    --steel-border:linear-gradient(135deg,#A8B2BE 0%,#DFE4EA 50%,#A0AAB8 100%);
    --steel-dark:#6A7888; --err:#C44545;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--white);color:var(--text);font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;flex-direction:column}
  [hidden]{display:none!important}

  header{background:var(--ink);padding:16px 24px;display:flex;align-items:center;justify-content:center;gap:12px}
  header img{width:34px;height:34px;border-radius:50%;object-fit:cover;background:#fff}
  header span{font-family:'Audiowide','Orbitron',sans-serif;font-size:15px;letter-spacing:.04em;color:#fff;text-transform:uppercase}

  main{flex:1;display:flex;align-items:center;justify-content:center;padding:32px 20px}
  .es-card{width:100%;max-width:460px;text-align:center}

  .es-msg{font-size:15px;color:var(--body);line-height:1.6}
  .es-msg.err{color:var(--err);font-weight:500}

  .es-icon{
    width:64px;height:64px;border-radius:50%;margin:0 auto 20px;
    background-image:linear-gradient(#fff,#fff),var(--steel-border);
    background-origin:border-box;background-clip:padding-box,border-box;
    border:2px solid transparent;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 8px 28px -8px rgba(120,130,145,.3);color:var(--ink)
  }

  h1{font-family:'Orbitron',sans-serif;font-size:clamp(20px,4vw,26px);font-weight:500;margin:0 0 10px;line-height:1.15}
  .es-sub{font-size:14px;color:var(--body);line-height:1.6;margin:0 0 22px}

  .es-stars{display:flex;gap:8px;justify-content:center;margin-bottom:22px}
  .es-star{
    width:52px;height:52px;border-radius:10px;border:1.5px solid var(--g200);
    background:#fff;display:flex;align-items:center;justify-content:center;
    font-size:22px;cursor:pointer;color:var(--g300);transition:all .15s
  }
  .es-star.on{border-color:var(--ink);background:var(--ink);color:#fff}

  textarea{
    width:100%;min-height:80px;border:1.5px solid var(--g200);border-radius:10px;
    padding:12px 14px;font-family:'Inter',sans-serif;font-size:14px;color:var(--text);
    resize:vertical;margin-bottom:18px
  }

  .es-btn{
    width:100%;font-family:'Barlow Condensed',sans-serif;
    font-size:12px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;
    padding:14px 22px;border-radius:7px;border:1.5px solid var(--ink);
    background:var(--ink);color:#fff;cursor:pointer;transition:all .2s
  }
  .es-btn:hover:not(:disabled){background:transparent;color:var(--ink)}
  .es-btn:disabled{background:var(--g200);color:var(--g300);border-color:var(--g200);cursor:not-allowed}

  .es-review{margin-top:20px;font-size:13px;color:var(--meta)}
  .es-review a{color:var(--ink)}
</style>
</head>
<body>
<header>
  <img src="/assets/logo.png" alt="SW Studio">
  <span>SW Studio</span>
</header>
<main>
  <div class="es-card">
    <div id="es-loading" class="es-msg">Cargando…</div>
    <div id="es-error" class="es-msg err" hidden></div>
    <div id="es-form" hidden>
      <h1>¿Cómo estuvo tu visita?</h1>
      <p class="es-sub" id="es-sub"></p>
      <div class="es-stars" id="es-stars"></div>
      <textarea id="es-comment" placeholder="¿Algo que quieras contarnos? (opcional)"></textarea>
      <button class="es-btn" id="es-submit">Enviar</button>
    </div>
    <div id="es-done" hidden>
      <div class="es-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 10 18 20 6"/></svg>
      </div>
      <h1>¡Gracias por tu opinión!</h1>
      <p class="es-sub">Quedaste participando en el sorteo mensual de un 30% de descuento en tu próximo corte.</p>
      <p class="es-review" id="es-review-note" hidden>¿Nos dejarías también <a id="es-review-link" href="#" target="_blank" rel="noopener">una reseña en Google</a>?</p>
    </div>
    <div id="es-already" hidden>
      <div class="es-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 10 18 20 6"/></svg>
      </div>
      <h1>Ya recibimos tu opinión</h1>
      <p class="es-sub">¡Gracias! No hace falta que respondas de nuevo.</p>
    </div>
  </div>
</main>
<script type="module">
  import { getBookingForSurvey, submitSatisfactionSurvey } from './js/data.js';

  const params = new URLSearchParams(location.search);
  const code = params.get('code') || '';
  const token = params.get('t') || '';
  const initialRating = Math.min(5, Math.max(1, Number(params.get('rating')) || 5));
  let rating = initialRating;

  const els = {
    loading: document.getElementById('es-loading'),
    error: document.getElementById('es-error'),
    form: document.getElementById('es-form'),
    sub: document.getElementById('es-sub'),
    stars: document.getElementById('es-stars'),
    comment: document.getElementById('es-comment'),
    submit: document.getElementById('es-submit'),
    done: document.getElementById('es-done'),
    already: document.getElementById('es-already'),
    reviewNote: document.getElementById('es-review-note'),
    reviewLink: document.getElementById('es-review-link'),
  };

  function showError(msg) {
    els.loading.hidden = true;
    els.error.hidden = false;
    els.error.textContent = msg;
  }

  function renderStars() {
    els.stars.innerHTML = '';
    for (let n = 1; n <= 5; n++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'es-star' + (n <= rating ? ' on' : '');
      btn.textContent = '★';
      btn.addEventListener('click', () => { rating = n; renderStars(); });
      els.stars.appendChild(btn);
    }
  }

  async function init() {
    if (!code || !token) {
      showError('Este link no es válido.');
      return;
    }
    let booking;
    try {
      booking = await getBookingForSurvey(code, token);
    } catch (e) {
      showError('No pudimos cargar la encuesta. El link puede haber expirado.');
      return;
    }

    els.loading.hidden = true;

    if (booking.alreadyAnswered) {
      els.already.hidden = false;
      return;
    }

    els.sub.textContent = `Tu ${booking.svcName || 'visita'} con ${booking.barberName || 'nuestro equipo'}.`;
    if (booking.writeReviewUri) {
      els.reviewLink.href = booking.writeReviewUri;
    }
    renderStars();
    els.form.hidden = false;
    els.submit.addEventListener('click', onSubmit);
  }

  async function onSubmit() {
    els.submit.disabled = true;
    els.submit.textContent = 'Enviando…';
    try {
      await submitSatisfactionSurvey(code, token, rating, els.comment.value.trim());
      els.form.hidden = true;
      els.done.hidden = false;
      if (els.reviewLink.href && els.reviewLink.href !== location.href) {
        els.reviewNote.hidden = false;
      }
    } catch (e) {
      els.submit.disabled = false;
      els.submit.textContent = 'Enviar';
      showError('No pudimos registrar tu respuesta. Intenta de nuevo.');
    }
  }

  init();
</script>
</body>
</html>
```

- [ ] **Step 6: Verificar que el archivo es HTML bien formado**

Run: `node -e "require('fs').readFileSync('public/encuesta.html','utf8')" && echo "archivo legible"`
(No hay validador de HTML en el proyecto — esta verificación solo confirma que el archivo existe y se puede leer; la Step 4 es la que realmente importa.)

- [ ] **Step 7: Verificación manual (no automatizable sin emulador + Resend real)**

1. Levantar el emulador o abrir el archivo sirviéndolo desde `public/` (no `file://`, por cómo `js/data.js` resuelve Firebase).
2. Simular la URL con parámetros de una reserva de prueba real: `/encuesta.html?code=XXX&t=YYY&rating=5`.
3. Confirmar que carga el resumen del servicio/profesional, que las estrellas muestran la calificación 5 preseleccionada y se pueden cambiar, que enviar funciona, y que recargar la misma URL después de enviar muestra "Ya recibimos tu opinión" en vez de dejar enviar de nuevo.
4. Si `googleReviews/main.writeReviewUri` existe, confirmar que el link de reseña aparece en la pantalla de gracias.

- [ ] **Step 8: Commit**

```bash
git add public/encuesta.html public/js/data.js
git commit -m "$(cat <<'EOF'
feat(web): agregar encuesta.html (encuesta de satisfacción post-atención)

Mismo patrón que confirmar-cita.html: standalone, code+token en la
URL, type="module" contra js/data.js. La calificación llega
preseleccionada desde el correo pero se puede cambiar. Tras enviar,
invita aparte (sin condicionar el sorteo) a dejar una reseña en
Google si el negocio ya tiene writeReviewUri cacheado.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

## Verificación manual final

1. Activar `businessInfo.surveysEnabled = true` en staging.
2. Completar una atención de prueba de punta a punta (marcar Finalizar en la PWA del barbero) y confirmar que, ~10-15 minutos después, llega el correo con el diseño validado.
3. Tocar cada una de las 5 estrellas del correo (en reservas de prueba distintas, o revisando el link antes de tocarlo) y confirmar que cada una precarga la calificación correcta en `encuesta.html`.
4. Enviar la encuesta y confirmar en la consola de Firebase que apareció un documento nuevo en `surveys/` con los datos correctos, y que la reserva quedó con `surveyResponseAt`.
5. Confirmar que un segundo intento (recargar `encuesta.html` con la misma URL) muestra "Ya recibimos tu opinión" y no duplica el documento en `surveys/`.
