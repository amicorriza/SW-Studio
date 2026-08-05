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
afterAll(async () => { await env.cleanup(); });

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
