'use strict';

// Suite de las funciones puras del dashboard de métricas de negocio.
// Estilo functions/test/*: node --test, sin deps, sin emulador, sin DOM.
// public/js/metrics.js es un <script> clásico con export dual -> require lo carga.

const test = require('node:test');
const assert = require('node:assert');
const M = require('../../public/js/metrics.js');

// ─────────────────────────────────────────────────────────────────────────────
// parseBookingDate
// ─────────────────────────────────────────────────────────────────────────────

test('parseBookingDate: YYYY-MM-DD plano -> Date a mediodía UTC de ese día', () => {
  const d = M.parseBookingDate({ date: '2026-09-06' });
  assert.ok(d instanceof Date);
  assert.strictEqual(d.getUTCFullYear(), 2026);
  assert.strictEqual(d.getUTCMonth(), 8);
  assert.strictEqual(d.getUTCDate(), 6);
  assert.strictEqual(d.getUTCHours(), 12);
});

test('parseBookingDate: date del camino admin (YYYY-MM-DDTHH:mm:00.000Z) -> recorta a 10, ignora la hora', () => {
  // '...T14:30:00.000Z' es hora de pared local mal etiquetada Z, no un instante real.
  const d = M.parseBookingDate({ date: '2026-09-06T14:30:00.000Z' });
  assert.strictEqual(M.ymd(d), '2026-09-06');
  assert.strictEqual(d.getUTCHours(), 12);
});

test('parseBookingDate: fechas imposibles -> null (round-trip)', () => {
  assert.strictEqual(M.parseBookingDate({ date: '2026-02-30' }), null);
  assert.strictEqual(M.parseBookingDate({ date: '2026-13-01' }), null);
  assert.strictEqual(M.parseBookingDate({ date: '2026-00-10' }), null);
});

test('parseBookingDate: basura / vacío / ausente / booking null -> null, nunca lanza', () => {
  assert.doesNotThrow(() => M.parseBookingDate(null));
  assert.strictEqual(M.parseBookingDate({ date: 'garbage' }), null);
  assert.strictEqual(M.parseBookingDate({ date: '' }), null);
  assert.strictEqual(M.parseBookingDate({ date: null }), null);
  assert.strictEqual(M.parseBookingDate({}), null);
  assert.strictEqual(M.parseBookingDate(null), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// bizToday
// ─────────────────────────────────────────────────────────────────────────────

test('bizToday: la zona del negocio gobierna, no el TZ del runner', () => {
  const instant = new Date('2026-01-01T02:00:00Z');
  // Santiago (GMT-3 en enero): 2026-01-01 02:00Z = 2025-12-31 23:00 local.
  assert.strictEqual(M.bizToday('America/Santiago', instant), '2025-12-31');
  // Kiritimati (GMT+14): mismo instante = 2026-01-01 16:00 local.
  assert.strictEqual(M.bizToday('Pacific/Kiritimati', instant), '2026-01-01');
});

test('bizToday: tz ausente -> cae a America/Santiago', () => {
  assert.strictEqual(M.bizToday(undefined, new Date('2026-06-15T12:00:00Z')), '2026-06-15');
  assert.strictEqual(M.bizToday('', new Date('2026-06-15T12:00:00Z')), '2026-06-15');
});

// ─────────────────────────────────────────────────────────────────────────────
// monthBounds
// ─────────────────────────────────────────────────────────────────────────────

test('monthBounds: febrero no bisiesto', () => {
  assert.deepStrictEqual(M.monthBounds('2026-02'), { from: '2026-02-01', to: '2026-02-28', ym: '2026-02' });
});

test('monthBounds: febrero bisiesto', () => {
  assert.deepStrictEqual(M.monthBounds('2024-02'), { from: '2024-02-01', to: '2024-02-29', ym: '2024-02' });
});

test('monthBounds: diciembre -> to 31', () => {
  assert.strictEqual(M.monthBounds('2026-12').to, '2026-12-31');
});

// ─────────────────────────────────────────────────────────────────────────────
// rangeBounds
// ─────────────────────────────────────────────────────────────────────────────

test('rangeBounds: rango bien formado pasa igual', () => {
  assert.deepStrictEqual(M.rangeBounds('2026-01-05', '2026-03-20'), { from: '2026-01-05', to: '2026-03-20' });
});

test('rangeBounds: from > to -> se invierte', () => {
  assert.deepStrictEqual(M.rangeBounds('2026-03-20', '2026-01-05'), { from: '2026-01-05', to: '2026-03-20' });
});

test('rangeBounds: alguno inválido -> {from:"",to:""}', () => {
  assert.deepStrictEqual(M.rangeBounds('garbage', '2026-01-05'), { from: '', to: '' });
  assert.deepStrictEqual(M.rangeBounds('', ''), { from: '', to: '' });
});

// ─────────────────────────────────────────────────────────────────────────────
// weekStartsBack (lunes a domingo)
// ─────────────────────────────────────────────────────────────────────────────

test('weekStartsBack(0): domingo cae en la semana que arranca el lunes anterior', () => {
  // 2026-09-06 es domingo.
  assert.deepStrictEqual(M.weekStartsBack(0, '2026-09-06'), { from: '2026-08-31', to: '2026-09-06' });
});

test('weekStartsBack(0): lunes es el primer día de su propia semana', () => {
  // 2026-09-07 es lunes.
  assert.deepStrictEqual(M.weekStartsBack(0, '2026-09-07'), { from: '2026-09-07', to: '2026-09-13' });
});

test('weekStartsBack(1): una semana atrás, cruzando el año', () => {
  // 2026-01-05 es lunes; su semana previa arranca el 2025-12-29 (lunes).
  assert.deepStrictEqual(M.weekStartsBack(1, '2026-01-05'), { from: '2025-12-29', to: '2026-01-04' });
});

test('weekStartsBack: "to" siempre es "from" + 6 días', () => {
  for (const n of [0, 1, 5, 12]) {
    const { from, to } = M.weekStartsBack(n, '2026-09-06');
    const diff = (new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000;
    assert.strictEqual(diff, 6);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// firstBookingByEmail
// ─────────────────────────────────────────────────────────────────────────────

test('firstBookingByEmail: guarda la primera reserva histórica por email normalizado', () => {
  const bk = [
    { email: 'A@B.CL', date: '2026-03-01' },
    { email: ' a@b.cl ', date: '2026-01-15' },
    { email: 'a@b.cl', date: '2026-05-20' },
  ];
  assert.deepStrictEqual(M.firstBookingByEmail(bk, { tz: 'America/Santiago' }), { 'a@b.cl': '2026-01-15' });
});

test('firstBookingByEmail: sin email -> no entra', () => {
  const bk = [{ email: '', date: '2026-01-01' }, { date: '2026-01-02' }];
  assert.deepStrictEqual(M.firstBookingByEmail(bk, { tz: 'America/Santiago' }), {});
});

test('firstBookingByEmail: date no parseable pero createdAt válido -> usa el día de createdAt en la zona', () => {
  const bk = [{ email: 'x@y.cl', date: 'garbage', createdAt: '2026-01-01T02:00:00Z' }];
  // 2026-01-01 02:00Z en Santiago (GMT-3) = 2025-12-31.
  assert.deepStrictEqual(M.firstBookingByEmail(bk, { tz: 'America/Santiago' }), { 'x@y.cl': '2025-12-31' });
});

test('firstBookingByEmail: sin date usable ni createdAt -> se salta, no lanza', () => {
  const bk = [{ email: 'x@y.cl', date: 'garbage' }];
  assert.doesNotThrow(() => M.firstBookingByEmail(bk, { tz: 'America/Santiago' }));
  assert.deepStrictEqual(M.firstBookingByEmail(bk, { tz: 'America/Santiago' }), {});
});

// ─────────────────────────────────────────────────────────────────────────────
// mFilterPeriod
// ─────────────────────────────────────────────────────────────────────────────

const PERIOD = { from: '2026-09-01', to: '2026-09-30', today: '2026-09-15' };

// Medición de la atención real (2026-09): cancelled se suma a las
// exclusiones. no_show NO -- ver el test siguiente.
test('mFilterPeriod excluye cancelled igual que declined', () => {
  const bks = [
    { date: '2026-09-10', price: 1000, status: 'cancelled' },
    { date: '2026-09-10', price: 1000, status: 'declined' },
    { date: '2026-09-10', price: 1000, status: 'completed' },
  ];
  const r = M.mFilterPeriod(bks, { from: PERIOD.from, to: PERIOD.to, mode: 'agendado', today: PERIOD.today });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].status, 'completed');
});

// A propósito: una cita a la que el cliente no llegó SIGUE siendo una
// reserva, y es el numerador del KPI de no-show que el dashboard (P2) va a
// calcular. Excluirla acá lo volvería incalculable. Que su `price` infle el
// ingreso es la misma sobreestimación que ya existe hoy (toda cita pasada se
// asume atendida); P2 la corrige separando "reservas" de "ingresos".
test('mFilterPeriod NO excluye no_show', () => {
  const bks = [{ date: '2026-09-10', price: 1000, status: 'no_show' }];
  const r = M.mFilterPeriod(bks, { from: PERIOD.from, to: PERIOD.to, mode: 'agendado', today: PERIOD.today });
  assert.strictEqual(r.length, 1);
});

test('mByService / mByBarber / mNewVsReturning también excluyen cancelled', () => {
  const bks = [
    { date: '2026-09-10', price: 1000, dur: 30, svcId: 'x', svcName: 'X', barberId: 'v', barberName: 'V', email: 'a@a.cl', status: 'cancelled' },
    { date: '2026-09-10', price: 2000, dur: 30, svcId: 'y', svcName: 'Y', barberId: 'v', barberName: 'V', email: 'b@b.cl', status: 'completed' },
  ];
  const svc = M.mByService(bks, { groupBy: 'svc' });
  assert.strictEqual(svc.length, 1);
  assert.strictEqual(svc[0].key, 'y');
  const barb = M.mByBarber(bks, []);
  assert.strictEqual(barb[0].total, 1);
  assert.strictEqual(barb[0].revenue, 2000);
});

test('mFilterPeriod: excluye declined en ambos modos', () => {
  const bk = [
    { date: '2026-09-05', status: 'declined', price: 100 },
    { date: '2026-09-05', status: 'pending', price: 100 },
  ];
  assert.strictEqual(M.mFilterPeriod(bk, { ...PERIOD, mode: 'realizado' }).length, 1);
  assert.strictEqual(M.mFilterPeriod(bk, { ...PERIOD, mode: 'agendado' }).length, 1);
});

test('mFilterPeriod: confirmed cuenta igual que pending', () => {
  const bk = [{ date: '2026-09-05', status: 'confirmed', price: 100 }];
  assert.strictEqual(M.mFilterPeriod(bk, { ...PERIOD, mode: 'realizado' }).length, 1);
});

test('mFilterPeriod: fecha malformada -> reserva ignorada, no propaga excepción', () => {
  const bk = [
    { date: '2026-13-40', status: 'pending' },
    { date: 'garbage', status: 'pending' },
    { date: null, status: 'pending' },
    { date: '2026-02-30', status: 'pending' },
    { date: '20260906', status: 'pending' },
    { date: '2026-09-05', status: 'pending' },
  ];
  let out;
  assert.doesNotThrow(() => { out = M.mFilterPeriod(bk, { ...PERIOD, mode: 'agendado' }); });
  assert.strictEqual(out.length, 1);
});

test('mFilterPeriod: date del camino admin (con hora basura tras la T) -> vale por su parte de fecha', () => {
  // parseBookingDate recorta a 10: la hora nunca se usa en agregaciones por día.
  const bk = [{ date: '2026-09-06T25:00:00.000Z', status: 'pending' }];
  assert.strictEqual(M.mFilterPeriod(bk, { ...PERIOD, mode: 'agendado' }).length, 1);
});

test('mFilterPeriod: fuera de [from,to] se excluye', () => {
  const bk = [
    { date: '2026-08-31', status: 'pending' },
    { date: '2026-10-01', status: 'pending' },
    { date: '2026-09-01', status: 'pending' },
    { date: '2026-09-30', status: 'pending' },
  ];
  assert.strictEqual(M.mFilterPeriod(bk, { ...PERIOD, mode: 'agendado' }).length, 2);
});

test('mFilterPeriod: Realizado excluye hoy y futuro; Agendado los incluye', () => {
  const bk = [
    { date: '2026-09-14', status: 'pending' }, // ayer
    { date: '2026-09-15', status: 'pending' }, // hoy
    { date: '2026-09-16', status: 'pending' }, // mañana
  ];
  assert.strictEqual(M.mFilterPeriod(bk, { ...PERIOD, mode: 'realizado' }).length, 1);
  assert.strictEqual(M.mFilterPeriod(bk, { ...PERIOD, mode: 'agendado' }).length, 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// mKpis
// ─────────────────────────────────────────────────────────────────────────────

test('mKpis: totales básicos', () => {
  const bk = [
    { date: '2026-09-02', price: 10000, email: 'a@x.cl' },
    { date: '2026-09-03', price: 20000, email: 'b@x.cl' },
  ];
  const k = M.mKpis(bk, [], { firstSeen: { 'a@x.cl': '2026-09-02', 'b@x.cl': '2026-01-01' }, periodFrom: '2026-09-01', prevFrom: '' });
  assert.strictEqual(k.ingresos, 30000);
  assert.strictEqual(k.citas, 2);
  assert.strictEqual(k.ticket, 15000);
});

test('mKpis: split nuevo/recurrente sobre clientes únicos; borde inclusivo; multi-reserva cuenta una vez', () => {
  const bk = [
    { date: '2026-09-03', price: 1, email: 'new@x.cl' },
    { date: '2026-09-04', price: 1, email: 'old@x.cl' },
    { date: '2026-09-10', price: 1, email: 'old@x.cl' },
    { date: '2026-09-11', price: 1, email: 'old@x.cl' },
    { date: '2026-09-05', price: 1, email: 'edge@x.cl' },
    { date: '2026-09-06', price: 1 }, // sin email
  ];
  const firstSeen = {
    'new@x.cl': '2026-09-03',
    'old@x.cl': '2026-08-01',
    'edge@x.cl': '2026-09-01', // === periodFrom -> nuevo
  };
  const k = M.mKpis(bk, [], { firstSeen, periodFrom: '2026-09-01', prevFrom: '' });
  assert.strictEqual(k.nuevos, 2);
  assert.strictEqual(k.recurrentes, 1);
  assert.strictEqual(k.activos, 3);
  assert.strictEqual(k.sinEmail, 1);
  assert.ok(Math.abs(k.nuevosPct - 2 / 3) < 1e-9);
  assert.ok(Math.abs(k.recurrentesPct - 1 / 3) < 1e-9);
});

test('mKpis: período vacío -> ceros, pcts null, deltas null, sin NaN/Infinity', () => {
  const k = M.mKpis([], [], { firstSeen: {}, periodFrom: '2026-09-01', prevFrom: '2026-08-01' });
  assert.strictEqual(k.ingresos, 0);
  assert.strictEqual(k.citas, 0);
  assert.strictEqual(k.ticket, 0);
  assert.strictEqual(k.nuevos, 0);
  assert.strictEqual(k.nuevosPct, null);
  assert.strictEqual(k.recurrentesPct, null);
  for (const v of Object.values(k.deltas)) assert.strictEqual(v, null);
});

test('mKpis: período previo vacío -> cada delta null (nunca división por cero)', () => {
  const bk = [{ date: '2026-09-02', price: 10000, email: 'a@x.cl' }];
  const k = M.mKpis(bk, [], { firstSeen: { 'a@x.cl': '2026-09-02' }, periodFrom: '2026-09-01', prevFrom: '2026-08-01' });
  for (const v of Object.values(k.deltas)) assert.strictEqual(v, null);
});

test('mKpis: delta de ingresos como fracción; delta de % recurrentes como diferencia de puntos', () => {
  const cur = [
    { date: '2026-09-02', price: 12000, email: 'a@x.cl' },
    { date: '2026-09-03', price: 0, email: 'b@x.cl' },
  ];
  const prev = [
    { date: '2026-08-02', price: 10000, email: 'a@x.cl' },
    { date: '2026-08-03', price: 0, email: 'c@x.cl' },
  ];
  const firstSeen = {
    'a@x.cl': '2026-01-01', // recurrente en ambos períodos
    'b@x.cl': '2026-09-01', // nuevo en el período actual (=== periodFrom)
    'c@x.cl': '2026-07-01', // recurrente en el previo (< prevFrom)
  };
  const k = M.mKpis(cur, prev, { firstSeen, periodFrom: '2026-09-01', prevFrom: '2026-08-01' });
  assert.ok(Math.abs(k.deltas.ingresos - (12000 - 10000) / 10000) < 1e-9); // +0.2
  // recurrentesPct actual = 1/2, previo = 2/2 -> diferencia -0.5 (medio punto)
  assert.ok(Math.abs(k.deltas.recurrentesPct - (0.5 - 1.0)) < 1e-9);
});

// ─────────────────────────────────────────────────────────────────────────────
// mMonthlySeries / mWeeklySeries
// ─────────────────────────────────────────────────────────────────────────────

test('mMonthlySeries: 12 entradas, más viejo primero, terminando en el mes de today', () => {
  const s = M.mMonthlySeries([], { months: 12, mode: 'agendado', today: '2026-09-15' });
  assert.strictEqual(s.length, 12);
  assert.strictEqual(s[0].ym, '2025-10');
  assert.strictEqual(s[11].ym, '2026-09');
});

test('mMonthlySeries: claves contiguas cruzando Dic->Ene', () => {
  const s = M.mMonthlySeries([], { months: 3, mode: 'agendado', today: '2026-01-15' });
  assert.deepStrictEqual(s.map(x => x.ym), ['2025-11', '2025-12', '2026-01']);
});

test('mMonthlySeries: agrega ingresos y citas por mes y respeta el modo', () => {
  const bk = [
    { date: '2026-08-10', price: 5000, status: 'pending' },
    { date: '2026-09-10', price: 7000, status: 'pending' }, // pasado (today 2026-09-15)
    { date: '2026-09-20', price: 9000, status: 'pending' }, // futuro
  ];
  const real = M.mMonthlySeries(bk, { months: 12, mode: 'realizado', today: '2026-09-15' });
  const agen = M.mMonthlySeries(bk, { months: 12, mode: 'agendado', today: '2026-09-15' });
  const sep = s => s.find(x => x.ym === '2026-09');
  assert.strictEqual(sep(real).ingresos, 7000);
  assert.strictEqual(sep(real).citas, 1);
  assert.strictEqual(sep(agen).ingresos, 16000);
  assert.strictEqual(sep(agen).citas, 2);
});

test('mWeeklySeries: 13 entradas (12 completas + actual), la última marcada current', () => {
  const s = M.mWeeklySeries([], { weeks: 12, mode: 'agendado', today: '2026-09-06' });
  assert.strictEqual(s.length, 13);
  assert.strictEqual(s[12].current, true);
  assert.strictEqual(s[12].weekStart, '2026-08-31');
  assert.ok(!s[0].current);
});

// ─────────────────────────────────────────────────────────────────────────────
// mByService
// ─────────────────────────────────────────────────────────────────────────────

test('mByService: agrupa por servicio, ordena por ingreso desc, pct sobre el total', () => {
  const bk = [
    { svcId: 's1', svcName: 'Corte', price: 10000, dur: 30 },
    { svcId: 's1', svcName: 'Corte', price: 10000, dur: 30 },
    { svcId: 's2', svcName: 'Barba', price: 6000, dur: 20 },
  ];
  const rows = M.mByService(bk, { groupBy: 'svc' });
  assert.strictEqual(rows[0].label, 'Corte');
  assert.strictEqual(rows[0].citas, 2);
  assert.strictEqual(rows[0].ingreso, 20000);
  assert.ok(Math.abs(rows[0].pct - 20000 / 26000) < 1e-9);
  // ingreso/hora de Corte: 20000 / (60/60) = 20000
  assert.strictEqual(rows[0].ingresoHora, 20000);
});

test('mByService: groupBy cat usa svcCat; label crudo (el admin mapea CN)', () => {
  const bk = [
    { svcCat: 'c', svcName: 'Corte', price: 10000, dur: 30 },
    { svcCat: 'b', svcName: 'Barba', price: 6000, dur: 20 },
  ];
  const rows = M.mByService(bk, { groupBy: 'cat' });
  assert.deepStrictEqual(rows.map(r => r.key).sort(), ['b', 'c']);
});

test('mByService: dur 0 en todas las filas del grupo -> ingresoHora null, no divide', () => {
  const bk = [{ svcId: 's1', svcName: 'X', price: 10000, dur: 0 }];
  assert.strictEqual(M.mByService(bk, { groupBy: 'svc' })[0].ingresoHora, null);
});

test('mByService: grupo mixto -> el denominador de ingreso/hora solo cuenta filas con dur>0', () => {
  const bk = [
    { svcId: 's1', svcName: 'X', price: 10000, dur: 60 },
    { svcId: 's1', svcName: 'X', price: 5000, dur: 0 },
  ];
  // ingreso/hora = 10000 / (60/60) = 10000 (la fila dur:0 no entra al denominador)
  assert.strictEqual(M.mByService(bk, { groupBy: 'svc' })[0].ingresoHora, 10000);
});

test('mByService: declined no aporta; confirmed sí (mismo trato que pending)', () => {
  const bk = [
    { svcId: 's1', svcName: 'X', price: 10000, dur: 30, status: 'declined' },
    { svcId: 's1', svcName: 'X', price: 10000, dur: 30, status: 'confirmed' },
  ];
  const rows = M.mByService(bk, { groupBy: 'svc' });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].citas, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// mByBarber
// ─────────────────────────────────────────────────────────────────────────────

test('mByBarber: ordena por total desc y calcula deltas vs período previo', () => {
  const cur = [
    { barberId: 'x', barberName: 'Xanni', price: 10000, svcName: 'Corte' },
    { barberId: 'x', barberName: 'Xanni', price: 10000, svcName: 'Corte' },
    { barberId: 'y', barberName: 'Yayo', price: 5000, svcName: 'Barba' },
  ];
  const prev = [{ barberId: 'x', barberName: 'Xanni', price: 10000, svcName: 'Corte' }];
  const rows = M.mByBarber(cur, prev);
  assert.strictEqual(rows[0].barberId, 'x');
  assert.strictEqual(rows[0].total, 2);
  assert.strictEqual(rows[0].revenue, 20000);
  assert.ok(Math.abs(rows[0].deltaCitas - (2 - 1) / 1) < 1e-9);
  assert.strictEqual(rows[1].deltaCitas, null); // Yayo no existía en el previo
});

// ─────────────────────────────────────────────────────────────────────────────
// mNewVsReturning
// ─────────────────────────────────────────────────────────────────────────────

test('mNewVsReturning: serie de 6 meses con split nuevo/recurrente por mes y conteo sin email', () => {
  const bk = [
    { date: '2026-09-05', email: 'new@x.cl' },
    { date: '2026-09-06', email: 'old@x.cl' },
    { date: '2026-09-07' }, // sin email
    { date: '2026-08-10', email: 'old@x.cl' },
  ];
  const firstSeen = { 'new@x.cl': '2026-09-01', 'old@x.cl': '2026-05-01' };
  const r = M.mNewVsReturning(bk, { months: 6, tz: 'America/Santiago', today: '2026-09-15', firstSeen });
  assert.strictEqual(r.series.length, 6);
  const sep = r.series.find(x => x.ym === '2026-09');
  assert.strictEqual(sep.nuevos, 1);
  assert.strictEqual(sep.recurrentes, 1);
  assert.strictEqual(r.sinEmail, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// mMonthlyExportRows
// ─────────────────────────────────────────────────────────────────────────────

test('mMonthlyExportRows: header + 12 filas, más viejo primero, meses contiguos', () => {
  const rows = M.mMonthlyExportRows([], { months: 12, mode: 'agendado', today: '2026-09-15', firstSeen: {} });
  assert.strictEqual(rows.length, 13);
  assert.strictEqual(rows[0][0], 'Mes');
  assert.strictEqual(rows[1][0], '2025-10');
  assert.strictEqual(rows[12][0], '2026-09');
});

test('mMonthlyExportRows: Citas e Ingresos de cada fila coinciden con mMonthlySeries del mismo mes', () => {
  const bk = [
    { date: '2026-08-10', price: 5000, status: 'pending' },
    { date: '2026-08-12', price: 3000, status: 'pending' },
  ];
  const rows = M.mMonthlyExportRows(bk, { months: 12, mode: 'agendado', today: '2026-09-15', firstSeen: {} });
  const ago = rows.find(r => r[0] === '2026-08');
  assert.strictEqual(ago[1], 2);     // Citas
  assert.strictEqual(ago[2], 8000);  // Ingresos CLP
});

// ─────────────────────────────────────────────────────────────────────────────
// toCSV
// ─────────────────────────────────────────────────────────────────────────────

test('toCSV: filas unidas con CRLF, valores planos sin comillas', () => {
  assert.strictEqual(M.toCSV([['Mes', 'Citas'], ['2026-01', 5]]), 'Mes,Citas\r\n2026-01,5');
});

test('toCSV: entrecomilla y escapa comillas, comas, saltos de línea y punto y coma', () => {
  assert.strictEqual(M.toCSV([['a,b', 'c"d', 'e\nf']]), '"a,b","c""d","e\nf"');
  assert.strictEqual(M.toCSV([['a;b']]), '"a;b"');
});

test('toCSV: null/undefined -> celda vacía', () => {
  assert.strictEqual(M.toCSV([[null, undefined, 0]]), ',,0');
});

// ─────────────────────────────────────────────────────────────────────────────
// svgLine
// ─────────────────────────────────────────────────────────────────────────────

test('svgLine: serie con datos -> string SVG con una polilínea y un <title> por punto', () => {
  const svg = M.svgLine(
    [{ label: 'a', value: 100 }, { label: 'b', value: 0 }, { label: 'c', value: 250 }],
    { fmt: String }
  );
  assert.strictEqual(typeof svg, 'string');
  assert.ok(svg.indexOf('<svg') !== -1);
  assert.strictEqual((svg.match(/<polyline/g) || []).length, 1);
  assert.strictEqual((svg.match(/<title>/g) || []).length, 3);
  assert.ok(svg.indexOf('NaN') === -1);
});

test('svgLine: serie vacía -> string con "Sin datos", no lanza', () => {
  let svg;
  assert.doesNotThrow(() => { svg = M.svgLine([], { fmt: String }); });
  assert.ok(svg.indexOf('Sin datos') !== -1);
});

test('svgLine: serie toda en cero -> sin NaN en coordenadas', () => {
  const svg = M.svgLine([{ label: 'a', value: 0 }, { label: 'b', value: 0 }], { fmt: String });
  assert.ok(svg.indexOf('NaN') === -1);
});

// ═══════════ P2: asistencia real, cobertura e ingreso ═══════════
const P = { from: '2026-09-01', to: '2026-09-30', today: '2026-09-15' };
const at = (over) => Object.assign({
  date: '2026-09-10', time: '10:00', price: 10000, dur: 45,
  svcId: 'corte', svcName: 'Corte', barberId: 'v', barberName: 'Victoria', email: 'a@a.cl',
}, over);
const periodo = (bks) => M.mFilterPeriod(bks, { from: P.from, to: P.to, mode: 'agendado', today: P.today });
const periodoAll = (bks) => M.mFilterPeriodAll(bks, { from: P.from, to: P.to, mode: 'agendado', today: P.today });

test('median: muestra impar toma el central', () => {
  assert.strictEqual(M.median([50, 10, 30]), 30);
});

test('median: muestra par promedia los dos centrales', () => {
  assert.strictEqual(M.median([10, 20, 30, 40]), 25);
});

test('median: lista vacía o basura devuelve null', () => {
  assert.strictEqual(M.median([]), null);
  assert.strictEqual(M.median(null), null);
  assert.strictEqual(M.median(undefined), null);
});

// La mediana existe justamente para esto (PDF §2): una atención de 4 horas
// no debe arrastrar la recomendación de todo el servicio.
test('median resiste un valor atípico que sí movería el promedio', () => {
  const v = [40, 45, 50, 45, 240];
  const prom = v.reduce((a, b) => a + b, 0) / v.length;
  assert.strictEqual(M.median(v), 45);
  assert.ok(prom > 80, 'el promedio sí se dispara');
});

test('mFilterPeriodAll conserva cancelled y declined que mFilterPeriod descarta', () => {
  const bks = [
    at({ status: 'completed' }), at({ status: 'cancelled' }),
    at({ status: 'declined' }), at({ status: 'no_show' }),
  ];
  assert.strictEqual(periodo(bks).length, 2, 'completed + no_show');
  assert.strictEqual(periodoAll(bks).length, 4);
});

test('mFilterPeriodAll respeta los mismos límites de fecha', () => {
  const bks = [at({ date: '2026-08-31' }), at({ date: '2026-09-01' }), at({ date: '2026-10-01' })];
  assert.strictEqual(periodoAll(bks).length, 1);
});

test('mAttendance cuenta cada estado por separado', () => {
  const a = M.mAttendance(periodoAll([
    at({ status: 'completed' }), at({ status: 'completed' }), at({ status: 'completed' }),
    at({ status: 'no_show' }),
    at({ status: 'cancelled' }),
    at({ status: 'declined' }),
    at({ status: 'confirmed' }),
  ]));
  assert.strictEqual(a.atendidas, 3);
  assert.strictEqual(a.noShow, 1);
  assert.strictEqual(a.canceladas, 1);
  assert.strictEqual(a.declinadas, 1);
  assert.strictEqual(a.sinMarcar, 1);
  assert.ok(Math.abs(a.asistenciaPct - 0.75) < 1e-9, 'atendidas / (atendidas+noShow)');
  assert.ok(Math.abs(a.noShowPct - 0.25) < 1e-9);
});

// El caso del día 1: nadie usó la PWA todavía. No puede dar NaN ni 0%,
// que se leería como "nadie asiste".
test('mAttendance sin ninguna marca: porcentajes null, nunca NaN ni 0', () => {
  const a = M.mAttendance(periodoAll([at({ status: 'pending' }), at({ status: 'confirmed' })]));
  assert.strictEqual(a.atendidas, 0);
  assert.strictEqual(a.sinMarcar, 2);
  assert.strictEqual(a.asistenciaPct, null);
  assert.strictEqual(a.noShowPct, null);
});

test('mAttendance: arrived e in_service todavía no son asistencia cerrada', () => {
  const a = M.mAttendance(periodoAll([at({ status: 'arrived' }), at({ status: 'in_service' })]));
  assert.strictEqual(a.atendidas, 0);
  assert.strictEqual(a.sinMarcar, 2);
});

test('mAttendanceCoverage: 0, parcial y total', () => {
  assert.strictEqual(M.mAttendanceCoverage(periodo([at({ status: 'pending' })])).pct, 0);
  const parcial = M.mAttendanceCoverage(periodo([
    at({ status: 'completed' }), at({ status: 'no_show' }),
    at({ status: 'pending' }), at({ status: 'confirmed' }),
  ]));
  assert.strictEqual(parcial.medidas, 2);
  assert.strictEqual(parcial.total, 4);
  assert.ok(Math.abs(parcial.pct - 0.5) < 1e-9);
  assert.strictEqual(M.mAttendanceCoverage([]).pct, 0, 'período vacío no divide por cero');
});

test('mRevenue excluye no_show, pero mFilterPeriod sí lo conserva como reserva', () => {
  const bks = [at({ status: 'completed', price: 10000 }), at({ status: 'no_show', price: 10000 })];
  const p = periodo(bks);
  assert.strictEqual(p.length, 2, 'las dos siguen siendo demanda');
  assert.strictEqual(M.mRevenue(p), 10000, 'pero solo una generó ingreso');
});

test('mRevenue con período vacío devuelve 0', () => {
  assert.strictEqual(M.mRevenue([]), 0);
});

// ═══════════ P2: tiempo real, desviación y precio equivalente ═══════════
const done = (over) => at(Object.assign({ status: 'completed', actualDur: 50, durSource: 'timer' }, over));

test('mRealTime usa la MEDIANA, no el promedio', () => {
  // 45,45,50,50,240 -> mediana 50, promedio 86
  const r = M.mRealTime(periodo([
    done({ actualDur: 45 }), done({ actualDur: 45 }), done({ actualDur: 50 }),
    done({ actualDur: 50 }), done({ actualDur: 240 }),
  ]), { groupBy: 'svc' });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].medianMin, 50);
  assert.strictEqual(r[0].n, 5);
});

test('mRealTime calcula la desviación contra lo planificado', () => {
  const r = M.mRealTime(periodo([done({ dur: 45, actualDur: 53 }), done({ dur: 45, actualDur: 53 })]), { groupBy: 'svc' });
  // (53 - 45) / 45 = 0.1777...
  assert.ok(Math.abs(r[0].deviationPct - 8 / 45) < 1e-9, String(r[0].deviationPct));
  assert.strictEqual(r[0].planMin, 45);
});

test('mRealTime: solo entran las completed con actualDur > 0', () => {
  const r = M.mRealTime(periodo([
    done({ actualDur: 50 }),
    at({ status: 'completed', actualDur: 0 }),
    at({ status: 'completed' }),
    at({ status: 'no_show' }),
    at({ status: 'pending' }),
  ]), { groupBy: 'svc' });
  assert.strictEqual(r[0].n, 1);
});

test('mRealTime: servicio sin ninguna atención cerrada no aparece', () => {
  const r = M.mRealTime(periodo([at({ svcId: 'barba', svcName: 'Barba', status: 'pending' })]), { groupBy: 'svc' });
  assert.deepStrictEqual(r, []);
});

test('mRealTime: plan 0 -> deviationPct null, sin división por cero', () => {
  const r = M.mRealTime(periodo([done({ dur: 0, actualDur: 50 }), done({ dur: 0, actualDur: 50 })]), { groupBy: 'svc' });
  assert.strictEqual(r[0].deviationPct, null);
  assert.ok(Number.isFinite(r[0].ingresoHoraReal));
});

// Excluirlas sesgaría hacia las atenciones que el barbero cerró a tiempo,
// que son justo las más cortas. Se cuentan aparte, no se descartan.
test('mRealTime cuenta las cerradas a mano pero NO las excluye de la mediana', () => {
  const r = M.mRealTime(periodo([
    done({ actualDur: 40 }), done({ actualDur: 60, durSource: 'manual' }), done({ actualDur: 50 }),
  ]), { groupBy: 'svc' });
  assert.strictEqual(r[0].n, 3);
  assert.strictEqual(r[0].nManual, 1);
  assert.strictEqual(r[0].medianMin, 50);
});

test('mRealTime: ingreso por hora real usa la mediana', () => {
  const r = M.mRealTime(periodo([done({ price: 18000, actualDur: 60 }), done({ price: 18000, actualDur: 60 })]), { groupBy: 'svc' });
  assert.strictEqual(r[0].ingresoHoraReal, 18000);
});

test('mRealTime ordena por cantidad de atenciones medidas, desc', () => {
  const r = M.mRealTime(periodo([
    done({ svcId: 'a', svcName: 'A' }),
    done({ svcId: 'b', svcName: 'B' }), done({ svcId: 'b', svcName: 'B' }),
  ]), { groupBy: 'svc' });
  assert.deepStrictEqual(r.map(x => x.key), ['b', 'a']);
});

// El ejemplo del PDF §5: $18.000 / 45 min planificados, mediana real 53 min.
// Productividad esperada $24.000/h, real ~$20.377/h, equivalente ~$21.200,
// y el rango comercial que muestra es $20.000-$22.000.
test('mPriceSim reproduce el ejemplo del PDF', () => {
  const row = { n: 32, planMin: 45, medianMin: 53, price: 18000 };
  const sim = M.mPriceSim(row);
  assert.strictEqual(sim.objetivoHora, 24000);
  assert.ok(Math.abs(sim.equivalente - 21200) < 60, String(sim.equivalente));
  assert.ok(sim.rango[0] < sim.equivalente && sim.equivalente < sim.rango[1], JSON.stringify(sim.rango));
  assert.strictEqual(sim.rango[0] % 100, 0, 'redondeado a la centena');
  assert.strictEqual(sim.rango[1] % 100, 0);
});

// PDF §6: bajo 20 atenciones medidas no se recomienda precio.
test('mPriceSim devuelve null bajo la muestra mínima', () => {
  assert.strictEqual(M.mPriceSim({ n: 19, planMin: 45, medianMin: 53, price: 18000 }), null);
  assert.ok(M.mPriceSim({ n: 20, planMin: 45, medianMin: 53, price: 18000 }));
});

test('mPriceSim devuelve null sin datos utilizables', () => {
  assert.strictEqual(M.mPriceSim({ n: 30, planMin: 0, medianMin: 53, price: 18000 }), null);
  assert.strictEqual(M.mPriceSim({ n: 30, planMin: 45, medianMin: null, price: 18000 }), null);
  assert.strictEqual(M.mPriceSim(null), null);
});
