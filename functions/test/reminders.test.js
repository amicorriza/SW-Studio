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

test('findBookingsNeedingReminder incluye una reserva justo en el borde inicial de la ventana (now+24h)', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  // now+24h = 2026-06-11T12:00:00Z -- en America/Santiago, junio es invierno
  // (GMT-4), así que el instante real es 08:00 hora local.
  const bookings = [
    { code: 'SW-1', status: 'pending', date: '2026-06-11', time: '08:00', tz: 'America/Santiago' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].code, 'SW-1');
});

test('findBookingsNeedingReminder excluye una reserva justo en el borde final de la ventana (now+24h+15min)', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  // now+24h+15min = 08:15 local -- la ventana es [start, end), así que el
  // borde final queda afuera.
  const bookings = [
    { code: 'SW-2', status: 'pending', date: '2026-06-11', time: '08:15', tz: 'America/Santiago' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 0);
});

test('findBookingsNeedingReminder excluye reservas antes o después de la ventana', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const bookings = [
    { code: 'SW-antes', status: 'pending', date: '2026-06-11', time: '07:59', tz: 'America/Santiago' },
    { code: 'SW-despues', status: 'pending', date: '2026-06-11', time: '08:16', tz: 'America/Santiago' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 0);
});

test('findBookingsNeedingReminder respeta el tz propio de cada reserva, no un tz global', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  // Misma hora de pared (08:00) pero en Punta Arenas (GMT-3 fijo): el
  // instante real es UNA HORA ANTES que en Santiago (GMT-4 en junio) --
  // cae fuera de la ventana [now+24h, now+24h+15min).
  const bookings = [
    { code: 'SW-otra-tz', status: 'pending', date: '2026-06-11', time: '08:00', tz: 'America/Punta_Arenas' },
  ];
  const result = findBookingsNeedingReminder(bookings, now);
  assert.strictEqual(result.length, 0);
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
