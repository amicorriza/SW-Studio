const test = require('node:test');
const assert = require('node:assert');
const { resolveCreateBooking, isValidBookingPayload, orderCandidateBarbers } = require('../createBooking.js');
const { dateKeyOf } = require('../shared/availability.js');

// `now` fijo -- estos tests nunca deben depender de la fecha real del
// sistema que los corre.
const NOW = new Date('2026-01-01T00:00:00.000Z');
// businessTz por defecto para los tests que no prueban zona horaria
// específicamente -- resolveCreateBooking ya no tiene ningún default propio
// (falla si no llega), así que todo call site necesita pasarlo.
const TZ = 'America/Santiago';
const FUTURE_DATE_WIDGET = '2026-06-10T00:00:00.000Z'; // formato widget: medianoche UTC
const FUTURE_DAY_KEY = dateKeyOf(FUTURE_DATE_WIDGET); // '2026-06-10'

function basePayload(overrides) {
  return {
    code: 'SW-TEST1', name: 'Juan Pérez', email: 'juan@mail.com', phone: '+56912345678',
    svcId: 'lp', barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:00', club: 'guest',
    ...overrides,
  };
}
// Abierto todos los días 09:00-20:00 -- evita que los tests dependan de qué
// día de la semana cae FUTURE_DATE_WIDGET.
function openAllWeek(extra) {
  return Array(7).fill({ open: true, start: '09:00', end: '20:00', ...(extra || {}) });
}
const SERVICE = { name: 'Corte', cat: 'cortes', price: 21000, dur: 50, status: 'active' };
function staffList() {
  return [
    { id: 'felipe', name: 'Felipe', status: 'active', schedule: openAllWeek() },
    { id: 'victoria', name: 'Victoria', status: 'active', schedule: openAllWeek() },
  ];
}

test('acepta una reserva válida y arma el doc final (status/emailStatus/src correctos)', () => {
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.doc.barberId, 'felipe');
  assert.strictEqual(result.doc.status, 'pending');
  assert.strictEqual(result.doc.emailStatus, 'pending');
  assert.strictEqual(result.doc.src, 'callable');
});

test('el doc siempre trae `tz`, incluso cuando la zona resuelta ES el default -- la ausencia del campo, no su valor, marca "reserva de antes de Fase 2"', () => {
  // TZ acá vale lo mismo que DEFAULT_TZ a propósito: prueba que buildBookingDoc
  // no "ahorra" el campo cuando coincide con el default -- si lo hiciera, un
  // negocio en el default sería indistinguible de una reserva vieja sin tz.
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.doc.tz, TZ);
});

test('el doc trae la zona real cuando NO es el default (Punta Arenas)', () => {
  const result = resolveCreateBooking({
    businessTz: 'America/Punta_Arenas',
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.doc.tz, 'America/Punta_Arenas');
});

test('solape exacto con una reserva existente → rechaza con already-exists', () => {
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:00', dur: 50 }];
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('solape parcial por el extremo de inicio de la candidata → rechaza', () => {
  // Existente 10:30-11:20 vs candidata 11:00-11:50 (dur 50 del servicio).
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '10:30', dur: 50 }];
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('solape parcial por el extremo de término de la candidata → rechaza', () => {
  // Existente 11:30-12:20 vs candidata 11:00-11:50.
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:30', dur: 50 }];
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('cita adyacente (termina exactamente cuando empieza la otra) → acepta', () => {
  // Existente 11:50-12:40 empieza justo cuando termina la candidata (11:00-11:50).
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:50', dur: 50 }];
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
});

test('cita adyacente con bufferMin>0 → rechaza (el margen de limpieza sí bloquea lo que sin buffer estaba libre)', () => {
  // Mismo caso que el test anterior (existente 11:50-12:40, candidata
  // 11:00-11:50) pero con bufferMin=10 -- ya no debería caber.
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:50', dur: 50 }];
  const result = resolveCreateBooking({
    businessTz: TZ, bufferMin: 10,
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('sin bufferMin (default 0), el comportamiento es idéntico al de antes de este parámetro', () => {
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:50', dur: 50 }];
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
});

test('bufferMin>0 NO se aplica contra colación ni bloqueos -- solo entre reservas reales', () => {
  // Colación 10:45-11:15 termina justo cuando... no, aquí probamos que un
  // horario ADYACENTE a la colación (candidata 11:15-12:05) sigue aceptando
  // aunque bufferMin sea alto -- el margen de limpieza es solo entre citas.
  const staff = [{ id: 'felipe', name: 'Felipe', status: 'active', schedule: openAllWeek({ break: { start: '10:15', end: '11:00' } }) }];
  const result = resolveCreateBooking({
    businessTz: TZ, bufferMin: 30,
    payload: basePayload({ time: '11:00' }), now: NOW, service: SERVICE, staff,
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
});

test("'any' se resuelve a un barbero real libre y NUNCA se persiste 'any'", () => {
  // felipe ocupado a esa hora, victoria libre -- 'any' debe caer en victoria.
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:00', dur: 50 }];
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload({ barberId: 'any' }), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.doc.barberId, 'victoria');
  assert.notStrictEqual(result.doc.barberId, 'any');
});

test("'any' sin ningún barbero libre → rechaza con resource-exhausted (no already-exists)", () => {
  const bookingsForDay = [
    { barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:00', dur: 50 },
    { barberId: 'victoria', date: FUTURE_DATE_WIDGET, time: '11:00', dur: 50 },
  ];
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload({ barberId: 'any' }), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'resource-exhausted');
});

test('dur y price manipulados en el payload se ignoran -- se usan siempre los de services', () => {
  const payload = basePayload({ dur: 5, price: 1, svcName: 'otro', svcCat: 'otro' });
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload, now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.doc.dur, 50);
  assert.strictEqual(result.doc.price, 21000);
  assert.strictEqual(result.doc.svcName, 'Corte');
  assert.strictEqual(result.doc.svcCat, 'cortes');
});

test('svcId inexistente (service null) → rechaza con not-found', () => {
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload(), now: NOW, service: null, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'not-found');
});

test('servicio inactivo (existe pero status!=="active") → rechaza con not-found', () => {
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload(), now: NOW, service: { ...SERVICE, status: 'inactive' }, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'not-found');
});

test('fecha pasada → rechaza con failed-precondition', () => {
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload({ date: '2020-01-01T00:00:00.000Z', time: '11:00' }),
    now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'failed-precondition');
});

// No es uno de los casos listados explícitamente, pero el paso 5 de la
// implementación ("caiga en el horario del barbero") lo exige -- se agrega
// como acompañante natural de "fecha pasada", mismo code.
test('fuera del horario del barbero (día cerrado) → rechaza con failed-precondition', () => {
  const staff = [{ id: 'felipe', name: 'Felipe', status: 'active', schedule: Array(7).fill(null) }];
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload(), now: NOW, service: SERVICE, staff,
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'failed-precondition');
});

test('solape contra un scheduleBlock del barbero → rechaza con already-exists', () => {
  const scheduleBlocksForDay = [{ barberId: 'felipe', date: FUTURE_DAY_KEY, start: '10:45', end: '11:15' }];
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('solape contra la colación recurrente del barbero → rechaza con already-exists', () => {
  const staff = [{ id: 'felipe', name: 'Felipe', status: 'active', schedule: openAllWeek({ break: { start: '10:45', end: '11:15' } }) }];
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload(), now: NOW, service: SERVICE, staff,
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('detecta solape aunque la reserva EXISTENTE tenga `date` en formato panel (hora real, no medianoche)', () => {
  // La agrupación por barbero usa siempre `time`, nunca la hora embebida en
  // `date` -- por eso da igual qué formato traiga la reserva existente.
  const bookingsForDay = [{ barberId: 'felipe', date: '2026-06-10T11:00:00.000Z', time: '11:00', dur: 50 }];
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload({ date: FUTURE_DATE_WIDGET }), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('detecta el día correcto aunque la reserva NUEVA use `date` en formato panel', () => {
  // dateKeyOf() normaliza ambos formatos al mismo día calendario.
  const bookingsForDay = [{ barberId: 'felipe', date: FUTURE_DATE_WIDGET, time: '11:00', dur: 50 }];
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload({ date: '2026-06-10T11:00:00.000Z' }), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay, scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already-exists');
});

test('payload inválido → resolveCreateBooking propaga invalid-argument end-to-end (no solo isValidBookingPayload aislado)', () => {
  // Cubre el punto de integración real: el `if (!isValidBookingPayload(...))
  // return {...}` inicial de resolveCreateBooking nunca se había probado a
  // través de la función completa, solo isValidBookingPayload() por separado
  // más abajo -- hueco detectado al revisar la cobertura del Bloque A.
  const result = resolveCreateBooking({
    businessTz: TZ,
    payload: basePayload({ email: 'no-es-email' }), now: NOW, service: SERVICE, staff: staffList(),
    bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'invalid-argument');
});

// ── businessTz: obligatorio, sin default silencioso, y gobierna todo ──
test('sin businessTz, resolveCreateBooking falla ruidosamente (excepción, no {ok:false})', () => {
  assert.throws(() => {
    resolveCreateBooking({
      payload: basePayload(), now: NOW, service: SERVICE, staff: staffList(),
      bookingsForDay: [], scheduleBlocksForDay: [],
    });
  }, /businessTz es obligatorio/);
});

test('la zona del CLIENTE no existe como concepto -- mismo payload/businessTz, mismo resultado sin importar desde dónde "vendría" el cliente', () => {
  // El payload que arma el widget post-Fase 2 no lleva ningún artefacto de
  // zona del navegador (ver commits 7a/7b) -- resolveCreateBooking ni
  // siquiera tiene un parámetro para eso. Este test documenta esa garantía:
  // si alguien reintrodujera por error un offset de cliente, tendría que
  // cambiar la firma de la función para que este test pudiera fallar.
  const args = {
    businessTz: 'America/Santiago', payload: basePayload(), now: NOW,
    service: SERVICE, staff: staffList(), bookingsForDay: [], scheduleBlocksForDay: [],
  };
  const asIfClienteSantiago = resolveCreateBooking({ ...args }); // cliente "en" UTC-3/-4 (misma zona que el negocio)
  const asIfClienteTokio = resolveCreateBooking({ ...args }); // cliente "en" UTC+9 -- el payload es idéntico, no hay forma de que esto cambie nada
  assert.deepStrictEqual(asIfClienteSantiago, asIfClienteTokio);
});

// ── Bordes del día calendario, donde el bug original (hardcodear 'Z') habría
// mordido -- una reserva a las 16:00 pasaría aunque la lógica estuviera mal.
// `now` se elige a propósito ENTRE el instante que el bug viejo habría
// calculado (tratar dayKey+time como UTC) y el instante correcto (resuelto
// vía la zona real) -- así el test falla con el bug y pasa con el fix, no
// "pasa siempre pase lo que pase". Horario 24h a propósito: 23:30/00:30 caen
// fuera del 09:00-20:00 de staffList(), y ese rechazo (horario) usa el mismo
// code (failed-precondition) que el rechazo por fecha pasada -- se aislaría
// mal cuál de los dos está fallando si se dejara el horario normal.
function staffOpenAllDay() {
  return [{ id: 'felipe', name: 'Felipe', status: 'active', schedule: Array(7).fill({ open: true, start: '00:00', end: '23:59' }) }];
}

test('reserva a las 23:30 en America/Punta_Arenas (GMT-3 fijo) resuelve el instante futuro correcto, no el del bug viejo', () => {
  // Correcto: 23:30 + 3h = 2026-06-16T02:30Z. Bug viejo ('Z' literal):
  // 2026-06-15T23:30Z. `now` entre ambos -- con el bug, "ya pasó".
  const result = resolveCreateBooking({
    businessTz: 'America/Punta_Arenas',
    payload: basePayload({ date: '2026-06-15T00:00:00.000Z', time: '23:30' }),
    now: new Date('2026-06-16T01:00:00.000Z'),
    service: SERVICE, staff: staffOpenAllDay(), bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
});

test('reserva a las 00:30 en America/Punta_Arenas (GMT-3 fijo) resuelve el instante futuro correcto, no el del bug viejo', () => {
  // Correcto: 00:30 + 3h = 2026-06-15T03:30Z. Bug viejo: 2026-06-15T00:30Z.
  const result = resolveCreateBooking({
    businessTz: 'America/Punta_Arenas',
    payload: basePayload({ date: '2026-06-15T00:00:00.000Z', time: '00:30' }),
    now: new Date('2026-06-15T02:00:00.000Z'),
    service: SERVICE, staff: staffOpenAllDay(), bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
});

test('reserva a las 23:30 en America/Santiago en invierno (GMT-4) resuelve el instante futuro correcto -- mismo par de horas, offset distinto al de Punta Arenas', () => {
  // Correcto: 23:30 + 4h = 2026-07-16T03:30Z. Bug viejo: 2026-07-15T23:30Z.
  const result = resolveCreateBooking({
    businessTz: 'America/Santiago',
    payload: basePayload({ date: '2026-07-15T00:00:00.000Z', time: '23:30' }),
    now: new Date('2026-07-16T01:00:00.000Z'),
    service: SERVICE, staff: staffOpenAllDay(), bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
});

test('reserva a las 00:30 en America/Santiago en invierno (GMT-4) resuelve el instante futuro correcto', () => {
  // Correcto: 00:30 + 4h = 2026-07-15T04:30Z. Bug viejo: 2026-07-15T00:30Z.
  const result = resolveCreateBooking({
    businessTz: 'America/Santiago',
    payload: basePayload({ date: '2026-07-15T00:00:00.000Z', time: '00:30' }),
    now: new Date('2026-07-15T02:00:00.000Z'),
    service: SERVICE, staff: staffOpenAllDay(), bookingsForDay: [], scheduleBlocksForDay: [],
  });
  assert.strictEqual(result.ok, true);
});

// ── isValidBookingPayload / orderCandidateBarbers: unidades sueltas ──
test('isValidBookingPayload rechaza email/phone/name inválidos y acepta un payload completo', () => {
  assert.strictEqual(isValidBookingPayload(basePayload()), true);
  assert.strictEqual(isValidBookingPayload(basePayload({ email: 'no-es-email' })), false);
  assert.strictEqual(isValidBookingPayload(basePayload({ phone: '123' })), false);
  assert.strictEqual(isValidBookingPayload(basePayload({ name: 'J' })), false);
  assert.strictEqual(isValidBookingPayload(basePayload({ club: 'vip' })), false);
});

test('orderCandidateBarbers ordena alfabéticamente por id (política actual, aislada a propósito)', () => {
  assert.deepStrictEqual(orderCandidateBarbers(['victoria', 'felipe', 'ariel']), ['ariel', 'felipe', 'victoria']);
});
