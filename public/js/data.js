// public/js/data.js — capa de datos sobre Firestore. Expone window.SWData.
import { db, storage, functions } from './firebase-init.js';
import {
  collection, getDocs, doc, setDoc, addDoc, deleteDoc,
  writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import {
  ref, uploadBytes, getDownloadURL, deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js';

async function readCol(name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

// Catálogo para el widget público de reservas: solo services + staff
// (lectura pública según firestore.rules; adminLog/bookings requieren auth).
async function loadCatalog() {
  const [services, staff] = await Promise.all([readCol('services'), readCol('staff')]);
  return { services, staff };
}

// Reservas
async function getBookings() {
  return await readCol('bookings');
}

async function saveBookings(arr) {
  const batch = writeBatch(db);
  (arr || []).forEach(b => {
    const id = b.id || b.code;
    batch.set(doc(db, 'bookings', id), b, { merge: true });
  });
  await batch.commit();
}

// Crear UNA reserva (camino público). Dispara la Cloud Function de email.
async function createBooking(obj) {
  const payload = { ...obj, status: 'pending', emailStatus: 'pending', createdAtTs: serverTimestamp() };
  const ref = await addDoc(collection(db, 'bookings'), payload);
  return ref.id;
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

// Cuenta las visitas Club SW de un email vía Cloud Function (el cliente
// público no tiene permiso de leer `bookings` directamente).
async function getClubStatus(email) {
  const call = httpsCallable(functions, 'getClubStatus');
  const { data } = await call({ email });
  return data; // { visitCount, benefitReached }
}

window.SWData = {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus,
};
export {
  loadAdmin, saveAdmin, loadCatalog, getBookings, saveBookings, createBooking,
  getPatients, savePatients, deletePatient,
  uploadPatientPhoto, deletePatientPhoto, getClubStatus,
};
