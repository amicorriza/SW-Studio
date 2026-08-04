// Cross-check entre isValidBooking() (firestore.rules, CEL) e
// isValidBookingPayload() (functions/createBooking.js, JS) -- son DOS
// implementaciones separadas del mismo criterio (no se puede compartir
// código entre CEL y JS), así que sincronizarlas a mano es deuda desde el
// minuto uno. Este archivo prueba el MISMO set de fixtures contra ambos
// caminos y falla si divergen.
//
// IMPORTANTE -- este test solo tiene sentido MIENTRAS `bookings.create`
// siga aceptando la rama pública `isValidBooking()` en firestore.rules. En
// cuanto esa rama se cierre (ver el commit que deja `allow create` en
// `isAdmin() && isValidEmail(...)` únicamente), isValidBooking() queda
// inalcanzable para cualquier escritura real -- probarla vía
// unauthenticatedContext ya no demuestra nada (todo se rechaza siempre, sin
// importar el payload, así que "divergen" dejaría de significar un bug real
// y este archivo se retira/skipea en ese mismo commit, no antes).
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { isValidBookingPayload } from '../../functions/createBooking.js';

let env;
let counter = 0;

// Documento COMPLETO tal como lo escribía el widget público (addDoc directo,
// antes de esta fase) -- isValidBooking() valida el doc final, no un payload
// parcial. `status` se incluye siempre: isValidBookingPayload() NO lo valida
// a propósito (el servidor lo fuerza en el callable, nunca viene del
// cliente), así que mutar `status` produciría una divergencia esperada y sin
// valor -- por eso ningún caso de abajo lo toca.
const validFull = {
  status: 'pending', name: 'Juan Pérez', email: 'juan@mail.com', phone: '+56912345678',
  svcId: 'lp', svcName: 'Corte', barberId: 'felipe', barberName: 'Felipe',
  date: '2026-06-10T00:00:00.000Z', time: '11:00', code: 'SW-AB12345', price: 21000, dur: 50,
  club: 'guest',
};

function omit(obj, key) {
  const rest = { ...obj };
  delete rest[key];
  return rest;
}

// [etiqueta, fixture, válido-esperado-en-AMBOS-caminos]
const cases = [
  ['payload completo válido', validFull, true],
  ['sin email', omit(validFull, 'email'), false],
  ['email con formato inválido', { ...validFull, email: 'no-es-email' }, false],
  ['phone muy corto', { ...validFull, phone: '123' }, false],
  ['name muy corto', { ...validFull, name: 'J' }, false],
  ['club inválido', { ...validFull, club: 'vip' }, false],
  ['sin svcId', omit(validFull, 'svcId'), false],
  ['sin barberId', omit(validFull, 'barberId'), false],
  ['sin date', omit(validFull, 'date'), false],
  ['sin time', omit(validFull, 'time'), false],
  ['sin code', omit(validFull, 'code'), false],
  // Laxitud REAL y compartida por ambos caminos: `is string`/`typeof===
  // 'string'` no exigen no-vacío. No es un bug de este cross-check --
  // demuestra que la réplica JS preservó la laxitud original en vez de
  // "mejorarla" en silencio (lo que sí sería una divergencia).
  ['svcId vacío (laxitud compartida: string vacío pasa el chequeo de tipo)', { ...validFull, svcId: '' }, true],
  ['barberId vacío (misma laxitud)', { ...validFull, barberId: '' }, true],
  ['date vacío (misma laxitud)', { ...validFull, date: '' }, true],
  ['time vacío (misma laxitud)', { ...validFull, time: '' }, true],
  ['code vacío (misma laxitud)', { ...validFull, code: '' }, true],
];

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'scissor-white-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

cases.forEach(([label, fixture, expectValid]) => {
  test(`isValidBooking() (rules) e isValidBookingPayload() (JS) coinciden: ${label}`, async () => {
    expect(isValidBookingPayload(fixture)).toBe(expectValid);

    const db = env.unauthenticatedContext().firestore();
    const id = 'crosscheck' + (counter++);
    if (expectValid) {
      await assertSucceeds(setDoc(doc(db, 'bookings/' + id), fixture));
    } else {
      await assertFails(setDoc(doc(db, 'bookings/' + id), fixture));
    }
  });
});
