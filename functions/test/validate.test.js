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

// ── isValidAdminBookingPayload ──
// El panel escribía reservas sin ninguna validación real: precio y duración
// del DOM, y una fecha u hora corrupta entraba sin resistencia. De ahí salían
// los documentos que hacen throw en zonedInstant() y dejan a un cliente sin
// recordatorio y a un barbero sin aviso.
const { isValidAdminBookingPayload, isDateKey, isHhMm } = require('../shared/validate.js');

const adm = (o) => Object.assign({
  name: 'Ana Torres', phone: '+56911111111', email: 'ana@mail.cl',
  svcId: 'corte', barberId: 'victoria', date: '2026-09-07', time: '10:30',
}, o);

test('acepta el payload que arma el modal del panel', () => {
  assert.strictEqual(isValidAdminBookingPayload(adm({})), true);
});

// El salón agenda por teléfono; exigir correo rompería un flujo real.
test('el correo es opcional, pero con formato si viene', () => {
  assert.strictEqual(isValidAdminBookingPayload(adm({ email: '' })), true);
  assert.strictEqual(isValidAdminBookingPayload(adm({ email: undefined })), true);
  assert.strictEqual(isValidAdminBookingPayload(adm({ email: 'no-es-email' })), false);
});

// El teléfono tampoco se exige: el modal no lo pide y no es asunto de esta
// función volver más rígido un flujo que ya se usa.
test('el teléfono no se exige', () => {
  assert.strictEqual(isValidAdminBookingPayload(adm({ phone: '' })), true);
  assert.strictEqual(isValidAdminBookingPayload(adm({ phone: undefined })), true);
});

test('exige lo mismo que el modal ya exige en el navegador', () => {
  assert.strictEqual(isValidAdminBookingPayload(adm({ name: '' })), false);
  assert.strictEqual(isValidAdminBookingPayload(adm({ name: 'A' })), false);
  assert.strictEqual(isValidAdminBookingPayload(adm({ svcId: '' })), false);
  assert.strictEqual(isValidAdminBookingPayload(adm({ barberId: '' })), false);
});

// El corazón del asunto: no alcanza con el formato.
test('rechaza fechas y horas que existen en el regex pero no en el calendario', () => {
  assert.strictEqual(isValidAdminBookingPayload(adm({ date: '2026-02-30' })), false);
  assert.strictEqual(isValidAdminBookingPayload(adm({ date: '2026-13-01' })), false);
  assert.strictEqual(isValidAdminBookingPayload(adm({ date: 'no-es-fecha' })), false);
  assert.strictEqual(isValidAdminBookingPayload(adm({ time: '25:00' })), false);
  assert.strictEqual(isValidAdminBookingPayload(adm({ time: '12:60' })), false);
  assert.strictEqual(isValidAdminBookingPayload(adm({ time: null })), false);
});

// La forma vieja que escribía el panel ya no se acepta: era hora de pared mal
// etiquetada como UTC y obligaba al resto del sistema a desarmarla.
test('rechaza el formato viejo YYYY-MM-DDTHH:mm:00.000Z', () => {
  assert.strictEqual(isValidAdminBookingPayload(adm({ date: '2026-09-07T10:30:00.000Z' })), false);
});

test('isDateKey respeta los años bisiestos', () => {
  assert.strictEqual(isDateKey('2024-02-29'), true);
  assert.strictEqual(isDateKey('2026-02-29'), false);
  assert.strictEqual(isDateKey('2026-9-1'), false);
});

test('isHhMm exige dos dígitos y horas reales', () => {
  assert.strictEqual(isHhMm('09:30'), true);
  assert.strictEqual(isHhMm('23:59'), true);
  assert.strictEqual(isHhMm('9:30'), false);
});

test('no revienta con basura', () => {
  assert.strictEqual(isValidAdminBookingPayload(null), false);
  assert.strictEqual(isValidAdminBookingPayload(undefined), false);
  assert.strictEqual(isValidAdminBookingPayload({}), false);
});
