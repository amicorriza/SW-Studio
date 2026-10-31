const test = require('node:test');
const assert = require('node:assert');
const { HttpsError } = require('firebase-functions/v2/https');
const { isExpectedError, scrubString, guard } = require('../sentry.js');

test('errores de cliente no se reportan, los internos sí', () => {
  assert.equal(isExpectedError(new HttpsError('permission-denied', 'x')), true);
  assert.equal(isExpectedError(new HttpsError('failed-precondition', 'x')), true);
  assert.equal(isExpectedError(new HttpsError('internal', 'x')), false);
  assert.equal(isExpectedError(new TypeError('boom')), false);
});

test('scrubString quita correos y teléfonos', () => {
  const s = scrubString('fallo para ana@ejemplo.cl al +56 9 1234 5678');
  assert.ok(!s.includes('ana@ejemplo.cl'));
  assert.ok(!s.includes('1234'));
});

test('guard re-lanza el mismo error y devuelve el valor', async () => {
  const e = new HttpsError('invalid-argument', 'x');
  await assert.rejects(guard('t', async () => { throw e; }), (got) => got === e);
  assert.equal(await guard('t', async (a) => a + 1)(1), 2);
});

test('scrubEvent limpia aunque el evento tenga referencias circulares', () => {
  const { scrubEvent } = require('../sentry.js');
  const ev = { exception: { values: [{ value: 'fallo ana@x.cl' }] }, sdkProcessingMetadata: {} };
  ev.sdkProcessingMetadata.self = ev;
  assert.equal(scrubEvent(ev).exception.values[0].value, 'fallo [correo]');
});
