// seed/seed.js — carga services, staff y businessInfo a Firestore.
//
// Emulador:
//   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=<project-id> node seed.js
// Producción:
//   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json GCLOUD_PROJECT=<project-id> node seed.js
'use strict';
const admin = require('firebase-admin');
const { services, staff, businessInfo } = require('./data.js');

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'REEMPLAZAR-project-id' });
const db = admin.firestore();

async function main() {
  const batch = db.batch();
  services.forEach((s) => batch.set(db.collection('services').doc(s.id), s));
  staff.forEach((s) => batch.set(db.collection('staff').doc(s.id), s));
  batch.set(db.collection('businessInfo').doc('main'), businessInfo);
  await batch.commit();
  console.log(`Seed OK: ${services.length} servicios, ${staff.length} barberos, businessInfo/main`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
