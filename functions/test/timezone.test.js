const test = require('node:test');
const assert = require('node:assert');
const { DEFAULT_TZ, resolveBusinessTz, zonedInstant, dateKeyInZone, timeKeyInZone } = require('../shared/timezone.js');

test('DEFAULT_TZ es America/Santiago', () => {
  assert.strictEqual(DEFAULT_TZ, 'America/Santiago');
});

// Los dos casos reales que puede devolver el tx.get() de businessInfo/main
// en index.js: el documento no existe todavía (negocio recién configurado,
// nunca guardó Info & Contacto) o existe pero es de antes de Fase 2 (sin
// campo tz). Ninguno de los dos debe tirar excepción ni bloquear la reserva
// -- resolveBusinessTz() cae a DEFAULT_TZ en ambos, sin excepción.
test('resolveBusinessTz: businessInfo/main NO existe todavía (negocio recién configurado) -> DEFAULT_TZ, sin tirar', () => {
  // index.js pasa null cuando businessInfoSnap.exists es false.
  assert.doesNotThrow(() => resolveBusinessTz(null));
  assert.strictEqual(resolveBusinessTz(null), DEFAULT_TZ);
  assert.strictEqual(resolveBusinessTz(undefined), DEFAULT_TZ);
});

test('resolveBusinessTz: businessInfo/main existe pero es de antes de Fase 2 (sin campo tz) -> DEFAULT_TZ, sin tirar', () => {
  assert.doesNotThrow(() => resolveBusinessTz({ name: 'Scissor White', addr: 'Cochrane 635' }));
  assert.strictEqual(resolveBusinessTz({ name: 'Scissor White', addr: 'Cochrane 635' }), DEFAULT_TZ);
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

// ── timeKeyInZone ──
// Hallazgo que motivó este helper: el widget decidía qué horarios de "hoy"
// ya pasaron comparando contra `new Date()` en hora del NAVEGADOR de quien
// reserva -- alguien reservando desde otra zona veía disponibilidad
// distinta de la real en el negocio. No es un detalle de tipo (S.date de
// Date a string), es un bug de producto -- de ahí que tenga commit y tests
// propios, separados del resto de la migración.

test('timeKeyInZone devuelve la hora de pared correcta en America/Santiago (invierno, GMT-4)', () => {
  // 18:00 UTC - 4h = 14:00 local.
  assert.strictEqual(timeKeyInZone(new Date('2026-07-15T18:00:00.000Z'), 'America/Santiago'), '14:00');
});

test('el mismo instante da horas de pared DISTINTAS en zonas distintas (Santiago invierno GMT-4 vs Punta Arenas GMT-3 fijo)', () => {
  const instant = new Date('2026-07-15T18:00:00.000Z');
  assert.strictEqual(timeKeyInZone(instant, 'America/Santiago'), '14:00');
  assert.strictEqual(timeKeyInZone(instant, 'America/Punta_Arenas'), '15:00');
});

test('timeKeyInZone + zonedInstant hacen roundtrip correcto', () => {
  const tz = 'America/Punta_Arenas';
  for (const time of ['00:30', '11:45', '23:30']) {
    const instant = zonedInstant('2026-06-15', time, tz);
    assert.strictEqual(timeKeyInZone(instant, tz), time);
  }
});

test('timeKeyInZone normaliza medianoche a "00:00", no "24:00"', () => {
  // 03:00 UTC = medianoche exacta en America/Punta_Arenas (GMT-3 fijo).
  const instant = new Date('2026-06-15T03:00:00.000Z');
  assert.strictEqual(timeKeyInZone(instant, 'America/Punta_Arenas'), '00:00');
});
