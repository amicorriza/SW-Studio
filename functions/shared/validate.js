// functions/shared/validate.js — validación del payload de una reserva
// nueva. Reemplaza la implementación que vivía inline en
// functions/createBooking.js (mismo código, mismo criterio, solo movida acá
// para ser la fuente única).
//
// Réplica EXACTA (mismo criterio, campo a campo) de isValidBooking() en
// firestore.rules -- no se puede compartir código entre CEL (reglas) y JS,
// así que sigue siendo deuda de sincronización manual con esa regla. Esa
// regla (isValidBooking) hoy es código muerto: ningún `allow` la invoca, ver
// el comentario ahí.
//
// El panel admin NO pasa por esta función: escribe reservas directo a
// Firestore (public/admin/index.html → SWData.saveBooking), gateado en
// servidor solo por isValidEmail() en firestore.rules -- un criterio mucho
// más débil (solo formato de email, y opcional). Cerrar esa brecha es
// trabajo aparte, fuera de alcance acá.
'use strict';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isValidBookingPayload(payload) {
  const p = payload || {};
  return typeof p.name === 'string' && p.name.length > 1
    && typeof p.email === 'string' && EMAIL_RE.test(p.email)
    && typeof p.phone === 'string' && p.phone.length >= 7
    && typeof p.svcId === 'string'
    && typeof p.barberId === 'string'
    && typeof p.date === 'string'
    && typeof p.time === 'string'
    && typeof p.code === 'string'
    && typeof p.club === 'string' && (p.club === 'member' || p.club === 'guest');
}

module.exports = { EMAIL_RE, isValidBookingPayload };
