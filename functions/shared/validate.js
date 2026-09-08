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
// El panel admin usa isValidAdminBookingPayload() (abajo), no esta: sus
// reservas tienen el correo OPCIONAL a propósito -- el salón agenda por
// teléfono y muchas veces no hay correo. Hasta el 2026-09-07 el panel escribía
// directo a Firestore sin pasar por ninguna validación real; ahora va por el
// callable adminSaveBooking.
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

// 'YYYY-MM-DD'. No alcanza con el formato: '2026-13-45' calza el regex y
// después revienta en zonedInstant(), que es exactamente el tipo de dato que
// dejaba a un cliente sin recordatorio y a un barbero sin aviso.
function isDateKey(v) {
  if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return false;
  const y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8, 10);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// 'HH:mm' de 24 horas.
function isHhMm(v) {
  if (typeof v !== 'string' || !/^[0-9]{2}:[0-9]{2}$/.test(v)) return false;
  const h = +v.slice(0, 2), mi = +v.slice(3, 5);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}

// Payload de una reserva creada o editada DESDE EL PANEL. Replica campo a
// campo lo que el modal ya exige en el navegador (nombre, servicio, barbero,
// fecha y hora; correo opcional pero con formato si viene; teléfono libre),
// para no imponer requisitos nuevos a un flujo que el salón ya usa -- el
// objetivo es cortar los datos CORRUPTOS, no volver más rígido el trabajo.
//
// La diferencia con isValidBookingPayload() es deliberada y son dos funciones
// y no un flag: el camino público SIEMPRE tiene correo (es donde llega la
// confirmación) y el del panel muchas veces no.
function isValidAdminBookingPayload(payload) {
  const p = payload || {};
  return typeof p.name === 'string' && p.name.trim().length > 1
    && typeof p.svcId === 'string' && p.svcId.trim() !== ''
    && typeof p.barberId === 'string' && p.barberId.trim() !== ''
    && isDateKey(p.date)
    && isHhMm(p.time)
    && (p.email == null || (typeof p.email === 'string'
      && (p.email.trim() === '' || EMAIL_RE.test(p.email.trim()))))
    && (p.phone == null || typeof p.phone === 'string')
    && (p.notes == null || typeof p.notes === 'string');
}

module.exports = {
  EMAIL_RE, isValidBookingPayload, isValidAdminBookingPayload, isDateKey, isHhMm,
};
