// functions/shared/status.js — estado de una reserva.
//
// Con este módulo (etapa B, 2026-09) el repo tiene su primera transición de
// estado real: 'pending' -> 'confirmed' | 'declined', vía el flujo de
// recordatorio de citas (ver functions/reminders.js y
// exports.respondToBookingReminder en functions/index.js). Antes de esto
// 'pending' era el único valor posible y nada lo cambiaba después de crear
// la reserva -- cancelar sigue siendo deleteDoc (destruye el registro), eso
// NO cambió acá: 'declined' es la respuesta del cliente al recordatorio, no
// una cancelación administrativa.
'use strict';

const BOOKING_STATUSES = ['pending', 'confirmed', 'declined'];
const DEFAULT_BOOKING_STATUS = 'pending';

function isValidBookingStatus(status) {
  return BOOKING_STATUSES.indexOf(status) !== -1;
}

module.exports = { BOOKING_STATUSES, DEFAULT_BOOKING_STATUS, isValidBookingStatus };
