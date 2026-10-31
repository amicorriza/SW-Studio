// functions/scripts/backfillStaffPublic.js
//
// Copia `staff/*` a `staffPublic/*` SIN el campo `schedule` (lo que el
// trigger mirrorStaffPublic hace hacia adelante). Correrlo UNA vez, ANTES de
// desplegar las reglas que cierran la lectura pública de `staff`: si no, el
// widget de reservas se queda sin barberos.
//
// Por defecto solo reporta; --apply escribe.
//   cd functions
//   node scripts/backfillStaffPublic.js [--project ID]
//   node scripts/backfillStaffPublic.js --apply [--project ID]
// Requiere gcloud ADC o GOOGLE_APPLICATION_CREDENTIALS (o FIRESTORE_EMULATOR_HOST).
'use strict';
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const pi = args.indexOf('--project');
initializeApp(pi > -1 ? { projectId: args[pi + 1] } : {});

(async () => {
  const db = getFirestore();
  const snap = await db.collection('staff').get();
  console.log(`staff: ${snap.size} documento(s)`);
  for (const d of snap.docs) {
    const { schedule, ...publico } = d.data();
    console.log(` - ${d.id} (${publico.name || 'sin nombre'}) -> staffPublic${apply ? '' : ' [no escrito]'}`);
    if (apply) await db.collection('staffPublic').doc(d.id).set(publico);
  }
  if (!apply) console.log('Solo reporte. Usá --apply para escribir.');
})().catch((e) => { console.error(e); process.exit(1); });
