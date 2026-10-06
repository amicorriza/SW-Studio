// tests/e2e/suspension.mjs
//
// Suspensión del servicio (spec 2026-10-05-suspension-servicio-design.md)
// contra el EMULADOR real. Requiere lo mismo que callables.mjs (emulador +
// seed). Deja license/main BORRADO al terminar, pase lo que pase: el seed no
// lo toca y una licencia suspendida contaminaría las otras suites.
//
// Uso: node tests/e2e/suspension.mjs
import { makeChecker, token, call, getDoc, patchDoc, ownerSetDoc, ownerDeleteDoc } from './emulator.mjs';

const check = makeChecker();
const tVic = await token('victoria@scissorwhite.cl', 'barbero123');
const tAdm = await token('admin@scissorwhite.cl', 'admin123');

const esSusp = (r) => !!(r.error && /FAILED_PRECONDITION/i.test(r.error.status || '')
  && r.error.details && r.error.details.license === 'suspended');

try {
  await ownerSetDoc('license/main', { status: 'suspended', message: 'Prueba e2e' });

  // ── callables gateados ──
  const cb = await call('createBooking', { svcId: 'cualquiera' }, null);
  check('createBooking rechaza con licencia suspendida', esSusp(cb), cb.error);
  check('createBooking NO devuelve el mensaje al público',
    !!(cb.error && cb.error.details) && !('message' in cb.error.details), cb.error);

  const asb = await call('adminSaveBooking', { booking: {} }, tAdm);
  check('adminSaveBooking rechaza', esSusp(asb), asb.error);

  const antes = await getDoc('bookings/E2E-PROX', tAdm);
  const ma = await call('markAttendance', { bookingId: 'E2E-PROX', action: 'arrive' }, tVic);
  check('markAttendance rechaza', esSusp(ma), ma.error);
  const despues = await getDoc('bookings/E2E-PROX', tAdm);
  check('y la cita no cambió', antes && despues && antes.status === despues.status, { antes: antes && antes.status, despues: despues && despues.status });

  for (const [fn, data] of [['getMyDay', {}], ['getMyRange', { from: '2026-10-01', to: '2026-10-02' }], ['getMyClients', {}]]) {
    const r = await call(fn, data, tVic);
    check(`${fn} rechaza al barbero`, esSusp(r), r.error);
  }

  // Review Focus #2: /login decide la ruta con este permission-denied.
  const adm = await call('getMyDay', {}, tAdm);
  check('getMyDay a una cuenta sin ficha sigue siendo permission-denied',
    !!(adm.error && /PERMISSION_DENIED/i.test(adm.error.status || '')), adm.error);

  const le = await call('adminLogEvent', { action: 'x' }, tAdm);
  check('adminLogEvent rechaza', esSusp(le), le.error);
  const ls = await call('linkStaffAccount', { staffId: 'victoria', email: 'victoria@scissorwhite.cl' }, tAdm);
  check('linkStaffAccount rechaza', esSusp(ls), ls.error);

  // ── NO gateados a propósito ──
  const rr = await call('respondToBookingReminder', { code: 'NOEXISTE', token: 'x', action: 'confirm' }, null);
  check('respondToBookingReminder NO está gateado (correos ya enviados)', !esSusp(rr), rr.error);
  const av = await call('getAvailability', { date: '2026-10-10', barberId: 'victoria' }, null);
  check('getAvailability NO está gateado', !esSusp(av), av.error);

  // ── reglas por REST ──
  let catBloq = false;
  try { await patchDoc('services/e2e-susp', { name: 'x' }, tAdm); } catch (e) { catBloq = /403/.test(e.message); }
  check('el admin NO escribe el catálogo', catBloq);
  check('el admin SÍ lee reservas', !!(await getDoc('bookings/E2E-PROX', tAdm)));
  let licBloq = false;
  try { await patchDoc('license/main', { status: 'active' }, tAdm); } catch (e) { licBloq = /403/.test(e.message); }
  check('el admin NO puede reactivarse solo', licBloq);

  // ── reactivar ──
  // En el emulador la caché de readLicense está en 0 ms (ver functions/index.js).
  await ownerSetDoc('license/main', { status: 'active' });
  const ok = await call('getMyDay', {}, tVic);
  check('reactivado: getMyDay vuelve a responder', ok.status === 200, ok.error);
} finally {
  await ownerDeleteDoc('license/main');
}

check.done();
