// functions/email.js — render + envío de emails vía Resend.
'use strict';
const { Resend } = require('resend');

const SITE_URL = 'https://scissorwhite.cl';
const ASSETS_URL = SITE_URL + '/assets/email'; // logo.png / salon.png (Gmail bloquea data-URIs)
const TZ = 'America/Santiago';
const ADDRESS_LINE = 'Cochrane 635, Of. 303, Torre B, Concepción';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long', timeZone: TZ }); }
  catch { return iso; }
}
// Piezas de fecha para el bloque calendario del template (VIERNES / 07 / JULIO 2025).
function dateParts(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) throw new Error('bad date');
    const weekday = d.toLocaleDateString('es-CL', { weekday:'long', timeZone: TZ }).toUpperCase();
    const day = d.toLocaleDateString('es-CL', { day:'2-digit', timeZone: TZ });
    const month = d.toLocaleDateString('es-CL', { month:'long', timeZone: TZ }).toUpperCase();
    const year = d.toLocaleDateString('es-CL', { year:'numeric', timeZone: TZ });
    return { weekday, day, monthYear: month + ' ' + year };
  } catch { return { weekday:'', day:'', monthYear: String(iso || '') }; }
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

// Template "SW Studio — Reserva Confirmada": versión email-safe (tablas + estilos
// inline; sin flexbox ni SVG, que Gmail/Outlook no soportan). Las imágenes viven
// en Hosting (public/assets/email) porque los clientes de correo bloquean data-URIs.
function renderClientEmail(b) {
  const subject = `Tu reserva en Scissor White — ${b.code}`;
  const d = dateParts(b.date);
  const rows = [
    detailRow('CLIENTE', esc(b.name)),
    detailRow('PROFESIONAL', esc(b.barberName)),
    detailRow('SERVICIO', esc(b.svcName)),
    b.dur ? detailRow('DURACIÓN', esc(b.dur) + ' minutos') : '',
    detailRow('VALOR', esc(fmtCLP(b.price))),
    detailRow('CÓDIGO', esc(b.code)),
    detailRow('SUCURSAL',
      `<span style="display:block;line-height:1.2;">SW Studio · Concepción</span>
       <span style="display:block;font-weight:400;font-size:15px;color:#8a8a8a;">${esc(ADDRESS_LINE)}</span>`, true),
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
    .sw-hero-img { height:260px !important; }
    .sw-hero-txt { padding:32px 24px 36px !important; }
    .sw-title { font-size:26px !important; letter-spacing:7px !important; }
    .sw-card { padding:26px 18px 22px !important; }
    .sw-datecell { padding:0 0 22px 0 !important; }
    .sw-datebox { width:100% !important; }
    .sw-foot-links { display:block !important; width:100% !important; text-align:left !important; padding-top:12px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#cfccc7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#cfccc7;">
<tr><td align="center" style="padding:32px 10px;">

<table role="presentation" class="sw-wrap" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;background:#0e0e0e;border-radius:2px;overflow:hidden;">

  <!-- HERO -->
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td class="sw-col sw-hero-txt" width="52%" valign="top" style="background:#0e0e0e;padding:38px 32px 44px;">
          <img src="${ASSETS_URL}/logo.png" alt="SW Studio" width="82" height="82" style="display:block;border-radius:50%;margin-bottom:44px;">
          <h1 class="sw-title" style="margin:0;font-family:${FONT_SANS};font-weight:300;font-size:33px;letter-spacing:10px;color:#ffffff;line-height:1.4;">RESERVA<br>CONFIRMADA</h1>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:44px;height:1px;background:rgba(255,255,255,.45);font-size:0;line-height:0;padding:0;margin:0;" height="1"></td></tr></table>
          <p style="margin:20px 0 0;font-family:${FONT_SERIF};font-style:italic;font-weight:500;font-size:22px;color:#f2f2f2;line-height:1.3;">Más que cortes,<br>creamos identidad</p>
          <p style="margin:26px 0 0;font-family:${FONT_SERIF};font-weight:400;font-size:17px;color:#c9c7c4;line-height:1.55;">Tu hora ha sido reservada correctamente.<br>Gracias por elegir SW Studio.<br>Te esperamos.</p>
        </td>
        <td class="sw-col" width="48%" valign="top" style="background:#0e0e0e;padding:0;">
          <img src="${ASSETS_URL}/salon.png" alt="Salón SW Studio" width="307" class="sw-hero-img" style="display:block;width:100%;height:486px;object-fit:cover;">
        </td>
      </tr>
    </table>
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

    <!-- CTA -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
      <tr><td style="background:#161616;border:1px solid rgba(255,255,255,.1);border-radius:8px;">
        <a href="${SITE_URL}" target="_blank" style="display:block;padding:21px 30px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-family:${FONT_SANS};font-weight:500;font-size:15px;letter-spacing:5px;color:#ffffff;">VER MI RESERVA</td>
            <td align="right" style="font-family:${FONT_SANS};font-weight:300;font-size:22px;color:#ffffff;line-height:1;">&#8594;</td>
          </tr></table>
        </a>
      </td></tr>
    </table>

    <!-- Aviso -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
      <tr><td style="background:#e7e6e3;border-radius:10px;padding:20px 22px;">
        <p style="margin:0;font-family:${FONT_SERIF};font-weight:400;font-size:17px;color:#3a3a3a;line-height:1.45;">Si necesitas modificar o cancelar tu cita, puedes hacerlo hasta <strong style="font-weight:600;">2 horas</strong> antes de la hora reservada, escribiéndonos por <a href="https://wa.me/56982514114" target="_blank" style="color:#161616;text-decoration:underline;">WhatsApp</a>.</p>
      </td></tr>
    </table>
  </td></tr>

  <!-- BANDA OSCURA -->
  <tr><td style="background:#0e0e0e;padding:30px 32px;">
    <div style="font-family:${FONT_SANS};font-weight:500;font-size:13px;letter-spacing:4px;color:#ffffff;margin-bottom:8px;">VISAGISMO · ESTILO · CONFIANZA</div>
    <p style="margin:0;font-family:${FONT_SERIF};font-weight:400;font-size:16px;color:#b9b7b4;line-height:1.5;">En SW Studio combinamos técnica, precisión y visagismo para realzar tu imagen y potenciar tu mejor versión.</p>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#f3f2f0;padding:20px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="44" valign="middle"><img src="${ASSETS_URL}/logo.png" alt="SW Studio" width="44" height="44" style="display:block;border-radius:50%;"></td>
        <td valign="middle" style="padding:0 0 0 18px;font-family:${FONT_SERIF};font-weight:400;font-size:16px;color:#4a4a4a;">Más que cortes, creamos identidad</td>
        <td align="right" valign="middle" class="sw-foot-links" style="font-family:${FONT_SANS};font-size:13px;letter-spacing:1px;">
          <a href="https://www.instagram.com/scissorwhite.cl" target="_blank" style="color:#161616;text-decoration:underline;">Instagram</a>
          &nbsp;·&nbsp;
          <a href="https://wa.me/56982514114" target="_blank" style="color:#161616;text-decoration:underline;">WhatsApp</a>
        </td>
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

function renderShopEmail(b) {
  const subject = `Nueva reserva — ${b.svcName} (${b.code})`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif">
      <h3>Nueva reserva</h3>
      <p><strong>${esc(b.name)}</strong> — ${esc(b.phone)} · ${esc(b.email)}</p>
      <p>${esc(b.svcName)} con ${esc(b.barberName)}<br>${esc(fmtDate(b.date))} · ${esc(b.time)} hrs · ${esc(fmtCLP(b.price))}</p>
      <p>Código: ${esc(b.code)}</p>
    </div>`;
  return { subject, html };
}

// El SDK de Resend no lanza en errores de API: resuelve con {data, error}.
// Hay que inspeccionar `error` o los envíos rechazados pasarían por exitosos.
function assertResendOk(results) {
  const errs = results.map(r => r && r.error).filter(Boolean);
  if (errs.length) {
    throw new Error('Resend rechazó el envío: ' + errs.map(e => e.message || JSON.stringify(e)).join(' | '));
  }
}

async function sendBookingEmails(b, { apiKey, fromEmail, shopEmail }) {
  const resend = new Resend(apiKey);
  const client = renderClientEmail(b);
  const shop = renderShopEmail(b);
  const results = await Promise.all([
    resend.emails.send({ from: fromEmail, to: b.email, subject: client.subject, html: client.html }),
    resend.emails.send({ from: fromEmail, to: parseRecipients(shopEmail), subject: shop.subject, html: shop.html }),
  ]);
  assertResendOk(results);
}

module.exports = { renderClientEmail, renderShopEmail, sendBookingEmails, parseRecipients, assertResendOk };
