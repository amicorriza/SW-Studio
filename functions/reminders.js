// functions/reminders.js — lógica pura del recordatorio de citas (24h
// antes, confirmar/declinar). Sin dependencia de firebase-admin: mismo
// patrón que shared/availability.js y shared/timezone.js, testeable con
// node --test sin emulador. functions/index.js hace todo el I/O (query a
// Firestore, envío de email) y le pasa a findBookingsNeedingReminder() los
// datos ya leídos; esta función solo decide.
'use strict';
const crypto = require('crypto');
const { DEFAULT_TZ, zonedInstant } = require('./shared/timezone.js');
const { dateKeyOf } = require('./shared/availability.js');

// Ventana rodante: se envía el recordatorio exactamente 24h antes de la hora
// real de la cita. 15 min de ancho == el intervalo de la corrida programada
// (ver exports.sendBookingReminders, functions/index.js) -- sin huecos ni
// duplicados por diseño; reminderSentAt es el respaldo si una corrida se
// atrasa o se reintenta.
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
const REMINDER_WINDOW_MS = 15 * 60 * 1000;

// 32 hex, alta entropía -- crypto.randomBytes (nunca Math.random, que ya se
// usa para `code` y no es apto como secreto de un link de acción).
function generateReminderToken() {
  return crypto.randomBytes(16).toString('hex');
}

// De un array de reservas candidatas (ya filtradas por Firestore a un rango
// de fechas amplio -- ver sendBookingReminders), decide cuáles caen
// EXACTAMENTE en la ventana [now+24h, now+24h+15min). Firestore no puede
// calcular zonedInstant() en una query, así que ese filtro fino ocurre acá,
// en JS puro. Respeta el `tz` propio de cada reserva -- nunca un tz global
// del negocio -- aunque en la práctica coincidan salvo reservas de antes de
// Fase 2 sin `tz`, que caen a DEFAULT_TZ igual que el resto del código.
function findBookingsNeedingReminder(bookings, now) {
  const windowStart = now.getTime() + REMINDER_LEAD_MS;
  const windowEnd = windowStart + REMINDER_WINDOW_MS;
  return (bookings || []).filter((b) => {
    if (b.status !== 'pending') return false;
    if (b.reminderSentAt) return false;
    const tz = b.tz || DEFAULT_TZ;
    const instant = zonedInstant(dateKeyOf(b.date), b.time, tz);
    const t = instant.getTime();
    return t >= windowStart && t < windowEnd;
  });
}

module.exports = {
  REMINDER_LEAD_MS, REMINDER_WINDOW_MS, generateReminderToken, findBookingsNeedingReminder,
};
