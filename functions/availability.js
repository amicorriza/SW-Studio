// functions/availability.js — lógica pura de disponibilidad de horarios.
// Sin dependencias de Firebase Admin: fácil de testear, se usa desde index.js.
// PRIVACIDAD: esta lógica solo debe manejar/devolver datos derivados
// (barberId, start, end). Nunca debe tocar name/email/phone/otro PII de una
// reserva — ese es exactamente el motivo por el que getAvailability existe
// como Cloud Function en vez de dejar que el público lea `bookings` directo
// (ver firestore.rules: bookings solo lo lee el admin).
'use strict';

// 'HH:MM' -> minutos desde medianoche. Tolerante a valores raros (mismo
// espíritu defensivo que parseDt/checkConflict en public/index.html).
function toMinutes(hhmm) {
  const parts = String(hhmm || '0:0').split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

// minutos desde medianoche -> 'HH:MM'.
function toHHMM(mins) {
  const total = ((mins % 1440) + 1440) % 1440; // por si acaso, nunca negativo
  const h = Math.floor(total / 60);
  const m = total % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// 'HH:MM' + minutos de duración -> 'HH:MM' de término.
function addMinutesToTime(hhmm, durMin) {
  return toHHMM(toMinutes(hhmm) + (durMin || 0));
}

// Agrupa las reservas de un día por barbero, devolviendo solo {start, end}
// derivados de `time`+`dur` — NUNCA name/email/phone/otro dato personal.
//
// Si `barberId` es 'any' (o vacío/omitido) no se filtra: se agrupan TODAS
// las reservas recibidas por su propio barberId. El llamador (index.js) es
// quien decide si filtra la query de Firestore por barberId o no; esta
// función solo agrupa lo que le llega.
//
// Esta función NO decide si un horario candidato está disponible — devuelve
// los rangos ocupados en bruto. Es responsabilidad de quien consuma esta
// respuesta (el widget público, en public/index.html) comparar un slot
// candidato [start, start+durCandidata) contra estos rangos con el mismo
// solape que ya usa checkConflict/parseDt: candStart < end && candEnd > start.
// Un `barberId` que no aparece en `activeBarberIds` es un barbero
// inactivo/inexistente — quien llama debe tratarlo como "no disponible",
// esta función no lo valida ni lo rechaza.
function computeAvailability({ bookings, staff, barberId, dow, scheduleBlocks }) {
  const wantsAny = !barberId || barberId === 'any';
  const relevant = wantsAny
    ? (bookings || [])
    : (bookings || []).filter(b => b.barberId === barberId);

  const barberBusy = {};
  function addBusy(id, start, end) {
    if (!id) return;
    if (!barberBusy[id]) barberBusy[id] = [];
    barberBusy[id].push({ start, end });
  }

  relevant.forEach(b => addBusy(b.barberId, b.time, addMinutesToTime(b.time, b.dur || 0)));

  const activeBarberIds = (staff || [])
    .filter(s => s.status === 'active')
    .map(s => s.id);

  // Mismo criterio de filtrado que ya aplica a `relevant` para las
  // reservas: si se pidió un barbero específico, solo su colación/sus
  // bloqueos entran a barberBusy; si es 'any', los de todos los activos.
  const relevantStaffIds = wantsAny ? activeBarberIds : activeBarberIds.filter(id => id === barberId);

  // Colación recurrente (staff.schedule[dow].break) -- solo si se pasó
  // `dow` (día de semana 0-6 de la fecha consultada). Si no se pasa,
  // comportamiento idéntico al de antes de este cambio (compatibilidad).
  if (typeof dow === 'number') {
    (staff || []).forEach(s => {
      if (relevantStaffIds.indexOf(s.id) === -1) return;
      const day = Array.isArray(s.schedule) ? s.schedule[dow] : null;
      if (day && day.break && day.break.start && day.break.end) {
        addBusy(s.id, day.break.start, day.break.end);
      }
    });
  }

  // Bloqueos puntuales de la fecha consultada (ya filtrados por el
  // llamador -- ver getAvailability en index.js).
  (scheduleBlocks || []).forEach(blk => {
    if (!blk.barberId) return;
    if (relevantStaffIds.indexOf(blk.barberId) === -1) return;
    addBusy(blk.barberId, blk.start, blk.end);
  });

  return { barberBusy, activeBarberIds };
}

module.exports = { toMinutes, toHHMM, addMinutesToTime, computeAvailability };
