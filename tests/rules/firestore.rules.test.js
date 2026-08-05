import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { beforeAll, afterAll, test } from 'vitest';

let env;
const valid = {
  status:'pending', name:'Juan Pérez', email:'juan@mail.com', phone:'+56912345678',
  svcId:'lp', svcName:'Corte', barberId:'felipe', barberName:'Felipe',
  date:'2026-06-10T00:00:00.000Z', time:'11:00', code:'SW-AB12345', price:21000, dur:50,
  club:'guest',
};

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'scissor-white-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

test('cualquiera puede leer services', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'services/lp')));
});

test('anónimo NO puede escribir services', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'services/lp'), { name:'x' }));
});

test('anónimo puede crear una reserva válida', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(setDoc(doc(db, 'bookings/b1'), valid));
});

test('reserva inválida (sin email) es rechazada', async () => {
  const db = env.unauthenticatedContext().firestore();
  const bad = { ...valid }; delete bad.email;
  await assertFails(setDoc(doc(db, 'bookings/b2'), bad));
});

test('anónimo NO puede leer reservas ajenas', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'bookings/b1')));
});

test('autenticado sin claim admin NO puede leer reservas', async () => {
  const db = env.authenticatedContext('staff1').firestore();
  await assertFails(getDoc(doc(db, 'bookings/b1')));
});

test('admin (custom claim) SÍ puede leer reservas', async () => {
  const db = env.authenticatedContext('admin1', { admin: true }).firestore();
  await assertSucceeds(getDoc(doc(db, 'bookings/b1')));
});

test('reserva con club inválido es rechazada', async () => {
  const db = env.unauthenticatedContext().firestore();
  const bad = { ...valid, club:'vip' };
  await assertFails(setDoc(doc(db, 'bookings/b3'), bad));
});

test('anónimo NO puede leer patients', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'patients/p1')));
});

test('anónimo NO puede crear patients', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'patients/p1'), { name:'Juan', email:'juan@mail.com', club:'guest', visits:[], photos:[] }));
});

test('autenticado sin claim admin NO puede leer ni escribir patients', async () => {
  const db = env.authenticatedContext('staff1').firestore();
  await assertFails(setDoc(doc(db, 'patients/p1'), { name:'Juan', email:'juan@mail.com', club:'guest', visits:[], photos:[] }));
  await assertFails(getDoc(doc(db, 'patients/p1')));
});

test('admin (custom claim) SÍ puede leer y escribir patients', async () => {
  const db = env.authenticatedContext('admin1', { admin: true }).firestore();
  await assertSucceeds(setDoc(doc(db, 'patients/p1'), { name:'Juan', email:'juan@mail.com', club:'guest', visits:[], photos:[] }));
  await assertSucceeds(getDoc(doc(db, 'patients/p1')));
});

test('cualquiera puede leer availability (vista de disponibilidad sin PII)', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'availability/2026-07-10')));
});

test('anónimo NO puede escribir availability', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'availability/2026-07-10'), { barberBusy: {} }));
});

test('staff autenticado tampoco puede escribir availability (solo la Cloud Function via Admin SDK)', async () => {
  const db = env.authenticatedContext('staff1').firestore();
  await assertFails(setDoc(doc(db, 'availability/2026-07-10'), { barberBusy: {} }));
});

test('anónimo NO puede leer scheduleBlocks', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'scheduleBlocks/sb1')));
});

test('anónimo NO puede crear scheduleBlocks', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'scheduleBlocks/sb1'), { barberId: 'victoria', date: '2026-08-05', start: '13:00', end: '14:00', reason: 'Colación' }));
});

test('admin (custom claim) SÍ puede leer y escribir scheduleBlocks', async () => {
  const db = env.authenticatedContext('admin1', { admin: true }).firestore();
  await assertSucceeds(setDoc(doc(db, 'scheduleBlocks/sb1'), { barberId: 'victoria', date: '2026-08-05', start: '13:00', end: '14:00', reason: 'Colación' }));
  await assertSucceeds(getDoc(doc(db, 'scheduleBlocks/sb1')));
});

// El payload que arma el modal del panel no trae status/club/svcName/etc,
// así que estos casos usan solo los campos que admin/index.html realmente
// envía -- no el fixture `valid` (que simula el widget público).
test('admin NO puede crear una reserva con email de formato inválido (antes isAdmin() cortocircuitaba isValidBooking)', async () => {
  const db = env.authenticatedContext('admin1', { admin: true }).firestore();
  await assertFails(setDoc(doc(db, 'bookings/adm1'), { code: 'SW-ADM1', name: 'Cliente', email: 'no-es-email' }));
});

test('admin SÍ puede crear una reserva sin email (opcional en el panel)', async () => {
  const db = env.authenticatedContext('admin1', { admin: true }).firestore();
  await assertSucceeds(setDoc(doc(db, 'bookings/adm2'), { code: 'SW-ADM2', name: 'Cliente' }));
});

test('admin SÍ puede crear una reserva con email válido', async () => {
  const db = env.authenticatedContext('admin1', { admin: true }).firestore();
  await assertSucceeds(setDoc(doc(db, 'bookings/adm3'), { code: 'SW-ADM3', name: 'Cliente', email: 'cliente@test.cl' }));
});
