// staffDevices y staffAccounts.
//
// staffDevices/{uid} — tokens de FCM del dispositivo de cada profesional
// (PWA /barbero). Es el ÚNICO lugar del repo donde alguien que no es admin
// escribe directo a Firestore: un dato por-usuario, sin PII, con una regla
// de una sola igualdad. Todo lo demás de la PWA pasa por callables con
// Admin SDK (getMyDay, markAttendance).
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { beforeAll, afterAll, test } from 'vitest';

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'scissor-white-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

test('un barbero escribe y lee su propio doc de dispositivos', async () => {
  const db = env.authenticatedContext('uid-victoria').firestore();
  await assertSucceeds(setDoc(doc(db, 'staffDevices/uid-victoria'), { tokens: ['t1'] }));
  await assertSucceeds(getDoc(doc(db, 'staffDevices/uid-victoria')));
});

test('un barbero NO puede escribir el doc de otro', async () => {
  const db = env.authenticatedContext('uid-victoria').firestore();
  await assertFails(setDoc(doc(db, 'staffDevices/uid-esteban'), { tokens: ['t1'] }));
});

// Los tokens de FCM son credenciales de envío: quien los tiene puede
// mandarle notificaciones a ese teléfono. No son públicos entre colegas.
test('un barbero NO puede leer el doc de otro', async () => {
  const db = env.authenticatedContext('uid-victoria').firestore();
  await assertFails(getDoc(doc(db, 'staffDevices/uid-esteban')));
});

test('un anónimo no puede escribir ni leer ninguno', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'staffDevices/uid-victoria'), { tokens: ['t1'] }));
  await assertFails(getDoc(doc(db, 'staffDevices/uid-victoria')));
});

// staffAccounts: el vínculo entre una ficha de staff y su cuenta de Auth.
// Vive aparte de staff/{id} porque ese tiene lectura PÚBLICA (el widget de
// reservas necesita nombres, fotos y horarios) y ahí el uid y el correo del
// profesional quedarían legibles por cualquiera.
test('staffAccounts: un anónimo NO puede leerlo', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'staffAccounts/victoria')));
});

test('staffAccounts: un barbero autenticado tampoco puede leerlo', async () => {
  const db = env.authenticatedContext('uid-victoria').firestore();
  await assertFails(getDoc(doc(db, 'staffAccounts/victoria')));
  await assertFails(setDoc(doc(db, 'staffAccounts/esteban'), { uid: 'uid-victoria' }));
});

// El contraste que justifica todo: staff SÍ es público, y por eso no puede
// guardar el vínculo.
test('staff sigue siendo de lectura pública (lo necesita el widget)', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'staff/victoria')));
});
