// functions/whatsapp.js — render + envío de WhatsApp vía Kapso (Meta Cloud API).
'use strict';

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.startsWith('56') ? digits : '56' + digits;
}

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

module.exports = { normalizePhone, buildTextBody, buildTemplateComponents, sendBookingWhatsApp };
