// functions/scripts/license.js
//
// Suspende o reactiva SW Studio escribiendo license/main (spec
// 2026-10-05-suspension-servicio-design.md). Es la alternativa a editar el
// campo a mano en la consola de Firebase; las dos sirven.
//
// Requisitos (una de las dos):
//   a) gcloud auth application-default login   (usa tus credenciales)
//   b) GOOGLE_APPLICATION_CREDENTIALS=/ruta/service-account.json
// Con FIRESTORE_EMULATOR_HOST definido escribe en el emulador.
//
// Uso:
//   cd functions
//   node scripts/license.js warning --suspend-at 2026-10-15 --message "Contacta a soporte"
//   node scripts/license.js suspended --message "Contacta a soporte para reactivar"
//   node scripts/license.js active
//
// OJO: license/main es de LECTURA PÚBLICA (el widget la lee), así que el
// mensaje lo puede ver cualquiera. Que sea neutro.
//
// Las funciones lo ven en hasta 1 minuto (caché por instancia).
'use strict';
const { LICENSE_STATUSES } = require('../shared/license.js');

const USO = 'Uso: node scripts/license.js <active|warning|suspended> [--message "..."] [--suspend-at YYYY-MM-DD]';

function buildLicenseDoc(argv, nowIso) {
  const [status, ...rest] = argv;
  if (LICENSE_STATUSES.indexOf(status) === -1) throw new Error(USO);
  let message = '';
  let suspendAt = '';
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const val = rest[i + 1];
    if (flag !== '--message' && flag !== '--suspend-at') throw new Error(USO);
    if (val === undefined || val.startsWith('--')) throw new Error(`Falta el valor de ${flag}. ${USO}`);
    if (flag === '--message') message = val;
    else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) throw new Error('--suspend-at debe ser YYYY-MM-DD.');
      suspendAt = val;
    }
    i++;
  }
  if (status === 'active') { message = ''; suspendAt = ''; }
  return { status, message, suspendAt, updatedAt: nowIso };
}

async function main() {
  let data;
  try {
    data = buildLicenseDoc(process.argv.slice(2), new Date().toISOString());
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp(process.env.FIRESTORE_EMULATOR_HOST
    ? { projectId: 'scissor-white' }
    : { credential: applicationDefault(), projectId: 'scissor-white' });
  const ref = getFirestore().collection('license').doc('main');
  await ref.set(data);
  const snap = await ref.get();
  console.log('OK: license/main =', snap.data());
  console.log('Las funciones lo ven en hasta 1 minuto.');
}

if (require.main === module) {
  main().catch((err) => { console.error('Error:', err.message); process.exit(1); });
}

module.exports = { buildLicenseDoc };
