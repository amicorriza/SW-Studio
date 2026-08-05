// functions/scripts/verifyCreateBookingConcurrency.js
//
// Verifica en vivo que dos llamadas SIMULTÁNEAS al callable createBooking
// para el mismo barbero+fecha+hora resuelven en exactamente un ganador. Es
// el único caso de la Fase A que no se puede probar con node --test: prueba
// el runTransaction real contra Firestore (lecturas fuera de tx.get() no
// serializarían nada y este script lo mostraría como dos ganadores, o dos
// documentos para el mismo slot).
//
// Requiere el emulador de Firestore Y Functions corriendo (`firebase
// emulators:start`), con functions/.env presente (createBooking no necesita
// secretos, pero el resto del codebase sí al arrancar).
//
// Uso:
//   cd functions
//   node scripts/verifyCreateBookingConcurrency.js
//
// Siembra un servicio/barbero de prueba, dispara las dos llamadas, imprime
// el resultado (se espera 1 fulfilled + 1 rejected con already-exists, y
// exactamente 1 documento real en `bookings` para ese slot) y limpia todo
// al final, incluso si falla a mitad de camino.
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const clientApp = require('firebase/app');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');

const SVC_ID = 'qa-conc-svc';
const BARBER_ID = 'qa-conc-barber';
const DATE = '2099-06-15T00:00:00.000Z';
const TIME = '11:00';

function payload(code) {
  return {
    code, name: 'QA Concurrencia', email: 'qa-conc@example.com', phone: '+56900000099',
    svcId: SVC_ID, barberId: BARBER_ID, date: DATE, time: TIME, club: 'guest',
  };
}

async function main() {
  const admin = initializeApp({ projectId: 'scissor-white' }, 'verify-concurrency-admin');
  const db = getFirestore(admin);
  await db.collection('services').doc(SVC_ID).set({ name: 'QA Conc', cat: 'qa', price: 5000, dur: 30, status: 'active' });
  await db.collection('staff').doc(BARBER_ID).set({
    name: 'QA Barber', status: 'active',
    schedule: Array(7).fill({ open: true, start: '09:00', end: '20:00' }),
  });
  console.log('Seed OK: services/%s, staff/%s', SVC_ID, BARBER_ID);

  try {
    const app = clientApp.initializeApp({ projectId: 'scissor-white', apiKey: 'qa-fake-key' }, 'verify-concurrency-client');
    const functions = getFunctions(app, 'southamerica-east1');
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    const call = httpsCallable(functions, 'createBooking');

    const [ra, rb] = await Promise.allSettled([call(payload('SW-QA-CONC-A')), call(payload('SW-QA-CONC-B'))]);
    console.log('Llamada A:', ra.status, ra.status === 'fulfilled' ? ra.value.data : `${ra.reason.code} | ${ra.reason.message}`);
    console.log('Llamada B:', rb.status, rb.status === 'fulfilled' ? rb.value.data : `${rb.reason.code} | ${rb.reason.message}`);

    const fulfilled = [ra, rb].filter(r => r.status === 'fulfilled').length;
    const rejected = [ra, rb].filter(r => r.status === 'rejected').length;
    console.log('Resumen: fulfilled =', fulfilled, '| rejected =', rejected, '(esperado: 1 / 1)');

    const snap = await db.collection('bookings').where('svcId', '==', SVC_ID).where('barberId', '==', BARBER_ID).get();
    console.log('Documentos reales en bookings para este slot:', snap.size, '(esperado: 1)');
    for (const d of snap.docs) await d.ref.delete();

    if (fulfilled !== 1 || rejected !== 1 || snap.size !== 1) {
      throw new Error('Resultado inesperado -- ver el detalle arriba');
    }
    console.log('OK: exactamente un ganador, exactamente un documento.');
  } finally {
    await db.collection('services').doc(SVC_ID).delete();
    await db.collection('staff').doc(BARBER_ID).delete();
  }
}

main().catch((err) => { console.error('FAIL:', err.message); process.exit(1); });
