const test = require('node:test');
const assert = require('node:assert');
const { BOOKING_STATUSES, DEFAULT_BOOKING_STATUS, isValidBookingStatus } = require('../shared/status.js');

test('DEFAULT_BOOKING_STATUS es pending', () => {
  assert.strictEqual(DEFAULT_BOOKING_STATUS, 'pending');
});

test('BOOKING_STATUSES incluye el default', () => {
  assert.ok(BOOKING_STATUSES.indexOf(DEFAULT_BOOKING_STATUS) !== -1);
});

test('isValidBookingStatus acepta pending y rechaza cualquier otro valor', () => {
  assert.strictEqual(isValidBookingStatus('pending'), true);
  assert.strictEqual(isValidBookingStatus('confirmed'), false);
  assert.strictEqual(isValidBookingStatus(''), false);
  assert.strictEqual(isValidBookingStatus(undefined), false);
});
