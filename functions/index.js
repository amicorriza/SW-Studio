// functions/index.js — envía emails al crear una reserva.
'use strict';
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { sendBookingEmails } = require('./email.js');
const { buildPatientUpsert, countClubVisits } = require('./patients.js');
const { computeAvailability, dateKeyOf, dayBoundsOf } = require('./availability.js');

const app = initializeApp();
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const FROM_EMAIL = defineSecret('FROM_EMAIL');
const SHOP_EMAIL = defineSecret('SHOP_EMAIL');

exports.onBookingCreated = onDocumentCreated(
  { document: 'bookings/{id}', region: 'southamerica-east1', secrets: [RESEND_API_KEY, FROM_EMAIL, SHOP_EMAIL] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const b = snap.data();
    try {
      await sendBookingEmails(b, {
        apiKey: RESEND_API_KEY.value(),
        fromEmail: FROM_EMAIL.value(),
        shopEmail: SHOP_EMAIL.value(),
      });
      await snap.ref.update({ emailStatus: 'sent' });
      logger.info('Emails enviados', { code: b.code });
    } catch (err) {
      logger.error('Fallo al enviar emails', err);
      // Si estas escrituras también fallan (ej. IAM), no deben impedir el
      // sync de patients de más abajo — fue lo que pasó en el incidente del 5-7 jul.
      try {
        await snap.ref.update({ emailStatus: 'failed' });
        await getFirestore(app).collection('adminLog').add({
          action: 'email_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
        });
      } catch (err2) {
        logger.error('Fallo al registrar emailStatus failed', err2);
      }
      // No relanzar: la reserva ya está guardada.
    }
    try {
      const db = getFirestore(app);
      const existingSnap = await db.collection('patients').where('email', '==', b.email).limit(1).get();
      const existingDoc = existingSnap.empty ? null : existingSnap.docs[0];
      const patient = buildPatientUpsert(existingDoc ? existingDoc.data() : null, b);
      if (existingDoc) {
        await existingDoc.ref.set(patient, { merge: true });
      } else {
        await db.collection('patients').add(patient);
      }
    } catch (err) {
      logger.error('Fallo al sincronizar patients', err);
      // No relanzar: la reserva y el email ya se procesaron independientemente.
    }
  }
);

exports.getClubStatus = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const email = (request.data && request.data.email || '').trim();
    if (!email) throw new HttpsError('invalid-argument', 'email es requerido');
    const db = getFirestore(app);
    const snap = await db.collection('bookings').where('email', '==', email).where('club', '==', 'member').get();
    const bookings = snap.docs.map(d => d.data());
    return countClubVisits(bookings, email);
  }
);

// getAvailability: el público no puede leer `bookings` directo (ver
// firestore.rules), así que el widget de reservas consulta disponibilidad
// real vía esta función server-side (Admin SDK, no sujeta a reglas). Solo
// devuelve datos derivados (barberId + rangos start/end) — nunca
// name/email/phone ni ningún otro dato de otras reservas/clientes.
exports.getAvailability = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    // Solo se valida que `date`/`barberId` no vengan vacíos, no su formato:
    // el widget siempre los arma desde su propio date-picker/selector de
    // barbero, nunca desde texto libre. Un `date` con formato inesperado o
    // un `barberId` que ya no corresponde a ningún staff activo NO tira
    // error acá -- simplemente no calzan con ninguna reserva/activeBarberIds
    // y la respuesta "parece" plena disponibilidad. Es responsabilidad de
    // quien llama (el cliente) tratar un barberId ausente de
    // `activeBarberIds` como no disponible, no de esta función.
    const date = (request.data && request.data.date || '').trim();
    if (!date) throw new HttpsError('invalid-argument', 'date es requerido');
    const barberId = ((request.data && request.data.barberId) || '').trim();

    // `date` puede venir con formatos ligeramente distintos según si la
    // reserva se creó desde el widget público o desde el admin (uno usa
    // toISOString(), el otro concatena fecha+hora a mano) -- pero ambos
    // formatos siempre dejan el día calendario correcto en los primeros 10
    // caracteres, así que dateKeyOf() es seguro sin importar cuál de los dos
    // lo generó. `scheduleBlocks` es una colección nueva: se guarda y
    // consulta siempre por el día puro 'YYYY-MM-DD', sin ese problema.
    // `dow` se deriva con getUTCDay() (no getDay()) a propósito: Date-only
    // ISO parsea como medianoche UTC, y getUTCDay() lee el día de semana en
    // términos UTC sin importar en qué zona horaria corra el proceso --
    // getDay() sí dependería de eso (verificado: da un día distinto bajo
    // TZ=America/Santiago vs TZ=UTC), así que no es intercambiable acá.
    const dayStr = dateKeyOf(date);
    const dow = new Date(dayStr).getUTCDay();

    const db = getFirestore(app);
    let bookingsQuery = db.collection('bookings').where('date', '==', date);
    if (barberId && barberId !== 'any') {
      bookingsQuery = bookingsQuery.where('barberId', '==', barberId);
    }
    let blocksQuery = db.collection('scheduleBlocks').where('date', '==', dayStr);
    if (barberId && barberId !== 'any') {
      blocksQuery = blocksQuery.where('barberId', '==', barberId);
    }
    const [bookingsSnap, staffSnap, blocksSnap] = await Promise.all([
      bookingsQuery.get(),
      db.collection('staff').where('status', '==', 'active').get(),
      blocksQuery.get(),
    ]);
    const bookings = bookingsSnap.docs.map(d => d.data());
    const staff = staffSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const scheduleBlocks = blocksSnap.docs.map(d => d.data());
    return computeAvailability({ bookings, staff, barberId, dow, scheduleBlocks });
  }
);

// Recalcula la vista materializada `availability/{dateKey}` (sin PII, solo
// rangos ocupados por barbero) para un día calendario, a partir de una
// lectura fresca de `bookings` -- mismo espíritu de "recompute completo
// desde el estado actual" que ya usan saveAdmin/saveBookings (public/js/data.js),
// así que ejecuciones del trigger fuera de orden se autocorrigen: la última
// en terminar simplemente sobreescribe con el estado correcto vigente.
async function recomputeAvailabilityForDate(db, dateKey) {
  const { start, end } = dayBoundsOf(dateKey);
  const snap = await db.collection('bookings')
    .where('date', '>=', start).where('date', '<', end).get();
  const bookings = snap.docs.map(d => d.data());
  const { barberBusy } = computeAvailability({ bookings, staff: [], barberId: 'any' });
  const ref = db.collection('availability').doc(dateKey);
  if (Object.keys(barberBusy).length === 0) await ref.delete();
  else await ref.set({ barberBusy, updatedAt: FieldValue.serverTimestamp() });
}

// Mantiene `availability/{dateKey}` en tiempo real para el widget público
// (que no puede leer `bookings` directo -- ver firestore.rules) ante
// cualquier creación/edición/borrado de una reserva. Trigger independiente
// de onBookingCreated -- mismo documento, otra responsabilidad.
exports.onBookingWritten = onDocumentWritten(
  { document: 'bookings/{id}', region: 'southamerica-east1' },
  async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    // Un update que cambia de día requiere recalcular AMBAS fechas -- la
    // vieja (para liberar el horario que dejó de estar ocupado) y la nueva.
    const dates = new Set();
    if (before && before.date) dates.add(dateKeyOf(before.date));
    if (after && after.date) dates.add(dateKeyOf(after.date));
    if (!dates.size) return;
    const db = getFirestore(app);
    await Promise.all([...dates].map(dk => recomputeAvailabilityForDate(db, dk)));
  }
);
