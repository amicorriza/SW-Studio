// functions/index.js — envía emails al crear una reserva.
'use strict';
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { sendBookingEmails } = require('./email.js');
const { buildPatientUpsert, countClubVisits } = require('./patients.js');

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
      await snap.ref.update({ emailStatus: 'failed' });
      await admin.firestore().collection('adminLog').add({
        action: 'email_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
      });
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
