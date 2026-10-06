// tests/rules/license.test.js
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { beforeAll, afterAll, beforeEach, test } from 'vitest';

let env;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'scissor-white-license-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

// license/main tiene write:false, así que solo se siembra saltándose las reglas.
async function licencia(data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    if (data === null) await deleteDoc(doc(ctx.firestore(), 'license/main'));
    else await setDoc(doc(ctx.firestore(), 'license/main'), data);
  });
}
const admin = () => env.authenticatedContext('admin1', { admin: true }).firestore();

test('licencia ausente: el admin escribe', async () => {
  await assertSucceeds(setDoc(doc(admin(), 'services/lp'), { name: 'x' }));
});

for (const status of ['active', 'warning', 'inventado']) {
  test(`licencia ${status}: el admin escribe`, async () => {
    await licencia({ status });
    await assertSucceeds(setDoc(doc(admin(), 'services/lp'), { name: 'x' }));
  });
}

const RUTAS_ADMIN = ['services/a', 'staff/a', 'businessInfo/main', 'siteImages/a', 'googleReviews/main',
  'patients/a', 'scheduleBlocks/a', 'adminLog/a', 'staffAccounts/a'];

for (const ruta of RUTAS_ADMIN) {
  test(`licencia suspended: el admin NO escribe ${ruta}`, async () => {
    await licencia({ status: 'suspended' });
    await assertFails(setDoc(doc(admin(), ruta), { x: 1 }));
  });
}

test('licencia suspended: el admin NO borra reservas', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'bookings/b1'), { status: 'pending' });
  });
  await licencia({ status: 'suspended' });
  await assertFails(deleteDoc(doc(admin(), 'bookings/b1')));
});

// Los datos de los clientes del salón son de la dueña: suspender no se los niega.
test('licencia suspended: el admin SÍ lee', async () => {
  await licencia({ status: 'suspended' });
  await assertSucceeds(getDoc(doc(admin(), 'bookings/b1')));
  await assertSucceeds(getDoc(doc(admin(), 'patients/a')));
});

test('license/main: lectura pública', async () => {
  await licencia({ status: 'active' });
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'license/main')));
});

test('license/main: nadie la escribe, ni el admin', async () => {
  await licencia({ status: 'suspended' });
  await assertFails(setDoc(doc(admin(), 'license/main'), { status: 'active' }));
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'license/main'), { status: 'active' }));
  await licencia(null);
  await assertFails(setDoc(doc(admin(), 'license/main'), { status: 'active' }));
});

// Review Focus #1: saveAdmin() escribe el catálogo entero en un batch. Si el
// get() de licenseActive() rompe el límite de accesos por request, el panel deja
// de guardar con la licencia ACTIVA. 40 escrituras > cualquier catálogo real.
test('licencia active: un batch de 40 escrituras del admin pasa', async () => {
  await licencia({ status: 'active' });
  const db = admin();
  const b = writeBatch(db);
  for (let i = 0; i < 30; i++) b.set(doc(db, `services/s${i}`), { name: 'S' + i });
  for (let i = 0; i < 9; i++) b.set(doc(db, `staff/p${i}`), { name: 'P' + i });
  b.set(doc(db, 'businessInfo/main'), { tz: 'America/Santiago' });
  await assertSucceeds(b.commit());
});
