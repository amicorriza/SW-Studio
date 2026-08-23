// public/js/data.js — capa de datos sobre Firestore. Expone window.SWData.
import { db, storage, functions } from './firebase-init.js';
import {
  collection, getDocs, getDoc, doc, setDoc, deleteDoc, deleteField,
  writeBatch, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import {
  ref, uploadBytes, getDownloadURL, deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js';

async function readCol(name) {
  const snap = await getDocs(collection(db, name));
  // El ID real de Firestore va AL FINAL del spread para que gane sobre
  // cualquier campo `id` que haya quedado guardado dentro del propio
  // documento (ver bookings: versiones viejas de saveBookings lo estampaban).
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

// Carga el objeto D que usa el admin: {services, staff, info, log, schedule}
async function loadAdmin() {
  const [services, staff, infoSnap, log] = await Promise.all([
    readCol('services'), readCol('staff'),
    getDocs(collection(db, 'businessInfo')), readCol('adminLog'),
  ]);
  const infoDoc = infoSnap.docs.find(d => d.id === 'main');
  return {
    services, staff,
    info: infoDoc ? infoDoc.data() : {},
    log: log.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 30),
    schedule: [],
  };
}

// Guarda todo el objeto D (batch). Reemplaza servicios/staff/info y BORRA de
// Firestore los docs que ya no están en D — sin esto, un barbero/servicio
// eliminado en el admin reaparece al recargar porque loadAdmin lee la
// colección completa.
async function saveAdmin(D) {
  const batch = writeBatch(db);
  const [svcSnap, stfSnap] = await Promise.all([
    getDocs(collection(db, 'services')),
    getDocs(collection(db, 'staff')),
  ]);
  const keepSvc = new Set((D.services || []).map(s => s.id));
  const keepStf = new Set((D.staff || []).map(s => s.id));
  svcSnap.docs.forEach(d => { if (!keepSvc.has(d.id)) batch.delete(d.ref); });
  stfSnap.docs.forEach(d => { if (!keepStf.has(d.id)) batch.delete(d.ref); });
  (D.services || []).forEach(s => batch.set(doc(db, 'services', s.id), stripId(s)));
  (D.staff || []).forEach(s => batch.set(doc(db, 'staff', s.id), stripId(s)));
  if (D.info) batch.set(doc(db, 'businessInfo', 'main'), D.info);
  await batch.commit();
}

function stripId(o) { const { id, ...rest } = o; return rest; }

// Catálogo para el widget público de reservas: services + staff + la zona
// horaria del negocio (businessInfo.tz -- lectura pública según
// firestore.rules, igual que services/staff; adminLog/bookings requieren
// auth) + el buffer de limpieza entre citas (businessInfo.bufferMin). Ambos
// pueden venir ausentes (negocio recién configurado, o businessInfo/main de
// antes de que existiera el campo) -- el fallback a DEFAULT_TZ/0 vive en
// quien consuma esto (public/index.html), no acá: esta capa solo devuelve lo
// que hay en Firestore, sin lógica de negocio.
async function loadCatalog() {
  const [services, staff, infoSnap] = await Promise.all([
    readCol('services'), readCol('staff'), getDoc(doc(db, 'businessInfo', 'main')),
  ]);
  const info = infoSnap.exists() ? infoSnap.data() : {};
  return { services, staff, tz: info.tz, bufferMin: info.bufferMin };
}

// Reservas
async function getBookings() {
  return await readCol('bookings');
}

// Guarda UNA reserva por su ID (crea o edita). Escritura puntual -- antes esto
// leía la colección `bookings` ENTERA y borraba cualquier doc que no viniera
// en el array recibido (delete-diff). Sin transacción, eso dejaba una ventana
// entre el getDocs y el commit en la que una reserva creada por el widget
// público podía quedar fuera del array y ser BORRADA por el guardado del
// panel. `stripId` + `id: deleteField()` limpian, al primer guardado
// posterior, el campo `id` que versiones viejas de esta función estampaban
// dentro del propio documento (no hace falta migración aparte).
async function saveBooking(b) {
  const id = b.id || b.code;
  await setDoc(doc(db, 'bookings', id), { ...stripId(b), id: deleteField() }, { merge: true });
  return id;
}

// Borra UNA reserva por su ID real (no por `code`: una reserva creada por el
// widget público tiene un autoId de Firestore distinto de su `code`).
async function deleteBooking(id) {
  await deleteDoc(doc(db, 'bookings', id));
}

// Suscripción en tiempo real a `bookings` para el panel admin (permitido por
// firestore.rules: bookings es admin-read). `ready` resuelve tras el primer
// snapshot para no dejar un flash de "0 reservas" en el dashboard tras login.
function subscribeBookings(onChange) {
  let first = true, resolveReady;
  const ready = new Promise(res => { resolveReady = res; });
  const unsubscribe = onSnapshot(
    collection(db, 'bookings'),
    snap => {
      onChange(snap.docs.map(d => ({ ...d.data(), id: d.id })));
      if (first) { first = false; resolveReady(); }
    },
    err => {
      console.error('subscribeBookings: fallo la suscripción en tiempo real', err);
      if (first) { first = false; resolveReady(); }
    }
  );
  return { unsubscribe, ready };
}

// Crear UNA reserva (camino público), vía el callable transaccional
// createBooking (Fase A) -- reemplaza el addDoc directo de antes, que no
// verificaba disponibilidad al escribir. El servidor resuelve dur/price
// (desde services), el barbero real si se pidió 'any', arma status/
// emailStatus/createdAt y dispara onBookingCreated igual que antes. Si el
// horario ya no está libre, la Cloud Function rechaza con
// HttpsError('already-exists'|'resource-exhausted'|...) -- ver el mapeo de
// mensajes en public/index.html.
async function createBooking(obj) {
  const call = httpsCallable(functions, 'createBooking');
  const { data } = await call(obj);
  return data.id;
}

// Clientes (v19). El upsert automático por reserva lo hace la Cloud
// Function onBookingCreated (Task 6.6); savePatients cubre las escrituras
// manuales del admin (crear/editar/borrar cliente, notas, visita manual).
async function getPatients() {
  return await readCol('patients');
}

async function savePatients(arr) {
  const batch = writeBatch(db);
  (arr || []).forEach(p => batch.set(doc(db, 'patients', p.id), stripId(p), { merge: true }));
  await batch.commit();
}

async function deletePatient(id) {
  await deleteDoc(doc(db, 'patients', id));
}

// Bloqueos de horario (colación puntual, trámites, etc.). Un doc por
// bloqueo -- a diferencia de bookings/patients no se usa el patrón "array
// completo + diff de borrados", porque acá cada mutación (crear/editar/
// eliminar un bloqueo) ya es una operación puntual sobre un solo doc.
async function getScheduleBlocks() {
  return await readCol('scheduleBlocks');
}

async function saveScheduleBlock(block) {
  const id = block.id || ('sb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  await setDoc(doc(db, 'scheduleBlocks', id), stripId({ ...block, id }), { merge: true });
  return id;
}

async function deleteScheduleBlock(id) {
  await deleteDoc(doc(db, 'scheduleBlocks', id));
}

// Sube una foto (blob ya comprimido por compressImage) a Storage y devuelve
// el objeto {url, path, date} que se agrega al array `photos` del paciente.
async function uploadPatientPhoto(patientId, blob) {
  const photoId = 'pat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const path = `patients/${patientId}/${photoId}.jpg`;
  const objRef = ref(storage, path);
  await uploadBytes(objRef, blob, { contentType: 'image/jpeg' });
  const url = await getDownloadURL(objRef);
  const photo = { url, path, date: new Date().toISOString() };
  const patientRef = doc(db, 'patients', patientId);
  const patients = await getPatients();
  const p = patients.find(x => x.id === patientId);
  const photos = [...((p && p.photos) || []), photo];
  await setDoc(patientRef, { photos }, { merge: true });
  return photo;
}

// Borra una foto de Storage y la quita del array `photos` del paciente.
async function deletePatientPhoto(patientId, path) {
  await deleteObject(ref(storage, path));
  const patientRef = doc(db, 'patients', patientId);
  const patients = await getPatients();
  const p = patients.find(x => x.id === patientId);
  const photos = ((p && p.photos) || []).filter(ph => ph.path !== path);
  await setDoc(patientRef, { photos }, { merge: true });
}

// ══ IMÁGENES DEL SITIO (herramienta de reemplazo manual, panel admin) ══
// Un doc por slot en la colección `siteImages` (id = slot, ej. 'hero',
// 'galeria-3'). El landing público lee esta colección al cargar y, si un
// slot trae `url`, reemplaza el <img data-img-slot="..."> correspondiente
// -- si no hay override, el <img> conserva su src por defecto en /assets/.

// Carga todos los overrides activos: {slot: {url, path}}. `path` es el
// nombre del objeto en Storage -- lo necesita el admin para poder borrarlo
// al restaurar el original; el landing público solo usa `.url`.
async function loadSiteImages() {
  const rows = await readCol('siteImages');
  const map = {};
  rows.forEach((r) => { if (r.url) map[r.id] = { url: r.url, path: r.path || '' }; });
  return map;
}

// Sube el reemplazo (blob ya comprimido por compressImage) a Storage y
// guarda {url, path, updatedAt} en el doc del slot.
async function saveSiteImage(slot, blob) {
  const path = `siteImages/${slot}/${Date.now()}.jpg`;
  const objRef = ref(storage, path);
  await uploadBytes(objRef, blob, { contentType: 'image/jpeg' });
  const url = await getDownloadURL(objRef);
  await setDoc(doc(db, 'siteImages', slot), { url, path, updatedAt: new Date().toISOString() });
  return { url, path };
}

// Quita el override: borra el archivo de Storage (si se pasa `path`) y el
// doc del slot -- el <img> vuelve a mostrar su src por defecto en /assets/.
async function deleteSiteImage(slot, path) {
  if (path) {
    try { await deleteObject(ref(storage, path)); }
    catch (e) { /* el archivo puede ya no existir; no bloquea el borrado del doc */ }
  }
  await deleteDoc(doc(db, 'siteImages', slot));
}

// Cuenta las visitas Club SW de un email vía Cloud Function (el cliente
// público no tiene permiso de leer `bookings` directamente).
async function getClubStatus(email) {
  const call = httpsCallable(functions, 'getClubStatus');
  const { data } = await call({ email });
  return data; // { visitCount, benefitReached }
}

// Disponibilidad real de horarios (widget público de reservas) vía Cloud
// Function: el cliente no tiene permiso de leer `bookings` directamente (ver
// firestore.rules), así que esta consulta pasa por getAvailability, que
// corre con el Admin SDK y solo devuelve datos derivados (barberId+rangos).
// Contrato completo y responsabilidades del llamador documentadas en
// functions/availability.js.
async function getAvailability(date, barberId) {
  const call = httpsCallable(functions, 'getAvailability');
  const { data } = await call({ date, barberId });
  return data; // { barberBusy, activeBarberIds }
}

// Disponibilidad real en tiempo real, vía la vista materializada
// `availability/{YYYY-MM-DD}` que mantiene la Cloud Function
// onBookingWritten (nunca contiene PII, solo rangos ocupados derivados —
// ver functions/availability.js). `dateKey` no exista todavía = sin
// reservas ese día = plena disponibilidad, se resuelve igual que
// `barberBusy` vacío.
function subscribeAvailability(dateKey, onChange, onError) {
  return onSnapshot(doc(db, 'availability', dateKey), snap => {
    onChange(snap.exists() ? (snap.data().barberBusy || {}) : {});
  }, err => {
    console.error('subscribeAvailability: fallo la suscripción', err);
    if (onError) onError(err);
  });
}

// ══ RESEÑAS DE GOOGLE ══
// `googleReviews/main` es el espejo del perfil de Google Business que
// mantienen las Cloud Functions refreshGoogleReviews (diaria) y
// syncGoogleReviews (botón del panel). Lectura pública, igual que
// availability: el visitante nunca habla con Google ni ve una API key.
//
// El doc trae DOS listas y no una por accidente: `reviews` son las que
// devuelve Places, y `manualReviews` es la lista curada que el panel guarda
// en el mismo doc y que ninguna sincronización pisa. Cuál se muestra lo
// decide el landing (ver pickReviews en public/index.html), no esta capa --
// acá solo se devuelve lo que hay en Firestore.
async function loadGoogleReviews() {
  const snap = await getDoc(doc(db, 'googleReviews', 'main'));
  return snap.exists() ? snap.data() : null;
}

// Guarda solo la lista curada del panel. `merge: true` es obligatorio, no
// una optimización: sin él este set borraría rating/userRatingCount/reviews
// que escribió la Cloud Function, y la sección quedaría sin el total real
// del perfil hasta la próxima corrida del cron.
async function saveManualReviews(manualReviews) {
  await setDoc(doc(db, 'googleReviews', 'main'), { manualReviews }, { merge: true });
}

// Dispara la sincronización con Google a pedido (botón del panel). Es
// callable y admin-only porque cada llamada se factura contra la cuenta de
// Places del cliente.
async function syncGoogleReviews(force = false) {
  const call = httpsCallable(functions, 'syncGoogleReviews');
  const { data } = await call({ force });
  return data;
}

window.SWData = {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBooking, deleteBooking, subscribeBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus, getAvailability, subscribeAvailability,
  loadSiteImages, saveSiteImage, deleteSiteImage,
  getScheduleBlocks, saveScheduleBlock, deleteScheduleBlock,
  loadGoogleReviews, saveManualReviews, syncGoogleReviews,
};
export {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBooking, deleteBooking, subscribeBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus, getAvailability, subscribeAvailability,
  loadSiteImages, saveSiteImage, deleteSiteImage,
  getScheduleBlocks, saveScheduleBlock, deleteScheduleBlock,
  loadGoogleReviews, saveManualReviews, syncGoogleReviews,
};
