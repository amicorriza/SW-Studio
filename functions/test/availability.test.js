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
  assert.deepStrictEqual(result.barberBusy.felipe, [{ start: '10:00', end: '10:50', kind: 'booking' }]);
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
    { start: '10:00', end: '10:50', kind: 'booking' },
    { start: '15:00', end: '16:00', kind: 'booking' },
  ]);
  assert.deepStrictEqual(result.barberBusy.victoria, [{ start: '11:00', end: '11:30', kind: 'booking' }]);
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
  assert.deepStrictEqual(result.barberBusy.felipe, [{ start: '10:00', end: '10:50', kind: 'booking' }]);
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
  assert.deepStrictEqual(result.barberBusy.felipe, [{ start: '10:00', end: '10:00', kind: 'booking' }]);
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

test('dayBoundsOf devuelve [start,end) como fechas puras, sin hora ni Z (Fase 2)', () => {
  const { start, end } = dayBoundsOf('2026-07-10');
  assert.strictEqual(start, '2026-07-10');
  assert.strictEqual(end, '2026-07-11');
});

test('dayBoundsOf hace rollover correcto de fin de mes y fin de año', () => {
  assert.deepStrictEqual(dayBoundsOf('2026-01-31'), { start: '2026-01-31', end: '2026-02-01' });
  assert.deepStrictEqual(dayBoundsOf('2026-12-31'), { start: '2026-12-31', end: '2027-01-01' });
});

// CONVIVENCIA DE FORMATOS -- la prueba de que no hace falta migrar ninguna
// reserva existente. Documentos viejos siguen en formato ISO con hora
// ("2026-06-15T03:00:00.000Z", como escribía el widget antes de Fase 2);
// documentos nuevos van a ser fecha pura ("2026-06-15"). Ambos formatos
// tienen que convivir en la MISMA consulta de rango sin ningún cambio de
// datos -- si esto no se sostiene, todo el enfoque de "sin migración" se cae.
test('dayBoundsOf: un booking en formato ISO viejo cae dentro del rango calculado sobre la fecha pura nueva', () => {
  const { start, end } = dayBoundsOf('2026-06-15');
  const oldFormatDate = '2026-06-15T03:00:00.000Z'; // formato widget pre-Fase 2
  assert.ok(oldFormatDate >= start && oldFormatDate < end);
});

test('dayBoundsOf: primer y último instante posible del día en formato viejo, ambos dentro del rango', () => {
  const { start, end } = dayBoundsOf('2026-06-15');
  const firstInstant = '2026-06-15T00:00:00.000Z';
  const lastInstant = '2026-06-15T23:59:59.999Z';
  assert.ok(firstInstant >= start && firstInstant < end, 'primer instante del día debe entrar');
  assert.ok(lastInstant >= start && lastInstant < end, 'último instante del día debe entrar');
});

test('dayBoundsOf: una fecha del día siguiente en formato viejo NO entra en el rango', () => {
  const { start, end } = dayBoundsOf('2026-06-15');
  const nextDayOldFormat = '2026-06-16T00:00:00.000Z';
  assert.ok(!(nextDayOldFormat >= start && nextDayOldFormat < end));
});

test('computeAvailability agrega la colación recurrente del barbero como rango ocupado', () => {
  const staff = [{ id: 'victoria', status: 'active', schedule: [null, null, { open: true, start: '10:00', end: '20:00', break: { start: '13:00', end: '14:00' } }] }];
  const result = computeAvailability({ bookings: [], staff, barberId: 'victoria', dow: 2, scheduleBlocks: [] });
  assert.deepStrictEqual(result.barberBusy.victoria, [{ start: '13:00', end: '14:00', kind: 'break' }]);
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
  assert.deepStrictEqual(result.barberBusy.victoria, [{ start: '15:00', end: '16:00', kind: 'block' }]);
});

test('computeAvailability combina reservas, colación y bloqueos puntuales sin pisarse', () => {
  const bookings = [{ barberId: 'victoria', date: '2026-08-05', time: '10:00', dur: 50 }];
  const staff = [{ id: 'victoria', status: 'active', schedule: [null, null, null, { open: true, start: '10:00', end: '20:00', break: { start: '13:00', end: '14:00' } }] }];
  const scheduleBlocks = [{ barberId: 'victoria', date: '2026-08-05', start: '17:00', end: '18:00', reason: 'Trámite' }];
  const result = computeAvailability({ bookings, staff, barberId: 'victoria', dow: 3, scheduleBlocks });
  assert.deepStrictEqual(result.barberBusy.victoria, [
    { start: '10:00', end: '10:50', kind: 'booking' },
    { start: '13:00', end: '14:00', kind: 'break' },
    { start: '17:00', end: '18:00', kind: 'block' },
  ]);
});

test('computeAvailability con barberId "any" agrega colación/bloqueos de todos los barberos activos', () => {
  const staff = [
    { id: 'victoria', status: 'active', schedule: [null, null, null, { open: true, start: '10:00', end: '20:00', break: { start: '13:00', end: '14:00' } }] },
    { id: 'esteban', status: 'active', schedule: [] },
  ];
  const scheduleBlocks = [{ barberId: 'esteban', date: '2026-08-05', start: '11:00', end: '11:30', reason: 'x' }];
  const result = computeAvailability({ bookings: [], staff, barberId: 'any', dow: 3, scheduleBlocks });
  assert.deepStrictEqual(result.barberBusy.victoria, [{ start: '13:00', end: '14:00', kind: 'break' }]);
  assert.deepStrictEqual(result.barberBusy.esteban, [{ start: '11:00', end: '11:30', kind: 'block' }]);
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
  assert.deepStrictEqual(result.barberBusy.felipe, [{ start: '10:00', end: '10:50', kind: 'booking' }]);
});

test('overlaps: solape exacto, parcial, adyacente y sin relación (bufferMin=0, comportamiento original)', () => {
  assert.strictEqual(overlaps(600, 650, 600, 650), true); // exacto
  assert.strictEqual(overlaps(600, 650, 620, 700), true); // parcial por el final
  assert.strictEqual(overlaps(600, 650, 500, 620), true); // parcial por el inicio
  assert.strictEqual(overlaps(600, 650, 650, 700), false); // adyacente, sin solape
  assert.strictEqual(overlaps(600, 650, 700, 800), false); // sin relación
});

test('overlaps: bufferMin>0 bloquea rangos adyacentes o cercanos que sin buffer estarían libres', () => {
  assert.strictEqual(overlaps(600, 650, 650, 700, 10), true); // adyacente, pero con 10min de buffer sí choca
  assert.strictEqual(overlaps(600, 650, 660, 700, 10), false); // hueco == buffer (10min): justo libre, mismo criterio que el borde adyacente sin buffer
  assert.strictEqual(overlaps(600, 650, 659, 700, 10), true); // hueco de 9min < buffer 10min: no alcanza, choca
  assert.strictEqual(overlaps(600, 650, 661, 700, 10), false); // 11min de hueco, buffer=10 alcanza a dejarlo libre
  assert.strictEqual(overlaps(600, 650, 500, 600, 10), true); // adyacente por el inicio, con buffer choca
});

test('isRangeFree: libre sin rangos, ocupado con solape, libre si es adyacente (bufferMin=0)', () => {
  assert.strictEqual(isRangeFree([], '10:00', '10:50'), true);
  assert.strictEqual(isRangeFree([{ start: '10:00', end: '10:50', kind: 'booking' }], '10:20', '10:40'), false);
  assert.strictEqual(isRangeFree([{ start: '10:00', end: '10:50', kind: 'booking' }], '10:50', '11:20'), true);
});

test('isRangeFree: bufferMin>0 aplica el margen solo contra kind:"booking", nunca contra break/block', () => {
  // Adyacente a una reserva real: sin buffer estaría libre, con buffer=15 no.
  assert.strictEqual(
    isRangeFree([{ start: '10:00', end: '10:50', kind: 'booking' }], '10:50', '11:20', 15),
    false
  );
  // Mismo horario adyacente, pero contra una colación/bloqueo: el buffer NO
  // aplica -- sigue libre igual que con bufferMin=0.
  assert.strictEqual(
    isRangeFree([{ start: '10:00', end: '10:50', kind: 'break' }], '10:50', '11:20', 15),
    true
  );
  assert.strictEqual(
    isRangeFree([{ start: '10:00', end: '10:50', kind: 'block' }], '10:50', '11:20', 15),
    true
  );
});

test('isWithinOpenHours: dentro, fuera, día cerrado y sin schedule', () => {
  const schedule = [null, null, { open: true, start: '10:00', end: '20:00' }];
  assert.strictEqual(isWithinOpenHours(schedule, 2, '10:00', '10:50'), true);
  assert.strictEqual(isWithinOpenHours(schedule, 2, '19:30', '20:30'), false); // se pasa del cierre
  assert.strictEqual(isWithinOpenHours(schedule, 0, '10:00', '10:50'), false); // día sin entrada (cerrado)
  assert.strictEqual(isWithinOpenHours(null, 2, '10:00', '10:50'), false);
});
