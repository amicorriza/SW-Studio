const test = require('node:test');
const assert = require('node:assert');
const {
  BOOKING_STATUSES, DEFAULT_BOOKING_STATUS, isValidBookingStatus,
  BLOCKING_STATUSES, isBlockingStatus,
} = require('../shared/status.js');

test('DEFAULT_BOOKING_STATUS es pending', () => {
  assert.strictEqual(DEFAULT_BOOKING_STATUS, 'pending');
});

test('BOOKING_STATUSES incluye el default', () => {
  assert.ok(BOOKING_STATUSES.indexOf(DEFAULT_BOOKING_STATUS) !== -1);
});

test('BOOKING_STATUSES incluye confirmed y declined (recordatorio de citas, 2026-09)', () => {
  assert.ok(BOOKING_STATUSES.indexOf('confirmed') !== -1);
  assert.ok(BOOKING_STATUSES.indexOf('declined') !== -1);
});

test('isValidBookingStatus rechaza cualquier valor fuera de la lista', () => {
  assert.strictEqual(isValidBookingStatus('atendida'), false);
  assert.strictEqual(isValidBookingStatus(''), false);
  assert.strictEqual(isValidBookingStatus(undefined), false);
});

test('BOOKING_STATUSES cubre el ciclo completo de la atención real', () => {
  for (const s of ['pending', 'confirmed', 'declined', 'arrived', 'in_service', 'completed', 'no_show', 'cancelled']) {
    assert.ok(isValidBookingStatus(s), `${s} debería ser válido`);
  }
});

test('isBlockingStatus: pending/confirmed/arrived/in_service/completed ocupan el horario', () => {
  for (const s of ['pending', 'confirmed', 'arrived', 'in_service', 'completed']) {
    assert.ok(isBlockingStatus(s), `${s} debería ocupar el horario`);
  }
  assert.strictEqual(BLOCKING_STATUSES.length, 5);
});

test('isBlockingStatus: declined/no_show/cancelled liberan el horario', () => {
  for (const s of ['declined', 'no_show', 'cancelled']) {
    assert.ok(!isBlockingStatus(s), `${s} debería liberar el horario`);
  }
});

// El default seguro es OCUPAR, no liberar: una reserva vieja sin `status` es
// una cita real que nadie debe pisar. Liberarla produciría doble reserva.
test('isBlockingStatus: una reserva sin status ocupa el horario', () => {
  assert.ok(isBlockingStatus(undefined));
  assert.ok(isBlockingStatus(null));
  assert.ok(isBlockingStatus(''));
});
