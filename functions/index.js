// functions/index.js — envía emails al crear una reserva.
'use strict';
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { sendBookingEmails } = require('./email.js');
const { sendBookingWhatsApp } = require('./whatsapp.js');
const { buildPatientUpsert, countClubVisits } = require('./patients.js');

admin.initializeApp();
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const FROM_EMAIL = defineSecret('FROM_EMAIL');
const SHOP_EMAIL = defineSecret('SHOP_EMAIL');
const KAPSO_API_KEY = defineSecret('KAPSO_API_KEY');
const KAPSO_PHONE_NUMBER_ID = defineSecret('KAPSO_PHONE_NUMBER_ID');
const WHATSAPP_MODE = defineSecret('WHATSAPP_MODE');
const WHATSAPP_TEMPLATE_NAME = defineSecret('WHATSAPP_TEMPLATE_NAME');
const WHATSAPP_TEMPLATE_LANG = defineSecret('WHATSAPP_TEMPLATE_LANG');

exports.onBookingCreated = onDocumentCreated(
  {
    document: 'bookings/{id}', region: 'southamerica-east1',
    secrets: [
      RESEND_API_KEY, FROM_EMAIL, SHOP_EMAIL,
      KAPSO_API_KEY, KAPSO_PHONE_NUMBER_ID, WHATSAPP_MODE, WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG,
    ],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const b = snap.data();

    const [emailResult, waResult] = await Promise.allSettled([
      sendBookingEmails(b, { apiKey: RESEND_API_KEY.value(), fromEmail: FROM_EMAIL.value(), shopEmail: SHOP_EMAIL.value() }),
      sendBookingWhatsApp(b, {
        apiKey: KAPSO_API_KEY.value(),
        phoneNumberId: KAPSO_PHONE_NUMBER_ID.value(),
        mode: WHATSAPP_MODE.value(),
        templateName: WHATSAPP_TEMPLATE_NAME.value(),
        templateLang: WHATSAPP_TEMPLATE_LANG.value(),
      }),
    ]);

    await snap.ref.update({
      emailStatus: emailResult.status === 'fulfilled' ? 'sent' : 'failed',
      whatsappStatus: waResult.status === 'fulfilled' ? 'sent' : 'failed',
    });

    if (emailResult.status === 'fulfilled') {
      logger.info('Emails enviados', { code: b.code });
    } else {
      logger.error('Fallo al enviar emails', emailResult.reason);
      await admin.firestore().collection('adminLog').add({
        action: 'email_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
      });
      // No relanzar: la reserva ya está guardada.
    }

    if (waResult.status === 'rejected') {
      logger.error('Fallo al enviar WhatsApp', waResult.reason);
      await admin.firestore().collection('adminLog').add({
        action: 'whatsapp_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
      });
      // No relanzar: mismo criterio que el email.
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
      // No relanzar: la reserva y el email/WhatsApp ya se procesaron independientemente.
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
