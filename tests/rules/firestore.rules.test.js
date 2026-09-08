import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
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

// Hasta el 2026-09-07 el panel escribía reservas DIRECTO a Firestore y lo
// único que lo gateaba era el formato del email: precio, duración y nombres
// salían de datasets del DOM, y una fecha u hora corrupta entraba sin
// resistencia. Ahora esa vía está cerrada y el panel pasa por el callable
// adminSaveBooking, que valida de verdad y resuelve el catálogo del lado del
// servidor. Estos tests fijan que la puerta quedó cerrada.
test('NI SIQUIERA el admin puede crear una reserva directo', async () => {
  const db = env.authenticatedContext('admin1', { admin: true }).firestore();
  await assertFails(setDoc(doc(db, 'bookings/adm1'), { code: 'SW-ADM1', name: 'Cliente', email: 'cliente@test.cl' }));
});

test('ni editarla directo', async () => {
  const db = env.authenticatedContext('admin1', { admin: true }).firestore();
  await assertFails(updateDoc(doc(db, 'bookings/b1'), { name: 'Otro' }));
});

// El borrado se conserva a propósito: es la salida de emergencia documentada
// para una reserva de prueba, y borrar no puede corromper datos.
test('pero sí puede leerla y borrarla', async () => {
  const db = env.authenticatedContext('admin1', { admin: true }).firestore();
  await assertSucceeds(getDoc(doc(db, 'bookings/b1')));
  await assertSucceeds(deleteDoc(doc(db, 'bookings/b1')));
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

// ── Fase 3: el UID de admin ya no está hardcodeado ──
// Durante meses isAdmin() aceptaba el custom claim O este UID literal, como
// red por si el claim no estaba puesto. El 2026-09-07 se verificó con
// `firebase auth:export` que admin@scissorwhite.cl SÍ lo tiene, así que el
// respaldo se retiró de los cuatro sitios donde vivía. Estos tests existen
// para que no vuelva a colarse: la autorización es el claim y nada más.
test('el UID del admin, SIN el claim, ya no da acceso', async () => {
  const db = env.authenticatedContext('VUm858rENuNVzB4MAMtzLnGb1A63').firestore();
  await assertFails(getDoc(doc(db, 'bookings/b1')));
  await assertFails(getDoc(doc(db, 'patients/p1')));
  await assertFails(setDoc(doc(db, 'services/s1'), { name: 'x' }));
});

test('y el claim sigue siendo suficiente, venga del UID que venga', async () => {
  const db = env.authenticatedContext('cualquier-uid-nuevo', { admin: true }).firestore();
  await assertSucceeds(getDoc(doc(db, 'bookings/b1')));
  await assertSucceeds(setDoc(doc(db, 'services/s1'), { name: 'x' }));
});