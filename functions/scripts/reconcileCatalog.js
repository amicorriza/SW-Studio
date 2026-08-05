// functions/scripts/reconcileCatalog.js
//
// Reconcilia las colecciones Firestore `services` y `staff` contra el estado
// esperado definido en seed/data.js. El sitio está en producción desde
// 2026-07-05: el admin puede haber editado servicios/barberos desde el panel
// en vivo (public/js/data.js -> saveAdmin), así que la Firestore real puede
// ya diferir de seed/data.js. Editar solo los archivos fuente NO cambia lo
// que ya está en producción — para eso existe este script.
//
// A diferencia de seed/seed.js (que hace batch.set incondicional, sin leer
// antes ni pedir confirmación), este script:
//   1. Lee `services` y `staff` EN VIVO desde Firestore (Admin SDK, sin
//      restricción de reglas).
//   2. Calcula el estado ESPERADO a partir de seed/data.js, forzando
//      esteban/ariel a status:'inactive' en el PROPIO script (de forma
//      independiente de lo que ya diga seed/data.js — defensa en
//      profundidad, ver plan 3a/3b).
//   3. Imprime un diff campo por campo. Documentos solo-en-producción se
//      marcan para revisión manual y NUNCA se borran ni se tocan.
//   4. Por defecto SOLO REPORTA. Escribir requiere el flag --apply MÁS una
//      confirmación escrita interactiva exacta (YES) — es el único paso de
//      todo el plan que toca datos de producción directamente.
//   5. Al aplicar, escribe con `.set(ref, doc, { merge:true })` únicamente
//      sobre los documentos que difieren o que faltan en producción.
//
// NUNCA reutilizar seed/seed.js para esto: podría pisar silenciosamente
// ediciones reales hechas desde el panel en vivo.
//
// Requisitos (una de las dos, igual que setAdminClaim.js):
//   a) gcloud auth application-default login   (usa tus credenciales)
//   b) GOOGLE_APPLICATION_CREDENTIALS=/ruta/service-account.json
//
// Uso (contra producción):
//   cd functions
//   node scripts/reconcileCatalog.js                    # solo reporte
//   node scripts/reconcileCatalog.js --project OTRO_ID  # solo reporte, otro proyecto
//   node scripts/reconcileCatalog.js --apply            # aplica (pide confirmación escrita)
//
// Uso (contra el emulador, para pruebas — no toca producción):
//   export PATH="$PATH:/c/Users/aldon/tools/jdk-21.0.11+10/bin"
//   firebase emulators:start --only firestore
//   FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/reconcileCatalog.js --project scissor-white
'use strict';

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const readline = require('readline');

const DEFAULT_PROJECT = 'scissor-white';
// esteban/ariel deben quedar inactive sin importar lo que diga seed/data.js
// (ver plan 3a/3b): esto se recalcula acá, no se hereda del archivo fuente.
const FORCE_INACTIVE_STAFF_IDS = new Set(['esteban', 'ariel']);

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
      throw new Error(`Argumento desconocido: ${a}. Uso: node scripts/reconcileCatalog.js [--apply] [--project <id>]`);
    }
  }
  if (!args.project) throw new Error('--project requiere un valor');
  return args;
}

// Calcula el estado esperado a partir de los arrays crudos de seed/data.js,
// SIN mutar los objetos originales (el módulo required queda intacto), y
// forzando esteban/ariel a inactive de forma independiente del archivo.
function computeIntended(rawServices, rawStaff) {
  const services = rawServices.map((s) => ({ ...s }));
  const staff = rawStaff.map((s) => {
    const copy = { ...s };
    if (FORCE_INACTIVE_STAFF_IDS.has(copy.id)) copy.status = 'inactive';
    return copy;
  });
  return { services, staff };
}

function toMapById(list) {
  const map = new Map();
  for (const item of list) map.set(item.id, item);
  return map;
}

// Elimina el campo `id` (redundante con la key del doc en Firestore) antes
// de escribir, igual que hace stripId() en public/js/data.js::saveAdmin().
function stripId(obj) {
  const { id, ...rest } = obj;
  return rest;
}

function formatValue(v) {
  if (v === undefined) return '(ausente)';
  return JSON.stringify(v);
}

// Compara dos docs campo por campo. `id` se excluye porque ya es la key del
// documento (no un campo de contenido) y siempre coincide por construcción.
function diffFields(intended, live) {
  const keys = new Set([...Object.keys(intended), ...Object.keys(live)]);
  keys.delete('id');
  const changes = [];
  for (const key of keys) {
    const a = intended[key];
    const b = live[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ field: key, from: b, to: a }); // from = valor actual en vivo, to = valor esperado
    }
  }
  return changes;
}

async function readLive(db, collectionName) {
  const snap = await db.collection(collectionName).get();
  const map = new Map();
  snap.forEach((docSnap) => {
    // Igual que readCol() en public/js/data.js: el id del doc manda, se
    // sintetiza como campo `id` para comparar con el estado esperado
    // (algunos docs viejos de seed.js ya traen `id` en el body; los nuevos
    // escritos por el panel -- que usa stripId() -- no lo traen).
    map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
  });
  return map;
}

// Separa los docs esperados vs. en vivo en tres grupos: difieren, faltan en
// vivo (se crearían), y solo-en-vivo (nunca se tocan, solo revisión manual).
function reconcileCollection(label, intendedList, liveMap) {
  const intendedMap = toMapById(intendedList);
  const toWrite = [];
  const missing = [];
  const liveOnly = [];

  for (const [id, intendedDoc] of intendedMap) {
    const liveDoc = liveMap.get(id);
    if (!liveDoc) {
      missing.push({ id, doc: intendedDoc });
      continue;
    }
    const changes = diffFields(intendedDoc, liveDoc);
    if (changes.length > 0) toWrite.push({ id, doc: intendedDoc, changes });
  }
  for (const [id, liveDoc] of liveMap) {
    if (!intendedMap.has(id)) liveOnly.push({ id, doc: liveDoc });
  }
  return { label, toWrite, missing, liveOnly };
}

function printReport(result) {
  const { label, toWrite, missing, liveOnly } = result;
  console.log(`\n=== ${label} ===`);
  if (toWrite.length === 0 && missing.length === 0 && liveOnly.length === 0) {
    console.log('  Sin diferencias: producción coincide con lo esperado.');
    return;
  }
  if (toWrite.length) {
    console.log('  Documentos que DIFIEREN (se escribirían con --apply, merge:true):');
    for (const { id, changes } of toWrite) {
      console.log(`   - ${id}`);
      for (const c of changes) {
        if (c.to === undefined) {
          // merge:true nunca borra campos ausentes del doc escrito -- este
          // campo es "extra" en producción y --apply lo deja intacto.
          console.log(`       ${c.field}: ${formatValue(c.from)}  (campo extra en producción, no se tocará con merge:true)`);
        } else {
          console.log(`       ${c.field}: ${formatValue(c.from)}  ->  ${formatValue(c.to)}`);
        }
      }
    }
  }
  if (missing.length) {
    console.log('  Documentos FALTANTES en producción (se crearían con --apply):');
    for (const { id, doc } of missing) {
      console.log(`   - ${id} (${doc.name || ''})`);
    }
  }
  if (liveOnly.length) {
    console.log('  Documentos SOLO EN PRODUCCIÓN, ausentes de lo esperado -- REVISIÓN MANUAL (nunca se borran ni se escriben, bajo ningún flag):');
    for (const { id, doc } of liveOnly) {
      console.log(`   - ${id} (${doc.name || ''})`);
    }
  }
}

// Pide confirmación escrita antes de aplicar cambios de producción. Si
// stdin no es un TTY (ej. corrida no interactiva / CI / pipe), se niega en
// vez de colgarse o de aplicar en silencio.
async function confirmApply(totalChanges, projectId) {
  if (!process.stdin.isTTY) {
    throw new Error(
      'stdin no es un TTY: --apply requiere confirmación interactiva y no puede ' +
      'correr de forma no interactiva. Ejecutá el script a mano en una terminal.'
    );
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`Escribí YES para aplicar ${totalChanges} cambio(s) al proyecto "${projectId}": `, resolve);
  });
  rl.close();
  return answer.trim() === 'YES';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const app = initializeApp({
    credential: applicationDefault(),
    projectId: args.project,
  });
  const db = getFirestore(app);

  const { services: rawActive, retiredServices: rawRetired, staff: rawStaff } = require('../../seed/data.js');
  // El estado esperado incluye los servicios retirados/renombrados (inactive)
  // para que --apply también los baje en producción, en vez de dejarlos como
  // "solo en producción" para revisión manual.
  const rawServices = rawActive.concat(rawRetired || []);
  const { services: intendedServices, staff: intendedStaff } = computeIntended(rawServices, rawStaff);

  const [liveServices, liveStaff] = await Promise.all([
    readLive(db, 'services'),
    readLive(db, 'staff'),
  ]);

  const servicesResult = reconcileCollection('services', intendedServices, liveServices);
  const staffResult = reconcileCollection('staff', intendedStaff, liveStaff);

  console.log(`Proyecto: ${args.project}`);
  console.log(`Modo: ${args.apply ? 'APLICAR (--apply)' : 'SOLO REPORTE'}`);
  printReport(servicesResult);
  printReport(staffResult);

  const pending = [
    ...servicesResult.toWrite.map((x) => ({ ...x, col: 'services' })),
    ...servicesResult.missing.map((x) => ({ ...x, col: 'services' })),
    ...staffResult.toWrite.map((x) => ({ ...x, col: 'staff' })),
    ...staffResult.missing.map((x) => ({ ...x, col: 'staff' })),
  ];
  const totalLiveOnly = servicesResult.liveOnly.length + staffResult.liveOnly.length;

  console.log(`\nResumen: ${pending.length} documento(s) para escribir, ${totalLiveOnly} solo-en-producción para revisión manual.`);

  if (!args.apply) {
    console.log('Modo solo-reporte: no se escribió nada. Corré con --apply para aplicar los cambios de arriba.');
    return;
  }

  if (pending.length === 0) {
    console.log('Nada que aplicar: no hay diferencias ni faltantes.');
    return;
  }

  // Nota: no se vuelve a leer Firestore antes de escribir -- si alguien edita
  // uno de estos mismos documentos desde el panel admin en vivo mientras el
  // operador está leyendo el reporte y escribiendo YES, ese --apply pisaría
  // esa edición concurrente con el snapshot leído al principio de esta
  // corrida. Riesgo aceptado: este es un script de un solo uso, corrido a
  // mano por un operador, no un job recurrente -- si hay dudas, volver a
  // correr en modo solo-reporte antes de confirmar.
  const confirmed = await confirmApply(pending.length, args.project);
  if (!confirmed) {
    console.log('Cancelado: no se escribió nada.');
    process.exitCode = 1;
    return;
  }

  const batch = db.batch();
  for (const { id, doc, col } of pending) {
    batch.set(db.collection(col).doc(id), stripId(doc), { merge: true });
  }
  await batch.commit();
  console.log(`OK: se escribieron ${pending.length} documento(s) en el proyecto "${args.project}".`);
}

module.exports = {
  parseArgs,
  computeIntended,
  diffFields,
  reconcileCollection,
  stripId,
  confirmApply,
};

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err.stack || err.message);
    process.exit(1);
  });
}
