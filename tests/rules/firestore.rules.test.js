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

// Fase A: la creación pública de reservas ya NO pasa por acá -- el widget
// llama al callable transaccional createBooking (Admin SDK, no sujeto a
// estas reglas), que además verifica disponibilidad real antes de escribir.
// `valid` (perfectamente válido según el viejo isValidBooking()) se usa acá
// a propósito: demuestra que el rechazo es INCONDICIONAL -- ya no depende de
// la forma del payload, isAdmin() sola decide.
test('anónimo NO puede crear una reserva directo, ni siquiera una con payload válido', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'bookings/b1'), valid));
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

// ── Reseñas de Google ──
// Espejo público del perfil de Google Business: el landing lo lee para TODOS
// los visitantes, así que la lectura anónima es el caso normal, no una fuga.
test('cualquiera puede leer googleReviews (la sección de reseñas del landing la pinta para todos)', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'googleReviews/main')));
});

test('anónimo NO puede escribir googleReviews', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'googleReviews/main'), { rating: 5, userRatingCount: 999 }));
});

// Sin esta regla, cualquiera con una cuenta creada por el registro público de
// Auth podría inflar el puntaje que muestra la portada.
test('autenticado sin claim admin NO puede escribir googleReviews', async () => {
  const db = env.authenticatedContext('staff1').firestore();
  await assertFails(setDoc(doc(db, 'googleReviews/main'), { rating: 5 }));
});

// El admin escribe solo `manualReviews` (las reseñas de respaldo del panel);
// el resto del doc lo mantiene la Cloud Function con Admin SDK.
test('admin SÍ puede escribir googleReviews (reseñas de respaldo del panel)', async () => {
  const db = env.authenticatedContext('admin1', { admin: true }).firestore();
  await assertSucceeds(setDoc(doc(db, 'googleReviews/main'), {
    manualReviews: [{ author: 'Cliente', rating: 5, text: 'Excelente.' }],
  }, { merge: true }));
});
