const test = require('node:test');
const assert = require('node:assert');
const { DEFAULT_TZ, resolveBusinessTz, zonedInstant, dateKeyInZone } = require('../timezone.js');

test('DEFAULT_TZ es America/Santiago', () => {
  assert.strictEqual(DEFAULT_TZ, 'America/Santiago');
});

test('resolveBusinessTz cae a DEFAULT_TZ cuando businessInfo no trae tz', () => {
  assert.strictEqual(resolveBusinessTz(null), DEFAULT_TZ);
  assert.strictEqual(resolveBusinessTz(undefined), DEFAULT_TZ);
  assert.strictEqual(resolveBusinessTz({}), DEFAULT_TZ);
  assert.strictEqual(resolveBusinessTz({ tz: '' }), DEFAULT_TZ);
});

test('resolveBusinessTz usa el tz configurado cuando existe', () => {
  assert.strictEqual(resolveBusinessTz({ tz: 'America/Punta_Arenas' }), 'America/Punta_Arenas');
});

test('zonedInstant resuelve el offset correcto de America/Santiago en verano (GMT-3) e invierno (GMT-4)', () => {
  // Verano: 15 de enero, 14:00 local -> 17:00 UTC (GMT-3).
  const summer = zonedInstant('2026-01-15', '14:00', 'America/Santiago');
  assert.strictEqual(summer.toISOString(), '2026-01-15T17:00:00.000Z');
  // Invierno: 15 de julio, 14:00 local -> 18:00 UTC (GMT-4).
  const winter = zonedInstant('2026-07-15', '14:00', 'America/Santiago');
  assert.strictEqual(winter.toISOString(), '2026-07-15T18:00:00.000Z');
});

test('zonedInstant NO mueve el offset de America/Punta_Arenas entre verano e invierno (Magallanes no cambia de hora)', () => {
  const summer = zonedInstant('2026-01-15', '14:00', 'America/Punta_Arenas');
  const winter = zonedInstant('2026-07-15', '14:00', 'America/Punta_Arenas');
  // Ambos GMT-3 fijo -> 17:00 UTC los dos.
  assert.strictEqual(summer.toISOString(), '2026-01-15T17:00:00.000Z');
  assert.strictEqual(winter.toISOString(), '2026-07-15T17:00:00.000Z');
});

// Etiqueta de offset ("GMT-3"/"GMT-4") de `tz` en un instante de referencia
// fijo (mediodía UTC de esa fecha -- nunca ambiguo). Comparar ESTO entre dos
// fechas aísla si el offset cambió; comparar zonedInstant(...) directamente
// no sirve, porque dos fechas distintas siempre dan instantes distintos
// tengan o no el mismo offset (el bug de mi primer intento de este test).
function offsetLabel(dateKey, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, timeZoneName: 'shortOffset',
  }).formatToParts(new Date(`${dateKey}T12:00:00Z`));
  return parts.find(p => p.type === 'timeZoneName').value;
}

test('el offset de America/Santiago DIFIERE entre principio y fin de abril (cambio de horario, sin fijar la fecha exacta del decreto)', () => {
  assert.notStrictEqual(offsetLabel('2026-04-01', 'America/Santiago'), offsetLabel('2026-04-30', 'America/Santiago'));
});

test('el offset de America/Santiago DIFIERE entre principio y fin de septiembre (mismo criterio)', () => {
  assert.notStrictEqual(offsetLabel('2026-09-01', 'America/Santiago'), offsetLabel('2026-09-30', 'America/Santiago'));
});

test('el offset de America/Punta_Arenas NO difiere entre principio y fin de abril ni de septiembre (sin DST)', () => {
  assert.strictEqual(offsetLabel('2026-04-01', 'America/Punta_Arenas'), offsetLabel('2026-04-30', 'America/Punta_Arenas'));
  assert.strictEqual(offsetLabel('2026-09-01', 'America/Punta_Arenas'), offsetLabel('2026-09-30', 'America/Punta_Arenas'));
});

test('zonedInstant + dateKeyInZone hacen roundtrip correcto en los bordes del día (00:30 y 23:30, America/Punta_Arenas)', () => {
  // Los bordes donde el día calendario se desplaza -- una reserva a las
  // 16:00 pasaría aunque la lógica de zona estuviera mal armada.
  const tz = 'America/Punta_Arenas';
  for (const time of ['00:30', '23:30']) {
    const instant = zonedInstant('2026-06-15', time, tz);
    assert.strictEqual(dateKeyInZone(instant, tz), '2026-06-15');
  }
});

test('dateKeyInZone devuelve el día calendario visto desde la zona, no el día UTC recortado', () => {
  // 02:00 UTC del 16 -- en America/Santiago (GMT-4 en junio) son las 22:00
  // del 15. Cortar el string ISO en UTC (.slice(0,10)) daría '2026-06-16',
  // que es el día equivocado para el negocio.
  const instant = new Date('2026-06-16T02:00:00.000Z');
  assert.strictEqual(dateKeyInZone(instant, 'America/Santiago'), '2026-06-15');
});
