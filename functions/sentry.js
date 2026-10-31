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
const DEFAULT_DSN = 'https://2cc586f10f557c12844422d4502e669f@o4511547664105472.ingest.us.sentry.io/4511547670265856';

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
const PHONE_RE = /\+\d[\d\s().-]{7,}\d|\b9[\s-]?\d{4}[\s-]?\d{4}\b/g;
function scrubString(s) {
  return String(s).replace(EMAIL_RE, '[correo]').replace(PHONE_RE, '[teléfono]');
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

function report(err, where) {
  try {
    const s = init();
    if (!s) return;
    s.withScope((scope) => {
      scope.setTag('function', where || 'unknown');
      s.captureException(err instanceof Error ? err : new Error(scrubString(err)));
    });
  } catch (e) { /* el registro nunca rompe la operación */ }
}

async function flush() {
  try { if (Sentry) await Sentry.flush(2000); } catch (e) { /* idem */ }
}

// Envuelve el handler: reporta lo inesperado, vacía la cola (la instancia
// puede congelarse apenas responde) y re-lanza el MISMO error.
function guard(name, handler) {
  if (typeof handler !== 'function') return handler;
  return async function (...args) {
    try {
      return await handler.apply(this, args);
    } catch (err) {
      if (!isExpectedError(err)) { report(err, name); await flush(); }
      throw err;
    }
  };
}

// Mismas firmas que firebase-functions; solo cambia el último argumento.
function wrapFactory(factory) {
  return (...args) => {
    const i = args.length - 1;
    const name = (args[0] && (args[0].document || args[0].schedule)) || 'callable';
    args[i] = guard(String(name), args[i]);
    return factory(...args);
  };
}

// logger.error también va a Sentry. Se parchea una sola vez.
let patched = false;
function patchLogger() {
  if (patched) return;
  patched = true;
  const orig = logger.error;
  logger.error = function (...a) {
    orig.apply(this, a);
    const err = a.find((x) => x instanceof Error)
      || (a[1] && a[1].error instanceof Error ? a[1].error : null);
    report(err || new Error(scrubString(a.filter((x) => typeof x === 'string').join(' ') || 'logger.error')), 'logger.error');
    // sin flush: logger.error es síncrono; el SDK lo envía en segundo plano
  };
}

patchLogger();

module.exports = {
  onCall: wrapFactory(v2https.onCall),
  onSchedule: wrapFactory(v2sched.onSchedule),
  onDocumentCreated: wrapFactory(v2fs.onDocumentCreated),
  onDocumentWritten: wrapFactory(v2fs.onDocumentWritten),
  guard, report, flush, isExpectedError, scrubString, scrubEvent,
};
