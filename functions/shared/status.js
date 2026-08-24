// functions/shared/status.js — estado de una reserva.
//
// Hoy existe UN solo valor posible ('pending') y NADA lo cambia después de
// crear la reserva: cancelar hace deleteDoc (destruye el registro), no un
// cambio de estado -- ver CLAUDE.md, "Estado conocido". No hay divergencia
// real que reconciliar acá (a diferencia de solape/timezone/validación):
// antes de este módulo, el valor 'pending' vivía repetido suelto en
// functions/createBooking.js (buildBookingDoc) y en
// public/admin/index.html (al guardar/editar una reserva).
//
// Este módulo NO introduce transiciones ni una máquina de estados -- eso es
// autogestión/etapa B, fuera de alcance en las etapas 0 y A (ver CLAUDE.md).
// Solo centraliza el valor por defecto y la lista de estados reconocidos
// para que los dos sitios de escritura no repitan el string suelto.
'use strict';

const BOOKING_STATUSES = ['pending'];
const DEFAULT_BOOKING_STATUS = 'pending';

function isValidBookingStatus(status) {
  return BOOKING_STATUSES.indexOf(status) !== -1;
}

module.exports = { BOOKING_STATUSES, DEFAULT_BOOKING_STATUS, isValidBookingStatus };
