// functions/scripts/backfillAvailability.js
//
// Puebla `availability/{YYYY-MM-DD}` (vista materializada sin PII que
// mantiene la Cloud Function onBookingWritten, ver functions/index.js) a
// partir de las reservas YA existentes en Firestore. onBookingWritten solo
// corre hacia adelante -- reservas creadas/editadas/borradas ANTES de que
// el trigger se desplegara no generan/actualizan su doc `availability`
// hasta que algo las vuelva a escribir. Este script hace ese cálculo inicial
// una sola vez, agrupando TODAS las reservas por día calendario
// (dateKeyOf) y recomputando cada `availability/{fecha}` con la misma
// lógica pura que usa el trigger (computeAvailability).
//
// Mismo patrón que reconcileCatalog.js: por defecto SOLO REPORTA; escribir
// requiere --apply + confirmación escrita interactiva (YES).
//
// Requisitos (una de las dos, igual que setAdminClaim.js/reconcileCatalog.js):
//   a) gcloud auth application-default login   (usa tus credenciales)
//   b) GOOGLE_APPLICATION_CREDENTIALS=/ruta/service-account.json
//
// Uso (contra producción):
//   cd functions
//   node scripts/backfillAvailability.js                    # solo reporte
//   node scripts/backfillAvailability.js --project OTRO_ID  # solo reporte, otro proyecto
//   node scripts/backfillAvailability.js --apply             # aplica (pide confirmación escrita)
//
// Uso (contra el emulador, para pruebas -- no toca producción):
//   firebase emulators:start --only firestore
//   FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/backfillAvailability.js --project scissor-white --apply
'use strict';

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const readline = require('readline');
const { computeAvailability, dateKeyOf } = require('../availability.js');

const DEFAULT_PROJECT = 'scissor-white';
const BATCH_SIZE = 400; // margen bajo el límite de 500 ops/batch de Firestore

function parseArgs(argv) {
  const args = { apply: false, project: DEFAULT_PROJECT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') {
      args.apply = true;
    } else if (a === '--project') {
      args.project = argv[++i];
    } else if (a.startsWith('--project=')) {
      args.project = a.slice('--project='.length);
    } else {
      throw new Error(`Argumento desconocido: ${a}. Uso: node scripts/backfillAvailability.js [--apply] [--project <id>]`);
    }
  }
  if (!args.project) throw new Error('--project requiere un valor');
  return args;
}

// Agrupa reservas por día calendario (dateKeyOf) y calcula barberBusy para
// cada uno con la misma lógica pura que usa el trigger onBookingWritten.
// Reservas sin `date` se ignoran (no hay día calendario al que asignarlas).
function computeIntendedAvailability(bookings) {
  const byDate = new Map();
  for (const b of bookings || []) {
    const key = dateKeyOf(b.date);
    if (!key) continue;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(b);
  }
  const result = new Map(); // dateKey -> barberBusy
  for (const [dateKey, dayBookings] of byDate) {
    const { barberBusy } = computeAvailability({ bookings: dayBookings, staff: [], barberId: 'any' });
    result.set(dateKey, barberBusy);
  }
  return result;
}

async function readBookings(db) {
  const snap = await db.collection('bookings').get();
  return snap.docs.map((d) => d.data());
}

async function readExistingAvailabilityDates(db) {
  const snap = await db.collection('availability').get();
  return new Set(snap.docs.map((d) => d.id));
}

function printReport(intended, existingDates) {
  const dates = [...intended.keys()].sort();
  console.log(`\n=== availability ===`);
  if (!dates.length) {
    console.log('  Sin reservas con `date` válido: nada que respaldar.');
    return;
  }
  for (const dateKey of dates) {
    const barberBusy = intended.get(dateKey);
    const barberCount = Object.keys(barberBusy).length;
    const slotCount = Object.values(barberBusy).reduce((acc, arr) => acc + arr.length, 0);
    const status = existingDates.has(dateKey) ? 'SE SOBREESCRIBIRÍA' : 'SE CREARÍA';
    console.log(`   - ${dateKey}: ${barberCount} barbero(s), ${slotCount} rango(s) ocupado(s) -- ${status}`);
  }
}

async function confirmApply(totalDates, projectId) {
  if (!process.stdin.isTTY) {
    throw new Error(
      'stdin no es un TTY: --apply requiere confirmación interactiva y no puede ' +
      'correr de forma no interactiva. Ejecutá el script a mano en una terminal.'
    );
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`Escribí YES para respaldar ${totalDates} día(s) de disponibilidad en el proyecto "${projectId}": `, resolve);
  });
  rl.close();
  return answer.trim() === 'YES';
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const app = initializeApp({
    credential: applicationDefault(),
    projectId: args.project,
  });
  const db = getFirestore(app);

  const bookings = await readBookings(db);
  const intended = computeIntendedAvailability(bookings);
  const existingDates = await readExistingAvailabilityDates(db);

  console.log(`Proyecto: ${args.project}`);
  console.log(`Modo: ${args.apply ? 'APLICAR (--apply)' : 'SOLO REPORTE'}`);
  console.log(`Reservas leídas: ${bookings.length}`);
  printReport(intended, existingDates);

  const dateKeys = [...intended.keys()];
  console.log(`\nResumen: ${dateKeys.length} día(s) de disponibilidad para escribir.`);

  if (!args.apply) {
    console.log('Modo solo-reporte: no se escribió nada. Corré con --apply para aplicar los cambios de arriba.');
    return;
  }

  if (dateKeys.length === 0) {
    console.log('Nada que aplicar: no hay reservas con `date` válido.');
    return;
  }

  const confirmed = await confirmApply(dateKeys.length, args.project);
  if (!confirmed) {
    console.log('Cancelado: no se escribió nada.');
    process.exitCode = 1;
    return;
  }

  for (const group of chunk(dateKeys, BATCH_SIZE)) {
    const batch = db.batch();
    for (const dateKey of group) {
      batch.set(db.collection('availability').doc(dateKey), {
        barberBusy: intended.get(dateKey),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  console.log(`OK: se respaldaron ${dateKeys.length} día(s) de disponibilidad en el proyecto "${args.project}".`);
}

module.exports = {
  parseArgs,
  computeIntendedAvailability,
  confirmApply,
};

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err.stack || err.message);
    process.exit(1);
  });
}
