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
import { readFileSync } from 'node:fs';
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
// Contra el manifiesto del seed, no contra un número fijo: las tres citas son
// desplazamientos desde AHORA y cualquiera cruza la medianoche según la hora
// a la que se corra la suite.
const manifiesto = JSON.parse(readFileSync(
  new URL('../../functions/scripts/.e2e-seed.json', import.meta.url), 'utf8'));
const esperadasHoy = ((manifiesto && manifiesto.citas) || [])
  .filter((c) => c.date === (dia.result && dia.result.date)).map((c) => c.code).sort();
check('getMyDay devuelve exactamente las citas que el seed puso en ese día',
  JSON.stringify(ag.map((b) => b.code).sort()) === JSON.stringify(esperadasHoy),
  { recibidas: ag.map((b) => b.code).sort(), esperadas: esperadasHoy });
check('getMyDay identifica al profesional', dia.result && dia.result.staffId === 'victoria', dia.result && dia.result.staffId);
check('getMyDay resuelve la zona del negocio', dia.result && dia.result.tz === 'America/Santiago', dia.result && dia.result.tz);
check('getMyDay solo trae citas de Victoria',
  ag.length > 0 && ag.every(b => ['E2E-PROX', 'E2E-AHORA', 'E2E-LIBRE'].includes(b.code)),
  ag.map(b => b.code));
check('el seed sembró las tres citas del día, aunque alguna caiga en el día siguiente',
  ((manifiesto && manifiesto.citas) || []).length === 3, manifiesto);
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

// ═══════════════════ adminSaveBooking ═══════════════════
// Cierra la brecha que el panel tenía abierta: escribía reservas directo a
// Firestore, con precio y duración tomados del DOM y sin más control que el
// formato del email.
const nuevaCita = {
  code: 'E2E-ADM1', name: 'Nueva Cliente', phone: '+56955555555', email: 'nueva@e2e.cl',
  svcId: manifiesto.svcId, barberId: manifiesto.barberId, date: manifiesto.hoy, time: '19:30',
  notes: 'creada por el test', over: true,
  // Lo que el servidor DEBE ignorar: precio inventado y estado forzado.
  price: 1, dur: 45, svcName: 'MENTIRA', barberName: 'MENTIRA', status: 'completed',
};

const noAdm = await call('adminSaveBooking', { booking: nuevaCita }, tVic);
check('adminSaveBooking es admin-only',
  noAdm.error && /permission[-_]denied/i.test(JSON.stringify(noAdm.error)), noAdm.error);

const creada = await call('adminSaveBooking', { booking: nuevaCita }, tAdm);
check('adminSaveBooking crea la cita', creada.status === 200 && creada.result && creada.result.ok,
  { status: creada.status, error: creada.error });
check('y avisa que fue creación, no edición', creada.result && creada.result.created === true, creada.result);

const docCreado = await getDoc('bookings/E2E-ADM1', tAdm);
// El invariante del proyecto: precio y nombres SIEMPRE del catálogo.
check('el precio sale del catálogo, no del payload',
  docCreado && docCreado.price !== 1 && docCreado.price > 0, docCreado && docCreado.price);
check('el nombre del servicio también',
  docCreado && docCreado.svcName !== 'MENTIRA', docCreado && docCreado.svcName);
check('y el del profesional',
  docCreado && docCreado.barberName !== 'MENTIRA', docCreado && docCreado.barberName);
// El estado lo mueve markAttendance, que conoce las transiciones. Aceptarlo
// del payload dejaría marcar una cita como atendida sin que ocurriera.
check('el estado NO se toma del payload',
  docCreado && docCreado.status === 'pending', docCreado && docCreado.status);
check('se guarda la clave del día, no el formato viejo con T...Z',
  docCreado && docCreado.date === manifiesto.hoy, docCreado && docCreado.date);
check('se escribe la zona del negocio',
  docCreado && docCreado.tz === 'America/Santiago', docCreado && docCreado.tz);

// Lo que motivó todo: las fechas y horas corruptas ya no entran.
const corruptas = [
  ['fecha que no existe', { date: '2026-02-30' }],
  ['mes 13', { date: '2026-13-01' }],
  ['fecha basura', { date: 'no-es-fecha' }],
  ['el formato viejo con T...Z', { date: manifiesto.hoy + 'T10:00:00.000Z' }],
  ['hora 25', { time: '25:00' }],
  ['sin servicio', { svcId: '' }],
  ['sin profesional', { barberId: '' }],
  ['sin nombre', { name: '' }],
  ['correo con formato malo', { email: 'no-es-email' }],
];
for (const [etiqueta, patch] of corruptas) {
  const r = await call('adminSaveBooking', { booking: { ...nuevaCita, code: 'E2E-MALA', ...patch } }, tAdm);
  check('adminSaveBooking rechaza: ' + etiqueta,
    r.error && /invalid[-_]argument/i.test(JSON.stringify(r.error)), r.error);
}
const malaGuardada = await getDoc('bookings/E2E-MALA', tAdm);
check('ninguna de las corruptas llegó a escribirse', !malaGuardada, malaGuardada);

// El correo es opcional a propósito: el salón agenda por teléfono.
const sinCorreo = await call('adminSaveBooking',
  { booking: { ...nuevaCita, code: 'E2E-ADM2', email: '' } }, tAdm);
check('adminSaveBooking acepta una cita sin correo', sinCorreo.status === 200, sinCorreo.error);

const svcInexistente = await call('adminSaveBooking',
  { booking: { ...nuevaCita, code: 'E2E-ADM3', svcId: 'no-existe' } }, tAdm);
check('adminSaveBooking rechaza un servicio inexistente',
  svcInexistente.error && /not[-_]found/i.test(JSON.stringify(svcInexistente.error)), svcInexistente.error);

// Editar conserva lo que el modal no maneja.
const editada = await call('adminSaveBooking',
  { booking: { ...nuevaCita, name: 'Nombre Corregido' } }, tAdm);
check('editar no vuelve a crear', editada.result && editada.result.created === false, editada.result);
const docEditado = await getDoc('bookings/E2E-ADM1', tAdm);
check('la edición guarda el cambio', docEditado && docEditado.name === 'Nombre Corregido', docEditado && docEditado.name);
check('y conserva la fecha de creación original',
  docEditado && docEditado.createdAt === (docCreado && docCreado.createdAt),
  { antes: docCreado && docCreado.createdAt, despues: docEditado && docEditado.createdAt });

// Y la puerta directa quedó cerrada, incluso para el admin.
const directo = await fetch(`${FS}/bookings/E2E-DIRECTO`, {
  method: 'PATCH', headers: { Authorization: `Bearer ${tAdm}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { code: { stringValue: 'E2E-DIRECTO' } } }),
});
check('escribir una reserva directo a Firestore ya falla, aun siendo admin',
  directo.status === 403, directo.status);

check.done();