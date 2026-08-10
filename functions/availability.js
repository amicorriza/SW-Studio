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

// YYYY-MM-DD a partir de cualquier `date` de reserva -- normaliza el mismo
// desajuste de formato que ya tolera checkConflict (public/index.html): las
// reservas del admin guardan la hora real de la cita en `date`
// ('...T14:30:00.000Z'), las públicas guardan medianoche
// ('...T00:00:00.000Z') -- ambas comparten el mismo prefijo de 10 caracteres.
function dateKeyOf(dateStr) {
  return String(dateStr || '').slice(0, 10);
}

// Límites [start, end) en formato de fecha pura ('YYYY-MM-DD') para una
// query de rango sobre `date` que capture TODAS las reservas de un día
// calendario -- comparación lexicográfica de strings preserva el orden
// cronológico. A propósito SIN hora ni 'Z': Fase 2 guarda `date` como fecha
// pura (la hora vive solo en `time`; qué instante real representa esa hora
// lo resuelve la zona del negocio -- ver timezone.js -- nunca UTC).
//
// Documentos viejos (formato ISO con hora, ej. "2026-06-15T03:00:00.000Z")
// siguen cayendo correctamente acá SIN NINGUNA MIGRACIÓN: comparado
// lexicográficamente, un string que comparte el mismo prefijo de 10
// caracteres pero sigue con más caracteres ordena DESPUÉS del prefijo solo
// -- por eso tanto "...T00:00:00.000Z" como "...T23:59:59.999Z" del mismo
// día calendario son >= dateKey y < el día siguiente. Ver el test de
// convivencia en test/availability.test.js.
function dayBoundsOf(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return { start: dateKey, end: next.toISOString().slice(0, 10) };
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
// los rangos ocupados en bruto. `isRangeFree()` (más abajo) es quien aplica
// el criterio de solape sobre este resultado -- el widget público
// (isBarberFreeAt, public/index.html) y el panel (checkConflict/
// checkScheduleBlock, admin/index.html) mantienen su propia copia porque son
// <script> planos sin bundler y no pueden importar este archivo, pero
// createBooking.js (server, autoridad real) sí usa esta.
// Un `barberId` que no aparece en `activeBarberIds` es un barbero
// inactivo/inexistente — quien llama debe tratarlo como "no disponible",
// esta función no lo valida ni lo rechaza.
function computeAvailability({ bookings, staff, barberId, dow, scheduleBlocks }) {
  const wantsAny = !barberId || barberId === 'any';
  const relevant = wantsAny
    ? (bookings || [])
    : (bookings || []).filter(b => b.barberId === barberId);

  // `kind` distingue el origen de cada rango ocupado -- isRangeFree() lo usa
  // para aplicar el buffer de limpieza (bufferMin) SOLO entre reservas
  // reales, nunca contra colación ni bloqueos administrativos (son límites
  // duros, no necesitan margen adicional).
  const barberBusy = {};
  function addBusy(id, start, end, kind) {
    if (!id) return;
    if (!barberBusy[id]) barberBusy[id] = [];
    barberBusy[id].push({ start, end, kind });
  }

  relevant.forEach(b => addBusy(b.barberId, b.time, addMinutesToTime(b.time, b.dur || 0), 'booking'));

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
        addBusy(s.id, day.break.start, day.break.end, 'break');
      }
    });
  }

  // Bloqueos puntuales de la fecha consultada (ya filtrados por el
  // llamador -- ver getAvailability en index.js).
  (scheduleBlocks || []).forEach(blk => {
    if (!blk.barberId) return;
    if (relevantStaffIds.indexOf(blk.barberId) === -1) return;
    addBusy(blk.barberId, blk.start, blk.end, 'block');
  });

  return { barberBusy, activeBarberIds };
}

// Predicado atómico de solape en minutos desde medianoche, con un margen de
// limpieza opcional (bufferMin, default 0 = comportamiento idéntico al
// criterio original). Único criterio en todo el repo -- antes vivía
// duplicado en public/index.html (isBarberFreeAt) y admin/index.html
// (checkConflict/checkScheduleBlock); esta es la implementación real que el
// comentario de computeAvailability ya prometía (una auditoría previa había
// confundido esa mención en prosa con código).
function overlaps(aStart, aEnd, bStart, bEnd, bufferMin = 0) {
  return aStart < bEnd + bufferMin && aEnd > bStart - bufferMin;
}

// ¿[startHHMM,endHHMM) está libre contra `busyRanges` ([{start,end,kind}] en
// formato HH:MM, la misma forma que devuelve barberBusy de
// computeAvailability)? Usado por createBooking.js para decidir si un
// barbero candidato puede tomar una reserva nueva.
//
// `bufferMin` (tiempo de limpieza configurable, businessInfo.bufferMin) se
// aplica SOLO contra rangos con kind:'booking' -- colación y bloqueos
// administrativos (kind:'break'/'block') son límites duros, no llevan
// margen adicional.
function isRangeFree(busyRanges, startHHMM, endHHMM, bufferMin = 0) {
  const s = toMinutes(startHHMM);
  const e = toMinutes(endHHMM);
  return !(busyRanges || []).some(r => {
    const buf = r.kind === 'booking' ? bufferMin : 0;
    return overlaps(s, e, toMinutes(r.start), toMinutes(r.end), buf);
  });
}

// ¿`schedule[dow]` (staff.schedule, mismo campo que ya lee la colación de
// computeAvailability) tiene abierto el rango [startHHMM,endHHMM)? Vive acá
// junto a la colación -- ambas leen el mismo staff.schedule[dow] -- para no
// terminar con una tercera copia de "cómo se interpreta el horario de un
// barbero" el día que alguien la necesite de nuevo. Mismo criterio que
// hoursRangeFor() en public/index.html, pero server-side.
function isWithinOpenHours(schedule, dow, startHHMM, endHHMM) {
  const day = Array.isArray(schedule) ? schedule[dow] : null;
  if (!day || !day.open) return false;
  return toMinutes(startHHMM) >= toMinutes(day.start) && toMinutes(endHHMM) <= toMinutes(day.end);
}

module.exports = {
  toMinutes, toHHMM, addMinutesToTime, computeAvailability, dateKeyOf, dayBoundsOf,
  overlaps, isRangeFree, isWithinOpenHours,
};
