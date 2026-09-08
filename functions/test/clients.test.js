// aggregateMyClients: la lista de "mis clientes" de la PWA del profesional.
const { test } = require('node:test');
const assert = require('node:assert');
const { aggregateMyClients, clientKey } = require('../shared/clients.js');

const cita = (o) => Object.assign({
  name: 'Ana Torres', email: 'ana@mail.cl', date: '2026-09-01',
  svcName: 'Corte de cabello', status: 'completed',
}, o);

test('agrupa las visitas de un mismo cliente', () => {
  const r = aggregateMyClients([
    cita({ date: '2026-08-01' }), cita({ date: '2026-09-01' }), cita({ date: '2026-07-01' }),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].visits, 3);
  assert.equal(r[0].lastVisit, '2026-09-01');
});

// El motivo de agrupar por correo y no por nombre. Si esto se rompe, dos
// personas distintas aparecen como una sola con el doble de visitas.
test('dos homónimos con correos distintos NO se fusionan', () => {
  const r = aggregateMyClients([
    cita({ name: 'Juan Pérez', email: 'juan1@mail.cl' }),
    cita({ name: 'Juan Pérez', email: 'juan2@mail.cl' }),
  ]);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((c) => c.visits), [1, 1]);
});

test('el mismo correo con distinta capitalización o espacios es el mismo cliente', () => {
  const r = aggregateMyClients([
    cita({ email: 'Ana@Mail.CL' }), cita({ email: '  ana@mail.cl ' }),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].visits, 2);
});

// Las reservas que toma el salón por teléfono no traen correo.
test('sin correo agrupa por nombre, y no choca con los que sí lo tienen', () => {
  const r = aggregateMyClients([
    cita({ email: '', name: 'Sin Correo' }), cita({ email: '', name: 'sin correo' }),
    cita({ email: 'otro@mail.cl', name: 'Sin Correo' }),
  ]);
  assert.equal(r.length, 2);
  assert.equal(r.find((c) => c.key.startsWith('n:')).visits, 2);
});

// Lista blanca: un estado nuevo no debe colarse solo en el historial.
test('solo cuentan las atenciones reales, no las reservas que no ocurrieron', () => {
  const r = aggregateMyClients([
    cita({ status: 'completed' }), cita({ status: 'in_service' }),
    cita({ status: 'no_show' }), cita({ status: 'cancelled' }),
    cita({ status: 'declined' }), cita({ status: 'pending' }), cita({ status: 'confirmed' }),
  ]);
  assert.equal(r[0].visits, 2);
});

test('el correo NUNCA sale en la respuesta', () => {
  const r = aggregateMyClients([cita({})]);
  assert.equal(JSON.stringify(r).includes('ana@mail.cl'), false);
  assert.equal('email' in r[0], false);
  assert.equal('phone' in r[0], false);
});

test('el servicio más frecuente gana; con empate manda el alfabético', () => {
  const conEmpate = aggregateMyClients([
    cita({ svcName: 'Perfilado de barba' }), cita({ svcName: 'Corte de cabello' }),
  ]);
  assert.equal(conEmpate[0].topService, 'Corte de cabello');
  const claro = aggregateMyClients([
    cita({ svcName: 'Perfilado de barba' }), cita({ svcName: 'Perfilado de barba' }),
    cita({ svcName: 'Corte de cabello' }),
  ]);
  assert.equal(claro[0].topService, 'Perfilado de barba');
});

// El panel admin escribe `date` como 'YYYY-MM-DDT...Z' (ver CLAUDE.md), el
// widget como 'YYYY-MM-DD'. Las dos formas tienen que convivir.
test('convive con los dos formatos de fecha que escribe el sistema', () => {
  const r = aggregateMyClients([
    cita({ date: '2026-09-01' }), cita({ date: '2026-09-03T15:00:00.000Z' }),
  ]);
  assert.equal(r[0].visits, 2);
  assert.equal(r[0].lastVisit, '2026-09-03');
});

test('ordena por última visita, de más reciente a más antigua', () => {
  const r = aggregateMyClients([
    cita({ email: 'a@x.cl', name: 'A', date: '2026-07-01' }),
    cita({ email: 'b@x.cl', name: 'B', date: '2026-09-01' }),
    cita({ email: 'c@x.cl', name: 'C', date: '2026-08-01' }),
  ]);
  assert.deepEqual(r.map((c) => c.name), ['B', 'C', 'A']);
});

test('el nombre más reciente gana, para que una corrección de tipeo se vea', () => {
  const r = aggregateMyClients([
    cita({ date: '2026-07-01', name: 'Ana Torrez' }),
    cita({ date: '2026-09-01', name: 'Ana Torres' }),
  ]);
  assert.equal(r[0].name, 'Ana Torres');
});

test('sin citas devuelve lista vacía, no revienta', () => {
  assert.deepEqual(aggregateMyClients([]), []);
  assert.deepEqual(aggregateMyClients(null), []);
});

test('clientKey es estable y no reversible a simple vista', () => {
  const k = clientKey('ana@mail.cl', 'Ana');
  assert.equal(k, clientKey('ANA@mail.cl ', 'Otro Nombre'));
  assert.equal(k.length, 12);
  assert.match(k, /^[0-9a-f]{12}$/);
});
