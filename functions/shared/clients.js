// functions/shared/clients.js — agregación de "mis clientes" para la PWA del
// profesional. Puro: sin firebase-admin, sin reloj propio, testeable con
// `node --test` y sin emulador. Mismo patrón que shared/attendance.js.
//
// Se arma SIEMPRE desde `bookings`, nunca desde `patients`. Esa colección
// guarda teléfono, correo, notas e historial de fotos, y la decisión tomada
// con el usuario es que nada de eso llegue al teléfono del barbero. La forma
// segura de garantizarlo no es filtrar campos al salir: es no abrir la
// colección. Todo lo que esta vista necesita ya está en las reservas.
'use strict';

const crypto = require('crypto');

// Solo estas cuentan como "lo atendí". Es una lista BLANCA a propósito, igual
// que BLOCKING_STATUSES en shared/status.js: un estado nuevo no se cuela solo
// en el historial de nadie.
const ATENDIDAS = ['completed', 'in_service'];

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

// Clave de agrupación. Se agrupa por correo -- es la clave de unión real, la
// misma que usa patients -- pero el correo NO viaja al cliente: sale un hash.
// Agrupar por nombre fusionaría a dos "Juan Pérez" distintos en una ficha con
// el doble de visitas, que es peor que no tener la vista.
//
// Sin correo (las reservas que toma el salón por teléfono) se cae al nombre,
// con prefijo para que nunca choque con un hash de correo. Es una
// aproximación declarada: sin correo no hay identidad fuerte, y por eso mismo
// onBookingCreated tampoco crea ficha en patients.
function clientKey(email, name) {
  const e = norm(email);
  if (e) return crypto.createHash('sha256').update(e).digest('hex').slice(0, 12);
  return 'n:' + norm(name);
}

// bookings: las reservas de UN barbero, ya filtradas por el servidor.
// Devuelve una fila por cliente, de más reciente a más antiguo.
function aggregateMyClients(bookings) {
  const porClave = new Map();

  (bookings || []).forEach((b) => {
    if (ATENDIDAS.indexOf(b && b.status) === -1) return;
    const nombre = String((b && b.name) || '').trim();
    const key = clientKey(b && b.email, nombre);
    let c = porClave.get(key);
    if (!c) {
      c = { key, name: nombre || 'Sin nombre', visits: 0, lastVisit: null, _svc: new Map() };
      porClave.set(key, c);
    }
    c.visits += 1;
    // `date` puede venir como 'YYYY-MM-DD' (widget) o 'YYYY-MM-DDTHH:mm:ss.sssZ'
    // (el panel admin escribe así, ver CLAUDE.md). Comparar los primeros 10
    // caracteres funciona para ambos y no construye ningún Date, que es lo que
    // metería la zona del navegador en una fecha ya resuelta.
    const dia = String((b && b.date) || '').slice(0, 10);
    if (dia && (!c.lastVisit || dia > c.lastVisit)) {
      c.lastVisit = dia;
      // El nombre más reciente gana: si alguien corrigió un tipeo, la ficha
      // debería mostrar el nombre corregido y no el primero que se escribió.
      if (nombre) c.name = nombre;
    }
    const svc = String((b && b.svcName) || '').trim();
    if (svc) c._svc.set(svc, (c._svc.get(svc) || 0) + 1);
  });

  return [...porClave.values()].map((c) => {
    // Servicio más frecuente. Con empate gana el alfabéticamente menor, para
    // que la lista no baile entre dos recargas con los mismos datos.
    let top = null, topN = 0;
    [...c._svc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([s, n]) => {
      if (n > topN) { top = s; topN = n; }
    });
    return { key: c.key, name: c.name, visits: c.visits, lastVisit: c.lastVisit, topService: top };
  }).sort((a, b) => {
    if (a.lastVisit === b.lastVisit) return a.name < b.name ? -1 : 1;
    if (!a.lastVisit) return 1;
    if (!b.lastVisit) return -1;
    return a.lastVisit < b.lastVisit ? 1 : -1;
  });
}

module.exports = { aggregateMyClients, clientKey, ATENDIDAS };
