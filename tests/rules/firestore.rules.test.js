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

test('staff autenticado SÍ puede leer reservas', async () => {
  const db = env.authenticatedContext('staff1').firestore();
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

test('staff autenticado SÍ puede leer y escribir patients', async () => {
  const db = env.authenticatedContext('staff1').firestore();
  await assertSucceeds(setDoc(doc(db, 'patients/p1'), { name:'Juan', email:'juan@mail.com', club:'guest', visits:[], photos:[] }));
  await assertSucceeds(getDoc(doc(db, 'patients/p1')));
});
