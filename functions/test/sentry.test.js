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

test('guard no cuenta dos veces un logger.error seguido de HttpsError internal', async () => {
  const logger = require('firebase-functions/logger');
  const s = require('../sentry.js');
  let n = 0;
  await assert.rejects(
    s.__als.run({ n: 0 }, async () => {
      const h = s.guard('t', async () => {
        logger.error('fallo inesperado ' + Math.random());
        n = s.__als.getStore().n;
        throw new HttpsError('internal', 'x');
      });
      return h();
    })
  );
  assert.equal(n, 1);
});

test('scrubString cubre teléfonos 56 9 y tokens largos, no versiones de SO', () => {
  const { scrubString } = require('../sentry.js');
  const out = scrubString('56912345678 abcdefghijklmnopqrstuvwxyz0123456789 Windows 10.0.26300');
  assert.equal(out, '[teléfono] [token] Windows 10.0.26300');
});

test('logger.error no reporta fallos de Resend por culpa del dato o del límite de uso', () => {
  const logger = require('firebase-functions/logger');
  const s = require('../sentry.js');
  const mk = (kind) => Object.assign(new Error('Resend rechazó ' + kind + Math.random()), { resendKind: kind });
  const contar = (kind) => s.__als.run({ n: 0 }, () => { logger.error('Fallo al enviar emails ' + kind, mk(kind)); return s.__als.getStore().n; });
  assert.equal(contar('client'), 0);
  assert.equal(contar('transient'), 0);
  assert.equal(contar('config'), 1);
  assert.equal(contar('server'), 1);
});
