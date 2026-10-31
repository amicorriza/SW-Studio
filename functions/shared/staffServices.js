// functions/shared/staffServices.js — qué servicios presta cada profesional.
//
// `staff/{id}.serviceIds` es OPCIONAL:
//   - ausente o null: presta TODOS, incluidos los que se agreguen después. Es el
//     estado de toda ficha anterior a esta función, así que desplegar no cambia
//     nada hasta que el negocio configure una lista.
//   - lista: presta SOLO esos. Un servicio nuevo no entra solo a una lista: la
//     falla segura es que no se ofrezca, no que lo tome alguien no calificado.
//   - lista vacía: no presta ninguno ("ninguno", no "todos").
//
// Lo escribe el panel (ficha de Personal) y llega al público por el espejo
// staffPublic, sin código extra: mirrorStaffPublic copia todo menos `schedule`.
//
// Copia deliberada de canPerformService() en public/js/booking-widget.js y
// public/admin/index.html: los dos son <script> plano sin bundler y no pueden
// requerir este módulo. El filtro de esas copias es comodidad; lo que impide
// reservar de verdad es el chequeo de acá, en createBooking y adminSaveBooking.
'use strict';

// Motivo que viaja en HttpsError.details: el widget se guía por él para volver
// al paso de elegir barbero, en vez de mostrar el error genérico de conexión.
const BARBER_NOT_QUALIFIED = 'barber-not-qualified';

function canPerformService(staff, svcId) {
  if (!staff) return false;
  return !Array.isArray(staff.serviceIds) || staff.serviceIds.includes(svcId);
}

// ¿Puede guardarse esta cita desde el panel? Una cita que YA tenía este mismo
// cruce pasa aunque al profesional le hayan quitado el servicio después:
// rechazarla dejaría esa cita imposible de reprogramar o corregir. Lo que se
// impide es crear un cruce nuevo.
function canAssignBooking({ staff, barberId, svcId, prev }) {
  if (prev && prev.barberId === barberId && prev.svcId === svcId) return true;
  return canPerformService(staff, svcId);
}

module.exports = { BARBER_NOT_QUALIFIED, canPerformService, canAssignBooking };
