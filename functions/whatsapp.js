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

module.exports = { normalizePhone, buildTextBody };
