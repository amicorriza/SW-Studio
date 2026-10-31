// Sentry para las funciones: registro de errores inesperados.
//
// Con DEFAULT_DSN puesto, desplegar ACTIVA el registro. Para apagarlo, vaciar
// DEFAULT_DSN. SENTRY_DSN del entorno lo sobreescribe; no se usa defineString:
// firebase-tools pregunta por los params sin valor y cuelga el emulador sin TTY.
//
// Qué se reporta y qué no:
//  - HttpsError con código "de cliente" (invalid-argument, permission-denied,
//    failed-precondition, ...) NO se reporta: es el sistema funcionando, y la
//    suspensión por falta de pago (failed-precondition) sería ruido puro.
//  - Sí se reporta: HttpsError internal/unknown/data-loss, cualquier otra
//    excepción, y cada logger.error() (las onSchedule atrapan sus errores
//    para no quedar en estado de fallo, así que sin esto nunca llegarían).
//  - Sin PII: sendDefaultPii off y beforeSend borra correos y teléfonos.
const logger = require('firebase-functions/logger');
const v2https = require('firebase-functions/v2/https');
const v2sched = require('firebase-functions/v2/scheduler');
const v2fs = require('firebase-functions/v2/firestore');

// El DSN es público por diseño (solo permite ENVIAR eventos). Va aquí y no en un
// .env porque un functions/.env ya bloqueó un deploy; SENTRY_DSN lo sobreescribe.
const DEFAULT_DSN = 'https://1ca7b5a1bd6be9a417ab777039c409ab@o4511547664105472.ingest.us.sentry.io/4512351641010176';

// Códigos que significan "el llamador hizo algo mal / no tiene permiso".
const EXPECTED_CODES = new Set([
  'invalid-argument', 'not-found', 'already-exists', 'permission-denied',
  'unauthenticated', 'failed-precondition', 'out-of-range', 'resource-exhausted',
  'aborted', 'cancelled',
]);

function isExpectedError(err) {
  return !!err && err instanceof v2https.HttpsError && EXPECTED_CODES.has(err.code);
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /\+\d[\d\s().-]{7,}\d|\b(?:56\s?)?9[\s-]?\d{4}[\s-]?\d{4}\b/g;
// Tokens largos (reminderToken, claves): el scrub por correo/teléfono no los ve.
const TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;
function scrubString(s) {
  return String(s).replace(EMAIL_RE, '[correo]').replace(PHONE_RE, '[teléfono]').replace(TOKEN_RE, '[token]');
}
// Recorre el evento y limpia los strings EN SITIO. No se usa JSON.stringify del
// evento entero: trae referencias circulares (sdkProcessingMetadata) y al
// lanzar dejaba pasar el evento SIN limpiar -- se vio con un evento real.
function scrubEvent(event) {
  const seen = new WeakSet();
  (function walk(o) {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    for (const k of Object.keys(o)) {
      if (k === 'sdkProcessingMetadata') continue;
      if (typeof o[k] === 'string') o[k] = scrubString(o[k]);
      else walk(o[k]);
    }
  })(event);
  return event;
}

let Sentry = null;
let ready = false;
function init() {
  if (ready) return Sentry;
  ready = true;
  let dsn = '';
  dsn = process.env.SENTRY_DSN || DEFAULT_DSN;
  if (!dsn || process.env.FUNCTIONS_EMULATOR === 'true') return null;
  Sentry = require('@sentry/node');
  Sentry.init({
    dsn,
    environment: process.env.GCLOUD_PROJECT || 'scissor-white',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
  return Sentry;
}

// Estado de UNA invocación: cuántos reportes se hicieron (para no duplicar el
// logger.error + el HttpsError('internal') que le sigue) y si quedó algo sin enviar.
const { AsyncLocalStorage } = require('node:async_hooks');
const als = new AsyncLocalStorage();
let dirty = false;

function report(err, where, logMsg) {
  try {
    const store = als.getStore();
    if (store) store.n++;
    const s = init();
    if (!s) return;
    dirty = true;
    s.withScope((scope) => {
      scope.setTag('function', where || 'unknown');
      if (logMsg) scope.setExtra('log', scrubString(logMsg).slice(0, 300));
      s.captureException(err instanceof Error ? err : new Error(scrubString(err)));
    });
  } catch (e) { /* el registro nunca rompe la operación */ }
}

async function flush() {
  dirty = false;
  try { if (Sentry) await Sentry.flush(2000); } catch (e) { /* idem */ }
}

// Envuelve el handler: reporta lo inesperado, vacía la cola (la instancia
// puede congelarse apenas responde, también cuando el handler atrapó el error y
// solo lo dejó en logger.error) y re-lanza el MISMO error.
function guard(name, handler) {
  if (typeof handler !== 'function') return handler;
  return function (...args) {
    return als.run({ n: 0 }, async () => {
      try {
        return await handler.apply(this, args);
      } catch (err) {
        // Si un logger.error ya reportó este incidente y el handler lo convirtió en
        // HttpsError('internal'), no se reporta dos veces.
        const yaReportado = als.getStore().n > 0 && err instanceof v2https.HttpsError;
        if (!isExpectedError(err) && !yaReportado) report(err, name);
        throw err;
      } finally {
        if (dirty) await flush();
      }
    });
  };
}

// Mismas firmas que firebase-functions; solo cambia el último argumento.
function wrapFactory(factory) {
  return (...args) => {
    const i = args.length - 1;
    const name = (args[0] && (args[0].document || args[0].schedule)) || 'callable';
    // En gen2 FUNCTION_TARGET trae el nombre real del export (cada función es su
    // propio servicio); sin él, todas las callables serían 'callable'.
    args[i] = guard(process.env.FUNCTION_TARGET || String(name), args[i]);
    return factory(...args);
  };
}

// El mismo aviso repetido (una reserva ilegible se re-procesa cada 2-15 min) se
// reporta una vez cada 15 min, no en cada corrida.
const THROTTLE_MS = 15 * 60 * 1000;
const lastSent = new Map();
function throttled(key) {
  const now = Date.now();
  if (now - (lastSent.get(key) || 0) < THROTTLE_MS) return true;
  lastSent.set(key, now);
  if (lastSent.size > 200) lastSent.clear();
  return false;
}

// logger.error también va a Sentry. Se parchea una sola vez.
let patched = false;
function patchLogger() {
  if (patched) return;
  patched = true;
  const orig = logger.error;
  logger.error = function (...a) {
    orig.apply(this, a);
    const msg = a.filter((x) => typeof x === 'string').join(' ');
    const err = a.find((x) => x instanceof Error)
      || (a[1] && a[1].error instanceof Error ? a[1].error : null);
    // Resend rechazó por culpa del dato (correo inválido) o por límite de uso: se
    // reintenta solo y no hay nada que arreglar. Queda en Cloud Logging, no en Sentry.
    if (err && (err.resendKind === 'client' || err.resendKind === 'transient')) return;
    if (throttled(scrubString(msg || (err && err.message) || 'logger.error'))) return;
    report(err || new Error(scrubString(msg || 'logger.error')), 'logger.error', msg);
  };
}

patchLogger();

module.exports = {
  __als: als,
  onCall: wrapFactory(v2https.onCall),
  onSchedule: wrapFactory(v2sched.onSchedule),
  onDocumentCreated: wrapFactory(v2fs.onDocumentCreated),
  onDocumentWritten: wrapFactory(v2fs.onDocumentWritten),
  guard, report, flush, isExpectedError, scrubString, scrubEvent,
};
