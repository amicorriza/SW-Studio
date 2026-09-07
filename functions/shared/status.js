// functions/shared/status.js — estado de una reserva.
//
// Con este módulo (etapa B, 2026-09) el repo tiene su primera transición de
// estado real: 'pending' -> 'confirmed' | 'declined', vía el flujo de
// recordatorio de citas (ver functions/reminders.js y
// exports.respondToBookingReminder en functions/index.js).
//
// La medición de la atención real (2026-09, Fase 1 del reporte de KPI) suma
// los estados que marca el profesional desde la PWA /barbero: 'arrived',
// 'in_service', 'completed', 'no_show'; y 'cancelled', que reemplaza al
// deleteDoc con que se cancelaba antes -- cancelar ya no destruye el
// registro, así que la tasa de cancelación pasa a ser medible y deja de
// confundirse con un no-show. Las transiciones válidas viven en
// functions/shared/attendance.js.
'use strict';

const BOOKING_STATUSES = [
  'pending', 'confirmed', 'declined',
  'arrived', 'in_service', 'completed', 'no_show', 'cancelled',
];
const DEFAULT_BOOKING_STATUS = 'pending';

// Único criterio de "esta reserva ocupa el horario", compartido por
// computeAvailability() y por checkConflict() del admin (que mantiene una
// copia deliberada: es un <script> plano sin bundler y no puede requerir
// este módulo).
//
// Es una lista BLANCA a propósito. Con lista negra -- que es como estaba
// antes, `b.status !== 'declined'` -- cada estado nuevo que alguien olvide
// agregar libera silenciosamente un horario ocupado, y el síntoma es una
// doble reserva en producción. Con lista blanca, el mismo olvido produce el
// error seguro: un horario que se ve ocupado sin serlo.
const BLOCKING_STATUSES = ['pending', 'confirmed', 'arrived', 'in_service', 'completed'];

function isValidBookingStatus(status) {
  return BOOKING_STATUSES.indexOf(status) !== -1;
}

// Una reserva sin `status` (documentos anteriores a Fase 2) ocupa el
// horario: es una cita real que nadie debe pisar.
function isBlockingStatus(status) {
  if (!status) return true;
  return BLOCKING_STATUSES.indexOf(status) !== -1;
}

module.exports = {
  BOOKING_STATUSES, DEFAULT_BOOKING_STATUS, isValidBookingStatus,
  BLOCKING_STATUSES, isBlockingStatus,
};
