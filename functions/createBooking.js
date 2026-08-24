// functions/createBooking.js — lógica pura de resolución del callable
// transaccional `createBooking` (Fase A). Sin dependencia de firebase-admin:
// igual que availability.js/patients.js, se testea con node --test sin
// emulador. index.js hace TODO el I/O (lecturas dentro de la transacción) y
// le pasa a resolveCreateBooking() datos ya leídos; esta función solo decide.
'use strict';
const {
  addMinutesToTime, computeAvailability, dateKeyOf, isRangeFree, isWithinOpenHours,
} = require('./shared/availability.js');
const { zonedInstant } = require('./shared/timezone.js');
const { isValidBookingPayload } = require('./shared/validate.js');
const { DEFAULT_BOOKING_STATUS } = require('./shared/status.js');

// Único punto de la política de asignación cuando el cliente pide 'any' (o
// no manda barberId). Hoy: orden alfabético por id. Con un solo barbero
// activo da igual, pero en cuanto haya dos, el primero por orden alfabético
// se lleva toda la carga -- no hay ningún criterio de rotación/balanceo.
// Cambiar la política de asignación es tocar SOLO esta función.
function orderCandidateBarbers(activeBarberIds) {
  return [...(activeBarberIds || [])].sort();
}

// Resuelve qué barbero toma la reserva y si hay hueco. NUNCA devuelve 'any'
// -- si se pidió 'any', devuelve un barbero real y activo, o falla.
// `barberBusy` ya viene calculado (una sola vez, para todos los barberos
// activos) por el llamador -- ver resolveCreateBooking. `bufferMin` (default
// 0) solo afecta el margen contra otras reservas -- ver isRangeFree en
// availability.js.
function resolveBarber({ barberId, activeStaff, dow, time, endTime, barberBusy, bufferMin = 0 }) {
  const wantsAny = !barberId || barberId === 'any';

  function fitsAt(staffMember) {
    if (!isWithinOpenHours(staffMember.schedule, dow, time, endTime)) return false;
    return isRangeFree(barberBusy[staffMember.id] || [], time, endTime, bufferMin);
  }

  if (!wantsAny) {
    const candidate = activeStaff.find(s => s.id === barberId);
    if (!candidate) {
      return { ok: false, code: 'not-found', message: 'El barbero seleccionado no existe o no está activo.' };
    }
    if (!isWithinOpenHours(candidate.schedule, dow, time, endTime)) {
      return { ok: false, code: 'failed-precondition', message: 'Ese horario está fuera de la disponibilidad del barbero.' };
    }
    if (!isRangeFree(barberBusy[candidate.id] || [], time, endTime, bufferMin)) {
      return { ok: false, code: 'already-exists', message: 'Ese horario acaba de ser tomado.' };
    }
    return { ok: true, barber: candidate };
  }

  const order = orderCandidateBarbers(activeStaff.map(s => s.id));
  for (const id of order) {
    const staffMember = activeStaff.find(s => s.id === id);
    if (staffMember && fitsAt(staffMember)) return { ok: true, barber: staffMember };
  }
  return { ok: false, code: 'resource-exhausted', message: 'No hay barberos disponibles en ese horario.' };
}

// Arma el documento final. `dur`/`price`/`svcName`/`svcCat` SIEMPRE desde
// `service` (leído de Firestore dentro de la transacción) -- nunca del
// payload del cliente. `barber` ya es el barbero real resuelto por
// resolveBarber(): nunca se persiste 'any'. `createdAt` es del servidor
// (`now`), no del cliente, por la misma razón.
//
// `tz` se escribe SIEMPRE, incluso cuando `businessTz` resultó ser el
// default (Fase 2) -- el campo tiene que estar presente para que su
// AUSENCIA (no su valor) sea la señal inequívoca de "reserva de antes de
// Fase 2". Si `tz` faltara también para negocios en el default, no habría
// forma de distinguir "es el default" de "es de antes de esta fase".
function buildBookingDoc({ payload, service, barber, now, businessTz }) {
  if (!businessTz) {
    throw new Error('buildBookingDoc: businessTz es obligatorio -- resolver con resolveBusinessTz() en el llamador.');
  }
  return {
    code: payload.code,
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    svcId: payload.svcId,
    svcName: service.name || '',
    svcCat: service.cat || '',
    price: service.price || 0,
    dur: service.dur || 0,
    barberId: barber.id,
    barberName: barber.name || '',
    date: payload.date,
    time: payload.time,
    club: payload.club,
    status: DEFAULT_BOOKING_STATUS,
    emailStatus: 'pending',
    tz: businessTz,
    // Marca de origen: permite verificar en Firestore que el 100% de los
    // creates nuevos pasan por este callable antes de cerrar la vía pública
    // directa en firestore.rules (ver plan de despliegue de Fase A).
    src: 'callable',
    createdAt: now.toISOString(),
  };
}

// Punto de entrada único. Todo I/O (lecturas de Firestore) ya ocurrió en
// index.js, dentro de la transacción; acá solo se decide. Devuelve
// {ok:true, doc} o {ok:false, code, message} -- `code` es un HttpsError code
// válido, index.js solo hace `throw new HttpsError(code, message)`.
//
// `businessTz` es OBLIGATORIO y no tiene default acá -- si el llamador lo
// pierde en alguna ruta, esta función falla ruidosamente (excepción, no
// devuelve {ok:false,...}) en vez de agendar en una zona equivocada sin que
// nadie se entere. El único lugar con un default es resolveBusinessTz()
// (timezone.js), y vive en el llamador (index.js), no acá.
function resolveCreateBooking({ payload, now, service, staff, bookingsForDay, scheduleBlocksForDay, businessTz, bufferMin = 0 }) {
  if (!businessTz) {
    throw new Error('resolveCreateBooking: businessTz es obligatorio -- resolver con resolveBusinessTz() en el llamador.');
  }
  if (!isValidBookingPayload(payload)) {
    return { ok: false, code: 'invalid-argument', message: 'Datos de reserva inválidos.' };
  }
  if (!service || service.status !== 'active') {
    return { ok: false, code: 'not-found', message: 'El servicio seleccionado no existe o no está disponible.' };
  }

  const dayKey = dateKeyOf(payload.date);
  const dowDate = new Date(dayKey);
  if (!dayKey || Number.isNaN(dowDate.getTime())) {
    return { ok: false, code: 'invalid-argument', message: 'Fecha inválida.' };
  }
  // El día de la semana de una fecha calendario es el mismo mirado desde
  // cualquier zona -- el 15 de junio de 2026 es lunes lo mires desde donde
  // lo mires. getUTCDay() sobre un date-key limpio ('YYYY-MM-DD', que el
  // motor de JS parsea como medianoche UTC) ya da el día correcto sin
  // ningún ajuste de zona horaria.
  const dow = dowDate.getUTCDay();

  const dur = service.dur || 0;
  const endTime = addMinutesToTime(payload.time, dur);

  // La hora candidata SIEMPRE sale de `time`, nunca del contenido horario de
  // `date` -- ver dateKeyOf en availability.js. El instante real que esa
  // hora representa lo resuelve la zona del NEGOCIO (zonedInstant), nunca
  // UTC -- acá vivía el hardcodeo de 'Z' que Fase 2 vino a corregir.
  const candidateInstant = zonedInstant(dayKey, payload.time, businessTz);
  if (Number.isNaN(candidateInstant.getTime()) || candidateInstant.getTime() <= now.getTime()) {
    return { ok: false, code: 'failed-precondition', message: 'La fecha y hora de la reserva deben ser futuras.' };
  }

  const activeStaff = (staff || []).filter(s => s.status === 'active');
  // Una sola pasada de computeAvailability para TODOS los barberos activos
  // (reservas + colación + bloqueos del día) -- tanto el camino de barbero
  // concreto como el de 'any' consultan el mismo `barberBusy`.
  const { barberBusy } = computeAvailability({
    bookings: bookingsForDay, staff: activeStaff, barberId: 'any', dow, scheduleBlocks: scheduleBlocksForDay,
  });

  const resolved = resolveBarber({
    barberId: payload.barberId, activeStaff, dow, time: payload.time, endTime, barberBusy, bufferMin,
  });
  if (!resolved.ok) return resolved;

  return { ok: true, doc: buildBookingDoc({ payload, service, barber: resolved.barber, now, businessTz }) };
}

module.exports = {
  isValidBookingPayload, orderCandidateBarbers, resolveBarber, buildBookingDoc, resolveCreateBooking,
};
