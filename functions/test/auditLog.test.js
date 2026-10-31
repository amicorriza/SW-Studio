const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeLogExtras } = require('../shared/auditLog');

test('sin campos nuevos devuelve un objeto vacío (llamadas actuales intactas)', () => {
  assert.deepEqual(sanitizeLogExtras({ action: 'x', item: 'y' }), {});
  assert.deepEqual(sanitizeLogExtras(undefined), {});
  assert.deepEqual(sanitizeLogExtras(null), {});
});

test('acepta los campos opcionales válidos', () => {
  const r = sanitizeLogExtras({
    serviceId: 'sv_1', price: 14000, outcome: 'attempt', sessionId: 'ses-abc',
    before: { id: 'sv_1', name: 'Corte' }, after: { gone: true },
  });
  assert.equal(r.serviceId, 'sv_1');
  assert.equal(r.price, 14000);
  assert.equal(r.outcome, 'attempt');
  assert.equal(r.sessionId, 'ses-abc');
  assert.equal(r.before, JSON.stringify({ id: 'sv_1', name: 'Corte' }));
  assert.equal(r.after, JSON.stringify({ gone: true }));
});

test('descarta tipos inválidos y outcome fuera de la lista', () => {
  const r = sanitizeLogExtras({ serviceId: 5, price: 'caro', outcome: 'boom', sessionId: {}, price2: 1 });
  assert.deepEqual(r, {});
  assert.deepEqual(sanitizeLogExtras({ price: NaN }), {});
});

test('trunca strings largos y before/after a 2 KB', () => {
  const r = sanitizeLogExtras({
    serviceId: 'S'.repeat(500), sessionId: 'T'.repeat(500),
    before: { blob: 'x'.repeat(10000) }, after: 'y'.repeat(10000),
  });
  assert.ok(r.serviceId.length <= 80);
  assert.ok(r.sessionId.length <= 64);
  assert.ok(r.before.length <= 2048);
  assert.ok(r.after.length <= 2048);
});

test('before con referencia circular no revienta', () => {
  const a = {}; a.self = a;
  assert.doesNotThrow(() => sanitizeLogExtras({ before: a }));
});
