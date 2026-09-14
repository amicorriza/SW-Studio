# Confirmar/Declinar solo desde el recordatorio de 24h — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quitar los botones Confirmar/Declinar del correo de "reserva recibida" (`renderClientEmail`) para que confirmar/declinar la asistencia solo sea posible desde el recordatorio de 24h antes (`renderReminderEmail`).

**Architecture:** `renderClientEmail` deja de recibir `token` y de armar los links de confirmar/declinar; su `belowRowsHtml` queda solo con la nota de WhatsApp. `sendBookingEmails` deja de recibir/reenviar `token`. `onBookingCreated` (el único llamador) ajusta su llamada. La generación y persistencia de `reminderToken` en el doc de la reserva no cambia — sigue haciendo falta para `sendBookingReminders`.

**Tech Stack:** Firebase Cloud Functions v2 (Node 22), `node:test` (sin framework), spec de referencia: `docs/superpowers/specs/2026-09-14-confirmacion-solo-recordatorio-design.md`.

---

## File Structure

| File | Change |
|---|---|
| `functions/email.js` | **Modify.** `renderClientEmail(b)` pierde el parámetro `token` y los botones; nuevo copy de preheader/intro. `sendBookingEmails(b, {...})` pierde el parámetro `token`. Comentarios de `renderClientEmail`, `confirmDeclineButtonsHtml` y `confirmDeclineUrls` actualizados para no afirmar que el correo inicial ofrece confirmar/declinar. |
| `functions/test/email.test.js` | **Modify.** Los tests de `renderClientEmail` llaman sin el segundo argumento `token`; el test que esperaba los botones se invierte a `doesNotMatch`; se agrega un test para el copy nuevo. |
| `functions/index.js` | **Modify.** `onBookingCreated` deja de pasar `reminderToken` a `sendBookingEmails`. |
| `functions/createBooking.js` | **Modify.** Comentario junto a `reminderToken: generateReminderToken()` deja de decir que es para que el correo inicial "ya pueda ofrecer Confirmar/Declinar" (ya no es cierto). |

---

### Task 1: `functions/email.js` — quitar los botones de `renderClientEmail` (TDD)

**Files:**
- Modify: `functions/email.js`
- Test: `functions/test/email.test.js`

- [ ] **Step 1: Reemplazar el bloque de tests de `renderClientEmail` (van a fallar)**

En `functions/test/email.test.js`, reemplazar TODO el rango desde la línea 15 (`test('email al cliente incluye nombre, código y servicio'...`) hasta la línea 84 (el `});` que cierra el test de la ventana de 3 horas) por:

```js
test('email al cliente incluye nombre, código y servicio', () => {
  const { subject, html } = renderClientEmail(booking);
  assert.match(subject, /SW-AB12345/);
  assert.match(html, /Juan Pérez/);
  assert.match(html, /Corte \+ Lavado Premium/);
  assert.match(html, /Felipe/);
});

test('email al cliente usa el diseño 2026-09-08 con fecha en hora de Chile', () => {
  const { html } = renderClientEmail(booking);
  assert.match(html, /Tu próxima visita,<br>ya está reservada\./);
  assert.match(html, /Miércoles 10 de junio de 2026/);
  assert.match(html, /11:00/);
  assert.match(html, /45 minutos/);
  assert.match(html, /\$21\.000/);
  assert.match(html, /Cochrane 635/);
  assert.match(html, /assets\/logo\.png/);       // logo raíz del sitio, no assets/email/logo.png (ese es del diseño anterior)
  assert.match(html, /assets\/email\/hero-actual\.jpg/);
  assert.doesNotMatch(html, /data:image/);
});

test('email al cliente usa la zona guardada en la reserva, no siempre Santiago', () => {
  // Mismo date+time que el fixture principal, pero con tz explícito a
  // Punta Arenas (GMT-3, no cambia de hora) -- el resultado debe seguir
  // mostrando el 10 de junio: `date`/`time` son hora de PARED en `tz`, no un
  // instante que se reinterpreta al convertir de zona.
  const { html } = renderClientEmail({ ...booking, tz: 'America/Punta_Arenas' });
  assert.match(html, /Miércoles 10 de junio de 2026/);
});

test('email al cliente muestra el día calendario correcto cerca de la medianoche (borde donde el bug viejo habría corrido el día)', () => {
  // 23:30 del 15 de junio en Punta Arenas (GMT-3 fijo) -- si la fecha se
  // parseara directo en vez de armar el instante real vía dateKeyOf+time+
  // zonedInstant, un `date` en formato fecha pura ('2026-06-15') se leería
  // como medianoche UTC y mostraría el 14, no el 15.
  const { html } = renderClientEmail({
    ...booking, date: '2026-06-15', time: '23:30', tz: 'America/Punta_Arenas',
  });
  assert.match(html, /15 de junio de 2026/);
  assert.doesNotMatch(html, /14 de junio de 2026/);
});

test('email al cliente omite la fila Duración si la reserva no trae dur', () => {
  const { html } = renderClientEmail({ ...booking, dur: undefined });
  assert.doesNotMatch(html, /Duración/);
});

test('los datos del cliente se escapan para evitar inyección de HTML', () => {
  const { html } = renderClientEmail({ ...booking, name: 'Juan <script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Juan &lt;script&gt;/);
});

test('email al cliente NO incluye botones Confirmar/Declinar -- esa acción vive solo en el recordatorio de 24h', () => {
  // Antes este correo ofrecía confirmar/declinar al instante de reservar; los
  // clientes lo usaban al minuto de agendar, anulando el propósito del
  // recordatorio (una señal cercana a la cita). Ver
  // docs/superpowers/specs/2026-09-14-confirmacion-solo-recordatorio-design.md.
  const { html } = renderClientEmail(booking);
  assert.doesNotMatch(html, /Confirmar asistencia/);
  assert.doesNotMatch(html, /No podré ir/);
  assert.doesNotMatch(html, /confirmar-cita\.html/);
});

test('email al cliente anticipa que llegará un recordatorio para confirmar asistencia', () => {
  const { html } = renderClientEmail(booking);
  assert.match(html, /Te enviaremos un recordatorio antes de tu cita para que confirmes tu asistencia/);
});

test('email al cliente avisa la ventana de 3 horas para cambios y la tolerancia de 10 minutos por atraso', () => {
  // Confirmado por Aldo 2026-09-08: cancelar/cambiar sigue siendo 3 horas
  // (el texto viejo decía 2). La tolerancia de 10 minutos es algo distinto:
  // cuánto atraso se acepta EL DÍA de la cita, no la ventana para cancelar.
  const { html } = renderClientEmail(booking);
  assert.match(html, /hasta 3 horas antes/);
  assert.match(html, /tolerancia de 10 minutos/);
  assert.doesNotMatch(html, /2 horas/);
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd functions && node --test test/email.test.js`
Expected: FAIL en 2 tests — `'email al cliente NO incluye botones Confirmar/Declinar...'` (el HTML actual SÍ trae "Confirmar asistencia"/"No podré ir"/"confirmar-cita.html") y `'email al cliente anticipa que llegará un recordatorio...'` (el copy actual no incluye esa frase). El resto de los tests de `renderClientEmail` debe seguir en PASS (llamarla sin el segundo argumento `token` no rompe nada hoy, porque el código viejo no depende de verificar su tipo).

- [ ] **Step 3: Quitar los botones de `renderClientEmail` y actualizar el copy**

En `functions/email.js`, reemplazar el comentario y la función (líneas 154-174):

```js
// Template "SW Studio — Reserva Recibida": diseño 2026-09-08 (Audiowide +
// Inter, foto hero + tarjeta semitransparente) vía renderNewDesignShell().
// `token` llega desde buildBookingDoc() (functions/createBooking.js), generado
// junto con la reserva -- así el cliente puede confirmar/declinar desde este
// mismo correo, sin esperar al recordatorio de 24h antes.
function renderClientEmail(b, token) {
  const tz = b.tz || DEFAULT_TZ;
  const fecha = fmtFechaLarga(b.date, b.time, tz);
  const { confirmUrl, declineUrl } = confirmDeclineUrls(b.code, token);
  const subject = `Tu reserva en SW Studio · ${fecha} a las ${b.time} — ${b.code}`;
  const html = renderNewDesignShell({
    preheader: 'Tu hora quedó reservada. Confirma tu asistencia para que sepamos que contamos contigo.',
    eyebrow: 'RESERVA RECIBIDA',
    headlineHtml: 'Tu próxima visita,<br>ya está reservada.',
    introHtml: `Hola, ${esc(b.name)}.<br>Tu hora quedó reservada. Confirma tu asistencia para que sepamos que contamos contigo.`,
    fecha, hora: b.time,
    rows: citaDetailRows(b),
    belowRowsHtml: confirmDeclineButtonsHtml(confirmUrl, declineUrl) + whatsappChangeNoteHtml(),
  });
  return { subject, html };
}
```

con:

```js
// Template "SW Studio — Reserva Recibida": diseño 2026-09-08 (Audiowide +
// Inter, foto hero + tarjeta semitransparente) vía renderNewDesignShell().
// Puramente informativo -- confirmar/declinar la asistencia vive solo en
// renderReminderEmail (recordatorio 24h antes). Hasta 2026-09-14 este correo
// también traía esos botones (mismo reminderToken), pero los clientes los
// usaban al minuto de reservar, anulando el propósito del recordatorio como
// señal cercana a la cita -- ver
// docs/superpowers/specs/2026-09-14-confirmacion-solo-recordatorio-design.md.
function renderClientEmail(b) {
  const tz = b.tz || DEFAULT_TZ;
  const fecha = fmtFechaLarga(b.date, b.time, tz);
  const subject = `Tu reserva en SW Studio · ${fecha} a las ${b.time} — ${b.code}`;
  const html = renderNewDesignShell({
    preheader: 'Tu hora quedó reservada. Te avisaremos antes de tu cita para que confirmes tu asistencia.',
    eyebrow: 'RESERVA RECIBIDA',
    headlineHtml: 'Tu próxima visita,<br>ya está reservada.',
    introHtml: `Hola, ${esc(b.name)}.<br>Tu hora quedó reservada. Te enviaremos un recordatorio antes de tu cita para que confirmes tu asistencia.`,
    fecha, hora: b.time,
    rows: citaDetailRows(b),
    belowRowsHtml: whatsappChangeNoteHtml(),
  });
  return { subject, html };
}
```

Luego actualizar los dos comentarios que ahora afirman algo falso (que `renderClientEmail` ofrece confirmar/declinar):

Reemplazar (líneas 102-105, comentario sobre `confirmDeclineButtonsHtml`):

```js
// Bloque de dos botones (Confirmar/Declinar) del diseño 2026-09-08 -- usado
// por renderClientEmail y renderReminderEmail (los dos correos con una
// acción pendiente; renderConfirmationEmail no lo usa, ya no hay nada que
// decidir). Cargar el link NUNCA ejecuta la acción: ambos apuntan a
```

con:

```js
// Bloque de dos botones (Confirmar/Declinar) del diseño 2026-09-08 -- usado
// solo por renderReminderEmail (el único correo con una acción pendiente
// desde 2026-09-14; renderClientEmail ya no lo ofrece, ver
// docs/superpowers/specs/2026-09-14-confirmacion-solo-recordatorio-design.md;
// renderConfirmationEmail tampoco, ya no hay nada que decidir). Cargar el
// link NUNCA ejecuta la acción: apunta a
```

(el resto de ese comentario, desde `confirmar-cita.html (code+token+r)...` en adelante, sigue igual — no lo toques).

Reemplazar (líneas 143-146, comentario sobre `confirmDeclineUrls`):

```js
// URLs de acción del recordatorio de citas -- comparten forma entre
// renderClientEmail (email inicial) y renderReminderEmail (24h antes), así
// que un cliente puede usar el link de CUALQUIERA de los dos correos
// indistintamente mientras el token siga siendo válido.
```

con:

```js
// URL de acción del recordatorio de citas -- usada solo por
// renderReminderEmail (24h antes). renderClientEmail (email inicial) dejó de
// usarla el 2026-09-14, ver
// docs/superpowers/specs/2026-09-14-confirmacion-solo-recordatorio-design.md.
```

- [ ] **Step 4: Quitar el parámetro `token` de `sendBookingEmails`**

En `functions/email.js`, reemplazar (líneas 309-318):

```js
async function sendBookingEmails(b, token, { apiKey, fromEmail, shopEmail }) {
  const resend = new Resend(apiKey);
  const client = renderClientEmail(b, token);
  const shop = renderShopEmail(b);
  const results = await Promise.all([
    resend.emails.send({ from: fromEmail, to: b.email, subject: client.subject, html: client.html }),
    resend.emails.send({ from: fromEmail, to: parseRecipients(shopEmail), cc: SHOP_EMAIL_CC, subject: shop.subject, html: shop.html }),
  ]);
  assertResendOk(results);
}
```

con:

```js
async function sendBookingEmails(b, { apiKey, fromEmail, shopEmail }) {
  const resend = new Resend(apiKey);
  const client = renderClientEmail(b);
  const shop = renderShopEmail(b);
  const results = await Promise.all([
    resend.emails.send({ from: fromEmail, to: b.email, subject: client.subject, html: client.html }),
    resend.emails.send({ from: fromEmail, to: parseRecipients(shopEmail), cc: SHOP_EMAIL_CC, subject: shop.subject, html: shop.html }),
  ]);
  assertResendOk(results);
}
```

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `cd functions && node --test test/email.test.js`
Expected: PASS en todos los tests de `renderClientEmail` (incluidos los 2 nuevos/invertidos). Los tests de `renderShopEmail`/`renderReminderEmail`/`renderReminderResponseEmail`/`renderConfirmationEmail`/`parseRecipients` deben seguir pasando sin cambios — si alguno falla, algo de este paso tocó código compartido que no debía.

- [ ] **Step 6: Commit**

```bash
git add functions/email.js functions/test/email.test.js
git commit -m "$(cat <<'EOF'
fix(email): quitar Confirmar/Declinar del correo de reserva recibida

Los clientes confirmaban asistencia al minuto de reservar usando los
botones de ese correo, no los del recordatorio de 24h -- anulando su
propósito como señal cercana a la cita. Confirmar/declinar ahora vive
solo en el recordatorio (renderReminderEmail).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

### Task 2: `functions/index.js` y `functions/createBooking.js` — ajustar el llamador y el comentario del token

**Files:**
- Modify: `functions/index.js`
- Modify: `functions/createBooking.js`

- [ ] **Step 1: Dejar de pasar `reminderToken` a `sendBookingEmails`**

En `functions/index.js`, dentro de `exports.onBookingCreated`, reemplazar (línea 76-80):

```js
        await sendBookingEmails({ ...b, email }, reminderToken, {
          apiKey: RESEND_API_KEY.value(),
          fromEmail: FROM_EMAIL.value(),
          shopEmail: SHOP_EMAIL.value(),
        });
```

con:

```js
        await sendBookingEmails({ ...b, email }, {
          apiKey: RESEND_API_KEY.value(),
          fromEmail: FROM_EMAIL.value(),
          shopEmail: SHOP_EMAIL.value(),
        });
```

No toques nada más de esta función: `reminderToken` se sigue calculando y persistiendo en `bookingUpdate.reminderToken` un poco más arriba (líneas 67-68) — sigue haciendo falta para `sendBookingReminders`, solo deja de viajar a `sendBookingEmails`.

- [ ] **Step 2: Corregir el comentario junto a `reminderToken: generateReminderToken()`**

En `functions/createBooking.js`, reemplazar (líneas 92-98):

```js
    tz: businessTz,
    // Generado desde la creación (no recién a las 24h) para que el email de
    // "reserva confirmada" ya pueda ofrecer Confirmar/Declinar con el mismo
    // link -- ver renderClientEmail (functions/email.js) y
    // exports.sendBookingReminders (functions/index.js), que reutiliza este
    // mismo token en vez de generar uno nuevo si ya existe.
    reminderToken: generateReminderToken(),
```

con:

```js
    tz: businessTz,
    // Generado desde la creación (no recién a las 24h) -- ver
    // exports.sendBookingReminders (functions/index.js), que reutiliza este
    // mismo token en vez de generar uno nuevo si ya existe. Antes del
    // 2026-09-14 esto también le servía al correo de reserva recibida para
    // ofrecer Confirmar/Declinar; ya no (ver
    // docs/superpowers/specs/2026-09-14-confirmacion-solo-recordatorio-design.md).
    reminderToken: generateReminderToken(),
```

- [ ] **Step 3: Correr toda la suite de `functions` para verificar que nada quedó roto**

Run: `cd functions && node --test`
Expected: PASS en todos los archivos de `functions/test/` (incluye `email.test.js`, `createBooking.test.js`, `reminders.test.js`, `status.test.js`, `validate.test.js`). Ningún test debería fallar por este cambio — ni `email.test.js` (ya cubierto en Task 1) ni `createBooking.test.js` (el cambio ahí es solo de comentario, no de comportamiento).

- [ ] **Step 4: Commit**

```bash
git add functions/index.js functions/createBooking.js
git commit -m "$(cat <<'EOF'
fix(email): dejar de pasar reminderToken al correo de reserva recibida

Consecuencia directa de que renderClientEmail ya no ofrece
Confirmar/Declinar (commit anterior). reminderToken se sigue generando
y guardando en el doc -- sendBookingReminders lo sigue necesitando.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

## Verificación manual (fuera del alcance de los tests automatizados)

Resend real no corre en `node --test`. Antes de dar por cerrado el goal, en staging:

1. Crear una reserva de prueba desde el widget público con un correo propio.
2. Confirmar que el correo de "reserva recibida" llega SIN botones Confirmar/Declinar y con el copy nuevo ("Te enviaremos un recordatorio antes de tu cita...").
3. Confirmar que el correo a la barbería (`renderShopEmail`) no cambió.

No hace falta esperar 24h para verificar `renderReminderEmail` — ese correo no se tocó en este plan.
