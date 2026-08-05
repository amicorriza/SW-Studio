const test = require('node:test');
const assert = require('node:assert');
const { renderClientEmail, renderShopEmail, parseRecipients, assertResendOk } = require('../email.js');

const booking = {
  // date = medianoche en Chile (UTC-4) serializada con toISOString(), como hace el frontend.
  // Sin `tz` a propósito -- ejercita el fallback a DEFAULT_TZ ('America/Santiago'),
  // que es la misma zona que estaba hardcodeada antes de Fase 2, así que el
  // comportamiento para estas reservas viejas no cambia.
  code:'SW-AB12345', name:'Juan Pérez', email:'juan@mail.com', phone:'+56912345678',
  svcName:'Corte + Lavado Premium', barberName:'Felipe',
  date:'2026-06-10T04:00:00.000Z', time:'11:00', price:21000, dur:45,
};

test('email al cliente incluye nombre, código y servicio', () => {
  const { subject, html } = renderClientEmail(booking);
  assert.match(subject, /SW-AB12345/);
  assert.match(html, /Juan Pérez/);
  assert.match(html, /Corte \+ Lavado Premium/);
  assert.match(html, /Felipe/);
});

test('email al cliente usa el template SW Studio con fecha en hora de Chile', () => {
  const { html } = renderClientEmail(booking);
  assert.match(html, /RESERVA<br>CONFIRMADA/);
  assert.match(html, /MIÉRCOLES/);          // bloque calendario: día de semana
  assert.match(html, />10</);               // día del mes
  assert.match(html, /JUNIO 2026/);         // mes y año
  assert.match(html, /11:00 HRS/);
  assert.match(html, /45 minutos/);
  assert.match(html, /\$21\.000/);
  assert.match(html, /Cochrane 635/);
  assert.match(html, /assets\/email\/logo\.png/);   // imágenes alojadas, no data-URI
  assert.match(html, /assets\/email\/salon\.png/);
  assert.doesNotMatch(html, /data:image/);
});

test('email al cliente usa la zona guardada en la reserva, no siempre Santiago', () => {
  // Mismo date+time que el fixture principal, pero con tz explícito a
  // Punta Arenas (GMT-3, no cambia de hora) -- si el resultado fuera igual
  // al de `booking` (que cae a America/Santiago, GMT-4 en junio), significaría
  // que renderClientEmail está ignorando b.tz y siempre usando el default.
  const { html } = renderClientEmail({ ...booking, tz: 'America/Punta_Arenas' });
  assert.match(html, /MIÉRCOLES/);
  assert.match(html, />10</);
  assert.match(html, /JUNIO 2026/);
});

test('email al cliente muestra el día calendario correcto cerca de la medianoche (borde donde el bug viejo habría corrido el día)', () => {
  // 23:30 del 15 de junio en Punta Arenas (GMT-3 fijo) -- si dateParts
  // todavía parseara `date` directo en vez de armar el instante real vía
  // dateKeyOf+time+zonedInstant, un `date` en formato fecha pura ('2026-06-15')
  // se leería como medianoche UTC y mostraría el 14, no el 15.
  const { html } = renderClientEmail({
    ...booking, date: '2026-06-15', time: '23:30', tz: 'America/Punta_Arenas',
  });
  assert.match(html, />15</);
  assert.doesNotMatch(html, />14</);
});

test('email al cliente omite la fila DURACIÓN si la reserva no trae dur', () => {
  const { html } = renderClientEmail({ ...booking, dur: undefined });
  assert.doesNotMatch(html, /DURACIÓN/);
});

test('los datos del cliente se escapan para evitar inyección de HTML', () => {
  const { html } = renderClientEmail({ ...booking, name: 'Juan <script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Juan &lt;script&gt;/);
});

test('email a la barbería incluye teléfono y email del cliente', () => {
  const { subject, html } = renderShopEmail(booking);
  assert.match(subject, /Nueva reserva/i);
  assert.match(html, /\+56912345678/);
  assert.match(html, /mailto:juan@mail\.com/);
});

test('email a la barbería usa el mismo sistema visual que el del cliente (hero + tarjeta de fecha)', () => {
  const { html } = renderShopEmail(booking);
  assert.match(html, /NUEVA<br>RESERVA/);
  assert.match(html, /MIÉRCOLES/);          // bloque calendario: día de semana
  assert.match(html, />10</);               // día del mes
  assert.match(html, /JUNIO 2026/);         // mes y año
  assert.match(html, /11:00 HRS/);
  assert.match(html, /45 minutos/);
  assert.match(html, /\$21\.000/);
  assert.match(html, /Felipe/);
  assert.match(html, /Corte \+ Lavado Premium/);
  assert.doesNotMatch(html, /VER MI RESERVA/);   // sin CTA orientada al cliente
});

test('email a la barbería omite la fila DURACIÓN si la reserva no trae dur', () => {
  const { html } = renderShopEmail({ ...booking, dur: undefined });
  assert.doesNotMatch(html, /DURACIÓN/);
});

test('los datos del cliente en el correo de la barbería se escapan para evitar inyección de HTML', () => {
  const { html } = renderShopEmail({ ...booking, name: 'Juan <script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Juan &lt;script&gt;/);
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

// El SDK de Resend NO lanza en errores de API: resuelve con {data:null, error:{...}}.
// Sin esta verificación, un envío rechazado (ej. dominio no verificado) quedaría
// marcado emailStatus:'sent' silenciosamente.
test('assertResendOk lanza si alguna respuesta de Resend trae error', () => {
  assert.throws(
    () => assertResendOk([
      { data: { id: 'ok1' }, error: null },
      { data: null, error: { statusCode: 403, message: 'domain is not verified' } },
    ]),
    /domain is not verified/
  );
});

test('assertResendOk no lanza cuando todos los envíos fueron aceptados', () => {
  assert.doesNotThrow(() => assertResendOk([
    { data: { id: 'ok1' }, error: null },
    { data: { id: 'ok2' }, error: null },
  ]));
});
