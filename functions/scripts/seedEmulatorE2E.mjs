// Prepara el emulador para la prueba end-to-end de P1+P2:
//  - crea el usuario admin (con custom claim) y dos barberos en Auth
//  - vincula cada barbero a su ficha de staff (staff/{id}.uid)
//  - activa businessInfo.nudgesEnabled y deja horarios coherentes
//  - siembra citas de HOY para el barbero, y un histórico medido para el panel
//
// No usa el SDK de cliente: habla directo con los emuladores por Admin SDK y
// REST, así que no depende del navegador.
import { writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const app = initializeApp({ projectId: 'scissor-white' });
const db = getFirestore(app);
const auth = getAuth(app);

const TZ = 'America/Santiago';
const pad = (n) => String(n).padStart(2, '0');
// "Hoy" en la zona del negocio, no la del proceso.
const hoyBiz = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const diaAtras = (n) => {
  const d = new Date(hoyBiz + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

async function mkUser(email, password, claims) {
  let u;
  try { u = await auth.getUserByEmail(email); }
  catch { u = await auth.createUser({ email, password, emailVerified: true }); }
  if (claims) await auth.setCustomUserClaims(u.uid, claims);
  return u;
}

// ── 1. cuentas ──
const admin = await mkUser('admin@scissorwhite.cl', 'admin123', { admin: true });
const victoria = await mkUser('victoria@scissorwhite.cl', 'barbero123', null);
const esteban = await mkUser('esteban@scissorwhite.cl', 'barbero123', null);
console.log('admin uid   :', admin.uid);
console.log('victoria uid:', victoria.uid);

// ── 2. staff: horario completo + vínculo con Auth ──
// Sin `schedule` no hay disponibilidad, y sin `uid` el barbero no puede entrar.
const DIA = { open: true, start: '10:00', end: '20:00', break: { start: '13:00', end: '14:00' } };
const semana = [null, DIA, DIA, DIA, DIA, DIA, DIA]; // 0 = domingo cerrado

await db.collection('staff').doc('victoria').set({ status: 'active', schedule: semana }, { merge: true });
await db.collection('staff').doc('esteban').set({ status: 'active', schedule: semana }, { merge: true });

// El vínculo con Auth va APARTE: staff tiene lectura pública y ahí el uid y
// el correo del profesional quedarían legibles por cualquiera.
await db.collection('staffAccounts').doc('victoria').set({
  uid: victoria.uid, authEmail: victoria.email, linkedAt: new Date().toISOString(),
});
await db.collection('staffAccounts').doc('esteban').set({
  uid: esteban.uid, authEmail: esteban.email, linkedAt: new Date().toISOString(),
});

// ── 3. businessInfo: avisos activados, 10 min de anticipación ──
await db.collection('businessInfo').doc('main').set({
  tz: TZ, nudgesEnabled: true, nudgeLeadMin: 10, bufferMin: 0,
}, { merge: true });

// ── 4. citas de HOY para Victoria, en distintos estados ──
const svcDoc = (await db.collection('services').limit(1).get()).docs[0];
const svc = svcDoc.data();
// El id REAL del documento. Antes se sembraba svcId:'corte-adulto', que no
// existe en el catálogo: las reservas del seed apuntaban a un servicio
// fantasma. No molestaba mientras nadie lo resolviera, pero adminSaveBooking
// sí lo resuelve contra services y rebotaba con 'Ese servicio no existe'.
const svcId = svcDoc.id;
const ahora = new Date();
// Devuelve { date, time } en la zona del NEGOCIO. Antes devolvía solo la hora
// y la fecha se dejaba fija en hoy: corriendo la suite después de las 22:00,
// la cita de +120 min daba '00:13' con la fecha de hoy, o sea 22 horas en el
// PASADO, y el test de 'todavía no genera nada' fallaba por la hora del reloj
// y no por el código. Un test que depende de cuándo se corre es peor que no
// tenerlo.
const fmt = (d, opts) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, ...opts }).format(d);
const enMin = (m) => {
  const d = new Date(ahora.getTime() + m * 60000);
  return {
    date: fmt(d, { year: 'numeric', month: '2-digit', day: '2-digit' }),
    time: fmt(d, { hour: '2-digit', minute: '2-digit', hour12: false }),
  };
};

const base = {
  svcId, svcName: svc.name || 'Corte adulto', svcCat: svc.cat || 'c',
  price: svc.price || 18000, dur: svc.dur || 45,
  barberId: 'victoria', barberName: 'Victoria',
  date: hoyBiz, club: 'guest', tz: TZ, src: 'seed-e2e',
  createdAt: new Date().toISOString(),
};

const hoyCitas = [
  // La clave de la prueba: una cita a 8 minutos -> debe disparar "se acerca la hora".
  { ...base, code: 'E2E-PROX', name: 'Ana Próxima', email: 'ana@e2e.cl', phone: '+56911111111',
    ...enMin(8), status: 'confirmed' },
  { ...base, code: 'E2E-AHORA', name: 'Ben Ahora', email: 'ben@e2e.cl', phone: '+56922222222',
    ...enMin(-5), status: 'confirmed' },
  { ...base, code: 'E2E-LIBRE', name: 'Cata Tarde', email: 'cata@e2e.cl', phone: '+56933333333',
    ...enMin(120), status: 'pending' },
];
for (const c of hoyCitas) await db.collection('bookings').doc(c.code).set(c);

// ── 5. histórico ya medido, para que el Dashboard tenga qué mostrar ──
// El corte se pasa del plan (45 -> mediana 53) y hay 3 inasistencias, así que
// el motor de recomendaciones debe tener con qué opinar.
const reales = [53, 50, 53, 58, 53, 45, 53, 56, 53, 50, 53, 60, 53, 48, 53,
                55, 53, 47, 53, 52, 53, 49, 53, 51, 53, 46, 53, 54, 53, 50];
let n = 0;
for (const real of reales) {
  const d = diaAtras(1 + (n % 20));
  const startedAt = new Date(Date.now() - (n + 1) * 86400000).toISOString();
  await db.collection('bookings').doc('E2E-H' + n).set({
    ...base, code: 'E2E-H' + n, name: 'Atendido ' + n, email: 'h' + (n % 7) + '@e2e.cl',
    phone: '+56900000000', barberId: n % 2 ? 'esteban' : 'victoria',
    barberName: n % 2 ? 'Esteban' : 'Victoria',
    date: d, time: pad(10 + (n % 8)) + ':00', status: 'completed',
    arrivedAt: startedAt, startedAt,
    endedAt: new Date(new Date(startedAt).getTime() + real * 60000).toISOString(),
    actualDur: real, durSource: n === 3 ? 'manual' : 'timer',
    attendanceBy: n % 2 ? 'esteban' : 'victoria',
  });
  n++;
}
for (let k = 0; k < 3; k++) {
  await db.collection('bookings').doc('E2E-NS' + k).set({
    ...base, code: 'E2E-NS' + k, name: 'No vino ' + k, email: 'ns' + k + '@e2e.cl',
    phone: '+56900000000', date: diaAtras(2 + k), time: '12:00',
    status: 'no_show', noShowAt: new Date(Date.now() - 86400000).toISOString(),
    attendanceBy: 'victoria',
  });
}
await db.collection('bookings').doc('E2E-CAN').set({
  ...base, code: 'E2E-CAN', name: 'Canceló', email: 'can@e2e.cl', phone: '+56900000000',
  date: diaAtras(8), time: '12:00', status: 'cancelled',
  cancelledAt: new Date(Date.now() - 86400000).toISOString(), attendanceBy: 'admin',
});

const total = (await db.collection('bookings').get()).size;
console.log('hoy         :', hoyBiz);
// Manifiesto de lo sembrado. Existe porque las tres citas se calculan como
// desplazamientos desde AHORA y cualquiera puede cruzar la medianoche según
// la hora a la que se corra la suite: un test que afirme '3 citas hoy' pasa
// de día y falla de noche. Con esto los tests comparan contra lo que el seed
// realmente escribió, no contra un número escrito a mano.
//
// Va a un archivo y no a Firestore a propósito: firestore.rules deniega todo
// lo que no tenga un match, y abrir una colección en las reglas de producción
// para alimentar un test sería pagar en superficie de seguridad algo que se
// resuelve con fs -- el seed y los tests corren en la misma máquina.
writeFileSync(new URL('./.e2e-seed.json', import.meta.url), JSON.stringify({
  hoy: hoyBiz,
  svcId,
  barberId: 'victoria',
  citas: hoyCitas.map((c) => ({ code: c.code, date: c.date, time: c.time })),
}, null, 2));
console.log('citas sembradas:', hoyCitas.map((c) => c.date + ' ' + c.time + ' ' + c.name).join(' | '));
console.log('bookings    :', total);
process.exit(0);
