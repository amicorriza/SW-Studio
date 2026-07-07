// functions/whatsapp.js — render + envío de WhatsApp vía Kapso (Meta Cloud API).
'use strict';

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.startsWith('56') ? digits : '56' + digits;
}

module.exports = { normalizePhone };
