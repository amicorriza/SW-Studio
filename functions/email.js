// functions/email.js — render + envío de emails vía Resend.
'use strict';
const { Resend } = require('resend');
const { DEFAULT_TZ, zonedInstant } = require('./shared/timezone.js');
const { dateKeyOf } = require('./shared/availability.js');

const SITE_URL = 'https://scissorwhite.cl';
// Foto hero del diseño 2026-09-08, usada por los cinco templates (todos
// migraron a renderNewDesignShell). Capturada por el diseñador el 08-09-2026
// directo del sitio en vivo, porque el slot hero puede venir sobrescrito por
// siteImages (panel Fotos del admin) -- si alguien cambia esa foto desde el
// panel, esta imagen de correo queda desactualizada hasta que se vuelva a
// publicar a mano.
const EMAIL_HERO_URL = `${SITE_URL}/assets/email/hero-actual.jpg`;
const ADDRESS_LINE = 'Cochrane 635, Of. 303, Torre B, Concepción';
// Copia fija del aviso interno de nueva reserva, además de SHOP_EMAIL.
const SHOP_EMAIL_CC = ['amellado@micorriza.bio', 'scissorswhite111@gmail.com'];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Fecha en una sola frase capitalizada ("Miércoles 10 de junio de 2026").
// Arma el instante real desde dateKeyOf(dateStr)+time+tz (zonedInstant) en vez
// de parsear `dateStr` directo -- una vez que `date` sea fecha pura
// ('YYYY-MM-DD', Fase 2), new Date(dateStr) la interpreta como medianoche
// UTC, y mostrar ESE instante en una zona de offset negativo corre el día
// calendario hacia atrás (ej. "2026-06-15" -> medianoche UTC -> 2026-06-14
// 20:00 en Santiago). Mismo patrón que ya usa createBooking.js para el
// chequeo de futuro -- la hora siempre sale de `time`, nunca del contenido
// horario de `date`.
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
function fmtCLP(n) { return '$' + Number(n || 0).toLocaleString('es-CL'); }

// SHOP_EMAIL puede traer varios destinatarios separados por coma (ej. dueño + recepción).
function parseRecipients(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

const NEW_SANS = 'Inter,Arial,Helvetica,sans-serif';
const NEW_DISPLAY = 'Audiowide,Arial,Helvetica,sans-serif';

// Fila etiqueta/valor de la tarjeta "TU CITA"/"LA CITA" del diseño 2026-09-08
// -- usada por los cinco templates (correos al cliente y avisos internos).
function newDetailRow(label, valueHtml, last) {
  const border = last ? '' : 'border-bottom:1px solid #e0e4e8;';
  return `<tr><td style="padding:13px 0;${border}color:#505965;font-size:13px;width:36%;vertical-align:top;font-family:${NEW_SANS};">${label}</td><td style="padding:13px 0;${border}font-size:15px;font-weight:600;overflow-wrap:anywhere;font-family:${NEW_SANS};">${valueHtml}</td></tr>`;
}

// Filas de la tarjeta "TU CITA" -- compartidas por renderClientEmail y
// renderConfirmationEmail (mismo detalle de la reserva en ambos correos,
// renderConfirmationEmail se agrega en la Tarea 2 -- no es parte de este
// trabajo, pero esta función queda lista para que la reuse).
function citaDetailRows(b) {
  return [
    newDetailRow('Servicio', esc(b.svcName)),
    newDetailRow('Profesional', esc(b.barberName)),
    b.dur ? newDetailRow('Duración', esc(b.dur) + ' minutos') : '',
    newDetailRow('Valor', esc(fmtCLP(b.price))),
    newDetailRow('Código', esc(b.code), true),
  ].join('');
}

// Filas de la tarjeta de detalle en renderShopEmail -- a diferencia de
// citaDetailRows (lo que el cliente ya sabe de su propia reserva), el staff
// necesita además CLIENTE/TELÉFONO/EMAIL para poder contactarlo.
function shopDetailRows(b) {
  return [
    newDetailRow('Cliente', esc(b.name)),
    newDetailRow('Teléfono', `<a href="tel:${esc(b.phone)}" style="color:#111111;text-decoration:none;">${esc(b.phone)}</a>`),
    newDetailRow('Email', `<a href="mailto:${esc(b.email)}" style="color:#111111;text-decoration:none;">${esc(b.email)}</a>`),
    newDetailRow('Profesional', esc(b.barberName)),
    newDetailRow('Servicio', esc(b.svcName)),
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

// Bloque de dos botones (Confirmar/Declinar) del diseño 2026-09-08 -- usado
// por renderClientEmail y renderReminderEmail (los dos correos con una
// acción pendiente; renderConfirmationEmail no lo usa, ya no hay nada que
// decidir). Cargar el link NUNCA ejecuta la acción: ambos apuntan a
// confirmar-cita.html (code+token+r), que exige un tap explícito antes de
// llamar a respondToBookingReminder -- necesario porque clientes de correo
// (Gmail, Outlook Safe Links) siguen/prefetchean links automáticamente por
// seguridad, y un link que ejecutara la acción con un simple GET se
// dispararía solo.
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
// -- usado por los correos al CLIENTE (renderClientEmail, renderConfirmationEmail,
// renderReminderEmail) y, desde hoy, también por los avisos internos a la
// barbería (renderShopEmail, renderReminderResponseEmail): misma familia
// visual para toda la correspondencia, aunque el destinatario cambie.
// `citaLabel` default 'TU CITA' porque los tres correos al cliente hablan en
// segunda persona; los avisos internos pasan 'LA CITA' (le describen a un
// tercero -- el staff -- la cita de otra persona). `showVisitNotice` (default
// true) apaga la franja "antes de tu visita": ese aviso de ventana de cambios
// es un compromiso con el cliente, no información que el staff necesite leer
// sobre sí mismo. Incluye el fallback VML para Outlook clásico, igual que el
// mockup entregado.
function renderNewDesignShell({ preheader, eyebrow, headlineHtml, introHtml, fecha, hora, rows, belowRowsHtml, citaLabel = 'TU CITA', showVisitNotice = true }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>SW Studio</title><link href="https://fonts.googleapis.com/css2?family=Audiowide&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><style>body,table,td,a{font-family:${NEW_SANS}}table{border-collapse:collapse;text-align:left}a:focus-visible{outline:3px solid #6A7888;outline-offset:4px}@media(max-width:480px){.pad{padding-left:24px!important;padding-right:24px!important}.headline{font-size:29px!important}.cta-col{display:block!important;width:100%!important;padding:0 0 10px 0!important}}</style></head><body style="margin:0;padding:0;background:#eef0f2;color:#111111"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef0f2"><tr><td align="center" style="padding:24px 10px"><!--[if mso]><table role="presentation" width="600"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fafafa" bgcolor="#fafafa"><tr><td class="pad" style="padding:26px 40px;border-bottom:1px solid #d7dce2"><table role="presentation" width="100%"><tr><td><img src="${SITE_URL}/assets/logo.png" width="64" alt="SW Studio" style="display:block;width:64px;height:auto;border:0"></td><td align="right" style="font-size:11px;letter-spacing:2px;color:#505965">SCISSOR WHITE<br><span style="font-size:10px;line-height:24px">CONCEPCIÓN</span></td></tr></table></td></tr><tr><td class="pad" style="padding:34px 40px 26px"><p style="margin:0 0 16px;font-size:10px;font-weight:700;letter-spacing:2px;color:#596676">${eyebrow}</p><h1 class="headline" style="font-family:${NEW_DISPLAY};font-size:34px;line-height:1.22;letter-spacing:-1px;margin:0 0 20px">${headlineHtml}</h1><p style="font-size:15px;line-height:1.7;margin:0">${introHtml}</p></td></tr><tr><td background="${EMAIL_HERO_URL}" bgcolor="#24282d" width="600" height="360" valign="bottom" style="height:360px;background-color:#24282d;background-image:url('${EMAIL_HERO_URL}');background-size:cover;background-position:center 62%;background-repeat:no-repeat;padding:0;text-align:left">
<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:360px;"><v:fill type="frame" src="${EMAIL_HERO_URL}" color="#24282d"/><v:textbox inset="0,0,0,0"><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="180" style="height:180px;font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="padding:20px 24px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#1a1e23;background:rgba(12,15,19,0.70);border:1px solid #9aa5b2;border-radius:12px;padding:22px 24px;color:#ffffff;text-align:left"><p style="margin:0 0 10px;font-size:10px;line-height:1.4;letter-spacing:2px;color:#dce2e9">SCISSOR WHITE · CONCEPCIÓN</p><p style="margin:0;font-size:24px;line-height:1.25;font-weight:600;color:#ffffff">Más que cortes,<br>creamos identidad.</p></td></tr></table></td></tr></table>
<!--[if gte mso 9]></v:textbox></v:rect><![endif]--></td></tr><tr><td class="pad" style="padding:30px 40px"><p style="font-size:11px;letter-spacing:2px;color:#596676;margin:0 0 10px">${citaLabel}</p><p style="font-size:19px;line-height:1.5;font-weight:600;margin:0 0 8px">${esc(fecha)}</p><p style="font-size:34px;font-weight:700;letter-spacing:-1px;margin:0 0 18px">${esc(hora)} <span style="font-size:14px;font-weight:400;color:#505965">hrs · Chile</span></p><table role="presentation" width="100%" style="table-layout:fixed">${rows}</table><p style="font-size:14px;line-height:1.7;margin:22px 0"><strong>SW Studio · Concepción</strong><br>${esc(ADDRESS_LINE)}</p>${belowRowsHtml}</td></tr>${showVisitNotice ? visitNoticeHtml() : ''}<tr><td class="pad" style="padding:28px 40px;background:#111111;color:#ffffff"><p style="font-size:17px;line-height:1.5;margin:0 0 18px">Más que cortes,<br><strong>creamos identidad.</strong></p><a href="${SITE_URL}" style="font-size:12px;color:#c8d0da">scissorwhite.cl</a></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}

// URLs de acción del recordatorio de citas -- comparten forma entre
// renderClientEmail (email inicial) y renderReminderEmail (24h antes), así
// que un cliente puede usar el link de CUALQUIERA de los dos correos
// indistintamente mientras el token siga siendo válido.
function confirmDeclineUrls(code, token) {
  return {
    confirmUrl: `${SITE_URL}/confirmar-cita.html?code=${encodeURIComponent(code)}&t=${encodeURIComponent(token)}&r=confirm`,
    declineUrl: `${SITE_URL}/confirmar-cita.html?code=${encodeURIComponent(code)}&t=${encodeURIComponent(token)}&r=decline`,
  };
}

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

// Template del aviso interno de nueva reserva — diseño 2026-09-08, mismo
// shell que los correos al cliente (renderNewDesignShell) para que toda la
// correspondencia se sienta de la misma familia de marca. Sin CTA (nada que
// el staff deba decidir) ni aviso de ventana de cambios (showVisitNotice:
// false -- ese compromiso es con el cliente, no información para el staff).
function renderShopEmail(b) {
  const tz = b.tz || DEFAULT_TZ;
  const fecha = fmtFechaLarga(b.date, b.time, tz);
  const subject = `Nueva reserva — ${b.svcName} (${b.code})`;
  const html = renderNewDesignShell({
    preheader: `Se agendó una nueva hora desde el sitio — ${b.code}.`,
    eyebrow: 'NUEVA RESERVA',
    headlineHtml: 'Nueva reserva.',
    introHtml: 'Se agendó una nueva hora desde el sitio.',
    fecha, hora: b.time,
    citaLabel: 'LA CITA',
    rows: shopDetailRows(b),
    belowRowsHtml: '',
    showVisitNotice: false,
  });
  return { subject, html };
}

// Template "SW Studio — Recordatorio de cita": diseño 2026-09-08 (Audiowide +
// Inter, foto hero + tarjeta semitransparente) vía renderNewDesignShell(),
// igual que renderClientEmail -- cierra el flujo de recordatorio 24h antes
// (ver functions/reminders.js y exports.sendBookingReminders en index.js).
// Cargar el link NUNCA ejecuta la acción: ambos apuntan a confirmar-cita.html,
// que exige un tap explícito antes de llamar a respondToBookingReminder --
// necesario porque clientes de correo (Gmail, Outlook Safe Links) siguen/
// prefetchean links automáticamente por seguridad, y un link que ejecutara
// la acción con un simple GET se dispararía solo.
function renderReminderEmail(b, token) {
  const tz = b.tz || DEFAULT_TZ;
  const fecha = fmtFechaLarga(b.date, b.time, tz);
  const { confirmUrl, declineUrl } = confirmDeclineUrls(b.code, token);
  const subject = `¿Confirmas tu cita de mañana a las ${b.time}? — SW Studio`;
  const html = renderNewDesignShell({
    preheader: '¿Nos confirmas tu asistencia? Tu cita es mañana.',
    eyebrow: 'TU CITA ES MAÑANA',
    headlineHtml: '¿Nos confirmas<br>tu asistencia?',
    introHtml: `Hola, ${esc(b.name)}.<br>Tu cita es mañana. Confírmanos tu asistencia para que sepamos que te esperamos.`,
    fecha, hora: b.time,
    rows: citaDetailRows(b),
    belowRowsHtml: confirmDeclineButtonsHtml(confirmUrl, declineUrl) + whatsappChangeNoteHtml(),
  });
  return { subject, html };
}

async function sendReminderEmail(b, token, { apiKey, fromEmail }) {
  const resend = new Resend(apiKey);
  const { subject, html } = renderReminderEmail(b, token);
  const result = await resend.emails.send({ from: fromEmail, to: b.email, subject, html });
  assertResendOk([result]);
}

async function sendConfirmationEmail(b, { apiKey, fromEmail }) {
  const resend = new Resend(apiKey);
  const { subject, html } = renderConfirmationEmail(b);
  const result = await resend.emails.send({ from: fromEmail, to: b.email, subject, html });
  assertResendOk([result]);
}

// Aviso interno cuando el cliente responde al recordatorio (confirma o
// declina) -- mismo shell que renderShopEmail: sin CTA, sin aviso de ventana
// de cambios (el negocio no necesita releer su propia política). Se dispara
// desde exports.respondToBookingReminder (functions/index.js), después de
// que la transición de estado ya se escribió -- este email es respaldo, no
// la fuente de verdad, mismo criterio que el resto de los avisos del negocio.
function renderReminderResponseEmail(b, action) {
  const tz = b.tz || DEFAULT_TZ;
  const isConfirmed = action === 'confirm';
  const fecha = fmtFechaLarga(b.date, b.time, tz);
  const subject = (isConfirmed ? 'Cliente confirmó su cita' : 'Cliente declinó su cita') + ` — ${b.code}`;
  const rows = [
    newDetailRow('Cliente', esc(b.name)),
    newDetailRow('Teléfono', `<a href="tel:${esc(b.phone)}" style="color:#111111;text-decoration:none;">${esc(b.phone)}</a>`),
    newDetailRow('Profesional', esc(b.barberName)),
    newDetailRow('Servicio', esc(b.svcName)),
    newDetailRow('Código', esc(b.code), true),
  ].join('');
  const html = renderNewDesignShell({
    preheader: (isConfirmed ? 'El cliente confirmó su asistencia al recordatorio.' : 'El cliente avisó que no podrá asistir.') + ` — ${b.code}`,
    eyebrow: isConfirmed ? 'CITA CONFIRMADA' : 'CITA DECLINADA',
    headlineHtml: isConfirmed ? 'Cliente confirmó<br>su cita.' : 'Cliente declinó<br>su cita.',
    introHtml: isConfirmed ? 'El cliente confirmó su asistencia al recordatorio.' : 'El cliente avisó que no podrá asistir — el horario ya quedó libre.',
    fecha, hora: b.time,
    citaLabel: 'LA CITA',
    rows,
    belowRowsHtml: '',
    showVisitNotice: false,
  });
  return { subject, html };
}

async function sendReminderResponseEmail(b, action, { apiKey, fromEmail, shopEmail }) {
  const resend = new Resend(apiKey);
  const { subject, html } = renderReminderResponseEmail(b, action);
  const result = await resend.emails.send({ from: fromEmail, to: parseRecipients(shopEmail), cc: SHOP_EMAIL_CC, subject, html });
  assertResendOk([result]);
}

// El SDK de Resend no lanza en errores de API: resuelve con {data, error}.
// Hay que inspeccionar `error` o los envíos rechazados pasarían por exitosos.
function assertResendOk(results) {
  const errs = results.map(r => r && r.error).filter(Boolean);
  if (errs.length) {
    throw new Error('Resend rechazó el envío: ' + errs.map(e => e.message || JSON.stringify(e)).join(' | '));
  }
}

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

module.exports = {
  renderClientEmail, renderShopEmail, renderReminderEmail, renderReminderResponseEmail,
  renderConfirmationEmail, sendConfirmationEmail,
  sendBookingEmails, sendReminderEmail, sendReminderResponseEmail, parseRecipients, assertResendOk,
};
