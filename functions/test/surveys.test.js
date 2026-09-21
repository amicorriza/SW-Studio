const test = require('node:test');
const assert = require('node:assert');
const { findBookingsNeedingSurvey, SURVEY_LEAD_MS, SURVEY_EXPIRY_MS } = require('../surveys.js');

const NOW = new Date('2026-09-20T15:00:00.000Z');

function booking(overrides) {
  return {
    _docId: 'b1',
    status: 'completed',
    endedAt: new Date(NOW.getTime() - 11 * 60000).toISOString(),
    ...overrides,
  };
}

test('una atención terminada hace 11 minutos está debida', () => {
  const out = findBookingsNeedingSurvey([booking()], NOW);
  assert.strictEqual(out.length, 1);
});

test('una atención terminada hace 9 minutos NO está debida todavía', () => {
  const out = findBookingsNeedingSurvey(
    [booking({ endedAt: new Date(NOW.getTime() - 9 * 60000).toISOString() })],
    NOW
  );
  assert.strictEqual(out.length, 0);
});

test('exactamente en el borde de 10 minutos SÍ está debida', () => {
  const out = findBookingsNeedingSurvey(
    [booking({ endedAt: new Date(NOW.getTime() - SURVEY_LEAD_MS).toISOString() })],
    NOW
  );
  assert.strictEqual(out.length, 1);
});

test('una atención terminada hace más de 24 horas ya no se manda', () => {
  const out = findBookingsNeedingSurvey(
    [booking({ endedAt: new Date(NOW.getTime() - SURVEY_EXPIRY_MS - 60000).toISOString() })],
    NOW
  );
  assert.strictEqual(out.length, 0);
});

test('exactamente en el borde de 24 horas ya no está debida (límite exclusivo)', () => {
  const out = findBookingsNeedingSurvey(
    [booking({ endedAt: new Date(NOW.getTime() - SURVEY_EXPIRY_MS).toISOString() })],
    NOW
  );
  assert.strictEqual(out.length, 0);
});

test('una reserva con surveySentAt ya no se vuelve a mandar', () => {
  const out = findBookingsNeedingSurvey(
    [booking({ surveySentAt: new Date().toISOString() })],
    NOW
  );
  assert.strictEqual(out.length, 0);
});

test('una reserva que no está completed se ignora', () => {
  const out = findBookingsNeedingSurvey([booking({ status: 'in_service' })], NOW);
  assert.strictEqual(out.length, 0);
});

test('endedAt corrupto no tumba el lote, y se reporta por onSkip', () => {
  const skipped = [];
  const out = findBookingsNeedingSurvey(
    [booking({ endedAt: 'no-es-una-fecha' }), booking({ _docId: 'b2' })],
    NOW,
    (id) => skipped.push(id)
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0]._docId, 'b2');
  assert.deepStrictEqual(skipped, ['b1']);
});

test('endedAt ausente se trata igual que corrupto, no revienta', () => {
  const out = findBookingsNeedingSurvey([booking({ endedAt: undefined })], NOW);
  assert.strictEqual(out.length, 0);
});
