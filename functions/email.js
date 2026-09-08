// functions/email.js — render + envío de emails vía Resend.
'use strict';
const { Resend } = require('resend');
const { DEFAULT_TZ, zonedInstant } = require('./shared/timezone.js');
const { dateKeyOf } = require('./shared/availability.js');

const SITE_URL = 'https://scissorwhite.cl';
const ASSETS_URL = SITE_URL + '/assets/email'; // logo.png / salon.png (Gmail bloquea data-URIs)
// Foto hero del diseño 2026-09-08 (correo-reserva/correo-confirmacion) --
// distinta de ASSETS_URL + '/salon.png', que sigue usando el diseño
// anterior (renderReminderEmail/renderShopEmail, sin tocar en este cambio).
// Capturada por el diseñador el 08-09-2026 directo del sitio en vivo,
// porque el slot hero puede venir sobrescrito por siteImages (panel Fotos
// del admin) -- si alguien cambia esa foto desde el panel, esta imagen de
// correo queda desactualizada hasta que se vuelva a publicar a mano.
const EMAIL_HERO_URL = `${SITE_URL}/assets/email/hero-actual.jpg`;
const ADDRESS_LINE = 'Cochrane 635, Of. 303, Torre B, Concepción';
// Copia fija del aviso interno de nueva reserva, además de SHOP_EMAIL.
const SHOP_EMAIL_CC = ['amellado@micorriza.bio', 'scissorswhite111@gmail.com'];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Piezas de fecha para el bloque calendario del template (VIERNES / 07 / JULIO 2025).
// Arma el instante real desde dateKeyOf(dateStr)+time+tz (zonedInstant) en vez
// de parsear `dateStr` directo -- una vez que `date` sea fecha pura
// ('YYYY-MM-DD', Fase 2), new Date(dateStr) la interpreta como medianoche
// UTC, y mostrar ESE instante en una zona de offset negativo corre el día
// calendario hacia atrás (ej. "2026-06-15" -> medianoche UTC -> 2026-06-14
// 20:00 en Santiago). Mismo patrón que ya usa createBooking.js para el
// chequeo de futuro -- la hora siempre sale de `time`, nunca del contenido
// horario de `date`.
function dateParts(dateStr, time, tz) {
  try {
    const instant = zonedInstant(dateKeyOf(dateStr), time || '00:00', tz);
    if (isNaN(instant)) throw new Error('bad date');
    const weekday = instant.toLocaleDateString('es-CL', { weekday:'long', timeZone: tz }).toUpperCase();
    const day = instant.toLocaleDateString('es-CL', { day:'2-digit', timeZone: tz });
    const month = instant.toLocaleDateString('es-CL', { month:'long', timeZone: tz }).toUpperCase();
    const year = instant.toLocaleDateString('es-CL', { year:'numeric', timeZone: tz });
    return { weekday, day, monthYear: month + ' ' + year };
  } catch { return { weekday:'', day:'', monthYear: String(dateStr || '') }; }
}

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
function fmtCLP(n) { return '$' + Number(n || 0).toLocaleString('es-CL'); }

// SHOP_EMAIL puede traer varios destinatarios separados por coma (ej. dueño + recepción).
function parseRecipients(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

const FONT_SANS = "'Jost','Trebuchet MS',Arial,sans-serif";
const FONT_SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";

// Fila etiqueta/valor de la tarjeta de detalle.
function detailRow(label, valueHtml, last) {
  const border = last ? '' : 'border-bottom:1px solid #e5e4e1;';
  return `
    <tr>
      <td style="padding:15px 4px;${border}white-space:nowrap;font-family:${FONT_SANS};font-weight:400;font-size:11px;letter-spacing:2px;color:#6b6b6b;vertical-align:middle;width:110px;">${label}</td>
      <td style="padding:15px 4px;${border}font-family:${FONT_SERIF};font-weight:600;font-size:19px;color:#161616;vertical-align:middle;">${valueHtml}</td>
    </tr>`;
}

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
// (asistencia confirmada, Tarea 2). Incluye el fallback VML para Outlook
// clásico, igual que el mockup entregado.
function renderNewDesignShell({ preheader, eyebrow, headlineHtml, introHtml, fecha, hora, rows, belowRowsHtml }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>SW Studio</title><link href="https://fonts.googleapis.com/css2?family=Audiowide&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><style>body,table,td,a{font-family:${NEW_SANS}}table{border-collapse:collapse;text-align:left}a:focus-visible{outline:3px solid #6A7888;outline-offset:4px}@media(max-width:480px){.pad{padding-left:24px!important;padding-right:24px!important}.headline{font-size:29px!important}.cta-col{display:block!important;width:100%!important;padding:0 0 10px 0!important}}</style></head><body style="margin:0;padding:0;background:#eef0f2;color:#111111"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef0f2"><tr><td align="center" style="padding:24px 10px"><!--[if mso]><table role="presentation" width="600"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fafafa" bgcolor="#fafafa"><tr><td class="pad" style="padding:26px 40px;border-bottom:1px solid #d7dce2"><table role="presentation" width="100%"><tr><td><img src="${SITE_URL}/assets/logo.png" width="64" alt="SW Studio" style="display:block;width:64px;height:auto;border:0"></td><td align="right" style="font-size:11px;letter-spacing:2px;color:#505965">SCISSOR WHITE<br><span style="font-size:10px;line-height:24px">CONCEPCIÓN</span></td></tr></table></td></tr><tr><td class="pad" style="padding:34px 40px 26px"><p style="margin:0 0 16px;font-size:10px;font-weight:700;letter-spacing:2px;color:#596676">${eyebrow}</p><h1 class="headline" style="font-family:${NEW_DISPLAY};font-size:34px;line-height:1.22;letter-spacing:-1px;margin:0 0 20px">${headlineHtml}</h1><p style="font-size:15px;line-height:1.7;margin:0">${introHtml}</p></td></tr><tr><td background="${EMAIL_HERO_URL}" bgcolor="#24282d" width="600" height="360" valign="bottom" style="height:360px;background-color:#24282d;background-image:url('${EMAIL_HERO_URL}');background-size:cover;background-position:center 62%;background-repeat:no-repeat;padding:0;text-align:left">
<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:360px;"><v:fill type="frame" src="${EMAIL_HERO_URL}" color="#24282d"/><v:textbox inset="0,0,0,0"><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="180" style="height:180px;font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="padding:20px 24px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#1a1e23;background:rgba(12,15,19,0.70);border:1px solid #9aa5b2;border-radius:12px;padding:22px 24px;color:#ffffff;text-align:left"><p style="margin:0 0 10px;font-size:10px;line-height:1.4;letter-spacing:2px;color:#dce2e9">SCISSOR WHITE · CONCEPCIÓN</p><p style="margin:0;font-size:24px;line-height:1.25;font-weight:600;color:#ffffff">Más que cortes,<br>creamos identidad.</p></td></tr></table></td></tr></table>
<!--[if gte mso 9]></v:textbox></v:rect><![endif]--></td></tr><tr><td class="pad" style="padding:30px 40px"><p style="font-size:11px;letter-spacing:2px;color:#596676;margin:0 0 10px">TU CITA</p><p style="font-size:19px;line-height:1.5;font-weight:600;margin:0 0 8px">${esc(fecha)}</p><p style="font-size:34px;font-weight:700;letter-spacing:-1px;margin:0 0 18px">${esc(hora)} <span style="font-size:14px;font-weight:400;color:#505965">hrs · Chile</span></p><table role="presentation" width="100%" style="table-layout:fixed">${rows}</table><p style="font-size:14px;line-height:1.7;margin:22px 0"><strong>SW Studio · Concepción</strong><br>${esc(ADDRESS_LINE)}</p>${belowRowsHtml}</td></tr>${visitNoticeHtml()}<tr><td class="pad" style="padding:28px 40px;background:#111111;color:#ffffff"><p style="font-size:17px;line-height:1.5;margin:0 0 18px">Más que cortes,<br><strong>creamos identidad.</strong></p><a href="${SITE_URL}" style="font-size:12px;color:#c8d0da">scissorwhite.cl</a></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
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

// Bloque de dos botones (Confirmar/Declinar) compartido entre
// renderClientEmail y renderReminderEmail -- misma pieza visual en ambos
// correos. Cargar el link NUNCA ejecuta la acción: ambos apuntan a
// confirmar-cita.html, que exige un tap explícito antes de llamar a
// respondToBookingReminder -- necesario porque clientes de correo (Gmail,
// Outlook Safe Links) siguen/prefetchean links automáticamente por
// seguridad, y un link que ejecutara la acción con un simple GET se
// dispararía solo.
function confirmDeclineCta(confirmUrl, declineUrl) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
      <tr>
        <td class="sw-cta-col" width="50%" style="padding-right:6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#161616;border-radius:8px;">
            <tr><td align="center" style="padding:18px 10px;">
              <a href="${confirmUrl}" target="_blank" style="font-family:${FONT_SANS};font-weight:500;font-size:13px;letter-spacing:2px;color:#ffffff;">CONFIRMAR ASISTENCIA</a>
            </td></tr>
          </table>
        </td>
        <td class="sw-cta-col" width="50%" style="padding-left:6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:transparent;border:1px solid #161616;border-radius:8px;">
            <tr><td align="center" style="padding:18px 10px;">
              <a href="${declineUrl}" target="_blank" style="font-family:${FONT_SANS};font-weight:500;font-size:13px;letter-spacing:2px;color:#161616;">NO PODRÉ IR</a>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>`;
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

// Template del aviso interno de nueva reserva — mismo sistema visual que
// renderClientEmail (hero oscuro + tarjeta de detalle + footer) para que
// ambos correos se sientan de la misma familia de marca. Sin CTA ni banda de
// marketing: es una alerta operativa, no el momento "delight" del cliente.
function renderShopEmail(b) {
  const tz = b.tz || DEFAULT_TZ;
  const subject = `Nueva reserva — ${b.svcName} (${b.code})`;
  const d = dateParts(b.date, b.time, tz);
  const rows = [
    detailRow('CLIENTE', esc(b.name)),
    detailRow('TELÉFONO', `<a href="tel:${esc(b.phone)}" style="color:#161616;text-decoration:none;">${esc(b.phone)}</a>`),
    detailRow('EMAIL', `<a href="mailto:${esc(b.email)}" style="color:#161616;text-decoration:none;">${esc(b.email)}</a>`),
    detailRow('PROFESIONAL', esc(b.barberName)),
    detailRow('SERVICIO', esc(b.svcName)),
    b.dur ? detailRow('DURACIÓN', esc(b.dur) + ' minutos') : '',
    detailRow('VALOR', esc(fmtCLP(b.price))),
    detailRow('CÓDIGO', esc(b.code), true),
  ].join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,500&family=Jost:wght@200;300;400;500;600&display=swap');
  body { margin:0; padding:0; background:#cfccc7; -webkit-font-smoothing:antialiased; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; }
  a { color:inherit; text-decoration:none; }
  @media only screen and (max-width:640px) {
    .sw-wrap { width:100% !important; }
    .sw-col { display:block !important; width:100% !important; }
    .sw-title { font-size:26px !important; letter-spacing:7px !important; }
    .sw-card { padding:26px 18px 22px !important; }
    .sw-datecell { padding:0 0 22px 0 !important; }
    .sw-datebox { width:100% !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#cfccc7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#cfccc7;">
<tr><td align="center" style="padding:32px 10px;">

<table role="presentation" class="sw-wrap" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;background:#0e0e0e;border-radius:2px;overflow:hidden;">

  <!-- HERO -->
  <tr><td style="background:#0e0e0e;padding:38px 32px 40px;">
    <img src="${ASSETS_URL}/logo.png" alt="SW Studio" width="64" height="64" style="display:block;border-radius:50%;margin-bottom:28px;">
    <h1 class="sw-title" style="margin:0;font-family:${FONT_SANS};font-weight:300;font-size:33px;letter-spacing:10px;color:#ffffff;line-height:1.4;">NUEVA<br>RESERVA</h1>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:44px;height:1px;background:rgba(255,255,255,.45);font-size:0;line-height:0;padding:0;margin:0;" height="1"></td></tr></table>
    <p style="margin:20px 0 0;font-family:${FONT_SERIF};font-style:italic;font-weight:500;font-size:20px;color:#f2f2f2;line-height:1.3;">Se agendó una nueva hora desde el sitio.</p>
  </td></tr>

  <!-- DETAIL CARD -->
  <tr><td class="sw-card" style="background:#f3f2f0;padding:34px 30px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <!-- Bloque fecha -->
        <td class="sw-col sw-datecell" width="150" valign="top" style="padding:0 22px 0 0;">
          <table role="presentation" width="150" class="sw-datebox" cellpadding="0" cellspacing="0" style="background:#161616;border-radius:14px;">
            <tr><td align="center" style="padding:26px 14px;">
              <div style="font-family:${FONT_SANS};font-weight:400;font-size:12px;letter-spacing:4px;color:#e9e9e9;">${esc(d.weekday)}</div>
              <div style="font-family:${FONT_SANS};font-weight:200;font-size:72px;letter-spacing:2px;line-height:1;color:#ffffff;margin:8px 0 6px;">${esc(d.day)}</div>
              <div style="font-family:${FONT_SANS};font-weight:400;font-size:12px;letter-spacing:3px;color:#e9e9e9;">${esc(d.monthYear)}</div>
              <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:16px auto;"><tr><td style="width:26px;height:1px;background:rgba(255,255,255,.4);font-size:0;line-height:0;" height="1"></td></tr></table>
              <div style="font-family:${FONT_SANS};font-weight:500;font-size:15px;letter-spacing:.5px;color:#ffffff;white-space:nowrap;">${esc(b.time)} HRS</div>
            </td></tr>
          </table>
        </td>
        <!-- Campos -->
        <td class="sw-col" valign="middle">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
          </table>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#f3f2f0;padding:20px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="44" valign="middle"><img src="${ASSETS_URL}/logo.png" alt="SW Studio" width="44" height="44" style="display:block;border-radius:50%;"></td>
        <td valign="middle" style="padding:0 0 0 18px;font-family:${FONT_SERIF};font-weight:400;font-size:16px;color:#4a4a4a;">Más que cortes, creamos identidad</td>
      </tr>
    </table>
  </td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;
  return { subject, html };
}

// Template "SW Studio — Recordatorio de cita": mismo sistema visual que
// renderClientEmail (hero oscuro + tarjeta de detalle + banda de marca +
// footer), pero con dos CTA (Confirmar/Declinar) en vez de un solo botón --
// cierra el flujo de recordatorio 24h antes (ver functions/reminders.js y
// exports.sendBookingReminders en index.js). Cargar el link NUNCA ejecuta
// la acción: ambos apuntan a confirmar-cita.html, que exige un tap
// explícito antes de llamar a respondToBookingReminder -- necesario porque
// clientes de correo (Gmail, Outlook Safe Links) siguen/prefetchean links
// automáticamente por seguridad, y un link que ejecutara la acción con un
// simple GET se dispararía solo.
function renderReminderEmail(b, token) {
  const tz = b.tz || DEFAULT_TZ;
  const subject = `¿Confirmas tu cita de mañana a las ${b.time}? — Scissor White`;
  const d = dateParts(b.date, b.time, tz);
  const { confirmUrl, declineUrl } = confirmDeclineUrls(b.code, token);
  const rows = [
    detailRow('PROFESIONAL', esc(b.barberName)),
    detailRow('SERVICIO', esc(b.svcName)),
    detailRow('CÓDIGO', esc(b.code), true),
  ].join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,500&family=Jost:wght@200;300;400;500;600&display=swap');
  body { margin:0; padding:0; background:#cfccc7; -webkit-font-smoothing:antialiased; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; }
  a { color:inherit; text-decoration:none; }
  @media only screen and (max-width:640px) {
    .sw-wrap { width:100% !important; }
    .sw-col { display:block !important; width:100% !important; }
    .sw-title { font-size:26px !important; letter-spacing:7px !important; }
    .sw-card { padding:26px 18px 22px !important; }
    .sw-datecell { padding:0 0 22px 0 !important; }
    .sw-datebox { width:100% !important; }
    .sw-cta-col { display:block !important; width:100% !important; padding:0 0 10px 0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#cfccc7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#cfccc7;">
<tr><td align="center" style="padding:32px 10px;">

<table role="presentation" class="sw-wrap" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;background:#0e0e0e;border-radius:2px;overflow:hidden;">

  <!-- HERO -->
  <tr><td style="background:#0e0e0e;padding:38px 32px 40px;">
    <img src="${ASSETS_URL}/logo.png" alt="SW Studio" width="64" height="64" style="display:block;border-radius:50%;margin-bottom:28px;">
    <h1 class="sw-title" style="margin:0;font-family:${FONT_SANS};font-weight:300;font-size:33px;letter-spacing:10px;color:#ffffff;line-height:1.4;">TU CITA<br>ES MAÑANA</h1>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:44px;height:1px;background:rgba(255,255,255,.45);font-size:0;line-height:0;padding:0;margin:0;" height="1"></td></tr></table>
    <p style="margin:20px 0 0;font-family:${FONT_SERIF};font-style:italic;font-weight:500;font-size:20px;color:#f2f2f2;line-height:1.3;">¿Nos confirmas tu asistencia?</p>
  </td></tr>

  <!-- DETAIL CARD -->
  <tr><td class="sw-card" style="background:#f3f2f0;padding:34px 30px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td class="sw-col sw-datecell" width="150" valign="top" style="padding:0 22px 0 0;">
          <table role="presentation" width="150" class="sw-datebox" cellpadding="0" cellspacing="0" style="background:#161616;border-radius:14px;">
            <tr><td align="center" style="padding:26px 14px;">
              <div style="font-family:${FONT_SANS};font-weight:400;font-size:12px;letter-spacing:4px;color:#e9e9e9;">${esc(d.weekday)}</div>
              <div style="font-family:${FONT_SANS};font-weight:200;font-size:72px;letter-spacing:2px;line-height:1;color:#ffffff;margin:8px 0 6px;">${esc(d.day)}</div>
              <div style="font-family:${FONT_SANS};font-weight:400;font-size:12px;letter-spacing:3px;color:#e9e9e9;">${esc(d.monthYear)}</div>
              <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:16px auto;"><tr><td style="width:26px;height:1px;background:rgba(255,255,255,.4);font-size:0;line-height:0;" height="1"></td></tr></table>
              <div style="font-family:${FONT_SANS};font-weight:500;font-size:15px;letter-spacing:.5px;color:#ffffff;white-space:nowrap;">${esc(b.time)} HRS</div>
            </td></tr>
          </table>
        </td>
        <td class="sw-col" valign="middle">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
          </table>
        </td>
      </tr>
    </table>

    <!-- CTA: Confirmar / Declinar -->
    ${confirmDeclineCta(confirmUrl, declineUrl)}
  </td></tr>

  <!-- BANDA OSCURA -->
  <tr><td style="background:#0e0e0e;padding:30px 32px;">
    <div style="font-family:${FONT_SANS};font-weight:500;font-size:13px;letter-spacing:4px;color:#ffffff;margin-bottom:8px;">VISAGISMO · ESTILO · CONFIANZA</div>
    <p style="margin:0;font-family:${FONT_SERIF};font-weight:400;font-size:16px;color:#b9b7b4;line-height:1.5;">Te esperamos en SW Studio. Si necesitas reagendar, escríbenos por <a href="https://wa.me/56982514114" target="_blank" style="color:#ffffff;text-decoration:underline;">WhatsApp</a>.</p>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#f3f2f0;padding:20px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="44" valign="middle"><img src="${ASSETS_URL}/logo.png" alt="SW Studio" width="44" height="44" style="display:block;border-radius:50%;"></td>
        <td valign="middle" style="padding:0 0 0 18px;font-family:${FONT_SERIF};font-weight:400;font-size:16px;color:#4a4a4a;">Más que cortes, creamos identidad</td>
      </tr>
    </table>
  </td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;
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
// declina) -- mismo sistema visual que renderShopEmail (alerta operativa,
// sin CTA ni banda de marketing): el negocio se entera sin depender de
// revisar la Agenda a mano. Se dispara desde
// exports.respondToBookingReminder (functions/index.js), después de que la
// transición de estado ya se escribió -- este email es respaldo, no la
// fuente de verdad, mismo criterio que el resto de los avisos del negocio.
function renderReminderResponseEmail(b, action) {
  const tz = b.tz || DEFAULT_TZ;
  const isConfirmed = action === 'confirm';
  const subject = (isConfirmed ? 'Cliente confirmó su cita' : 'Cliente declinó su cita') + ` — ${b.code}`;
  const d = dateParts(b.date, b.time, tz);
  const rows = [
    detailRow('CLIENTE', esc(b.name)),
    detailRow('TELÉFONO', `<a href="tel:${esc(b.phone)}" style="color:#161616;text-decoration:none;">${esc(b.phone)}</a>`),
    detailRow('PROFESIONAL', esc(b.barberName)),
    detailRow('SERVICIO', esc(b.svcName)),
    detailRow('CÓDIGO', esc(b.code), true),
  ].join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,500&family=Jost:wght@200;300;400;500;600&display=swap');
  body { margin:0; padding:0; background:#cfccc7; -webkit-font-smoothing:antialiased; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; }
  a { color:inherit; text-decoration:none; }
  @media only screen and (max-width:640px) {
    .sw-wrap { width:100% !important; }
    .sw-col { display:block !important; width:100% !important; }
    .sw-title { font-size:26px !important; letter-spacing:7px !important; }
    .sw-card { padding:26px 18px 22px !important; }
    .sw-datecell { padding:0 0 22px 0 !important; }
    .sw-datebox { width:100% !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#cfccc7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#cfccc7;">
<tr><td align="center" style="padding:32px 10px;">

<table role="presentation" class="sw-wrap" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;background:#0e0e0e;border-radius:2px;overflow:hidden;">

  <!-- HERO -->
  <tr><td style="background:#0e0e0e;padding:38px 32px 40px;">
    <img src="${ASSETS_URL}/logo.png" alt="SW Studio" width="64" height="64" style="display:block;border-radius:50%;margin-bottom:28px;">
    <h1 class="sw-title" style="margin:0;font-family:${FONT_SANS};font-weight:300;font-size:33px;letter-spacing:10px;color:#ffffff;line-height:1.4;">${isConfirmed ? 'CITA<br>CONFIRMADA' : 'CITA<br>DECLINADA'}</h1>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:44px;height:1px;background:rgba(255,255,255,.45);font-size:0;line-height:0;padding:0;margin:0;" height="1"></td></tr></table>
    <p style="margin:20px 0 0;font-family:${FONT_SERIF};font-style:italic;font-weight:500;font-size:20px;color:#f2f2f2;line-height:1.3;">${isConfirmed ? 'El cliente confirmó su asistencia al recordatorio.' : 'El cliente avisó que no podrá asistir — el horario ya quedó libre.'}</p>
  </td></tr>

  <!-- DETAIL CARD -->
  <tr><td class="sw-card" style="background:#f3f2f0;padding:34px 30px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <!-- Bloque fecha -->
        <td class="sw-col sw-datecell" width="150" valign="top" style="padding:0 22px 0 0;">
          <table role="presentation" width="150" class="sw-datebox" cellpadding="0" cellspacing="0" style="background:#161616;border-radius:14px;">
            <tr><td align="center" style="padding:26px 14px;">
              <div style="font-family:${FONT_SANS};font-weight:400;font-size:12px;letter-spacing:4px;color:#e9e9e9;">${esc(d.weekday)}</div>
              <div style="font-family:${FONT_SANS};font-weight:200;font-size:72px;letter-spacing:2px;line-height:1;color:#ffffff;margin:8px 0 6px;">${esc(d.day)}</div>
              <div style="font-family:${FONT_SANS};font-weight:400;font-size:12px;letter-spacing:3px;color:#e9e9e9;">${esc(d.monthYear)}</div>
              <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:16px auto;"><tr><td style="width:26px;height:1px;background:rgba(255,255,255,.4);font-size:0;line-height:0;" height="1"></td></tr></table>
              <div style="font-family:${FONT_SANS};font-weight:500;font-size:15px;letter-spacing:.5px;color:#ffffff;white-space:nowrap;">${esc(b.time)} HRS</div>
            </td></tr>
          </table>
        </td>
        <!-- Campos -->
        <td class="sw-col" valign="middle">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
          </table>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#f3f2f0;padding:20px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="44" valign="middle"><img src="${ASSETS_URL}/logo.png" alt="SW Studio" width="44" height="44" style="display:block;border-radius:50%;"></td>
        <td valign="middle" style="padding:0 0 0 18px;font-family:${FONT_SERIF};font-weight:400;font-size:16px;color:#4a4a4a;">Más que cortes, creamos identidad</td>
      </tr>
    </table>
  </td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;
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
