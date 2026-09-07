// Prueba end-to-end de la función programada de avisos, contra el emulador.
//
// Lo que SÍ se verifica acá:
//  - el interruptor businessInfo.nudgesEnabled corta antes de tocar bookings
//  - computeNudges selecciona las reservas correctas sobre datos REALES de
//    Firestore, con el `date`/`time`/`tz` tal como los escribe el seed
//  - un token muerto no aborta la corrida, no deja marcadores de dedupe, y se
//    purga del dispositivo
//
// Lo que NO se puede verificar acá: la ENTREGA del push. No existe emulador
// de FCM, así que el envío siempre falla localmente. Eso queda para un
// teléfono real contra staging.
//
// Uso (emulador corriendo y sembrado): node tests/e2e/nudges.mjs
import { makeChecker, token, getDoc, listDocs, patchDoc, triggerSchedule, sleep } from './emulator.mjs';
import { computeNudges } from '../../functions/shared/attendance.js';
import { resolveNudgeLeadMin, resolveBusinessTz, dateKeyInZone } from '../../functions/shared/timezone.js';
import { dayBoundsOf } from '../../functions/shared/availability.js';

const check = makeChecker();
const adm = await token('admin@scissorwhite.cl', 'admin123');

// ── 1. Selección de avisos sobre datos reales ──
// Se replica la misma ventana que consulta el scheduler y se corre
// computeNudges sobre lo que Firestore devuelve de verdad.
const info = await getDoc('businessInfo/main', adm);
const tz = resolveBusinessTz(info);
const leadMin = resolveNudgeLeadMin(info);
const now = new Date();
const todayKey = dateKeyInZone(now, tz);
const yesterdayKey = dateKeyInZone(new Date(now.getTime() - 86400000), tz);
const { end } = dayBoundsOf(todayKey);

const todas = await listDocs('bookings', adm);
const bookings = todas.filter((b) => {
  const d = String(b.date || '');
  return d >= yesterdayKey && d < end;
});
const nudges = computeNudges(bookings, now, { leadMin, tz });

console.log(`   (${bookings.length} reservas en la ventana, lead ${leadMin} min, tz ${tz})`);
nudges.forEach((n) => console.log(`   → [${n.kind}] ${n.barberId}: ${n.body}`));

check('la ventana del scheduler trae las citas de hoy', bookings.length >= 3, bookings.length);
const prox = nudges.find((n) => n.bookingId === 'E2E-PROX');
check('la cita a ~8 min genera el aviso "se acerca la hora"', prox && prox.kind === 'upcoming', prox);
check('el aviso nombra al cliente y su hora',
  prox && /Ana Próxima/.test(prox.body) && /\d{2}:\d{2}/.test(prox.body), prox && prox.body);
const ahora = nudges.find((n) => n.bookingId === 'E2E-AHORA');
check('la cita cuya hora ya pasó genera "¿deseas comenzar?"', ahora && ahora.kind === 'start', ahora);
check('la cita de dentro de 2 horas todavía no genera nada',
  !nudges.some((n) => n.bookingId === 'E2E-LIBRE'), nudges.map((n) => n.bookingId));
check('las atenciones ya completadas no generan avisos',
  !nudges.some((n) => String(n.bookingId).startsWith('E2E-H')), nudges.map((n) => n.bookingId));
check('cada reserva produce a lo sumo un aviso',
  new Set(nudges.map((n) => n.bookingId)).size === nudges.length, nudges.map((n) => n.bookingId));
check('el enlace profundo del aviso apunta a la cita correcta',
  prox && prox.data.b === 'E2E-PROX', prox && prox.data);

// ── 2. El interruptor corta antes de tocar bookings ──
await patchDoc('businessInfo/main', { nudgesEnabled: false }, adm);
await triggerSchedule('staffAttendanceNudges');
await sleep(2500);
let d = await getDoc('bookings/E2E-PROX', adm);
check('con nudgesEnabled:false no se escribe ningún marcador', !d.nudgeUpcomingAt, d.nudgeUpcomingAt);

// ── 3. Con un token muerto: falla el envío, no la corrida ──
await patchDoc('businessInfo/main', { nudgesEnabled: true }, adm);
const vic = await getDoc('staff/victoria', adm);

// El token lo escribe SU PROPIO dispositivo, no el admin: la regla de
// staffDevices/{uid} exige request.auth.uid == uid. Que el admin no pueda es
// lo correcto, y se verifica explícitamente.
const tVic = await token('victoria@scissorwhite.cl', 'barbero123');
let negado = false;
try {
  await patchDoc('staffDevices/' + vic.uid, { tokens: ['intruso'] }, adm);
} catch (e) { negado = /403/.test(String(e.message)); }
check('ni el admin puede escribir el dispositivo de un barbero', negado, negado);

await patchDoc('staffDevices/' + vic.uid,
  { tokens: ['token-falso-para-la-prueba'], updatedAt: new Date().toISOString() }, tVic);

const res = await triggerSchedule('staffAttendanceNudges');
await sleep(4000);
check('la corrida termina en 200 aunque el envío falle', res.status === 200, res.status);

d = await getDoc('bookings/E2E-PROX', adm);
// successCount es 0, así que la reserva NO debe quedar marcada como avisada:
// sigue siendo candidata en la corrida siguiente. Mismo criterio de reintento
// que usa el recordatorio de citas.
check('un envío fallido NO marca la reserva como avisada', !d.nudgeUpcomingAt, d.nudgeUpcomingAt);

const dev = await getDoc('staffDevices/' + vic.uid, tVic);
check('el token rechazado por FCM se purga del dispositivo',
  !dev.tokens || dev.tokens.length === 0, dev.tokens);

const post = (await listDocs('bookings', adm)).filter((b) => String(b.date || '').startsWith(todayKey));
check('ninguna cita del día quedó con marcadores inconsistentes',
  post.every((b) => !b.nudgeUpcomingAt && !b.nudgeStartAt),
  post.map((b) => b._docId + ':' + (b.nudgeUpcomingAt || '-')));

check.done(
  'NOTA: la ENTREGA del push no se puede probar acá (no hay emulador de FCM).\n' +
  '      Eso queda para un teléfono real contra staging.'
);
