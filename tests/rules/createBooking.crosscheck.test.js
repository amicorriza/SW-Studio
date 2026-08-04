// Cross-check entre isValidBooking() (firestore.rules, CEL) e
// isValidBookingPayload() (functions/createBooking.js, JS) -- son DOS
// implementaciones separadas del mismo criterio (no se puede compartir
// código entre CEL y JS), así que sincronizarlas a mano es deuda desde el
// minuto uno.
//
// RETIRADO (mismo commit que cerró `bookings.create` a isAdmin()-only): con
// la rama pública `isValidBooking()` fuera de la regla, queda inalcanzable
// para cualquier escritura real -- probarla vía unauthenticatedContext ya no
// demuestra nada (todo se rechaza siempre, sin importar el payload). La
// mitad que toca reglas queda como `test.skip` (no se borra: es el registro
// de que la equivalencia SÍ se verificó, contra la rama pública viva, antes
// de cerrarla). La mitad que solo prueba isValidBookingPayload() sigue
// activa como regresión pineada contra ese mismo snapshot verificado.
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
  test(`isValidBookingPayload() (JS) coincide con la equivalencia verificada: ${label}`, () => {
    expect(isValidBookingPayload(fixture)).toBe(expectValid);
  });

  test.skip(`[retirado -- isValidBooking() ya inalcanzable, ver comentario de arriba] ${label}`, async () => {
    const db = env.unauthenticatedContext().firestore();
    const id = 'crosscheck' + (counter++);
    if (expectValid) {
      await assertSucceeds(setDoc(doc(db, 'bookings/' + id), fixture));
    } else {
      await assertFails(setDoc(doc(db, 'bookings/' + id), fixture));
    }
  });
});
