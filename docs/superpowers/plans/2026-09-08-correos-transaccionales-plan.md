# Correos transaccionales — nuevo formato (reserva + confirmación) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar el rediseño de correos entregado 2026-09-08 (Audiowide + Inter, foto hero con tarjeta semitransparente, mismo lenguaje visual que ya usa `confirmar-cita.html`) para el correo de "reserva recibida" y sumar un correo nuevo de "asistencia confirmada" — reusando el `reminderToken` y el flujo confirmar/declinar que YA existen en producción, sin inventar un sistema de tokens nuevo. De paso corrige el texto de la ventana de cambios (2 horas → 3 horas) y agrega la tolerancia de atraso (10 minutos), confirmadas por Aldo en esta conversación.

**Contexto importante:** El paquete de diseño (`C:\Users\aldon\Downloads\Scissor-White-HTML\sw-html\`) trae `correo-reserva.html`, `correo-confirmacion.html` y `pantalla-confirmacion.html`, ya revisados y con un ajuste hecho en esta misma sesión (el CTA pasó de un solo botón "Confirmar asistencia" + link de gestión, a dos botones Confirmar/Declinar + nota de WhatsApp, porque la página de gestión de reservas todavía no existe — ver `docs/superpowers/specs/2026-09-08-gestion-reservas-design.md`). Este plan usa esas plantillas YA corregidas como fuente de verdad del markup.

Nota sobre CLAUDE.md: la sección PROHIBIDO (etapas 0/A) incluye "Cambiar el diseño visual". Este plan sí cambia el diseño visual de los correos transaccionales y de la pantalla de éxito — es una excepción explícita y dirigida por Aldo en esta conversación (el diseño fue comisionado y entregado por él, no una decisión unilateral del agente), igual que las excepciones ya registradas para holds/recordatorios/autogestión en la nota 2026-09-01. Si quien ejecuta este plan tiene dudas sobre este punto, debe confirmarlo con Aldo antes de continuar.

**Architecture:** `functions/email.js` gana un segundo "sistema visual" (Audiowide+Inter, foto hero) que convive con el actual (Cormorant Garamond+Jost, hero oscuro de dos columnas) — **no se migra todo el archivo**, solo `renderClientEmail` (correo de reserva) y el nuevo `renderConfirmationEmail` (correo de confirmación). `renderReminderEmail`, `renderShopEmail` y `renderReminderResponseEmail` (avisos internos y recordatorio 24h) quedan con el diseño anterior — no fueron parte de la entrega de diseño, y tocarlos es decisión aparte. El correo de confirmación se dispara desde `exports.respondToBookingReminder` (`functions/index.js`) cuando `action === 'confirm'`, mismo patrón best-effort (no bloqueante, se loguea si falla) que ya usa el aviso a la barbería.

**Tech Stack:** Firebase Cloud Functions v2 (Node 22), Resend, `node:test` (sin framework), HTML/CSS inline con tablas (mismo patrón email-safe del resto de `email.js`), vanilla JS para `public/confirmar-cita.html`.

---

## File Structure

| File | Change |
|---|---|
| `functions/email.js` | **Modify.** Agrega helpers del diseño 2026-09-08 (`fmtFechaLarga`, `newDetailRow`, `citaDetailRows`, `whatsappChangeNoteHtml`, `confirmDeclineButtonsHtml`, `visitNoticeHtml`, `renderNewDesignShell`). Reescribe `renderClientEmail`. Agrega `renderConfirmationEmail` + `sendConfirmationEmail`. |
| `functions/test/email.test.js` | **Modify.** Actualiza las aserciones de `renderClientEmail` al nuevo formato de fecha/botones/copy. Agrega tests de `renderConfirmationEmail`. |
| `functions/index.js` | **Modify.** Importa `sendConfirmationEmail`; lo llama (best-effort) en `exports.respondToBookingReminder` cuando `action === 'confirm'`. |
| `public/assets/email/hero-actual.jpg` | **Create.** Copia publicada de la foto hero real del sitio (capturada por el diseñador el 08-09-2026), servida en HTTPS para los dos correos nuevos. |
| `public/confirmar-cita.html` | **Modify.** La pantalla de éxito tras CONFIRMAR (no declinar) adopta el fondo de foto + tarjeta semitransparente de `pantalla-confirmacion.html`. Requiere verificación visual manual (no hay test automatizado de esto en el repo). |

---

### Task 1: `email.js` — diseño 2026-09-08 y reescritura de `renderClientEmail` (TDD)

**Files:**
- Modify: `functions/email.js`
- Modify: `functions/test/email.test.js`

- [ ] **Step 1: Actualizar el `require` del test file**

En `functions/test/email.test.js`, reemplazar la línea 3:

```js
const { renderClientEmail, renderShopEmail, renderReminderEmail, renderReminderResponseEmail, parseRecipients, assertResendOk } = require('../email.js');
```

con:

```js
const { renderClientEmail, renderShopEmail, renderReminderEmail, renderReminderResponseEmail, renderConfirmationEmail, parseRecipients, assertResendOk } = require('../email.js');
```

- [ ] **Step 2: Escribir/actualizar los tests de `renderClientEmail` (van a fallar)**

Reemplazar el bloque de tests entre la línea 15 (`test('email al cliente incluye nombre...`) y la línea 79 (el `});` que cierra el test de los botones Confirmar/Declinar) — TODO ese rango — por:

```js
test('email al cliente incluye nombre, código y servicio', () => {
  const { subject, html } = renderClientEmail(booking, 'abc123token');
  assert.match(subject, /SW-AB12345/);
  assert.match(html, /Juan Pérez/);
  assert.match(html, /Corte \+ Lavado Premium/);
  assert.match(html, /Felipe/);
});

test('email al cliente usa el diseño 2026-09-08 con fecha en hora de Chile', () => {
  const { html } = renderClientEmail(booking, 'abc123token');
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
  const { html } = renderClientEmail({ ...booking, tz: 'America/Punta_Arenas' }, 'abc123token');
  assert.match(html, /Miércoles 10 de junio de 2026/);
});

test('email al cliente muestra el día calendario correcto cerca de la medianoche (borde donde el bug viejo habría corrido el día)', () => {
  // 23:30 del 15 de junio en Punta Arenas (GMT-3 fijo) -- si la fecha se
  // parseara directo en vez de armar el instante real vía dateKeyOf+time+
  // zonedInstant, un `date` en formato fecha pura ('2026-06-15') se leería
  // como medianoche UTC y mostraría el 14, no el 15.
  const { html } = renderClientEmail({
    ...booking, date: '2026-06-15', time: '23:30', tz: 'America/Punta_Arenas',
  }, 'abc123token');
  assert.match(html, /15 de junio de 2026/);
  assert.doesNotMatch(html, /14 de junio de 2026/);
});

test('email al cliente omite la fila Duración si la reserva no trae dur', () => {
  const { html } = renderClientEmail({ ...booking, dur: undefined }, 'abc123token');
  assert.doesNotMatch(html, /Duración/);
});

test('los datos del cliente se escapan para evitar inyección de HTML', () => {
  const { html } = renderClientEmail({ ...booking, name: 'Juan <script>alert(1)</script>' }, 'abc123token');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Juan &lt;script&gt;/);
});

test('email al cliente incluye los botones Confirmar/Declinar con code+token+r correctos (no espera al recordatorio de 24h)', () => {
  const { html } = renderClientEmail(booking, 'abc123token');
  assert.match(html, /confirmar-cita\.html\?code=SW-AB12345&t=abc123token&r=confirm/);
  assert.match(html, /confirmar-cita\.html\?code=SW-AB12345&t=abc123token&r=decline/);
  assert.match(html, /Confirmar asistencia/);
  assert.match(html, /No podré ir/);
});

test('email al cliente avisa la ventana de 3 horas para cambios y la tolerancia de 10 minutos por atraso', () => {
  // Confirmado por Aldo 2026-09-08: cancelar/cambiar sigue siendo 3 horas
  // (el texto viejo decía 2). La tolerancia de 10 minutos es algo distinto:
  // cuánto atraso se acepta EL DÍA de la cita, no la ventana para cancelar.
  const { html } = renderClientEmail(booking, 'abc123token');
  assert.match(html, /hasta 3 horas antes/);
  assert.match(html, /tolerancia de 10 minutos/);
  assert.doesNotMatch(html, /2 horas/);
});
```

- [ ] **Step 3: Correr los tests para verificar que fallan**

Run: `cd functions && node --test test/email.test.js`
Expected: FAIL — el HTML actual de `renderClientEmail` no trae "Tu próxima visita", "Miércoles 10 de junio de 2026", "hero-actual.jpg", "3 horas", etc. (sigue con el diseño viejo).

- [ ] **Step 4: Agregar los helpers del diseño 2026-09-08 y reescribir `renderClientEmail`**

En `functions/email.js`, ubicar la constante `ASSETS_URL` (cerca de la línea 8) y agregar justo debajo:

```js
// Foto hero del diseño 2026-09-08 (correo-reserva/correo-confirmacion) --
// distinta de ASSETS_URL + '/salon.png', que sigue usando el diseño
// anterior (renderReminderEmail/renderShopEmail, sin tocar en este cambio).
// Capturada por el diseñador el 08-09-2026 directo del sitio en vivo,
// porque el slot hero puede venir sobrescrito por siteImages (panel Fotos
// del admin) -- si alguien cambia esa foto desde el panel, esta imagen de
// correo queda desactualizada hasta que se vuelva a publicar a mano.
const EMAIL_HERO_URL = `${SITE_URL}/assets/email/hero-actual.jpg`;
```

Ubicar la función `dateParts` (usada por el diseño viejo) y agregar, justo debajo de su cierre, el nuevo formateador de fecha:

```js
// Fecha en una sola frase capitalizada ("Miércoles 10 de junio de 2026") --
// a diferencia de dateParts() (que arma la tarjeta calendario JUE/10/JUNIO
// del diseño anterior), el diseño 2026-09-08 solo necesita una línea de
// texto bajo "TU CITA". Mismo cálculo de instante real que dateParts
// (dateKeyOf+time+zonedInstant) -- no reinterpreta `date` directo.
function fmtFechaLarga(dateStr, time, tz) {
  try {
    const instant = zonedInstant(dateKeyOf(dateStr), time || '00:00', tz);
    if (isNaN(instant)) throw new Error('bad date');
    const raw = instant.toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone: tz });
    // Intl da "miércoles, 10 de junio de 2026" (con coma, minúscula) -- se
    // quita la coma y se capitaliza el día de semana para calzar con el
    // copy del diseño ("Miércoles 10 de junio de 2026").
    const sinComa = raw.replace(',', '');
    return sinComa.charAt(0).toUpperCase() + sinComa.slice(1);
  } catch { return String(dateStr || ''); }
}
```

Ubicar la función `detailRow` (usada por el diseño viejo) y agregar, justo debajo de su cierre, todo el bloque del diseño nuevo:

```js
const NEW_SANS = 'Inter,Arial,Helvetica,sans-serif';
const NEW_DISPLAY = 'Audiowide,Arial,Helvetica,sans-serif';

// Fila etiqueta/valor de la tarjeta "TU CITA" del diseño 2026-09-08 --
// visualmente distinta de detailRow() (columna de etiqueta ancha en
// mayúsculas + valor en serif, del diseño oscuro anterior). No se
// comparten: mezclar los dos sistemas de estilos en una sola fila sería
// más confuso que duplicar una función de 3 líneas.
function newDetailRow(label, valueHtml, last) {
  const border = last ? '' : 'border-bottom:1px solid #e0e4e8;';
  return `<tr><td style="padding:13px 0;${border}color:#505965;font-size:13px;width:36%;vertical-align:top;font-family:${NEW_SANS};">${label}</td><td style="padding:13px 0;${border}font-size:15px;font-weight:600;overflow-wrap:anywhere;font-family:${NEW_SANS};">${valueHtml}</td></tr>`;
}

// Filas de la tarjeta "TU CITA" -- compartidas por renderClientEmail y
// renderConfirmationEmail (mismo detalle de la reserva en ambos correos).
function citaDetailRows(b) {
  return [
    newDetailRow('Servicio', esc(b.svcName)),
    newDetailRow('Profesional', esc(b.barberName)),
    b.dur ? newDetailRow('Duración', esc(b.dur) + ' minutos') : '',
    newDetailRow('Valor', esc(fmtCLP(b.price))),
    newDetailRow('Código', esc(b.code), true),
  ].join('');
}

// Nota "por ahora, cambios por WhatsApp" -- compartida por el correo de
// reserva y el de confirmación. La página de gestión propia (reagendar/
// cancelar dentro de la ventana permitida) todavía no existe -- ver
// docs/superpowers/specs/2026-09-08-gestion-reservas-design.md -- así que
// ninguno de los dos correos enlaza a una URL que no resuelve a nada.
function whatsappChangeNoteHtml() {
  return `<p style="margin:18px 0 0;text-align:center;font-size:13px;line-height:1.6;color:#596676;font-family:${NEW_SANS};">¿Necesitas cambiar el día u hora? Por ahora, escríbenos por <a href="https://wa.me/56982514114" style="color:#383838;text-decoration:underline;">WhatsApp</a>.</p>`;
}

// Bloque de dos botones (Confirmar/Declinar) del diseño 2026-09-08 -- mismo
// destino que ya usa confirmDeclineCta() (confirmar-cita.html con code+
// token+r), solo con la piel visual del nuevo diseño (sin versalitas, sin
// letter-spacing). Igual que confirmDeclineCta: cargar el link NUNCA
// ejecuta la acción, ambos apuntan a la página intermedia.
function confirmDeclineButtonsHtml(confirmUrl, declineUrl) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><tr><td class="cta-col" width="50%" style="padding-right:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="#111111" style="border-radius:6px;"><a href="${confirmUrl}" target="_blank" style="display:block;padding:19px 8px;border:1px solid #111111;border-radius:6px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;font-family:${NEW_SANS};">Confirmar asistencia</a></td></tr></table></td><td class="cta-col" width="50%" style="padding-left:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="border-radius:6px;"><a href="${declineUrl}" target="_blank" style="display:block;padding:19px 8px;border:1px solid #111111;border-radius:6px;font-size:14px;font-weight:700;color:#111111;text-decoration:none;font-family:${NEW_SANS};">No podré ir</a></td></tr></table></td></tr></table>`;
}

// Ventana de cambios: 3 horas de antelación para cambiar/cancelar, más 10
// minutos de tolerancia de atraso EL DÍA de la cita -- dos cosas distintas,
// confirmadas por Aldo 2026-09-08 (el texto anterior decía "2 horas" y no
// mencionaba la tolerancia).
function visitNoticeHtml() {
  return `<tr><td class="pad" style="padding:24px 40px;background:#e9edf1;color:#383838;"><p style="font-size:13px;line-height:1.7;margin:0;font-family:${NEW_SANS};"><strong>Antes de tu visita</strong><br>Puedes cambiar o cancelar hasta 3 horas antes. Contamos con una tolerancia de 10 minutos; pasado ese tiempo, la atención podrá reprogramarse o ajustarse al tiempo disponible.</p></td></tr>`;
}

// Shell compartido del diseño 2026-09-08 (Audiowide + Inter, foto hero +
// tarjeta semitransparente, mismo lenguaje visual que confirmar-cita.html)
// -- usado por renderClientEmail (reserva recibida) y renderConfirmationEmail
// (asistencia confirmada). Incluye el fallback VML para Outlook clásico,
// igual que el mockup entregado.
function renderNewDesignShell({ preheader, eyebrow, headlineHtml, introHtml, fecha, hora, rows, belowRowsHtml }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>SW Studio</title><link href="https://fonts.googleapis.com/css2?family=Audiowide&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><style>body,table,td,a{font-family:${NEW_SANS}}table{border-collapse:collapse;text-align:left}a:focus-visible{outline:3px solid #6A7888;outline-offset:4px}@media(max-width:480px){.pad{padding-left:24px!important;padding-right:24px!important}.headline{font-size:29px!important}.cta-col{display:block!important;width:100%!important;padding:0 0 10px 0!important}}</style></head><body style="margin:0;padding:0;background:#eef0f2;color:#111111"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef0f2"><tr><td align="center" style="padding:24px 10px"><!--[if mso]><table role="presentation" width="600"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fafafa" bgcolor="#fafafa"><tr><td class="pad" style="padding:26px 40px;border-bottom:1px solid #d7dce2"><table role="presentation" width="100%"><tr><td><img src="${SITE_URL}/assets/logo.png" width="64" alt="SW Studio" style="display:block;width:64px;height:auto;border:0"></td><td align="right" style="font-size:11px;letter-spacing:2px;color:#505965">SCISSOR WHITE<br><span style="font-size:10px;line-height:24px">CONCEPCIÓN</span></td></tr></table></td></tr><tr><td class="pad" style="padding:34px 40px 26px"><p style="margin:0 0 16px;font-size:10px;font-weight:700;letter-spacing:2px;color:#596676">${eyebrow}</p><h1 class="headline" style="font-family:${NEW_DISPLAY};font-size:34px;line-height:1.22;letter-spacing:-1px;margin:0 0 20px">${headlineHtml}</h1><p style="font-size:15px;line-height:1.7;margin:0">${introHtml}</p></td></tr><tr><td background="${EMAIL_HERO_URL}" bgcolor="#24282d" width="600" height="360" valign="bottom" style="height:360px;background-color:#24282d;background-image:url('${EMAIL_HERO_URL}');background-size:cover;background-position:center 62%;background-repeat:no-repeat;padding:0;text-align:left">
<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:360px;"><v:fill type="frame" src="${EMAIL_HERO_URL}" color="#24282d"/><v:textbox inset="0,0,0,0"><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="180" style="height:180px;font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="padding:20px 24px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#1a1e23;background:rgba(12,15,19,0.70);border:1px solid #9aa5b2;border-radius:12px;padding:22px 24px;color:#ffffff;text-align:left"><p style="margin:0 0 10px;font-size:10px;line-height:1.4;letter-spacing:2px;color:#dce2e9">SCISSOR WHITE · CONCEPCIÓN</p><p style="margin:0;font-size:24px;line-height:1.25;font-weight:600;color:#ffffff">Más que cortes,<br>creamos identidad.</p></td></tr></table></td></tr></table>
<!--[if gte mso 9]></v:textbox></v:rect><![endif]--></td></tr><tr><td class="pad" style="padding:30px 40px"><p style="font-size:11px;letter-spacing:2px;color:#596676;margin:0 0 10px">TU CITA</p><p style="font-size:19px;line-height:1.5;font-weight:600;margin:0 0 8px">${esc(fecha)}</p><p style="font-size:34px;font-weight:700;letter-spacing:-1px;margin:0 0 18px">${esc(hora)} <span style="font-size:14px;font-weight:400;color:#505965">hrs · Chile</span></p><table role="presentation" width="100%" style="table-layout:fixed">${rows}</table><p style="font-size:14px;line-height:1.7;margin:22px 0"><strong>SW Studio · Concepción</strong><br>${esc(ADDRESS_LINE)}</p>${belowRowsHtml}</td></tr>${visitNoticeHtml()}<tr><td class="pad" style="padding:28px 40px;background:#111111;color:#ffffff"><p style="font-size:17px;line-height:1.5;margin:0 0 18px">Más que cortes,<br><strong>creamos identidad.</strong></p><a href="${SITE_URL}" style="font-size:12px;color:#c8d0da">scissorwhite.cl</a></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}
```

Ahora reemplazar la función `renderClientEmail` completa (busca `function renderClientEmail(b, token) {` y su cierre `}` que precede al comentario `// Template del aviso interno...`) por:

```js
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

**Importante:** `confirmDeclineUrls`, `confirmDeclineCta`, `detailRow`, `dateParts` y `FONT_SANS`/`FONT_SERIF` siguen existiendo sin cambios — los sigue usando `renderReminderEmail`. No borrarlos.

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `cd functions && node --test test/email.test.js`
Expected: PASS en los tests de `renderClientEmail` (los de `renderShopEmail`/`renderReminderEmail`/`renderReminderResponseEmail` deben seguir pasando sin cambios — si alguno falla, algo en el Step 4 tocó código compartido que no debía).

- [ ] **Step 6: Commit**

```bash
git add functions/email.js functions/test/email.test.js
git commit -m "feat(email): nuevo diseño del correo de reserva (Audiowide/Inter, foto hero, ventana de 3 horas)"
```

---

### Task 2: `email.js` — `renderConfirmationEmail` (correo tras confirmar asistencia)

**Files:**
- Modify: `functions/email.js`
- Modify: `functions/test/email.test.js`

- [ ] **Step 1: Escribir los tests que van a fallar**

Agregar al final de `functions/test/email.test.js`:

```js
test('renderConfirmationEmail incluye nombre, fecha, servicio y código', () => {
  const { subject, html } = renderConfirmationEmail(booking);
  assert.match(subject, /Asistencia confirmada/);
  assert.match(subject, /SW-AB12345/);
  assert.match(html, /Asistencia confirmada\./);
  assert.match(html, /Juan Pérez/);
  assert.match(html, /Miércoles 10 de junio de 2026/);
  assert.match(html, /Corte \+ Lavado Premium/);
  assert.match(html, /Felipe/);
  assert.match(html, /\$21\.000/);
  assert.match(html, /assets\/email\/hero-actual\.jpg/);
});

test('renderConfirmationEmail no incluye los botones Confirmar/Declinar -- la atención ya fue confirmada', () => {
  const { html } = renderConfirmationEmail(booking);
  assert.doesNotMatch(html, /confirmar-cita\.html/);
});

test('renderConfirmationEmail escapa los datos del cliente para evitar inyección de HTML', () => {
  const { html } = renderConfirmationEmail({ ...booking, name: 'Juan <script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Juan &lt;script&gt;/);
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd functions && node --test test/email.test.js`
Expected: FAIL — `renderConfirmationEmail is not a function`.

- [ ] **Step 3: Implementar `renderConfirmationEmail` y `sendConfirmationEmail`**

En `functions/email.js`, justo debajo del cierre de `renderClientEmail` (antes del comentario `// Template del aviso interno de nueva reserva`), agregar:

```js
// Correo al CLIENTE después de que confirma su asistencia desde
// confirmar-cita.html (respondToBookingReminder, action==='confirm'). Antes
// de esto, solo se avisaba al negocio (renderReminderResponseEmail) -- el
// cliente no recibía nada de vuelta. Sin botones Confirmar/Declinar: ya
// confirmó, no hay nada que decidir. `token` no aplica acá -- este correo no
// ofrece ninguna acción sobre la reserva.
function renderConfirmationEmail(b) {
  const tz = b.tz || DEFAULT_TZ;
  const fecha = fmtFechaLarga(b.date, b.time, tz);
  const subject = `Asistencia confirmada · Nos vemos en SW Studio — ${b.code}`;
  const html = renderNewDesignShell({
    preheader: 'Recibimos tu confirmación. Nos vemos pronto en SW Studio.',
    eyebrow: 'ASISTENCIA CONFIRMADA',
    headlineHtml: 'Asistencia confirmada.',
    introHtml: `Hola, ${esc(b.name)}.<br>Recibimos tu confirmación. Nos vemos pronto en SW Studio.`,
    fecha, hora: b.time,
    rows: citaDetailRows(b),
    belowRowsHtml: whatsappChangeNoteHtml(),
  });
  return { subject, html };
}
```

Y junto a `sendReminderEmail` (misma zona del archivo), agregar:

```js
async function sendConfirmationEmail(b, { apiKey, fromEmail }) {
  const resend = new Resend(apiKey);
  const { subject, html } = renderConfirmationEmail(b);
  const result = await resend.emails.send({ from: fromEmail, to: b.email, subject, html });
  assertResendOk([result]);
}
```

Finalmente, en `module.exports` al final del archivo, agregar `renderConfirmationEmail, sendConfirmationEmail`:

```js
module.exports = {
  renderClientEmail, renderShopEmail, renderReminderEmail, renderReminderResponseEmail, renderConfirmationEmail,
  sendBookingEmails, sendReminderEmail, sendReminderResponseEmail, sendConfirmationEmail, parseRecipients, assertResendOk,
};
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd functions && node --test test/email.test.js`
Expected: PASS (todos, incluidos los de Task 1).

- [ ] **Step 5: Commit**

```bash
git add functions/email.js functions/test/email.test.js
git commit -m "feat(email): agregar correo de confirmación de asistencia al cliente"
```

---

### Task 3: Publicar la foto hero del correo

**Files:**
- Create: `public/assets/email/hero-actual.jpg`

- [ ] **Step 1: Copiar el archivo**

```bash
cp "/c/Users/aldon/Downloads/Scissor-White-HTML/sw-html/assets/email-hero-actual.jpg" "public/assets/email/hero-actual.jpg"
```

- [ ] **Step 2: Verificar que se ve razonable (no corrupto, no placeholder)**

Run: `file public/assets/email/hero-actual.jpg` — debe reportar un JPEG válido de tamaño similar al original (~950 KB).

- [ ] **Step 3: Commit**

```bash
git add public/assets/email/hero-actual.jpg
git commit -m "feat(assets): publicar la foto hero actual para el correo rediseñado"
```

**Nota:** esta foto es una captura puntual (08-09-2026) del slot hero real del sitio, porque ese slot puede venir sobrescrito por `siteImages` (panel Fotos del admin) y no siempre coincide con el archivo estático `public/assets/hero.jpg`. Si alguien cambia la foto principal del sitio desde el admin, esta imagen de correo NO se actualiza sola — hay que repetir este Task a mano. No es parte de este plan automatizar eso (fuera de alcance, ver sección final).

---

### Task 4: Enviar `renderConfirmationEmail` cuando el cliente confirma

**Files:**
- Modify: `functions/index.js:12` (import)
- Modify: `functions/index.js:536-554` (dentro de `exports.respondToBookingReminder`)

- [ ] **Step 1: Actualizar el import**

Reemplazar:

```js
const { sendBookingEmails, sendReminderEmail, sendReminderResponseEmail } = require('./email.js');
```

con:

```js
const { sendBookingEmails, sendReminderEmail, sendReminderResponseEmail, sendConfirmationEmail } = require('./email.js');
```

- [ ] **Step 2: Agregar el envío del correo al cliente tras confirmar**

En `exports.respondToBookingReminder`, ubicar el bloque `try { await sendReminderResponseEmail(...) } catch (err) { ... }` (el aviso al negocio) y agregar justo después, antes del `return { ok: true, already: false, status };` final:

```js
    // Correo de vuelta al CLIENTE solo si confirmó -- si declinó, la propia
    // página confirmar-cita.html ya le muestra "liberamos tu horario" sin
    // necesitar un correo de respaldo (no hay "evidencia" que dar de que
    // avisó que no iba). Mismo criterio best-effort que el aviso al
    // negocio: si el envío falla, se loguea, pero la transición de estado
    // ya es real y NO se revierte.
    if (action === 'confirm') {
      try {
        await sendConfirmationEmail(b, {
          apiKey: RESEND_API_KEY.value(),
          fromEmail: FROM_EMAIL.value(),
        });
      } catch (err) {
        logger.error('Fallo al enviar el correo de confirmación al cliente', err);
        try {
          await db.collection('adminLog').add({
            action: 'confirmation_email_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
          });
        } catch (err2) {
          logger.error('Fallo al registrar adminLog de confirmation_email_failed', err2);
        }
      }
    }

```

(queda inmediatamente antes de `return { ok: true, already: false, status };`)

- [ ] **Step 3: Verificación manual (no hay test automatizado de `respondToBookingReminder` en este repo — ninguna de sus otras ramas lo tiene tampoco)**

Run: `firebase emulators:start` en una terminal. En otra, crear una reserva de prueba, tomar su `code` + `reminderToken` desde el emulador de Firestore, y llamar `respondToBookingReminder` con `action:'confirm'` (desde la consola del emulador de Functions, o abriendo `confirmar-cita.html?code=...&t=...&r=confirm` contra el emulador y tocando el botón). Verificar en los logs del emulador de Resend/consola que se intentó enviar el correo de confirmación al email del cliente, además del aviso a `SHOP_EMAIL`.

- [ ] **Step 4: Commit**

```bash
git add functions/index.js
git commit -m "feat(functions): enviar correo de confirmación al cliente cuando confirma su asistencia"
```

---

### Task 5: Pantalla de éxito de `confirmar-cita.html` — fondo de foto + tarjeta

**Files:**
- Modify: `public/confirmar-cita.html`

**Alcance:** solo la salida CONFIRMAR (`r === 'confirm'`) adopta el fondo de foto + tarjeta semitransparente de `pantalla-confirmacion.html`. La salida DECLINAR sigue con la tarjeta blanca de borde acero que ya existe hoy — ese estado no fue parte del diseño entregado (`pantalla-confirmacion.html` es, según el propio `LEEME-ALDO.md` del paquete, "respuesta web de éxito", singular). Los estados de carga/error/resumen (antes de que el cliente decida) tampoco cambian.

- [ ] **Step 1: Agregar el div de fondo y su CSS**

En `public/confirmar-cita.html`, dentro de `<style>`, agregar (junto a las otras reglas, por ejemplo después de `.cc-icon{...}`):

```css
.cc-bg{position:fixed;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(0,0,0,.18),rgba(0,0,0,.4)),url('assets/hero.jpg') center 48%/cover no-repeat}
.cc-card--success{background:rgba(12,15,19,.64)!important;border:1px solid rgba(219,225,235,.45)!important;border-radius:20px;box-shadow:0 24px 80px #0004;backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);padding:34px 30px}
.cc-card--success #cc-done-h{color:#fff}
.cc-card--success #cc-done-sub{color:#ecf0f4}
.cc-card--success .cc-icon{border-color:#c8d0da;background:#ffffff0d}
```

En el `<body>`, justo después de `<body>` (antes del `<header>`), agregar el div oculto:

```html
<div class="cc-bg" id="cc-bg" aria-hidden="true" hidden></div>
```

- [ ] **Step 2: Activar el fondo solo en la salida de confirmar**

En el `<script type="module">`, ubicar la función `showDone(heading, sub)` y reemplazarla por:

```js
  function showDone(heading, sub) {
    els.summary.hidden = true;
    els.done.hidden = false;
    els.doneH.textContent = heading;
    els.doneSub.textContent = sub;
    // Fondo de foto + tarjeta semitransparente solo para la salida
    // CONFIRMAR -- pantalla-confirmacion.html (el diseño entregado) es
    // "respuesta web de éxito", no cubre la salida de declinar.
    if (r === 'confirm') {
      document.getElementById('cc-bg').hidden = false;
      document.querySelector('.cc-card').classList.add('cc-card--success');
    }
  }
```

- [ ] **Step 3: Verificación manual (no hay test automatizado de esta pantalla en el repo)**

Abrir `confirmar-cita.html?code=<code de prueba>&t=<reminderToken de prueba>&r=confirm` contra el emulador, tocar "Sí, confirmo mi asistencia", y verificar visualmente en el navegador que aparece el fondo de foto con la tarjeta semitransparente (no un texto plano sobre blanco). Repetir con `r=decline` y confirmar que esa salida SIGUE viéndose como hoy (tarjeta blanca, sin foto de fondo) — es la comprobación de que el alcance quedó bien acotado.

- [ ] **Step 4: Commit**

```bash
git add public/confirmar-cita.html
git commit -m "feat(web): pantalla de éxito de confirmar-cita.html con foto de fondo (diseño 2026-09-08)"
```

---

## Adenda (2026-09-08, mismo día): recordatorio 24h actualizado

Aldo pidió expresamente extender el diseño 2026-09-08 a `renderReminderEmail`
(recordatorio 24h antes), dejando explícitamente pendiente la página de
gestión de reservas. Implementado en un commit aparte (fuera de las 5 tareas
originales de este plan, mismo patrón TDD): `renderReminderEmail` ahora usa
`renderNewDesignShell`/`citaDetailRows`/`confirmDeclineButtonsHtml`/
`whatsappChangeNoteHtml`, igual que `renderClientEmail`/`renderConfirmationEmail`.
Efecto secundario: `confirmDeclineCta()` (el bloque de dos botones del diseño
viejo) quedó sin ningún llamador y se eliminó — era exclusivo de este correo,
`renderClientEmail` ya había migrado a `confirmDeclineButtonsHtml` en la Tarea 1.
`renderShopEmail`/`renderReminderResponseEmail` (avisos internos al negocio,
no al cliente) siguen con el diseño anterior — no fueron parte de este pedido.

## Adenda 2 (2026-09-08, mismo día): avisos internos a la barbería

Aldo pidió extender el diseño 2026-09-08 también a `renderShopEmail` (nueva
reserva) y `renderReminderResponseEmail` (cliente confirmó/declinó) --
los dos avisos que hasta este punto quedaban explícitamente fuera de alcance
(ver más abajo). `renderNewDesignShell` gana dos parámetros para poder
reusarse en correos que NO son al cliente: `citaLabel` (default `'TU CITA'`,
los avisos internos pasan `'LA CITA'` porque le describen a un tercero la
cita de otra persona) y `showVisitNotice` (default `true`, los avisos
internos pasan `false` porque la franja "antes de tu visita" es un
compromiso con el cliente, no información que el staff necesite leer sobre
sí mismo). `renderShopEmail` suma `shopDetailRows()` (mismos campos que
antes: Cliente/Teléfono/Email/Profesional/Servicio/Duración/Valor/Código,
solo con la piel nueva) y ninguno de los dos correos lleva CTA ni nota de
WhatsApp -- son alertas operativas, no el momento del cliente.
Efecto secundario: `ASSETS_URL`, `FONT_SANS`, `FONT_SERIF`, `detailRow()` y
`dateParts()` (el sistema visual Cormorant Garamond/Jost del diseño
anterior) quedaron sin ningún llamador tras la migración y se eliminaron --
eran exclusivos de estos dos templates, los tres restantes ya usaban
`renderNewDesignShell` desde antes.

## Fuera de alcance (explícitamente)

- La página de gestión de reservas (reagendar/cancelar) — ver `docs/superpowers/specs/2026-09-08-gestion-reservas-design.md`. El link de WhatsApp en `whatsappChangeNoteHtml()` es el reemplazo interino, no una promesa de fecha. Confirmado explícitamente por Aldo (2026-09-08): queda pendiente a propósito.
- Mantener `EMAIL_HERO_URL` sincronizada automáticamente con `siteImages` si el admin cambia la foto del sitio — hoy es una publicación manual (Task 3). Automatizarlo (ej. una Cloud Function que exporte la imagen activa a una URL fija) no está en este plan.
- Probar el envío real con el proveedor (Resend) en Gmail/Apple Mail/Outlook, tal como pide el `LEEME-ALDO.md` del paquete de diseño — este plan cubre el emulador; el envío de prueba a bandejas reales queda para quien lo ejecute, antes de considerar esto listo para producción.
