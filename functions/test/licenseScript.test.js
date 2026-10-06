// functions/test/licenseScript.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildLicenseDoc } = require('../scripts/license.js');

const NOW = '2026-10-05T12:00:00.000Z';

test('buildLicenseDoc: suspended con mensaje', () => {
  assert.deepStrictEqual(buildLicenseDoc(['suspended', '--message', 'Contacta a soporte'], NOW),
    { status: 'suspended', message: 'Contacta a soporte', suspendAt: '', updatedAt: NOW });
});

test('buildLicenseDoc: warning con fecha', () => {
  assert.deepStrictEqual(buildLicenseDoc(['warning', '--suspend-at', '2026-10-15'], NOW),
    { status: 'warning', message: '', suspendAt: '2026-10-15', updatedAt: NOW });
});

test('buildLicenseDoc: active limpia mensaje y fecha', () => {
  assert.deepStrictEqual(buildLicenseDoc(['active'], NOW),
    { status: 'active', message: '', suspendAt: '', updatedAt: NOW });
});

test('buildLicenseDoc: rechaza estado desconocido, vacío o fecha mala', () => {
  assert.throws(() => buildLicenseDoc([], NOW), /Uso:/);
  assert.throws(() => buildLicenseDoc(['pausado'], NOW), /Uso:/);
  assert.throws(() => buildLicenseDoc(['warning', '--suspend-at', '15-10-2026'], NOW), /YYYY-MM-DD/);
  assert.throws(() => buildLicenseDoc(['suspended', '--message'], NOW), /--message/);
});
