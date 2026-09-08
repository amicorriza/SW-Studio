// Prueba end-to-end de los callables de la medición de la atención real,
// contra el EMULADOR real (Auth + Firestore + Functions). A diferencia de
// tests/browser/*, acá no hay ningún stub: se pide un ID token de verdad al
// emulador de Auth y se invocan las funciones por HTTP.
//
// Requiere el emulador corriendo y los datos sembrados:
//   firebase emulators:start --project scissor-white
//   cd seed && FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=scissor-white npm run seed
//   cd functions && node scripts/seedEmulatorE2E.mjs
//
// Uso: node tests/e2e/callables.mjs
import { makeChecker, token, call, getDoc, FS } from './emulator.mjs';

const check = makeChecker();

const tVic = await token('victoria@scissorwhite.cl', 'barbero123');
const tEst = await token('esteban@scissorwhite.cl', 'barbero123');
const tAdm = await token('admin@scissorwhite.cl', 'admin123');

// Que la lectura directa de `bookings` exija admin es parte del contrato.
const sinAuth = await fetch(`${FS}/bookings/E2E-PROX`);
check('leer bookings directo sin sesión da 403 (firestore.rules)', sinAuth.status === 403, sinAuth.status);

// ═══════════════════ getMyDay ═══════════════════
const dia = await call('getMyDay', {}, tVic);
check('getMyDay responde 200', dia.status === 200, { status: dia.status, error: dia.error });
const ag = (dia.result && dia.result.bookings) || [];
check('getMyDay devuelve la agenda de Victoria', ag.length >= 3, ag.length);
check('getMyDay identifica al profesional', dia.result && dia.result.staffId === 'victoria', dia.result && dia.result.staffId);
check('getMyDay resuelve la zona del negocio', dia.result && dia.result.tz === 'America/Santiago', dia.result && dia.result.tz);
check('getMyDay solo trae citas de Victoria',
  ag.length > 0 && ag.every(b => ['E2E-PROX', 'E2E-AHORA', 'E2E-LIBRE'].includes(b.code)),
  ag.map(b => b.code));
check('getMyDay ordena por hora', JSON.stringify(ag.map(b => b.time)) === JSON.stringify(ag.map(b => b.time).slice().sort()), ag.map(b => b.time));
// No debe filtrar PII de más, pero tampoco devolver el documento entero.
check('getMyDay no expone reminderToken ni tz por reserva',
  ag.every(b => !('reminderToken' in b) && !('phone' in b)), Object.keys(ag[0] || {}));

const sinSesion = await call('getMyDay', {}, null);
check('getMyDay rechaza sin sesión', sinSesion.error && /unauthenticated/i.test(JSON.stringify(sinSesion.error)), sinSesion.error);

const tSinFicha = await token('admin@scissorwhite.cl', 'admin123');
const noStaff = await call('getMyDay', {}, tSinFicha);
check('getMyDay rechaza a una cuenta sin ficha de staff (el admin no es barbero)',
  noStaff.error && /permission[-_]denied/i.test(JSON.stringify(noStaff.error)), noStaff.error);

// ═══════════════════ markAttendance: ciclo completo ═══════════════════
const ID = 'E2E-PROX';

const r1 = await call('markAttendance', { bookingId: ID, action: 'arrive' }, tVic);
check('markAttendance arrive responde ok', r1.result && r1.result.ok === true, r1.error || r1.result);
check('arrive deja status arrived', r1.result && r1.result.status === 'arrived', r1.result);
let d = await getDoc('bookings/' + ID, tAdm);
check('arrivedAt lo escribió el servidor', !!d.arrivedAt && !Number.isNaN(Date.parse(d.arrivedAt)), d.arrivedAt);
check('attendanceBy registra quién marcó', d.attendanceBy === 'victoria', d.attendanceBy);

// Idempotencia: repetir la misma acción no debe pisar la hora original.
const arrivedAt0 = d.arrivedAt;
const r1b = await call('markAttendance', { bookingId: ID, action: 'arrive' }, tVic);
check('repetir arrive devuelve already:true', r1b.result && r1b.result.already === true, r1b.result);
d = await getDoc('bookings/' + ID, tAdm);
check('repetir arrive NO pisa arrivedAt', d.arrivedAt === arrivedAt0, { antes: arrivedAt0, despues: d.arrivedAt });

const r2 = await call('markAttendance', { bookingId: ID, action: 'start' }, tVic);
check('start deja status in_service', r2.result && r2.result.status === 'in_service', r2.result);
d = await getDoc('bookings/' + ID, tAdm);
check('start escribe startedAt', !!d.startedAt, d.startedAt);
check('start NO pisa el arrivedAt anterior', d.arrivedAt === arrivedAt0, d.arrivedAt);

const r3 = await call('markAttendance', { bookingId: ID, action: 'snooze' }, tVic);
check('snooze responde ok sin cambiar el estado', r3.result && r3.result.ok && r3.result.status === 'in_service', r3.result);
d = await getDoc('bookings/' + ID, tAdm);
check('snooze escribe snoozeUntil ~10 min adelante',
  d.snoozeUntil && Math.abs(Date.parse(d.snoozeUntil) - Date.now() - 600000) < 90000, d.snoozeUntil);
check('snooze no toca nudgeEndCount', d.nudgeEndCount === undefined, d.nudgeEndCount);

const r4 = await call('markAttendance', { bookingId: ID, action: 'end' }, tVic);
check('end deja status completed', r4.result && r4.result.status === 'completed', r4.result);
check('end devuelve la duración real', r4.result && Number.isFinite(r4.result.actualDur), r4.result);
d = await getDoc('bookings/' + ID, tAdm);
check('end escribe endedAt, actualDur y durSource timer',
  !!d.endedAt && Number.isFinite(d.actualDur) && d.durSource === 'timer',
  { endedAt: d.endedAt, actualDur: d.actualDur, durSource: d.durSource });

// Transición inválida sobre una cita ya cerrada.
const inval = await call('markAttendance', { bookingId: ID, action: 'start' }, tVic);
check('no se puede reiniciar una atención completada', inval.result && inval.result.already === true, inval.result || inval.error);

// ═══════════════════ markAttendance: permisos ═══════════════════
const ajena = await call('markAttendance', { bookingId: 'E2E-H1', action: 'arrive' }, tVic);
check('un barbero NO puede marcar la cita de otro',
  ajena.error && /permission[-_]denied/i.test(JSON.stringify(ajena.error)), ajena.error || ajena.result);

const corrige = await call('markAttendance', { bookingId: 'E2E-AHORA', action: 'end', at: new Date().toISOString() }, tVic);
check('un barbero NO puede corregir una hora a mano',
  corrige.error && /permission[-_]denied/i.test(JSON.stringify(corrige.error)), corrige.error || corrige.result);

const mala = await call('markAttendance', { bookingId: ID, action: 'inventada' }, tVic);
check('una acción inexistente se rechaza', mala.error && /invalid[-_]argument/i.test(JSON.stringify(mala.error)), mala.error);

const noExiste = await call('markAttendance', { bookingId: 'NO-EXISTE', action: 'arrive' }, tVic);
check('una cita inexistente devuelve not-found', noExiste.error && /not[-_]found/i.test(JSON.stringify(noExiste.error)), noExiste.error);

// El admin sí puede sobre cualquier cita, y sí puede corregir.
const admStart = await call('markAttendance', { bookingId: 'E2E-AHORA', action: 'start' }, tAdm);
check('el admin puede marcar cualquier cita', admStart.result && admStart.result.status === 'in_service', admStart.error || admStart.result);
const hace30 = new Date(Date.now() - 30 * 60000).toISOString();
const admEnd = await call('markAttendance', { bookingId: 'E2E-AHORA', action: 'end', at: hace30, reason: 'olvidé cerrar' }, tAdm);
check('el admin puede cerrar corrigiendo la hora', admEnd.result && admEnd.result.ok, admEnd.error || admEnd.result);
d = await getDoc('bookings/' + 'E2E-AHORA', tAdm);
check('la corrección queda marcada como manual', d.durSource === 'manual', d.durSource);
check('la corrección deja rastro en attendanceAudit', Array.isArray(d.attendanceAudit) && d.attendanceAudit.length === 1, d.attendanceAudit);

// Cancelar conserva el documento (el cambio de comportamiento de P1).
const canc = await call('markAttendance', { bookingId: 'E2E-LIBRE', action: 'cancel' }, tAdm);
check('cancelar responde ok', canc.result && canc.result.status === 'cancelled', canc.error || canc.result);
d = await getDoc('bookings/' + 'E2E-LIBRE', tAdm);
check('la cita cancelada SIGUE existiendo', d !== null && d.status === 'cancelled', d && d.status);
check('cancelar escribe cancelledAt', !!(d && d.cancelledAt), d && d.cancelledAt);

// ═══════════════════ linkStaffAccount ═══════════════════
const linkNoAdm = await call('linkStaffAccount', { staffId: 'ariel', email: 'esteban@scissorwhite.cl' }, tVic);
check('linkStaffAccount es admin-only',
  linkNoAdm.error && /permission[-_]denied/i.test(JSON.stringify(linkNoAdm.error)), linkNoAdm.error);

const linkDup = await call('linkStaffAccount', { staffId: 'ariel', email: 'esteban@scissorwhite.cl' }, tAdm);
check('linkStaffAccount rechaza vincular un UID ya usado por otra ficha',
  linkDup.error && /already[-_]exists/i.test(JSON.stringify(linkDup.error)), linkDup.error || linkDup.result);

const linkNoUser = await call('linkStaffAccount', { staffId: 'ariel', email: 'nadie@e2e.cl' }, tAdm);
check('linkStaffAccount avisa si la cuenta no existe en Auth',
  linkNoUser.error && /not[-_]found/i.test(JSON.stringify(linkNoUser.error)), linkNoUser.error);

// ═══════════════════ getMyRange ═══════════════════
const hoyK = new Date().toISOString().slice(0, 10);
const clave = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const rango = await call('getMyRange', { from: clave(30), to: hoyK }, tVic);
check('getMyRange responde 200', rango.status === 200, { status: rango.status, error: rango.error });
const rb = (rango.result && rango.result.bookings) || [];
check('getMyRange trae el historial del rango', rb.length >= 15, rb.length);
check('getMyRange SOLO trae citas de Victoria',
  rb.length > 0 && rb.every(b => !b.code.startsWith('E2E-H') || Number(b.code.slice(5)) % 2 === 0),
  rb.filter(b => b.code.startsWith('E2E-H') && Number(b.code.slice(5)) % 2 === 1).map(b => b.code));

// La proyección es una lista blanca. Si alguien agrega un campo a bookings,
// esto lo atrapa antes de que llegue al teléfono de nadie.
check('getMyRange NO devuelve correo ni teléfono',
  rb.every(b => !('email' in b) && !('phone' in b) && !('reminderToken' in b)),
  Object.keys(rb[0] || {}));
// metrics.js necesita estos dos, y la agenda del día no los manda.
check('getMyRange sí devuelve date y svcId, que es lo que metrics.js consume',
  rb.every(b => typeof b.date === 'string' && b.date.length === 10 && 'svcId' in b),
  rb[0]);
check('getMyRange ordena por fecha y hora',
  JSON.stringify(rb.map(b => b.date + ' ' + b.time)) ===
  JSON.stringify(rb.map(b => b.date + ' ' + b.time).slice().sort()));

const rangoLargo = await call('getMyRange', { from: clave(400), to: hoyK }, tVic);
check('getMyRange rechaza un rango mayor a 92 días',
  rangoLargo.error && /invalid[-_]argument/i.test(JSON.stringify(rangoLargo.error)), rangoLargo.error);
const rangoAlReves = await call('getMyRange', { from: hoyK, to: clave(10) }, tVic);
check('getMyRange rechaza un rango al revés',
  rangoAlReves.error && /invalid[-_]argument/i.test(JSON.stringify(rangoAlReves.error)), rangoAlReves.error);
const rangoSinFechas = await call('getMyRange', {}, tVic);
check('getMyRange exige las fechas',
  rangoSinFechas.error && /invalid[-_]argument/i.test(JSON.stringify(rangoSinFechas.error)), rangoSinFechas.error);
const rangoSinSesion = await call('getMyRange', { from: clave(7), to: hoyK }, null);
check('getMyRange rechaza sin sesión',
  rangoSinSesion.error && /unauthenticated/i.test(JSON.stringify(rangoSinSesion.error)), rangoSinSesion.error);

// El aislamiento por barbero: Esteban pide el mismo rango y recibe LO SUYO.
const rangoEst = await call('getMyRange', { from: clave(30), to: hoyK }, tEst);
const reb = (rangoEst.result && rangoEst.result.bookings) || [];
check('cada barbero recibe su propio rango, no el del otro',
  reb.length > 0 && !reb.some(b => rb.some(x => x.id === b.id)),
  { victoria: rb.length, esteban: reb.length });

// ═══════════════════ getMyClients ═══════════════════
const cli = await call('getMyClients', {}, tVic);
check('getMyClients responde 200', cli.status === 200, { status: cli.status, error: cli.error });
const lista = (cli.result && cli.result.clients) || [];
check('getMyClients agrupa el historial en clientes', lista.length >= 5, lista.length);

// Lo que define esta vista: el barbero ve a quién atendió, no cómo contactarlo.
const crudo = JSON.stringify(lista);
check('getMyClients NO expone ningún correo', !crudo.includes('@e2e.cl'), crudo.slice(0, 200));
check('getMyClients NO expone teléfonos', !crudo.includes('+569'));
check('cada cliente trae una clave opaca, no el correo',
  lista.every(c => /^[0-9a-f]{12}$/.test(c.key) || c.key.startsWith('n:')),
  lista.map(c => c.key));
check('cada cliente trae visitas, última visita y servicio',
  lista.every(c => Number.isFinite(c.visits) && c.visits > 0 && typeof c.lastVisit === 'string'),
  lista[0]);
check('getMyClients ordena por última visita, de más reciente a más antigua',
  JSON.stringify(lista.map(c => c.lastVisit)) ===
  JSON.stringify(lista.map(c => c.lastVisit).slice().sort().reverse()),
  lista.map(c => c.lastVisit));

// Las que no ocurrieron no son historial de nadie.
check('los no_show y cancelados NO cuentan como clientes atendidos',
  !lista.some(c => /No vino|Canceló/.test(c.name)), lista.map(c => c.name));

const cliEst = await call('getMyClients', {}, tEst);
const listaEst = (cliEst.result && cliEst.result.clients) || [];
check('los clientes de Esteban son otros, no los de Victoria',
  listaEst.length > 0 && listaEst.reduce((t, c) => t + c.visits, 0) !== lista.reduce((t, c) => t + c.visits, 0),
  { victoria: lista.reduce((t, c) => t + c.visits, 0), esteban: listaEst.reduce((t, c) => t + c.visits, 0) });

const cliSinSesion = await call('getMyClients', {}, null);
check('getMyClients rechaza sin sesión',
  cliSinSesion.error && /unauthenticated/i.test(JSON.stringify(cliSinSesion.error)), cliSinSesion.error);

// ═══════════════════ horario en getMyDay ═══════════════════
check('getMyDay devuelve el horario del profesional, para la sección Horario',
  Array.isArray(dia.result && dia.result.schedule), dia.result && dia.result.schedule);

check.done();
