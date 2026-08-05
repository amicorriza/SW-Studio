const test = require('node:test');
const assert = require('node:assert');
const {
  toMinutes, addMinutesToTime, computeAvailability, dateKeyOf, dayBoundsOf,
  overlaps, isRangeFree, isWithinOpenHours,
} = require('../availability.js');

test('toMinutes convierte HH:MM a minutos desde medianoche', () => {
  assert.strictEqual(toMinutes('09:00'), 540);
  assert.strictEqual(toMinutes('00:00'), 0);
  assert.strictEqual(toMinutes('23:45'), 1425);
});

test('addMinutesToTime suma la duración y devuelve HH:MM', () => {
  assert.strictEqual(addMinutesToTime('10:00', 50), '10:50');
  assert.strictEqual(addMinutesToTime('10:40', 30), '11:10');
});

test('computeAvailability filtra por barberId cuando se especifica uno concreto', () => {
  const bookings = [
    { barberId: 'felipe', date: '2026-07-10', time: '10:00', dur: 50 },
    { barberId: 'victoria', date: '2026-07-10', time: '11:00', dur: 30 },
  ];
  const staff = [
    { id: 'felipe', status: 'active' },
    { id: 'victoria', status: 'active' },
  ];
  const result = computeAvailability({ bookings, staff, barberId: 'felipe' });
  assert.deepStrictEqual(Object.keys(result.barberBusy), ['felipe']);
  assert.deepStrictEqual(result.barberBusy.felipe, [{ start: '10:00', end: '10:50' }]);
});

test('computeAvailability con barberId "any" agrupa todas las reservas del día por su propio barbero', () => {
  const bookings = [
    { barberId: 'felipe', date: '2026-07-10', time: '10:00', dur: 50 },
    { barberId: 'victoria', date: '2026-07-10', time: '11:00', dur: 30 },
    { barberId: 'felipe', date: '2026-07-10', time: '15:00', dur: 60 },
  ];
  const staff = [
    { id: 'felipe', status: 'active' },
    { id: 'victoria', status: 'active' },
    { id: 'esteban', status: 'inactive' },
  ];
  const result = computeAvailability({ bookings, staff, barberId: 'any' });
  assert.deepStrictEqual(result.barberBusy.felipe, [
    { start: '10:00', end: '10:50' },
    { start: '15:00', end: '16:00' },
  ]);
  assert.deepStrictEqual(result.barberBusy.victoria, [{ start: '11:00', end: '11:30' }]);
  assert.deepStrictEqual(result.activeBarberIds.sort(), ['felipe', 'victoria']);
});

test('computeAvailability trata barberId vacío/omitido igual que "any"', () => {
  const bookings = [
    { barberId: 'felipe', date: '2026-07-10', time: '10:00', dur: 50 },
    { barberId: 'victoria', date: '2026-07-10', time: '11:00', dur: 30 },
  ];
  const staff = [{ id: 'felipe', status: 'active' }, { id: 'victoria', status: 'active' }];
  const result = computeAvailability({ bookings, staff, barberId: '' });
  assert.deepStrictEqual(Object.keys(result.barberBusy).sort(), ['felipe', 'victoria']);
});

test('computeAvailability nunca incluye PII (name/email/phone) en el resultado', () => {
  const bookings = [
    { barberId: 'felipe', date: '2026-07-10', time: '10:00', dur: 50, name: 'Juan Pérez', email: 'juan@mail.com', phone: '+56912345678', code: 'SW-XYZ' },
  ];
  const staff = [{ id: 'felipe', status: 'active', name: 'Felipe', schedule: [] }];
  const result = computeAvailability({ bookings, staff, barberId: 'felipe' });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('Juan'));
  assert.ok(!serialized.includes('juan@mail.com'));
  assert.ok(!serialized.includes('+56912345678'));
  assert.ok(!serialized.includes('SW-XYZ'));
  assert.deepStrictEqual(result.barberBusy.felipe, [{ start: '10:00', end: '10:50' }]);
});

test('computeAvailability solo incluye barberos activos en activeBarberIds', () => {
  const staff = [
    { id: 'felipe', status: 'active' },
    { id: 'esteban', status: 'inactive' },
  ];
  const result = computeAvailability({ bookings: [], staff, barberId: 'any' });
  assert.deepStrictEqual(result.activeBarberIds, ['felipe']);
  assert.deepStrictEqual(result.barberBusy, {});
});

test('computeAvailability con staff vacío/todos inactivos devuelve activeBarberIds vacío', () => {
  const result = computeAvailability({ bookings: [], staff: [], barberId: 'any' });
  assert.deepStrictEqual(result.activeBarberIds, []);
  const result2 = computeAvailability({
    bookings: [],
    staff: [{ id: 'esteban', status: 'inactive' }, { id: 'ariel', status: 'inactive' }],
    barberId: 'any',
  });
  assert.deepStrictEqual(result2.activeBarberIds, []);
});

test('computeAvailability no incluye barberBusy[id] cuando el barbero pedido no tiene reservas ese día', () => {
  // Contrato: ausencia de la clave, no un array vacío -- quien llama debe
  // leer con `barberBusy[id] || []`.
  const staff = [{ id: 'felipe', status: 'active' }];
  const result = computeAvailability({ bookings: [], staff, barberId: 'felipe' });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result.barberBusy, 'felipe'), false);
  assert.deepStrictEqual(result.barberBusy.felipe || [], []);
});

test('computeAvailability con dur ausente/cero produce un rango de duración cero, no un crash', () => {
  const bookings = [{ barberId: 'felipe', date: '2026-07-10', time: '10:00' }]; // sin dur
  const staff = [{ id: 'felipe', status: 'active' }];
  const result = computeAvailability({ bookings, staff, barberId: 'felipe' });
  assert.deepStrictEqual(result.barberBusy.felipe, [{ start: '10:00', end: '10:00' }]);
});

test('dateKeyOf normaliza ambos formatos de `date` de una reserva al mismo día calendario', () => {
  // Widget público: medianoche local serializada a UTC.
  assert.strictEqual(dateKeyOf('2026-07-10T04:00:00.000Z'), '2026-07-10');
  // Admin: hora real de la cita.
  assert.strictEqual(dateKeyOf('2026-07-10T14:30:00.000Z'), '2026-07-10');
});

test('dateKeyOf tolera valores vacíos/ausentes sin crashear', () => {
  assert.strictEqual(dateKeyOf(''), '');
  assert.strictEqual(dateKeyOf(undefined), '');
  assert.strictEqual(dateKeyOf(null), '');
});

test('dayBoundsOf devuelve [start,end) que cubre exactamente un día calendario UTC', () => {
  const { start, end } = dayBoundsOf('2026-07-10');
  assert.strictEqual(start, '2026-07-10T00:00:00.000Z');
  assert.strictEqual(end, '2026-07-11T00:00:00.000Z');
  // Ambos formatos de `date` deben caer dentro de [start, end) por comparación
  // lexicográfica de strings ISO.
  assert.ok('2026-07-10T04:00:00.000Z' >= start && '2026-07-10T04:00:00.000Z' < end);
  assert.ok('2026-07-10T14:30:00.000Z' >= start && '2026-07-10T14:30:00.000Z' < end);
});

test('dayBoundsOf hace rollover correcto de fin de mes y fin de año', () => {
  assert.deepStrictEqual(dayBoundsOf('2026-01-31'), {
    start: '2026-01-31T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z',
  });
  assert.deepStrictEqual(dayBoundsOf('2026-12-31'), {
    start: '2026-12-31T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z',
  });
});

test('computeAvailability agrega la colación recurrente del barbero como rango ocupado', () => {
  const staff = [{ id: 'victoria', status: 'active', schedule: [null, null, { open: true, start: '10:00', end: '20:00', break: { start: '13:00', end: '14:00' } }] }];
  const result = computeAvailability({ bookings: [], staff, barberId: 'victoria', dow: 2, scheduleBlocks: [] });
  assert.deepStrictEqual(result.barberBusy.victoria, [{ start: '13:00', end: '14:00' }]);
});

test('computeAvailability ignora la colación de otro día de la semana', () => {
  const staff = [{ id: 'victoria', status: 'active', schedule: [null, null, { open: true, start: '10:00', end: '20:00', break: { start: '13:00', end: '14:00' } }] }];
  const result = computeAvailability({ bookings: [], staff, barberId: 'victoria', dow: 3, scheduleBlocks: [] });
  assert.deepStrictEqual(result.barberBusy.victoria || [], []);
});

test('computeAvailability agrega los scheduleBlocks del barbero como rangos ocupados', () => {
  const staff = [{ id: 'victoria', status: 'active', schedule: [] }];
  const scheduleBlocks = [{ barberId: 'victoria', date: '2026-08-05', start: '15:00', end: '16:00', reason: 'Trámite' }];
  const result = computeAvailability({ bookings: [], staff, barberId: 'victoria', dow: 3, scheduleBlocks });
  assert.deepStrictEqual(result.barberBusy.victoria, [{ start: '15:00', end: '16:00' }]);
});

test('computeAvailability combina reservas, colación y bloqueos puntuales sin pisarse', () => {
  const bookings = [{ barberId: 'victoria', date: '2026-08-05', time: '10:00', dur: 50 }];
  const staff = [{ id: 'victoria', status: 'active', schedule: [null, null, null, { open: true, start: '10:00', end: '20:00', break: { start: '13:00', end: '14:00' } }] }];
  const scheduleBlocks = [{ barberId: 'victoria', date: '2026-08-05', start: '17:00', end: '18:00', reason: 'Trámite' }];
  const result = computeAvailability({ bookings, staff, barberId: 'victoria', dow: 3, scheduleBlocks });
  assert.deepStrictEqual(result.barberBusy.victoria, [
    { start: '10:00', end: '10:50' },
    { start: '13:00', end: '14:00' },
    { start: '17:00', end: '18:00' },
  ]);
});

test('computeAvailability con barberId "any" agrega colación/bloqueos de todos los barberos activos', () => {
  const staff = [
    { id: 'victoria', status: 'active', schedule: [null, null, null, { open: true, start: '10:00', end: '20:00', break: { start: '13:00', end: '14:00' } }] },
    { id: 'esteban', status: 'active', schedule: [] },
  ];
  const scheduleBlocks = [{ barberId: 'esteban', date: '2026-08-05', start: '11:00', end: '11:30', reason: 'x' }];
  const result = computeAvailability({ bookings: [], staff, barberId: 'any', dow: 3, scheduleBlocks });
  assert.deepStrictEqual(result.barberBusy.victoria, [{ start: '13:00', end: '14:00' }]);
  assert.deepStrictEqual(result.barberBusy.esteban, [{ start: '11:00', end: '11:30' }]);
});

test('computeAvailability ignora un scheduleBlock de un barbero distinto al filtrado', () => {
  const staff = [{ id: 'victoria', status: 'active' }, { id: 'esteban', status: 'active' }];
  const scheduleBlocks = [{ barberId: 'esteban', date: '2026-08-05', start: '11:00', end: '11:30', reason: 'x' }];
  const result = computeAvailability({ bookings: [], staff, barberId: 'victoria', dow: 3, scheduleBlocks });
  assert.deepStrictEqual(result.barberBusy.victoria || [], []);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result.barberBusy, 'esteban'), false);
});

test('computeAvailability sin dow/scheduleBlocks se comporta exactamente igual que antes (compatibilidad)', () => {
  const bookings = [{ barberId: 'felipe', date: '2026-07-10', time: '10:00', dur: 50 }];
  const staff = [{ id: 'felipe', status: 'active' }];
  const result = computeAvailability({ bookings, staff, barberId: 'felipe' });
  assert.deepStrictEqual(result.barberBusy.felipe, [{ start: '10:00', end: '10:50' }]);
});

test('overlaps: solape exacto, parcial, adyacente y sin relación', () => {
  assert.strictEqual(overlaps(600, 650, 600, 650), true); // exacto
  assert.strictEqual(overlaps(600, 650, 620, 700), true); // parcial por el final
  assert.strictEqual(overlaps(600, 650, 500, 620), true); // parcial por el inicio
  assert.strictEqual(overlaps(600, 650, 650, 700), false); // adyacente, sin solape
  assert.strictEqual(overlaps(600, 650, 700, 800), false); // sin relación
});

test('isRangeFree: libre sin rangos, ocupado con solape, libre si es adyacente', () => {
  assert.strictEqual(isRangeFree([], '10:00', '10:50'), true);
  assert.strictEqual(isRangeFree([{ start: '10:00', end: '10:50' }], '10:20', '10:40'), false);
  assert.strictEqual(isRangeFree([{ start: '10:00', end: '10:50' }], '10:50', '11:20'), true);
});

test('isWithinOpenHours: dentro, fuera, día cerrado y sin schedule', () => {
  const schedule = [null, null, { open: true, start: '10:00', end: '20:00' }];
  assert.strictEqual(isWithinOpenHours(schedule, 2, '10:00', '10:50'), true);
  assert.strictEqual(isWithinOpenHours(schedule, 2, '19:30', '20:30'), false); // se pasa del cierre
  assert.strictEqual(isWithinOpenHours(schedule, 0, '10:00', '10:50'), false); // día sin entrada (cerrado)
  assert.strictEqual(isWithinOpenHours(null, 2, '10:00', '10:50'), false);
});
