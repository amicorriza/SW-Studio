// functions/email.js — render + envío de emails vía Resend.
'use strict';
const { Resend } = require('resend');

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long' }); }
  catch { return iso; }
}
function fmtCLP(n) { return '$' + Number(n || 0).toLocaleString('es-CL'); }

// SHOP_EMAIL puede traer varios destinatarios separados por coma (ej. dueño + recepción).
function parseRecipients(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

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
    resend.emails.send({ from: fromEmail, to: parseRecipients(shopEmail), subject: shop.subject, html: shop.html }),
  ]);
}

module.exports = { renderClientEmail, renderShopEmail, sendBookingEmails, parseRecipients };
