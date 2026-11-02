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
  var SENTRY_DSN = 'https://1ca7b5a1bd6be9a417ab777039c409ab@o4511547664105472.ingest.us.sentry.io/4512351641010176';
  var SDK_URL = 'https://browser.sentry-cdn.com/10.0.0/bundle.min.js';
  var SDK_SRI = 'sha384-hvRF3mi8KPAyi1wKSeNMGuGD2dH+g4tc+SApgh50hNrkidHfALex6VB2OBKdpHiC';

  // swReport(err, donde): para los catch que muestran un aviso al usuario y por
  // eso nunca llegan al handler global. Siempre existe (no-op en localhost o sin
  // DSN), así que los llamadores no necesitan comprobar nada. Se ignora lo que
  // es "el usuario hizo algo mal" o falta de red; lo demás va con tag 'donde'.
  window.swReport = function () {};

  var h = location.hostname;
  if (!SENTRY_DSN || h === 'localhost' || h === '127.0.0.1') return;

  // Falta de red y errores de credenciales del usuario: no son fallas del sistema.
  var NOISE = /^(functions\/|auth\/)?(unavailable|deadline-exceeded|network-request-failed|invalid-credential|wrong-password|user-not-found|too-many-requests|popup-closed-by-user)$/;
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

  var ready = null;
  window.swReport = function (err, donde) {
    try {
      if (!err || err.__swReported) return;
      var code = typeof err.code === 'string' ? err.code : '';
      if (EXPECTED.test(code) || NOISE.test(code)) return;
      if (err.details && err.details.license === 'suspended') return;
      if (navigator.onLine === false) return;
      try { err.__swReported = true; } catch (e) { /* objeto congelado */ }
      var e2 = err instanceof Error ? err : new Error(String(err && err.message || err));
      if (ready) ready(e2, donde); else pending.push(e2);
    } catch (e) { /* reportar nunca rompe la operación */ }
  };

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
      // El último es del navegador interno de Instagram/Facebook en Android
      // (iabjs://navigation_performance_logger_android, sendDataToNative): su
      // propio script falla al hablar con la app nativa. No es código nuestro.
      ignoreErrors: [
        'ResizeObserver loop',
        'Non-Error promise rejection captured',
        'Error invoking postMessage: Java object is gone',
      ],
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
    ready = function (err, donde) {
      Sentry.withScope(function (scope) {
        if (donde) scope.setTag('donde', donde);
        Sentry.captureException(err);
      });
    };
    pending.splice(0).forEach(function (err) { Sentry.captureException(err); });
  };
  document.head.appendChild(s);
})();
