// public/barbero/sw.js — service worker de la PWA del barbero.
//
// Scope /barbero/, así no intercepta nada del sitio público ni de /admin.
// Se usan los builds *-compat* porque un service worker clásico no puede
// hacer `import`, e `importScripts` es la única forma de traer el SDK sin
// bundler. Misma versión (10.13.0) que el resto del sitio.
//
// Vive acá y no en /firebase-messaging-sw.js (la ruta que FCM busca por
// defecto) porque la app lo registra explícitamente y se lo pasa a getToken()
// vía serviceWorkerRegistration -- así no hay que plantar un service worker
// con scope '/' sobre todo scissorwhite.cl solo para esta app.
//
// firebase.json lo sirve con Cache-Control: no-cache. Es obligatorio: un
// service worker cacheado es un service worker congelado, y arreglarlo
// después requiere que cada barbero desinstale la app.
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

// Misma config pública que /js/firebase-init.js. No es secreto: la seguridad
// la dan las reglas y Firebase Auth.
firebase.initializeApp({
  apiKey: 'AIzaSyCIRapdq3FmO4hZgnH4uQjK-CEtm4GKtOg',
  authDomain: 'scissor-white.firebaseapp.com',
  projectId: 'scissor-white',
  storageBucket: 'scissor-white.firebasestorage.app',
  messagingSenderId: '801854192115',
  appId: '1:801854192115:web:45c4bab322ee6154583a86',
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// staffAttendanceNudges manda SOLO datos (sin clave `notification`), a
// propósito: con `notification` el SDK de FCM muestra la notificación por su
// cuenta y este handler no corre de forma confiable, así que se perderían el
// `tag`, las acciones y el `data` del enlace profundo. Título y cuerpo
// viajan dentro de `data`.
firebase.messaging().onBackgroundMessage(function (payload) {
  const d = payload.data || {};
  self.registration.showNotification(d.title || 'SW Barbero', {
    body: d.body || '',
    icon: '/barbero/icon-192.png',
    badge: '/barbero/icon-192.png',
    // Una notificación por cita, no una pila: si el aviso de fin se repite,
    // reemplaza al anterior en vez de acumular seis en la bandeja.
    tag: 'sw-' + (d.b || ''),
    renotify: true,
    data: d,
    // Las acciones solo se ven en Android -- Safari no las soporta. Por eso
    // NUNCA ejecutan nada acá: solo abren la app con la intención en la URL,
    // que es el único camino que funciona igual en los dos sistemas.
    actions: d.a === 'end'
      ? [{ action: 'end', title: 'Finalizar' }, { action: 'snooze', title: '10 min más' }]
      : (d.a === 'start' ? [{ action: 'start', title: 'Comenzar' }] : []),
  });
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const d = event.notification.data || {};
  const accion = event.action || d.a || 'view';
  const url = '/barbero/?b=' + encodeURIComponent(d.b || '') + '&a=' + encodeURIComponent(accion);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const c of list) {
        if (c.url.indexOf('/barbero/') !== -1 && 'focus' in c) {
          // navigate() puede no estar disponible en algunos navegadores; el
          // focus solo ya deja la app visible y su poll de visibilidad
          // recarga la agenda igual.
          if (typeof c.navigate === 'function') c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
