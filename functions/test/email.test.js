const test = require('node:test');
const assert = require('node:assert');
const { renderClientEmail, renderShopEmail } = require('../email.js');

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
