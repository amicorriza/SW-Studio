// functions/shared/attendance.js — máquina de estados de la atención real
// (Llegó / No llegó / Iniciar / Finalizar) y decisión de qué notificación
// corresponde enviarle al profesional.
//
// Lógica pura, sin firebase-admin y sin I/O: mismo patrón que
// shared/availability.js y reminders.js, testeable con node --test sin
// emulador. functions/index.js hace todo el I/O (query a Firestore, envío
// de push) y le pasa a estas funciones los datos ya leídos; acá solo se
// decide.
//
// `now` SIEMPRE se inyecta. Ninguna función de este módulo lee el reloj por
// su cuenta: las marcas de tiempo de asistencia son del servidor, nunca del
// teléfono del barbero, y los tests necesitan fechas determinísticas.
'use strict';

const { DEFAULT_TZ, zonedInstant } = require('./timezone.js');
const { dateKeyOf } = require('./availability.js');

const ATTENDANCE_ACTIONS = ['arrive', 'no_show', 'start', 'end', 'snooze', 'cancel'];

const DEFAULT_NUDGE_LEAD_MIN = 10;
// Tope de insistencia al cerrar: 6 avisos separados por SNOOZE_MS = una hora.
// Pasado eso la atención queda para revisión manual en vez de seguir
// vibrando el teléfono -- el PDF (§3) pide expresamente que el timer sirva
// para registrar, no para presionar al profesional.
const MAX_END_NUDGES = 6;
const SNOOZE_MS = 10 * 60 * 1000;

// De qué estados se puede aplicar cada acción. El atajo pending|confirmed ->
// start existe a propósito: el flujo que produce el dato va de la
// notificación "¿Deseas comenzar la atención?" directo a iniciar, y el PDF
// (§3) pide la menor cantidad de toques posible.
const FROM = {
  arrive: ['pending', 'confirmed'],
  no_show: ['pending', 'confirmed', 'arrived'],
  start: ['pending', 'confirmed', 'arrived'],
  end: ['in_service'],
  snooze: ['in_service'],
  cancel: ['pending', 'confirmed', 'arrived'],
};

// Una reserva sin `status` (anterior a Fase 2) se trata como 'pending'.
function canTransition(from, action) {
  const allowed = FROM[action];
  if (!allowed) return false;
  return allowed.indexOf(from || 'pending') !== -1;
}

// Estado en que queda la reserva tras aplicar la acción. 'snooze' no está:
// posponer no mueve el estado, solo corre el próximo aviso.
const RESULT = {
  arrive: 'arrived', no_show: 'no_show', start: 'in_service',
  end: 'completed', cancel: 'cancelled',
};

function msOf(value) {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function auditEntry(nowISO, field, from, to, by, reason) {
  return { at: nowISO, field, from: from || null, to, by: by || null, reason: reason || null };
}

// Devuelve el parche de campos a escribir, o null si no hay nada que hacer
// (acción ya aplicada, o transición inválida). Nunca lanza: una reserva con
// startedAt corrupto degrada a actualDur 0, no tumba la llamada.
function applyAction(booking, action, now, opts) {
  const b = booking || {};
  const o = opts || {};
  const status = b.status || 'pending';
  if (!canTransition(status, action)) return null;

  const nowISO = now.toISOString();
  const by = o.by || null;

  // Posponer solo corre la hora del próximo aviso. El contador de
  // insistencia lo lleva el scheduler al enviar -- una sola fuente de verdad.
  if (action === 'snooze') {
    const ms = o.snoozeMs || SNOOZE_MS;
    return { snoozeUntil: new Date(now.getTime() + ms).toISOString() };
  }

  const patch = { status: RESULT[action], attendanceBy: by };

  if (action === 'arrive') patch.arrivedAt = nowISO;
  if (action === 'no_show') patch.noShowAt = nowISO;
  if (action === 'cancel') patch.cancelledAt = nowISO;

  if (action === 'start') {
    patch.startedAt = nowISO;
    // Iniciar sin haber marcado Llegó implica que el cliente está presente.
    // Si ya se había marcado, se respeta la hora original.
    if (!b.arrivedAt) patch.arrivedAt = nowISO;
  }

  if (action === 'end') {
    const corrected = !!o.atISO && msOf(o.atISO) !== null;
    const endISO = corrected ? o.atISO : nowISO;
    patch.endedAt = endISO;
    patch.durSource = corrected ? 'manual' : 'timer';
    const startMs = msOf(b.startedAt);
    const endMs = msOf(endISO);
    patch.actualDur = (startMs === null || endMs === null)
      ? 0
      : Math.max(0, Math.round((endMs - startMs) / 60000));
    // Toda corrección conserva el dato original para auditoría (PDF §3).
    if (corrected) {
      patch.attendanceAudit = (b.attendanceAudit || [])
        .concat([auditEntry(nowISO, 'endedAt', nowISO, endISO, by, o.reason)]);
    }
  }

  return patch;
}

// Instante real de la cita. Respeta el `tz` propio de la reserva; las que
// escribe el admin no tienen ninguno y caen al del negocio.
function bookingInstant(b, fallbackTz) {
  const tz = b.tz || fallbackTz || DEFAULT_TZ;
  const d = zonedInstant(dateKeyOf(b.date), b.time, tz);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

function hhmm(b) {
  return String(b.time || '').slice(0, 5);
}

// Decide qué avisos corresponden AHORA. Una reserva produce como máximo uno
// por corrida, y el más avanzado del ciclo gana: si ya es hora de finalizar,
// no tiene sentido preguntar si querés empezar.
function computeNudges(bookings, now, cfg) {
  const c = cfg || {};
  const leadMs = (Number.isFinite(c.leadMin) ? c.leadMin : DEFAULT_NUDGE_LEAD_MIN) * 60000;
  const nowMs = now.getTime();
  const out = [];

  (bookings || []).forEach((b) => {
    // Aislada por reserva: el admin no pasa por isValidBookingPayload(), así
    // que un date corrupto es un caso real y no puede tumbar el lote entero
    // (ya pasó una vez con los recordatorios).
    try {
      const id = b._docId;
      if (!id || !b.barberId) return;
      const nombre = b.name || 'tu cliente';

      // ── fin de la atención ──
      if (b.status === 'in_service' && !b.endedAt) {
        const startMs = msOf(b.startedAt);
        if (startMs !== null) {
          const count = Number(b.nudgeEndCount) || 0;
          const snoozeMs = b.snoozeUntil ? msOf(b.snoozeUntil) : null;
          const dueMs = snoozeMs !== null ? snoozeMs : startMs + (Number(b.dur) || 0) * 60000;
          // El aviso de fin es el único que se repite. Sin este piso volvería
          // a salir en CADA corrida (cada 2 min) mientras el barbero no
          // responda: se espera SNOOZE_MS desde el último envío, igual que
          // si lo hubiera pospuesto él. El tope de MAX_END_NUDGES no alcanza
          // a protegerlo por sí solo, porque el contador solo sube cuando
          // efectivamente se envía.
          const lastMs = b.nudgeEndAt ? msOf(b.nudgeEndAt) : null;
          const listo = lastMs === null || nowMs >= lastMs + SNOOZE_MS;
          if (count < MAX_END_NUDGES && nowMs >= dueMs && listo) {
            out.push({
              bookingId: id, kind: 'end', barberId: b.barberId,
              title: 'Atención en curso',
              body: `¿Deseas finalizar la atención de ${nombre}?`,
              data: { b: id, a: 'end' },
            });
          }
        }
        return;
      }

      if (b.status !== 'pending' && b.status !== 'confirmed') return;

      const t = bookingInstant(b, c.tz);
      if (t === null) return;

      // ── inicio de la atención ──
      if (nowMs >= t) {
        if (b.nudgeStartAt) return;
        out.push({
          bookingId: id, kind: 'start', barberId: b.barberId,
          title: 'Es la hora',
          body: `¿Deseas comenzar la atención para ${nombre}?`,
          data: { b: id, a: 'start' },
        });
        return;
      }

      // ── se acerca la hora ──
      if (!b.nudgeUpcomingAt && t - nowMs <= leadMs) {
        out.push({
          bookingId: id, kind: 'upcoming', barberId: b.barberId,
          title: 'Próxima atención',
          body: `Se acerca la hora de atención con ${nombre} a las ${hhmm(b)}`,
          data: { b: id, a: 'view' },
        });
      }
    } catch {
      /* reserva malformada: se ignora, el lote sigue */
    }
  });

  return out;
}

module.exports = {
  ATTENDANCE_ACTIONS, canTransition, applyAction,
  computeNudges, DEFAULT_NUDGE_LEAD_MIN, MAX_END_NUDGES, SNOOZE_MS,
};
