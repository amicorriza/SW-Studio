'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { canTransition, applyAction, computeNudges } = require('../shared/attendance.js');

const NOW = new Date('2026-09-07T18:30:00.000Z');

test('canTransition: el ciclo feliz completo', () => {
  assert.ok(canTransition('pending', 'arrive'));
  assert.ok(canTransition('confirmed', 'arrive'));
  assert.ok(canTransition('arrived', 'start'));
  assert.ok(canTransition('in_service', 'end'));
});

// El flujo que pidió el usuario va de la notificación "¿Deseas comenzar la
// atención?" directo a iniciar. Obligar a marcar Llegó primero agregaría un
// toque que el PDF pide evitar explícitamente (§3).
test('canTransition: atajo pending/confirmed -> start sin marcar Llegó', () => {
  assert.ok(canTransition('pending', 'start'));
  assert.ok(canTransition('confirmed', 'start'));
});

test('canTransition: transiciones inválidas', () => {
  assert.ok(!canTransition('completed', 'start'));
  assert.ok(!canTransition('no_show', 'end'));
  assert.ok(!canTransition('declined', 'arrive'));
  assert.ok(!canTransition('pending', 'end'), 'no se puede finalizar lo que no empezó');
  assert.ok(!canTransition('cancelled', 'arrive'));
  assert.ok(!canTransition('pending', 'inventada'));
});

test('applyAction arrive: setea status y arrivedAt del servidor', () => {
  const p = applyAction({ status: 'confirmed' }, 'arrive', NOW, { by: 'victoria' });
  assert.strictEqual(p.status, 'arrived');
  assert.strictEqual(p.arrivedAt, NOW.toISOString());
  assert.strictEqual(p.attendanceBy, 'victoria');
});

test('applyAction start desde confirmed: setea arrivedAt igual a startedAt', () => {
  const p = applyAction({ status: 'confirmed' }, 'start', NOW, { by: 'victoria' });
  assert.strictEqual(p.status, 'in_service');
  assert.strictEqual(p.startedAt, NOW.toISOString());
  assert.strictEqual(p.arrivedAt, NOW.toISOString());
});

test('applyAction start desde arrived: NO pisa el arrivedAt original', () => {
  const b = { status: 'arrived', arrivedAt: '2026-09-07T18:00:00.000Z' };
  const p = applyAction(b, 'start', NOW, {});
  assert.strictEqual(p.startedAt, NOW.toISOString());
  assert.strictEqual(p.arrivedAt, undefined, 'no debe incluir arrivedAt en el parche');
});

test('applyAction end: calcula actualDur en minutos y durSource timer', () => {
  const b = { status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z' };
  const p = applyAction(b, 'end', NOW, {});
  assert.strictEqual(p.status, 'completed');
  assert.strictEqual(p.endedAt, NOW.toISOString());
  assert.strictEqual(p.actualDur, 30);
  assert.strictEqual(p.durSource, 'timer');
});

test('applyAction end con corrección: durSource manual + auditoría del original', () => {
  const b = { status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z' };
  const p = applyAction(b, 'end', NOW, { atISO: '2026-09-07T18:45:00.000Z', reason: 'olvidé cerrar', by: 'victoria' });
  assert.strictEqual(p.endedAt, '2026-09-07T18:45:00.000Z');
  assert.strictEqual(p.actualDur, 45);
  assert.strictEqual(p.durSource, 'manual');
  assert.strictEqual(p.attendanceAudit.length, 1);
  assert.strictEqual(p.attendanceAudit[0].field, 'endedAt');
  assert.strictEqual(p.attendanceAudit[0].to, '2026-09-07T18:45:00.000Z');
  assert.strictEqual(p.attendanceAudit[0].reason, 'olvidé cerrar');
});

test('applyAction end con corrección: conserva la auditoría previa', () => {
  const b = {
    status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z',
    attendanceAudit: [{ at: 'x', field: 'startedAt', from: null, to: 'y', by: 'admin', reason: null }],
  };
  const p = applyAction(b, 'end', NOW, { atISO: '2026-09-07T18:45:00.000Z' });
  assert.strictEqual(p.attendanceAudit.length, 2);
  assert.strictEqual(p.attendanceAudit[0].field, 'startedAt');
});

test('applyAction end nunca produce actualDur negativa', () => {
  const b = { status: 'in_service', startedAt: '2026-09-07T19:00:00.000Z' };
  const p = applyAction(b, 'end', NOW, {});
  assert.strictEqual(p.actualDur, 0);
});

// Posponer solo mueve la hora del próximo aviso. El contador de insistencia
// lo lleva el scheduler al ENVIAR (una sola fuente de verdad): si lo tocaran
// los dos, cada ciclo gastaría dos del tope y la app dejaría de avisar a la
// mitad de tiempo del previsto.
test('applyAction snooze: corre snoozeUntil y no toca el contador ni el estado', () => {
  const b = { status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z', nudgeEndCount: 2 };
  const p = applyAction(b, 'snooze', NOW, { snoozeMs: 10 * 60 * 1000 });
  assert.strictEqual(p.snoozeUntil, '2026-09-07T18:40:00.000Z');
  assert.strictEqual(p.nudgeEndCount, undefined);
  assert.strictEqual(p.status, undefined);
});

test('applyAction es idempotente: repetir una acción ya aplicada devuelve null', () => {
  assert.strictEqual(applyAction({ status: 'arrived' }, 'arrive', NOW, {}), null);
  assert.strictEqual(applyAction({ status: 'completed' }, 'end', NOW, {}), null);
  assert.strictEqual(applyAction({ status: 'no_show' }, 'no_show', NOW, {}), null);
});

test('applyAction devuelve null ante una transición inválida', () => {
  assert.strictEqual(applyAction({ status: 'completed' }, 'start', NOW, {}), null);
});

test('applyAction cancel y no_show', () => {
  assert.strictEqual(applyAction({ status: 'pending' }, 'cancel', NOW, {}).status, 'cancelled');
  assert.strictEqual(applyAction({ status: 'pending' }, 'cancel', NOW, {}).cancelledAt, NOW.toISOString());
  assert.strictEqual(applyAction({ status: 'arrived' }, 'no_show', NOW, {}).status, 'no_show');
  assert.strictEqual(applyAction({ status: 'arrived' }, 'no_show', NOW, {}).noShowAt, NOW.toISOString());
});

// Una reserva sin `status` es de antes de Fase 2 y se trata como 'pending'.
test('applyAction: una reserva sin status se trata como pending', () => {
  assert.strictEqual(applyAction({}, 'arrive', NOW, {}).status, 'arrived');
});

test('applyAction no lanza con una reserva vacía o basura', () => {
  assert.doesNotThrow(() => applyAction({}, 'start', NOW, {}));
  assert.doesNotThrow(() => applyAction({ status: 'in_service', startedAt: 'no-es-fecha' }, 'end', NOW, {}));
  assert.strictEqual(applyAction({ status: 'in_service', startedAt: 'no-es-fecha' }, 'end', NOW, {}).actualDur, 0);
});

// ═══════════════════════ computeNudges ═══════════════════════
// 2026-09-07 15:00 en America/Santiago = 18:00Z. Se fija el tz en cada
// reserva para no depender de la zona del runner.
const TZ = 'America/Santiago';
const bk = (over) => Object.assign({
  _docId: 'b1', barberId: 'victoria', name: 'Ana', date: '2026-09-07',
  time: '15:00', dur: 45, status: 'confirmed', tz: TZ,
}, over);
const at = (hhmmZ) => new Date(`2026-09-07T${hhmmZ}:00.000Z`);

test('computeNudges: la cita de referencia cae a las 18:00Z', () => {
  const n = computeNudges([bk()], at('18:00'), { tz: TZ });
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].kind, 'start', 'si esto falla, el fixture de zona horaria está mal');
});

test('computeNudges upcoming: dentro de la ventana de anticipación', () => {
  const n = computeNudges([bk()], at('17:52'), { leadMin: 10, tz: TZ });
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].kind, 'upcoming');
  assert.match(n[0].body, /Ana/);
  assert.match(n[0].body, /15:00/);
  assert.strictEqual(n[0].barberId, 'victoria');
  assert.deepStrictEqual(n[0].data, { b: 'b1', a: 'view' });
});

test('computeNudges upcoming: fuera de la ventana no dispara', () => {
  assert.strictEqual(computeNudges([bk()], at('17:30'), { leadMin: 10, tz: TZ }).length, 0);
});

test('computeNudges upcoming: no se repite si ya se envió', () => {
  const b = bk({ nudgeUpcomingAt: '2026-09-07T17:52:00.000Z' });
  assert.strictEqual(computeNudges([b], at('17:55'), { leadMin: 10, tz: TZ }).length, 0);
});

test('computeNudges upcoming: leadMin configurable', () => {
  assert.strictEqual(computeNudges([bk()], at('17:47'), { leadMin: 10, tz: TZ }).length, 0);
  assert.strictEqual(computeNudges([bk()], at('17:47'), { leadMin: 15, tz: TZ }).length, 1);
});

test('computeNudges start: la hora ya pasó y no se ha iniciado', () => {
  const n = computeNudges([bk()], at('18:01'), { leadMin: 10, tz: TZ });
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].kind, 'start');
  assert.strictEqual(n[0].data.a, 'start');
});

test('computeNudges start: no se repite si ya se envió', () => {
  const b = bk({ nudgeStartAt: '2026-09-07T18:01:00.000Z' });
  assert.strictEqual(computeNudges([b], at('18:10'), { tz: TZ }).length, 0);
});

test('computeNudges start: no dispara si ya se marcó no_show', () => {
  const b = bk({ status: 'no_show', noShowAt: '2026-09-07T18:00:00.000Z' });
  assert.strictEqual(computeNudges([b], at('18:05'), { leadMin: 10, tz: TZ }).length, 0);
});

test('computeNudges: una cita completed o cancelled no genera nada', () => {
  assert.strictEqual(computeNudges([bk({ status: 'completed' })], at('18:05'), { tz: TZ }).length, 0);
  assert.strictEqual(computeNudges([bk({ status: 'cancelled' })], at('18:05'), { tz: TZ }).length, 0);
  assert.strictEqual(computeNudges([bk({ status: 'declined' })], at('18:05'), { tz: TZ }).length, 0);
});

test('computeNudges end: al cumplirse la duración planificada', () => {
  const b = bk({ status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z' });
  const n = computeNudges([b], at('18:46'), { tz: TZ });
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].kind, 'end');
  assert.deepStrictEqual(n[0].data, { b: 'b1', a: 'end' });
});

test('computeNudges end: no dispara antes de cumplirse la duración', () => {
  const b = bk({ status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z' });
  assert.strictEqual(computeNudges([b], at('18:30'), { tz: TZ }).length, 0);
});

test('computeNudges end: respeta snoozeUntil y vuelve a disparar al vencer', () => {
  const b = bk({ status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z',
    nudgeEndAt: '2026-09-07T18:45:00.000Z', snoozeUntil: '2026-09-07T18:55:00.000Z', nudgeEndCount: 1 });
  assert.strictEqual(computeNudges([b], at('18:50'), { tz: TZ }).length, 0, 'sigue pospuesto');
  assert.strictEqual(computeNudges([b], at('18:56'), { tz: TZ }).length, 1, 'venció la posposición');
});

test('computeNudges end: deja de insistir al llegar al tope', () => {
  const b = bk({ status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z', nudgeEndCount: 6 });
  assert.strictEqual(computeNudges([b], at('20:00'), { tz: TZ }).length, 0);
});

// Sin esto el aviso de fin se redispararía en CADA corrida del scheduler --
// una vibración cada 2 minutos hasta que el barbero responda. El tope de
// MAX_END_NUDGES no alcanza a protegerlo por sí solo si el barbero
// simplemente ignora la notificación en vez de posponerla.
test('computeNudges end: no se repite en cada corrida, espera SNOOZE_MS', () => {
  const b = bk({ status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z',
    nudgeEndAt: '2026-09-07T18:45:00.000Z', nudgeEndCount: 1 });
  assert.strictEqual(computeNudges([b], at('18:47'), { tz: TZ }).length, 0, 'solo pasaron 2 min');
  assert.strictEqual(computeNudges([b], at('18:56'), { tz: TZ }).length, 1, 'pasaron más de 10 min');
});

test('computeNudges end: una atención ya cerrada no genera nada', () => {
  const b = bk({ status: 'in_service', startedAt: '2026-09-07T18:00:00.000Z', endedAt: '2026-09-07T18:40:00.000Z' });
  assert.strictEqual(computeNudges([b], at('19:00'), { tz: TZ }).length, 0);
});

// El admin escribe reservas SIN tz y con date 'YYYY-MM-DDTHH:mm:00.000Z'
// (public/admin/index.html). Ambas cosas tienen que funcionar.
test('computeNudges: reserva del admin sin tz y con date con sufijo', () => {
  const b = bk({ tz: undefined, date: '2026-09-07T15:00:00.000Z' });
  const n = computeNudges([b], at('17:52'), { leadMin: 10, tz: TZ });
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].kind, 'upcoming');
});

test('computeNudges: una reserva malformada no tumba el resto del lote', () => {
  const mala = bk({ _docId: 'mala', date: 'no-es-fecha', time: null });
  const buena = bk({ _docId: 'buena' });
  let n;
  assert.doesNotThrow(() => { n = computeNudges([mala, buena], at('17:52'), { leadMin: 10, tz: TZ }); });
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].bookingId, 'buena');
});

test('computeNudges: sin _docId o sin barberId se ignora', () => {
  assert.strictEqual(computeNudges([bk({ _docId: undefined })], at('17:52'), { tz: TZ }).length, 0);
  assert.strictEqual(computeNudges([bk({ barberId: '' })], at('17:52'), { tz: TZ }).length, 0);
});

test('computeNudges: lista vacía o nula devuelve []', () => {
  assert.deepStrictEqual(computeNudges([], at('17:52'), { tz: TZ }), []);
  assert.deepStrictEqual(computeNudges(null, at('17:52'), { tz: TZ }), []);
});

// El catch por reserva es correcto -- el lote debe seguir -- pero descartar en
// SILENCIO significa que ese barbero no recibe ningún aviso de esa cita y
// nadie se entera jamás. Estos dos tests fijan que el descarte se reporte.
test('computeNudges: avisa por callback cuál reserva descartó', () => {
  const mala = bk({ _docId: 'mala', date: 'no-es-fecha', time: null });
  const buena = bk({ _docId: 'buena' });
  const saltadas = [];
  const n = computeNudges([mala, buena], at('17:52'), {
    leadMin: 10, tz: TZ, onSkip: (id, err) => saltadas.push([id, err && err.message]),
  });
  assert.strictEqual(n.length, 1);
  assert.strictEqual(saltadas.length, 1);
  assert.strictEqual(saltadas[0][0], 'mala');
  assert.ok(saltadas[0][1], 'el callback recibe el error real, no solo el id');
});

test('computeNudges: sin callback sigue funcionando igual (es opcional)', () => {
  const mala = bk({ _docId: 'mala', date: 'no-es-fecha', time: null });
  assert.doesNotThrow(() => computeNudges([mala], at('17:52'), { leadMin: 10, tz: TZ }));
});