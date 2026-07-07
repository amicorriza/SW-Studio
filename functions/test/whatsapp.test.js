const test = require('node:test');
const assert = require('node:assert');
const { normalizePhone } = require('../whatsapp.js');

test('normalizePhone limpia espacios y el signo + de un número chileno', () => {
  assert.strictEqual(normalizePhone('+56 9 8251 4114'), '56982514114');
});

test('normalizePhone deja igual un número que ya viene en E.164 sin +', () => {
  assert.strictEqual(normalizePhone('56982514114'), '56982514114');
});

test('normalizePhone antepone 56 a un número local sin código de país', () => {
  assert.strictEqual(normalizePhone('982514114'), '56982514114');
});
