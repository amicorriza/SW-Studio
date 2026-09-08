import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { beforeAll, afterAll, test } from 'vitest';

let env;
const bytes = new Uint8Array([1, 2, 3]);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'scissor-white-test',
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
});
// Sin el guard, si beforeAll falla (emulador de Storage no levantado) env
// queda undefined y afterAll revienta con 'Cannot read properties of
// undefined': el archivo entero se reporta como FAIL con 3 tests saltados y
// npm run test:rules sale con codigo 1 aunque todo lo demas este verde. Eso
// paso durante meses y entrenaba a ignorar el exit code de la suite.
afterAll(async () => { if (env) await env.cleanup(); });

test('anónimo NO puede subir una foto de cliente', async () => {
  const storage = env.unauthenticatedContext().storage();
  await assertFails(uploadBytes(ref(storage, 'patients/p1/photo1.jpg'), bytes));
});

test('autenticado sin claim admin NO puede subir ni leer una foto de cliente', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), 'patients/p1/photo-existente.jpg'), bytes);
  });
  const storage = env.authenticatedContext('staff1').storage();
  await assertFails(uploadBytes(ref(storage, 'patients/p1/photo1.jpg'), bytes));
  await assertFails(getBytes(ref(storage, 'patients/p1/photo-existente.jpg')));
});

test('admin (custom claim) SÍ puede subir y leer una foto de cliente', async () => {
  const storage = env.authenticatedContext('admin1', { admin: true }).storage();
  await assertSucceeds(uploadBytes(ref(storage, 'patients/p1/photo1.jpg'), bytes));
  await assertSucceeds(getBytes(ref(storage, 'patients/p1/photo1.jpg')));
});

// ── Fase 3: el UID de admin ya no está hardcodeado ──
// Storage no puede importar isAdmin() de firestore.rules, así que el criterio
// estaba copiado a mano en DOS reglas de este archivo. Al retirar el UID hay
// que retirarlo de las cuatro copias a la vez: dejar una con el claim y otra
// con el UID produce un admin que puede escribir en Firestore y no en Storage.
test('el UID del admin, SIN el claim, ya no puede tocar fotos de clientes', async () => {
  const storage = env.authenticatedContext('VUm858rENuNVzB4MAMtzLnGb1A63').storage();
  await assertFails(uploadBytes(ref(storage, 'patients/p1/photo1.jpg'), bytes));
  await assertFails(getBytes(ref(storage, 'patients/p1/photo1.jpg')));
});

test('ni subir imágenes del sitio', async () => {
  const storage = env.authenticatedContext('VUm858rENuNVzB4MAMtzLnGb1A63').storage();
  await assertFails(uploadBytes(ref(storage, 'siteImages/hero/img.jpg'), bytes));
});

test('el claim sí puede, venga del UID que venga', async () => {
  const storage = env.authenticatedContext('otro-uid', { admin: true }).storage();
  await assertSucceeds(uploadBytes(ref(storage, 'patients/p1/photo1.jpg'), bytes));
  await assertSucceeds(uploadBytes(ref(storage, 'siteImages/hero/img.jpg'), bytes));
});