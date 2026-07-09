// functions/index.js — envía emails al crear una reserva.
'use strict';
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { sendBookingEmails } = require('./email.js');
const { buildPatientUpsert, countClubVisits } = require('./patients.js');
const { computeAvailability } = require('./availability.js');

admin.initializeApp();
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
        await admin.firestore().collection('adminLog').add({
          action: 'email_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
        });
      } catch (err2) {
        logger.error('Fallo al registrar emailStatus failed', err2);
      }
      // No relanzar: la reserva ya está guardada.
    }
    try {
      const db = admin.firestore();
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
    const db = admin.firestore();
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
    const date = (request.data && request.data.date || '').trim();
    if (!date) throw new HttpsError('invalid-argument', 'date es requerido');
    const barberId = ((request.data && request.data.barberId) || '').trim();

    const db = admin.firestore();
    let bookingsQuery = db.collection('bookings').where('date', '==', date);
    if (barberId && barberId !== 'any') {
      bookingsQuery = bookingsQuery.where('barberId', '==', barberId);
    }
    const [bookingsSnap, staffSnap] = await Promise.all([
      bookingsQuery.get(),
      db.collection('staff').where('status', '==', 'active').get(),
    ]);
    const bookings = bookingsSnap.docs.map(d => d.data());
    const staff = staffSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    return computeAvailability({ bookings, staff, barberId });
  }
);
