// functions/surveys.js — lógica pura de la encuesta de satisfacción post-
// atención (10 min después de "Finalizar", tope de 24h). Sin dependencia de
// firebase-admin: mismo patrón que reminders.js, testeable con node --test
// sin emulador. functions/index.js hace todo el I/O (query a Firestore,
// envío de email) y le pasa a findBookingsNeedingSurvey() los datos ya
// leídos; esta función solo decide.
'use strict';

const SURVEY_LEAD_MS = 10 * 60 * 1000;
const SURVEY_EXPIRY_MS = 24 * 60 * 60 * 1000;

function msOf(value) {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

// Una encuesta es "debida" si la atención terminó (`completed` con
// `endedAt`) hace 10 minutos o más, todavía no se mandó (`surveySentAt`
// ausente) y no ha pasado más de 24h desde que terminó. A diferencia de
// reminders.js (donde una reserva "debida" lo sigue siendo indefinidamente
// porque la cita todavía no ocurre), acá SÍ hay techo: el evento ya pasó,
// y preguntar "¿cómo estuvo tu corte?" un día después ya no tiene sentido
// -- se descarta en vez de reintentar para siempre.
function findBookingsNeedingSurvey(bookings, now, onSkip) {
  const nowMs = now.getTime();
  return (bookings || []).filter((b) => {
    if (b.status !== 'completed') return false;
    if (b.surveySentAt) return false;
    try {
      const endedMs = msOf(b.endedAt);
      if (endedMs === null) throw new Error('endedAt inválido o ausente');
      const ageMs = nowMs - endedMs;
      return ageMs >= SURVEY_LEAD_MS && ageMs < SURVEY_EXPIRY_MS;
    } catch (e) {
      // Descartar es correcto -- no se puede decidir sin fecha -- pero en
      // silencio significa que un cliente nunca recibe su encuesta y no
      // queda rastro de por qué. El callback lo pone index.js; este módulo
      // no importa un logger para seguir siendo puro.
      if (typeof onSkip === 'function') onSkip(b && b._docId, e);
      return false;
    }
  });
}

module.exports = { SURVEY_LEAD_MS, SURVEY_EXPIRY_MS, findBookingsNeedingSurvey };
