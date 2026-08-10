// functions/scripts/backfillRetiredServices.js
//
// Crea en Firestore los docs `services/{id}` de retiredServices
// (seed/data.js) que hoy no existen en producción. seed/data.js documenta
// que estos ids "NUNCA se borran de Firestore" porque bookings.svcId, el
// conteo Club SW y "Servicios más demandados" siguen apuntando a ellos --
// pero reconcileCatalog.js (2026-08-09) mostró que en realidad nunca se
// crearon en producción, así que cualquier lookup histórico a uno de estos
// ids hoy no encuentra nada.
//
// A diferencia de reconcileCatalog.js --apply, este script:
//   - Solo toca la colección `services`, nunca `staff` (no puede recrear a
//     esteban/ariel, que fueron borrados de producción a propósito).
//   - Solo crea docs que faltan; nunca sobreescribe uno que ya existe.
//
// Requisitos (una de las dos, igual que setAdminClaim.js):
//   a) gcloud auth application-default login   (usa tus credenciales)
//   b) GOOGLE_APPLICATION_CREDENTIALS=/ruta/service-account.json
//
// Uso:
//   cd functions
//   node scripts/backfillRetiredServices.js
'use strict';
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function stripId(obj) {
  const { id, ...rest } = obj;
  return rest;
}

async function main() {
  initializeApp({ credential: applicationDefault(), projectId: 'scissor-white' });
  const db = getFirestore();
  const { retiredServices } = require('../../seed/data.js');

  const missing = [];
  for (const svc of retiredServices) {
    const snap = await db.collection('services').doc(svc.id).get();
    if (!snap.exists) missing.push(svc);
  }

  if (!missing.length) {
    console.log('Nada que hacer: los', retiredServices.length, 'servicios retirados ya existen en producción.');
    return;
  }

  console.log('Faltan', missing.length, 'de', retiredServices.length, 'servicios retirados:');
  missing.forEach((s) => console.log(`   - ${s.id} (${s.name})`));

  const batch = db.batch();
  for (const svc of missing) {
    batch.set(db.collection('services').doc(svc.id), stripId(svc), { merge: true });
  }
  await batch.commit();
  console.log(`OK: se crearon ${missing.length} documento(s) en services/.`);
}

main().catch((err) => { console.error('Error:', err.stack || err.message); process.exit(1); });
