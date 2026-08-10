// functions/timezone.js — conversión entre hora de pared del negocio y el
// instante UTC real que representa, vía IANA (Intl, ya incluido en Node --
// sin dependencia nueva). Sin dependencia de firebase-admin: mismo patrón
// que availability.js/patients.js, testeable con node --test.
//
// PRINCIPIO (Fase 2): la zona del NEGOCIO gobierna todo -- ni el navegador
// del cliente ni el de quien administra el panel influyen en nada. La
// contraparte de este archivo vive duplicada, a propósito, inline en
// public/index.html y public/admin/index.html (son <script> planos sin
// bundler, no pueden importar este módulo -- mismo motivo documentado para
// overlaps()/isRangeFree() en availability.js). Cambiar la lógica acá sin
// revisar esas dos copias es exactamente el tipo de divergencia silenciosa
// que ya nos mordió una vez con isValidBooking()/isValidBookingPayload().
'use strict';

const DEFAULT_TZ = 'America/Santiago';
const DEFAULT_BUFFER_MIN = 0;

// businessInfo.tz ausente (negocios existentes, o el campo nunca se guardó)
// -> DEFAULT_TZ. Único punto de este fallback en todo el código -- explícito
// a propósito, no un default disperso en cada llamador.
function resolveBusinessTz(businessInfo) {
  return (businessInfo && businessInfo.tz) || DEFAULT_TZ;
}

// businessInfo.bufferMin ausente/no numérico -> DEFAULT_BUFFER_MIN (0, sin
// margen). Mismo patrón que resolveBusinessTz: único punto de este
// fallback, explícito en el llamador (index.js), nunca disperso.
function resolveBufferMin(businessInfo) {
  return (businessInfo && Number.isFinite(businessInfo.bufferMin)) ? businessInfo.bufferMin : DEFAULT_BUFFER_MIN;
}

// 'YYYY-MM-DD' + 'HH:MM', interpretados como hora de PARED en `tz`, ->
// instante UTC real (Date) que representan. Técnica de doble conversión:
// arma un instante candidato tratando los componentes como si fueran UTC,
// le pregunta a Intl qué hora de pared muestra ESE instante en `tz` (que ya
// conoce la regla vigente para esa fecha exacta -- DST incluido, sin que
// esta función necesite saberlo de antemano), y corrige por la diferencia.
//
// Limitación conocida y aceptada: no desambigua el minuto exacto de una
// transición de horario de verano (hora de pared que no existe o que ocurre
// dos veces esa noche). No hace falta resolverlo: la transición de Chile
// ocurre a medianoche y el horario de atención del negocio nunca cruza ese
// instante.
function zonedInstant(dateKey, time, tz) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(guess));
  const get = (type) => Number(parts.find(p => p.type === type).value);
  // Algunas implementaciones de Intl formatean medianoche como "24" en vez
  // de "00" con hour12:false -- se normaliza acá.
  const shownHour = get('hour') === 24 ? 0 : get('hour');
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), shownHour, get('minute'));

  return new Date(guess + (guess - asIfUtc));
}

// Instante real -> 'YYYY-MM-DD', el día calendario que ESE instante
// representa visto desde `tz`. NUNCA hacer esto recortando el string ISO en
// UTC (`.slice(0,10)`) -- para un instante tarde en la noche UTC, el día
// calendario visto desde una zona con offset negativo puede ser el anterior.
function dateKeyInZone(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const get = (type) => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Instante real -> 'HH:MM', la hora de PARED que ESE instante representa
// visto desde `tz`. Mismo patrón que dateKeyInZone, para la hora en vez de
// la fecha. Existe por un hallazgo concreto: el widget decidía qué horarios
// de "hoy" ya pasaron comparando contra `new Date()` en hora del NAVEGADOR
// de quien reserva -- alguien reservando desde otra zona veía disponibilidad
// distinta de la real en el negocio. No es un detalle de tipo, es un bug de
// producto que este helper cierra.
function timeKeyInZone(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(instant);
  const get = (type) => parts.find(p => p.type === type).value;
  // Mismo ajuste que zonedInstant: medianoche puede venir formateada como
  // "24" en vez de "00".
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${hour}:${get('minute')}`;
}

module.exports = {
  DEFAULT_TZ, resolveBusinessTz, DEFAULT_BUFFER_MIN, resolveBufferMin,
  zonedInstant, dateKeyInZone, timeKeyInZone,
};
