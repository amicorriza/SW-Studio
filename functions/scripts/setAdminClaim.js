// functions/scripts/setAdminClaim.js
//
// Asigna el custom claim { admin: true } a una cuenta de Firebase Auth, para
// que las reglas de Firestore (isAdmin) la reconozcan sin depender del UID
// hardcodeado. Ejecutar UNA vez por cada admin.
//
// Requisitos (una de las dos):
//   a) gcloud auth application-default login   (usa tus credenciales)
//   b) GOOGLE_APPLICATION_CREDENTIALS=/ruta/service-account.json
//
// Uso:
//   cd functions
//   node scripts/setAdminClaim.js admin@scissorwhite.cl
//
// Tras ejecutarlo, el usuario debe cerrar y volver a iniciar sesión (o refrescar
// el token) para que el claim tome efecto. Luego se puede quitar el UID de
// respaldo en firestore.rules y quedar solo con `request.auth.token.admin`.
'use strict';
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Falta el email. Uso: node scripts/setAdminClaim.js <email>');
    process.exit(1);
  }
  initializeApp({
    credential: applicationDefault(),
    projectId: 'scissor-white',
  });
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { admin: true });
  const updated = await auth.getUser(user.uid);
  console.log(`OK: ${email} (uid ${user.uid}) ahora tiene claims:`, updated.customClaims);
  console.log('El usuario debe re-loguearse para que el claim tome efecto.');
}

main().catch((err) => { console.error('Error:', err.message); process.exit(1); });
