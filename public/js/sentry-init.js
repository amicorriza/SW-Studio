// Sentry en el navegador: registro de errores inesperados. <script> clásico,
// sin bundler, va en <head> de home, login, admin y barbero.
//
// DSN vacío = no hace nada (ni descarga el SDK). El DSN de Sentry es público
// por diseño, igual que la config de Firebase: se pega acá en SENTRY_DSN.
// Tampoco corre en localhost.
//
// Sin PII: no se activa sendDefaultPii, no hay Session Replay, y beforeSend
// borra correos y teléfonos de lo que se envíe. Los errores de "el usuario
// hizo algo mal" de las callables (permission-denied, invalid-argument,
// failed-precondition por licencia suspendida...) NO se reportan.
(function () {
  var SENTRY_DSN = 'https://2cc586f10f557c12844422d4502e669f@o4511547664105472.ingest.us.sentry.io/4511547670265856';
  var SDK_URL = 'https://browser.sentry-cdn.com/10.0.0/bundle.min.js';
  var SDK_SRI = 'sha384-hvRF3mi8KPAyi1wKSeNMGuGD2dH+g4tc+SApgh50hNrkidHfALex6VB2OBKdpHiC';

  var h = location.hostname;
  if (!SENTRY_DSN || h === 'localhost' || h === '127.0.0.1') return;

  var EXPECTED = /^functions\/(invalid-argument|not-found|already-exists|permission-denied|unauthenticated|failed-precondition|out-of-range|resource-exhausted|aborted|cancelled)$/;
  var EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  var PHONE_RE = /\+\d[\d\s().-]{7,}\d|\b9[\s-]?\d{4}[\s-]?\d{4}\b/g;
  function scrub(s) { return s.replace(EMAIL_RE, '[correo]').replace(PHONE_RE, '[teléfono]'); }

  // Errores que ocurren mientras el SDK todavía se descarga: se guardan y se
  // reenvían al cargar.
  var pending = [];
  function onErr(e) { pending.push(e.error || new Error(e.message)); }
  function onRej(e) { pending.push(e.reason instanceof Error ? e.reason : new Error(String(e.reason))); }
  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onRej);

  var s = document.createElement('script');
  s.src = SDK_URL;
  s.integrity = SDK_SRI;
  s.crossOrigin = 'anonymous';
  s.async = true;
  s.onload = function () {
    var Sentry = window.Sentry;
    if (!Sentry) return;
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: 'scissor-white-web',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      ignoreErrors: ['ResizeObserver loop', 'Non-Error promise rejection captured'],
      denyUrls: [/^chrome-extension:/, /^moz-extension:/, /^safari-extension:/],
      beforeSend: function (event, hint) {
        var orig = hint && hint.originalException;
        if (orig && typeof orig.code === 'string' && EXPECTED.test(orig.code)) return null;
        var seen = [];
        (function walk(o) {
          if (!o || typeof o !== 'object' || seen.indexOf(o) !== -1) return;
          seen.push(o);
          Object.keys(o).forEach(function (k) {
            if (typeof o[k] === 'string') o[k] = scrub(o[k]); else walk(o[k]);
          });
        })(event);
        return event;
      },
    });
    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onRej);
    pending.splice(0).forEach(function (err) { Sentry.captureException(err); });
  };
  document.head.appendChild(s);
})();
