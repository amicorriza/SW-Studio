const test = require('node:test');
const assert = require('node:assert');
const { EMAIL_RE, isValidBookingPayload } = require('../shared/validate.js');

function basePayload(overrides) {
  return Object.assign({
    name: 'Juan Pérez', email: 'juan@mail.com', phone: '+56912345678',
    svcId: 'lp', barberId: 'felipe', date: '2026-06-10', time: '11:00',
    code: 'SW-AB12345', club: 'guest',
  }, overrides || {});
}

test('isValidBookingPayload acepta un payload completo', () => {
  assert.strictEqual(isValidBookingPayload(basePayload()), true);
});

test('isValidBookingPayload rechaza email con formato inválido', () => {
  assert.strictEqual(isValidBookingPayload(basePayload({ email: 'no-es-email' })), false);
});

test('isValidBookingPayload rechaza phone corto (<7)', () => {
  assert.strictEqual(isValidBookingPayload(basePayload({ phone: '123' })), false);
});

test('isValidBookingPayload rechaza name de un solo carácter', () => {
  assert.strictEqual(isValidBookingPayload(basePayload({ name: 'J' })), false);
});

test('isValidBookingPayload rechaza club fuera de member/guest', () => {
  assert.strictEqual(isValidBookingPayload(basePayload({ club: 'vip' })), false);
});

test('EMAIL_RE es el mismo regex que usa isValidBooking() en firestore.rules', () => {
  assert.strictEqual(EMAIL_RE.source, '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$');
});
