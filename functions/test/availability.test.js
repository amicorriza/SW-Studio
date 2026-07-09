const test = require('node:test');
const assert = require('node:assert');
const { toMinutes, addMinutesToTime, computeAvailability } = require('../availability.js');

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
