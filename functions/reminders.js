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

// Recordatorio "debido": una reserva pending, sin reminderSentAt, cuyo
// instante real está a 24h o menos de distancia (y todavía no ocurrió).
// REMINDER_LEAD_MS marca desde cuándo una reserva se vuelve elegible;
// REMINDER_WINDOW_MS es el intervalo de la corrida programada (ver
// exports.sendBookingReminders, functions/index.js) -- se usa como margen
// del límite superior, no como piso.
//
// A propósito NO es una ventana de coincidencia única [now+24h,
// now+24h+15min): con un piso fijo, una reserva que pierde su único turno
// por una falla transitoria de envío (Resend caído, timeout de red) queda
// descartada PARA SIEMPRE -- ninguna corrida futura vuelve a seleccionarla,
// porque `now` solo avanza y el instante de la reserva no se mueve. Con
// "debido" (sin piso), la reserva sigue siendo candidata en cada corrida
// hasta que el envío tenga éxito (reminderSentAt) o la cita ya haya
// ocurrido -- ver functions/test/reminders.test.js para el caso que
// reproduce la pérdida permanente con la ventana vieja.
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
const REMINDER_WINDOW_MS = 15 * 60 * 1000;

// 32 hex, alta entropía -- crypto.randomBytes (nunca Math.random, que ya se
// usa para `code` y no es apto como secreto de un link de acción).
function generateReminderToken() {
  return crypto.randomBytes(16).toString('hex');
}

// De un array de reservas candidatas (ya filtradas por Firestore a un rango
// de fechas amplio -- ver sendBookingReminders), decide cuáles están
// "debidas": su instante real cae a REMINDER_LEAD_MS+REMINDER_WINDOW_MS o
// menos hacia adelante, y todavía no ocurrió. Firestore no puede calcular
// zonedInstant() en una query, así que ese filtro fino ocurre acá, en JS
// puro. Respeta el `tz` propio de cada reserva -- nunca un tz global del
// negocio -- aunque en la práctica coincidan salvo reservas de antes de
// Fase 2 sin `tz`, que caen a DEFAULT_TZ igual que el resto del código.
function findBookingsNeedingReminder(bookings, now) {
  const nowMs = now.getTime();
  const dueBy = nowMs + REMINDER_LEAD_MS + REMINDER_WINDOW_MS;
  return (bookings || []).filter((b) => {
    if (b.status !== 'pending') return false;
    if (b.reminderSentAt) return false;
    // Una reserva con date/time faltante o malformado no debe tirar abajo
    // el resto del lote -- el admin no pasa por isValidBookingPayload() en
    // sus escrituras (ver CLAUDE.md), así que un dato corrupto acá es un
    // caso real, no hipotético. Se trata como "no elegible todavía", igual
    // que dateParts() en email.js hace con el mismo tipo de fallo.
    try {
      const tz = b.tz || DEFAULT_TZ;
      const instant = zonedInstant(dateKeyOf(b.date), b.time, tz);
      const t = instant.getTime();
      if (Number.isNaN(t)) return false;
      // Sin piso inferior a propósito (ver comentario de las constantes) --
      // "ya pasó su turno" sigue siendo "debido", nunca "ya no corresponde".
      return t <= dueBy && t > nowMs;
    } catch {
      return false;
    }
  });
}

module.exports = {
  REMINDER_LEAD_MS, REMINDER_WINDOW_MS, generateReminderToken, findBookingsNeedingReminder,
};
