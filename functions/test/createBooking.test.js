const test = require('node:test');
const assert = require('node:assert');
const { resolveCreateBooking, isValidBookingPayload, orderCandidateBarbers } = require('../createBooking.js');
const { dateKeyOf } = require('../availability.js');

// `now` fijo -- estos tests nunca deben depender de la fecha real del
// sistema que los corre.
const NOW = new Date('2026-01-01T00:00:00.000Z');
const FUTURE_DATE_WIDGET = '2026-06-10T00:00:00.000Z'; // formato widget: medianoche UTC
const FUTURE_DAY_KEY = dateKeyOf(FUTURE_DATE_WIDGET); // '2026-06-10'

function basePayload(overrides) {
  return {
    code: 'SW-TEST1', name: 'Juan Pérez', email: 'juan@mail.com', phone: '+56912345678',
    svcId: 'lp', barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:00', club: 'guest',
    ...overrides,
  };
}
// Abierto todos los días 09:00-20:00 -- evita que los tests dependan de qué
// día de la semana cae FUTURE_DATE_WIDGET.
function openAllWeek(extra) {
  return Array(7).fill({ open: true, start: '09:00', end: '20:00', ...(extra || {}) });
}
const SERVICE = { name: 'Corte', cat: 'cortes', price: 21000, dur: 50, status: 'active' };
function staffList() {
  return [
    { id: 'felipe', name: 'Felipe', status: 'active', schedule: openAllWeek() },
    { id: 'victoria', name: 'Victoria', status: 'active', schedule: openAllWeek() },
  ];
}

test('acepta una reserva válida y arma el doc final (status/emailStatus/src correctos)', () => {
  const result = resolveCreateBooking({
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.doc.barberId, 'felipe');
  assert.strictEqual(result.doc.status, 'pending');
  assert.strictEqual(result.doc.emailStatus, 'pending');
  assert.strictEqual(result.doc.src, 'callable');
});

test('solape exacto con una reserva existente → rechaza con already-exists', () => {
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:00', dur: 50 }];
  const result = resolveCreateBooking({
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('solape parcial por el extremo de inicio de la candidata → rechaza', () => {
  // Existente 10:30-11:20 vs candidata 11:00-11:50 (dur 50 del servicio).
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '10:30', dur: 50 }];
  const result = resolveCreateBooking({
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('solape parcial por el extremo de término de la candidata → rechaza', () => {
  // Existente 11:30-12:20 vs candidata 11:00-11:50.
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:30', dur: 50 }];
  const result = resolveCreateBooking({
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('cita adyacente (termina exactamente cuando empieza la otra) → acepta', () => {
  // Existente 11:50-12:40 empieza justo cuando termina la candidata (11:00-11:50).
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:50', dur: 50 }];
  const result = resolveCreateBooking({
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
});

test("'any' se resuelve a un barbero real libre y NUNCA se persiste 'any'", () => {
  // felipe ocupado a esa hora, victoria libre -- 'any' debe caer en victoria.
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:00', dur: 50 }];
  const result = resolveCreateBooking({
    payload: basePayload({ barberId: 'any' }), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.doc.barberId, 'victoria');
  assert.notStrictEqual(result.doc.barberId, 'any');
});

test("'any' sin ningún barbero libre → rechaza con resource-exhausted (no already-exists)", () => {
  const bookingsForDay = [
    { barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:00', dur: 50 },
    { barberId: 'victoria', date: FUTURE_DATE_WIDGET, time: '11:00', dur: 50 },
  ];
  const result = resolveCreateBooking({
    payload: basePayload({ barberId: 'any' }), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'resource-exhausted');
});

test('dur y price manipulados en el payload se ignoran -- se usan siempre los de services', () => {
  const payload = basePayload({ dur: 5, price: 1, svcName: 'otro', svcCat: 'otro' });
  const result = resolveCreateBooking({
    payload, now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.doc.dur, 50);
  assert.strictEqual(result.doc.price, 21000);
  assert.strictEqual(result.doc.svcName, 'Corte');
  assert.strictEqual(result.doc.svcCat, 'cortes');
});

test('svcId inexistente (service null) → rechaza con not-found', () => {
  const result = resolveCreateBooking({
    payload: basePayload(), now: NOW, service: null, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'not-found');
});

test('servicio inactivo (existe pero status!=="active") → rechaza con not-found', () => {
  const result = resolveCreateBooking({
    payload: basePayload(), now: NOW, service: { ...SERVICE, status: 'inactive' }, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'not-found');
});

test('fecha pasada → rechaza con failed-precondition', () => {
  const result = resolveCreateBooking({
    payload: basePayload({ date: '2020-01-01T00:00:00.000Z', time: '11:00' }),
    now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'failed-precondition');
});

// No es uno de los casos listados explícitamente, pero el paso 5 de la
// implementación ("caiga en el horario del barbero") lo exige -- se agrega
// como acompañante natural de "fecha pasada", mismo code.
test('fuera del horario del barbero (día cerrado) → rechaza con failed-precondition', () => {
  const staff = [{ id: 'felipe', name: 'Felipe', status: 'active', schedule: Array(7).fill(null) }];
  const result = resolveCreateBooking({
    payload: basePayload(), now: NOW, service: SERVICE, staff,
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'failed-precondition');
});

test('solape contra un scheduleBlock del barbero → rechaza con already-exists', () => {
  const scheduleBlocksForDay = [{ barberId: 'felipe', date: FUTURE_DAY_KEY, start: '10:45', end: '11:15' }];
  const result = resolveCreateBooking({
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('solape contra la colación recurrente del barbero → rechaza con already-exists', () => {
  const staff = [{ id: 'felipe', name: 'Felipe', status: 'active', schedule: openAllWeek({ break: { start: '10:45', end: '11:15' } }) }];
  const result = resolveCreateBooking({
    payload: basePayload(), now: NOW, service: SERVICE, staff,
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('detecta solape aunque la reserva EXISTENTE tenga `date` en formato panel (hora real, no medianoche)', () => {
  // La agrupación por barbero usa siempre `time`, nunca la hora embebida en
  // `date` -- por eso da igual qué formato traiga la reserva existente.
  const bookingsForDay = [{ barberId: 'felipe', date: '2026-06-10T11:00:00.000Z', time: '11:00', dur: 50 }];
  const result = resolveCreateBooking({
    payload: basePayload({ date: FUTURE_DATE_WIDGET }), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('detecta el día correcto aunque la reserva NUEVA use `date` en formato panel', () => {
  // dateKeyOf() normaliza ambos formatos al mismo día calendario.
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:00', dur: 50 }];
  const result = resolveCreateBooking({
    payload: basePayload({ date: '2026-06-10T11:00:00.000Z' }), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

// ── isValidBookingPayload / orderCandidateBarbers: unidades sueltas ──
test('isValidBookingPayload rechaza email/phone/name inválidos y acepta un payload completo', () => {
  assert.strictEqual(isValidBookingPayload(basePayload()), true);
  assert.strictEqual(isValidBookingPayload(basePayload({ email: 'no-es-email' })), false);
  assert.strictEqual(isValidBookingPayload(basePayload({ phone: '123' })), false);
  assert.strictEqual(isValidBookingPayload(basePayload({ name: 'J' })), false);
  assert.strictEqual(isValidBookingPayload(basePayload({ club: 'vip' })), false);
});

test('orderCandidateBarbers ordena alfabéticamente por id (política actual, aislada a propósito)', () => {
  assert.deepStrictEqual(orderCandidateBarbers(['victoria', 'felipe', 'ariel']), ['ariel', 'felipe', 'victoria']);
});
