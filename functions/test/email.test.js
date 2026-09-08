const test = require('node:test');
const assert = require('node:assert');
const { renderClientEmail, renderShopEmail, renderReminderEmail, renderReminderResponseEmail, renderConfirmationEmail, parseRecipients, assertResendOk } = require('../email.js');

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
  const { subject, html } = renderClientEmail(booking, 'abc123token');
  assert.match(subject, /SW-AB12345/);
  assert.match(html, /Juan Pérez/);
  assert.match(html, /Corte \+ Lavado Premium/);
  assert.match(html, /Felipe/);
});

test('email al cliente usa el diseño 2026-09-08 con fecha en hora de Chile', () => {
  const { html } = renderClientEmail(booking, 'abc123token');
  assert.match(html, /Tu próxima visita,<br>ya está reservada\./);
  assert.match(html, /Miércoles 10 de junio de 2026/);
  assert.match(html, /11:00/);
  assert.match(html, /45 minutos/);
  assert.match(html, /\$21\.000/);
  assert.match(html, /Cochrane 635/);
  assert.match(html, /assets\/logo\.png/);       // logo raíz del sitio, no assets/email/logo.png (ese es del diseño anterior)
  assert.match(html, /assets\/email\/hero-actual\.jpg/);
  assert.doesNotMatch(html, /data:image/);
});

test('email al cliente usa la zona guardada en la reserva, no siempre Santiago', () => {
  // Mismo date+time que el fixture principal, pero con tz explícito a
  // Punta Arenas (GMT-3, no cambia de hora) -- el resultado debe seguir
  // mostrando el 10 de junio: `date`/`time` son hora de PARED en `tz`, no un
  // instante que se reinterpreta al convertir de zona.
  const { html } = renderClientEmail({ ...booking, tz: 'America/Punta_Arenas' }, 'abc123token');
  assert.match(html, /Miércoles 10 de junio de 2026/);
});

test('email al cliente muestra el día calendario correcto cerca de la medianoche (borde donde el bug viejo habría corrido el día)', () => {
  // 23:30 del 15 de junio en Punta Arenas (GMT-3 fijo) -- si la fecha se
  // parseara directo en vez de armar el instante real vía dateKeyOf+time+
  // zonedInstant, un `date` en formato fecha pura ('2026-06-15') se leería
  // como medianoche UTC y mostraría el 14, no el 15.
  const { html } = renderClientEmail({
    ...booking, date: '2026-06-15', time: '23:30', tz: 'America/Punta_Arenas',
  }, 'abc123token');
  assert.match(html, /15 de junio de 2026/);
  assert.doesNotMatch(html, /14 de junio de 2026/);
});

test('email al cliente omite la fila Duración si la reserva no trae dur', () => {
  const { html } = renderClientEmail({ ...booking, dur: undefined }, 'abc123token');
  assert.doesNotMatch(html, /Duración/);
});

test('los datos del cliente se escapan para evitar inyección de HTML', () => {
  const { html } = renderClientEmail({ ...booking, name: 'Juan <script>alert(1)</script>' }, 'abc123token');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Juan &lt;script&gt;/);
});

test('email al cliente incluye los botones Confirmar/Declinar con code+token+r correctos (no espera al recordatorio de 24h)', () => {
  const { html } = renderClientEmail(booking, 'abc123token');
  assert.match(html, /confirmar-cita\.html\?code=SW-AB12345&t=abc123token&r=confirm/);
  assert.match(html, /confirmar-cita\.html\?code=SW-AB12345&t=abc123token&r=decline/);
  assert.match(html, /Confirmar asistencia/);
  assert.match(html, /No podré ir/);
});

test('email al cliente avisa la ventana de 3 horas para cambios y la tolerancia de 10 minutos por atraso', () => {
  // Confirmado por Aldo 2026-09-08: cancelar/cambiar sigue siendo 3 horas
  // (el texto viejo decía 2). La tolerancia de 10 minutos es algo distinto:
  // cuánto atraso se acepta EL DÍA de la cita, no la ventana para cancelar.
  const { html } = renderClientEmail(booking, 'abc123token');
  assert.match(html, /hasta 3 horas antes/);
  assert.match(html, /tolerancia de 10 minutos/);
  assert.doesNotMatch(html, /2 horas/);
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

test('renderReminderEmail incluye ambos botones con code+token+r correctos', () => {
  const { subject, html } = renderReminderEmail(booking, 'abc123token');
  assert.match(subject, /11:00/);
  assert.match(html, /confirmar-cita\.html\?code=SW-AB12345&t=abc123token&r=confirm/);
  assert.match(html, /confirmar-cita\.html\?code=SW-AB12345&t=abc123token&r=decline/);
  assert.match(html, /CONFIRMAR ASISTENCIA/);
  assert.match(html, /NO PODRÉ IR/);
});

test('renderReminderEmail muestra fecha/hora en la zona de la reserva', () => {
  const { html } = renderReminderEmail(booking, 'tok');
  assert.match(html, /MIÉRCOLES/);
  assert.match(html, />10</);
  assert.match(html, /JUNIO 2026/);
  assert.match(html, /11:00 HRS/);
});

test('renderReminderEmail escapa el código para evitar inyección de HTML', () => {
  const { html } = renderReminderEmail({ ...booking, code: '<script>x</script>' }, 'tok');
  assert.doesNotMatch(html, /<script>x/);
});

test('renderReminderEmail escapa barberName y svcName para evitar inyección de HTML', () => {
  const { html } = renderReminderEmail({
    ...booking, barberName: '<img src=x onerror=alert(1)>', svcName: '<b>bold</b>',
  }, 'tok');
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.doesNotMatch(html, /<b>bold<\/b>/);
  assert.match(html, /&lt;img src=x onerror/);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
});

test('renderReminderResponseEmail (confirm) tiene el asunto y el título correctos', () => {
  const { subject, html } = renderReminderResponseEmail(booking, 'confirm');
  assert.match(subject, /Cliente confirmó su cita/);
  assert.match(subject, /SW-AB12345/);
  assert.match(html, /CITA<br>CONFIRMADA/);
  assert.match(html, /confirmó su asistencia/);
});

test('renderReminderResponseEmail (decline) tiene el asunto y el título correctos', () => {
  const { subject, html } = renderReminderResponseEmail(booking, 'decline');
  assert.match(subject, /Cliente declinó su cita/);
  assert.match(html, /CITA<br>DECLINADA/);
  assert.match(html, /no podrá asistir/);
});

test('renderReminderResponseEmail incluye datos de contacto del cliente para que el negocio pueda llamarlo', () => {
  const { html } = renderReminderResponseEmail(booking, 'decline');
  assert.match(html, /Juan Pérez/);
  assert.match(html, /tel:\+56912345678/);
  assert.match(html, /Felipe/);
  assert.doesNotMatch(html, /VER MI RESERVA/); // sin CTA orientada al cliente, es un aviso interno
});

test('renderReminderResponseEmail escapa los datos del cliente para evitar inyección de HTML', () => {
  const { html } = renderReminderResponseEmail({ ...booking, name: 'Juan <script>alert(1)</script>' }, 'confirm');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Juan &lt;script&gt;/);
});

test('renderConfirmationEmail incluye nombre, fecha, servicio y código', () => {
  const { subject, html } = renderConfirmationEmail(booking);
  assert.match(subject, /Asistencia confirmada/);
  assert.match(subject, /SW-AB12345/);
  assert.match(html, /Asistencia confirmada\./);
  assert.match(html, /Juan Pérez/);
  assert.match(html, /Miércoles 10 de junio de 2026/);
  assert.match(html, /Corte \+ Lavado Premium/);
  assert.match(html, /Felipe/);
  assert.match(html, /\$21\.000/);
  assert.match(html, /assets\/email\/hero-actual\.jpg/);
});

test('renderConfirmationEmail no incluye los botones Confirmar/Declinar -- la atención ya fue confirmada', () => {
  const { html } = renderConfirmationEmail(booking);
  assert.doesNotMatch(html, /confirmar-cita\.html/);
});

test('renderConfirmationEmail escapa los datos del cliente para evitar inyección de HTML', () => {
  const { html } = renderConfirmationEmail({ ...booking, name: 'Juan <script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Juan &lt;script&gt;/);
});
