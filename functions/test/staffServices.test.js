const test = require('node:test');
const assert = require('node:assert');
const { canPerformService, canAssignBooking, BARBER_NOT_QUALIFIED } = require('../shared/staffServices.js');

test('sin lista presta todo: es el estado de toda ficha anterior a esta función', () => {
  assert.strictEqual(canPerformService({ id: 'a' }, 'corte'), true);
  assert.strictEqual(canPerformService({ id: 'a', serviceIds: null }, 'corte'), true);
});

test('con lista presta solo lo que está en ella', () => {
  const s = { id: 'a', serviceIds: ['corte', 'barba'] };
  assert.strictEqual(canPerformService(s, 'barba'), true);
  assert.strictEqual(canPerformService(s, 'visagismo'), false);
});

test('una lista vacía significa "ninguno", no "todos"', () => {
  assert.strictEqual(canPerformService({ id: 'a', serviceIds: [] }, 'corte'), false);
});

test('un valor que no es lista se trata como sin lista: el dato raro no deja a nadie sin reservas', () => {
  assert.strictEqual(canPerformService({ id: 'a', serviceIds: 'corte' }, 'barba'), true);
});

test('sin ficha no presta nada', () => {
  assert.strictEqual(canPerformService(null, 'corte'), false);
  assert.strictEqual(canPerformService(undefined, 'corte'), false);
});

const VICTORIA = { name: 'Victoria', serviceIds: ['corte'] };

test('canAssignBooking: una cita NUEVA exige que el profesional preste el servicio', () => {
  assert.strictEqual(canAssignBooking({ staff: VICTORIA, barberId: 'victoria', svcId: 'corte', prev: null }), true);
  assert.strictEqual(canAssignBooking({ staff: VICTORIA, barberId: 'victoria', svcId: 'barba', prev: null }), false);
});

test('canAssignBooking: una cita que YA tenía ese cruce se puede seguir editando', () => {
  // Le quitaron el servicio con la cita ya agendada: bloquear el guardado
  // dejaría esa cita imposible de reprogramar o de corregir desde el panel.
  const prev = { barberId: 'victoria', svcId: 'barba' };
  assert.strictEqual(canAssignBooking({ staff: VICTORIA, barberId: 'victoria', svcId: 'barba', prev }), true);
});

test('canAssignBooking: cambiar a un cruce nuevo no calificado se rechaza, aunque la cita exista', () => {
  const otroServicio = { barberId: 'victoria', svcId: 'corte' };
  assert.strictEqual(canAssignBooking({ staff: VICTORIA, barberId: 'victoria', svcId: 'barba', prev: otroServicio }), false);
  const otroBarbero = { barberId: 'esteban', svcId: 'barba' };
  assert.strictEqual(canAssignBooking({ staff: VICTORIA, barberId: 'victoria', svcId: 'barba', prev: otroBarbero }), false);
});

test('el motivo del rechazo es estable: el widget se guía por él', () => {
  assert.strictEqual(BARBER_NOT_QUALIFIED, 'barber-not-qualified');
});
