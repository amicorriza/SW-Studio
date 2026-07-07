const test = require('node:test');
const assert = require('node:assert');
const { normalizePhone, buildTextBody, buildTemplateComponents } = require('../whatsapp.js');

test('normalizePhone limpia espacios y el signo + de un número chileno', () => {
  assert.strictEqual(normalizePhone('+56 9 8251 4114'), '56982514114');
});

test('normalizePhone deja igual un número que ya viene en E.164 sin +', () => {
  assert.strictEqual(normalizePhone('56982514114'), '56982514114');
});

test('normalizePhone antepone 56 a un número local sin código de país', () => {
  assert.strictEqual(normalizePhone('982514114'), '56982514114');
});

const booking = {
  code: 'SW-AB12345', name: 'Juan Pérez', phone: '+56 9 8251 4114',
  svcName: 'Corte + Lavado Premium', barberName: 'Felipe',
  date: '2026-06-10T00:00:00.000Z', time: '11:00',
};

test('buildTextBody incluye nombre, servicio, barbero, fecha/hora y código', () => {
  const body = buildTextBody(booking);
  assert.match(body, /Juan Pérez/);
  assert.match(body, /Corte \+ Lavado Premium/);
  assert.match(body, /Felipe/);
  assert.match(body, /11:00/);
  assert.match(body, /SW-AB12345/);
});

test('buildTemplateComponents arma los parámetros en el orden esperado', () => {
  const components = buildTemplateComponents(booking);
  assert.strictEqual(components.length, 1);
  assert.strictEqual(components[0].type, 'body');
  const params = components[0].parameters.map(p => p.text);
  assert.strictEqual(params[0], 'Juan Pérez');
  assert.strictEqual(params[1], 'Corte + Lavado Premium');
  assert.strictEqual(params[2], 'Felipe');
  assert.match(params[3], /11:00 hrs/);
  assert.strictEqual(params[4], 'SW-AB12345');
});
