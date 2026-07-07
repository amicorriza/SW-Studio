const test = require('node:test');
const assert = require('node:assert');
const { renderClientEmail, renderShopEmail, parseRecipients } = require('../email.js');

const booking = {
  code:'SW-AB12345', name:'Juan Pérez', email:'juan@mail.com', phone:'+56912345678',
  svcName:'Corte + Lavado Premium', barberName:'Felipe',
  date:'2026-06-10T00:00:00.000Z', time:'11:00', price:21000,
};

test('email al cliente incluye nombre, código y servicio', () => {
  const { subject, html } = renderClientEmail(booking);
  assert.match(subject, /SW-AB12345/);
  assert.match(html, /Juan Pérez/);
  assert.match(html, /Corte \+ Lavado Premium/);
  assert.match(html, /Felipe/);
});

test('email a la barbería incluye teléfono y email del cliente', () => {
  const { subject, html } = renderShopEmail(booking);
  assert.match(subject, /Nueva reserva/i);
  assert.match(html, /\+56912345678/);
  assert.match(html, /juan@mail.com/);
});

test('parseRecipients separa una lista de emails por coma y recorta espacios', () => {
  assert.deepStrictEqual(
    parseRecipients('dueno@x.com, recepcion@x.com ,otro@x.com'),
    ['dueno@x.com', 'recepcion@x.com', 'otro@x.com']
  );
});

test('parseRecipients funciona con un solo email', () => {
  assert.deepStrictEqual(parseRecipients('solo@x.com'), ['solo@x.com']);
});

test('parseRecipients ignora valores vacíos', () => {
  assert.deepStrictEqual(parseRecipients(''), []);
  assert.deepStrictEqual(parseRecipients(undefined), []);
});
