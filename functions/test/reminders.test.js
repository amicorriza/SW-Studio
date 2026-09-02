const test = require('node:test');
const assert = require('node:assert');
const {
  REMINDER_LEAD_MS, REMINDER_WINDOW_MS, generateReminderToken, findBookingsNeedingReminder,
} = require('../reminders.js');

test('generateReminderToken devuelve 32 caracteres hexadecimales', () => {
  const token = generateReminderToken();
  assert.strictEqual(token.length, 32);
  assert.match(token, /^[0-9a-f]{32}$/);
});

test('generateReminderToken no repite el mismo valor entre llamadas', () => {
  assert.notStrictEqual(generateReminderToken(), generateReminderToken());
});

test('findBookingsNeedingReminder incluye una reserva justo en el borde superior de "debido" (now+24h+15min)', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  // now+24h+15min = 2026-06-11T12:15:00Z -- en America/Santiago, junio es
  // invierno (GMT-4), así que el instante real es 08:15 hora local.
  const bookings = [
    { code: 'SW-borde', status: 'pending', date: '2026-06-11', time: '08:15', tz: 'America/Santiago' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].code, 'SW-borde');
});

test('findBookingsNeedingReminder excluye una reserva apenas después del borde superior de "debido"', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    { code: 'SW-fuera', status: 'pending', date: '2026-06-11', time: '08:16', tz: 'America/Santiago' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 0);
});

test('findBookingsNeedingReminder excluye una reserva cuya cita ya ocurrió', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    // 07:00 Santiago (GMT-4) = 11:00Z, antes de `now` (12:00Z) -- la cita
    // ya pasó, no tiene sentido recordarla.
    { code: 'SW-pasada', status: 'pending', date: '2026-06-10', time: '07:00', tz: 'America/Santiago' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 0);
});

test('findBookingsNeedingReminder sigue incluyendo una reserva cuyo turno original ya pasó (retry tras una falla previa)', () => {
  // Regresión: con la ventana vieja de coincidencia única [now+24h,
  // now+24h+15min), una reserva a solo 8h de distancia (su "punto debido",
  // 24h antes, quedó 16h atrás) habría quedado EXCLUIDA para siempre si el
  // envío falló en su único turno -- ninguna corrida futura la habría
  // vuelto a seleccionar, porque `now` solo avanza. Con "debido" (sin piso
  // inferior) sigue siendo candidata mientras no tenga reminderSentAt y la
  // cita no haya ocurrido: esto es lo que hace que un reintento real sea
  // posible.
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    { code: 'SW-tardio', status: 'pending', date: '2026-06-10', time: '20:00', tz: 'America/Santiago' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].code, 'SW-tardio');
});

test('findBookingsNeedingReminder respeta el tz propio de cada reserva, no un tz global', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  // dueBy = now + 24h + 15min = 2026-06-11T12:15:00Z. El mismo wall-clock
  // "08:16" interpretado en America/Santiago (GMT-4 en invierno) da
  // 12:16Z -- más allá de dueBy, todavía no corresponde. El MISMO
  // wall-clock interpretado en America/Punta_Arenas (GMT-3 fijo, sin
  // cambio de hora) da 11:16Z -- dentro de dueBy, ya está debido. Si la
  // función usara un tz global en vez del propio de cada reserva, ambas
  // darían el mismo resultado.
  const bookings = [
    { code: 'SW-santiago', status: 'pending', date: '2026-06-11', time: '08:16', tz: 'America/Santiago' },
    { code: 'SW-punta-arenas', status: 'pending', date: '2026-06-11', time: '08:16', tz: 'America/Punta_Arenas' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.deepStrictEqual(result.map((b) => b.code), ['SW-punta-arenas']);
});

test('findBookingsNeedingReminder excluye reservas que ya tienen reminderSentAt', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    {
      code: 'SW-ya-enviado', status: 'pending', date: '2026-06-11', time: '08:00',
      tz: 'America/Santiago', reminderSentAt: '2026-06-10T12:00:00.000Z',
    },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 0);
});

test('findBookingsNeedingReminder excluye reservas que no están pending', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    { code: 'SW-confirmed', status: 'confirmed', date: '2026-06-11', time: '08:00', tz: 'America/Santiago' },
    { code: 'SW-declined', status: 'declined', date: '2026-06-11', time: '08:00', tz: 'America/Santiago' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 0);
});

test('findBookingsNeedingReminder usa DEFAULT_TZ cuando la reserva no trae tz (reservas de antes de Fase 2)', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    { code: 'SW-sin-tz', status: 'pending', date: '2026-06-11', time: '08:00' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 1);
});

test('findBookingsNeedingReminder omite (no crashea) una reserva con date faltante', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    { code: 'SW-sin-date', status: 'pending', time: '08:00', tz: 'America/Santiago' },
  ];
  assert.doesNotThrow(() => findBookingsNeedingReminder(bookings, now));
  assert.strictEqual(findBookingsNeedingReminder(bookings, now).length, 0);
});

test('findBookingsNeedingReminder omite (no crashea) una reserva con time faltante', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    { code: 'SW-sin-time', status: 'pending', date: '2026-06-11', tz: 'America/Santiago' },
  ];
  assert.doesNotThrow(() => findBookingsNeedingReminder(bookings, now));
  assert.strictEqual(findBookingsNeedingReminder(bookings, now).length, 0);
});

test('una reserva malformada no bloquea el resto del lote (no propaga la excepción al resto del filter)', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    { code: 'SW-mala', status: 'pending', date: '2026-06-11', time: undefined, tz: 'America/Santiago' },
    { code: 'SW-buena', status: 'pending', date: '2026-06-11', time: '08:00', tz: 'America/Santiago' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].code, 'SW-buena');
});

test('REMINDER_WINDOW_MS es 15 minutos (mismo ancho que el intervalo de la corrida programada)', () => {
  assert.strictEqual(REMINDER_WINDOW_MS, 15 * 60 * 1000);
});

test('REMINDER_LEAD_MS es 24 horas', () => {
  assert.strictEqual(REMINDER_LEAD_MS, 24 * 60 * 60 * 1000);
});
