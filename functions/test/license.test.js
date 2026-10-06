// functions/test/license.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeLicense, isSuspended, LICENSE_STATUSES } = require('../shared/license.js');

test('LICENSE_STATUSES son exactamente los tres estados del spec', () => {
  assert.deepStrictEqual(LICENSE_STATUSES, ['active', 'warning', 'suspended']);
});

// Ausente = activo: desplegar esto antes de crear license/main no puede
// apagar producción.
test('normalizeLicense: documento ausente o basura es activo', () => {
  for (const d of [undefined, null, {}, 'x', 42, { status: 'SUSPENDED' }, { status: 'inventado' }]) {
    assert.deepStrictEqual(normalizeLicense(d), { status: 'active', message: '', suspendAt: '' }, JSON.stringify(d));
  }
});

test('normalizeLicense: conserva estado, mensaje y fecha válidos', () => {
  assert.deepStrictEqual(
    normalizeLicense({ status: 'warning', message: 'Contacta a soporte', suspendAt: '2026-10-15', extra: 1 }),
    { status: 'warning', message: 'Contacta a soporte', suspendAt: '2026-10-15' });
});

test('normalizeLicense: descarta mensaje no-string y fecha mal formada', () => {
  assert.deepStrictEqual(
    normalizeLicense({ status: 'suspended', message: 7, suspendAt: '15/10/2026' }),
    { status: 'suspended', message: '', suspendAt: '' });
});

test('isSuspended: solo suspended', () => {
  assert.strictEqual(isSuspended(normalizeLicense({ status: 'suspended' })), true);
  assert.strictEqual(isSuspended(normalizeLicense({ status: 'warning' })), false);
  assert.strictEqual(isSuspended(normalizeLicense(null)), false);
  assert.strictEqual(isSuspended(null), false);
});
