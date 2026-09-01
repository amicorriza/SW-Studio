// functions/index.js — envía emails al crear una reserva.
'use strict';
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { sendBookingEmails } = require('./email.js');
const { buildPatientUpsert, countClubVisits } = require('./patients.js');
const { computeAvailability, dateKeyOf, dayBoundsOf } = require('./shared/availability.js');
const { resolveCreateBooking } = require('./createBooking.js');
const { resolveBusinessTz, resolveBufferMin } = require('./shared/timezone.js');
const { searchPlaceId, fetchPlaceDetails, isFresh } = require('./googleReviews.js');

const app = initializeApp();
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const FROM_EMAIL = defineSecret('FROM_EMAIL');
const SHOP_EMAIL = defineSecret('SHOP_EMAIL');
const GOOGLE_PLACES_API_KEY = defineSecret('GOOGLE_PLACES_API_KEY');

// Mismo criterio de admin que isAdmin() en firestore.rules — custom claim
// preferido, UID como respaldo. Está duplicado a propósito y NO por descuido:
// las reglas son CEL y no pueden importar JS. Cuando se retire el fallback de
// UID hay que tocar los cuatro sitios juntos (firestore.rules, storage.rules
// ×2 y este) — está anotado como pendiente de Fase 3.
const ADMIN_UID_FALLBACK = 'VUm858rENuNVzB4MAMtzLnGb1A63';
function assertAdmin(request) {
  const auth = request.auth;
  const isAdmin = !!auth && (auth.token.admin === true || auth.uid === ADMIN_UID_FALLBACK);
  if (!isAdmin) throw new HttpsError('permission-denied', 'Solo el panel de administración puede hacer esto.');
}

exports.onBookingCreated = onDocumentCreated(
  { document: 'bookings/{id}', region: 'southamerica-east1', secrets: [RESEND_API_KEY, FROM_EMAIL, SHOP_EMAIL] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const b = snap.data();
    // Normalizado UNA sola vez: lo usan tanto el envío de emails como el sync
    // de patients de abajo, para que ambos coincidan en qué cuenta como "el
    // mismo" correo (mayúsculas/espacios no deberían crear fichas separadas).
    const email = (b.email || '').trim().toLowerCase();
    // Junta los campos a escribir y hace UN solo `update` al final del
    // handler (ver más abajo) -- escribir emailStatus y patientSyncStatus por
    // separado dispararía onBookingWritten dos veces más de las necesarias
    // (recomputa `availability` cada vez); es idempotente, no un bug, pero
    // ruido y costo evitable.
    const bookingUpdate = {};

    // Email opcional (panel admin): sin email no hay a quién enviarle, así
    // que ni se intenta -- 'skipped' es un estado distinto de 'failed' (que
    // significa "había email pero el envío falló") para no ensuciar adminLog
    // con fallos de un envío que nunca correspondía intentar.
    if (email) {
      try {
        await sendBookingEmails({ ...b, email }, {
          apiKey: RESEND_API_KEY.value(),
          fromEmail: FROM_EMAIL.value(),
          shopEmail: SHOP_EMAIL.value(),
        });
        bookingUpdate.emailStatus = 'sent';
        logger.info('Emails enviados', { code: b.code });
      } catch (err) {
        logger.error('Fallo al enviar emails', err);
        bookingUpdate.emailStatus = 'failed';
        // Si esta escritura también falla (ej. IAM), no debe impedir el sync
        // de patients de más abajo — fue lo que pasó en el incidente del 5-7 jul.
        try {
          await getFirestore(app).collection('adminLog').add({
            action: 'email_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
          });
        } catch (err2) {
          logger.error('Fallo al registrar adminLog de email_failed', err2);
        }
        // No relanzar: la reserva ya está guardada.
      }
    } else {
      bookingUpdate.emailStatus = 'skipped';
    }

    // Sin email no hay clave de unión para identificar/fusionar al cliente
    // entre reservas: no se crea ni actualiza ficha (nunca se consulta con
    // string vacío -- eso fusionaba clientes distintos, ver countClubVisits).
    // Consecuencia operativa: una reserva tomada por teléfono sin correo NO
    // genera cliente en el CRM ni acumula visitas para el Club SW. Victoria
    // puede crear la ficha a mano desde el panel si el cliente importa -- es
    // una decisión explícita, no un olvido.
    if (email) {
      try {
        const db = getFirestore(app);
        const existingSnap = await db.collection('patients').where('email', '==', email).limit(1).get();
        const existingDoc = existingSnap.empty ? null : existingSnap.docs[0];
        const patient = buildPatientUpsert(existingDoc ? existingDoc.data() : null, { ...b, email });
        if (existingDoc) {
          await existingDoc.ref.set(patient, { merge: true });
        } else {
          await db.collection('patients').add(patient);
        }
      } catch (err) {
        logger.error('Fallo al sincronizar patients', err);
        bookingUpdate.patientSyncStatus = 'failed';
        try {
          await getFirestore(app).collection('adminLog').add({
            action: 'patient_sync_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
          });
        } catch (err2) {
          logger.error('Fallo al registrar adminLog de patient_sync_failed', err2);
        }
        // No relanzar: la reserva y el email ya se procesaron independientemente.
      }
    }

    try {
      await snap.ref.update(bookingUpdate);
    } catch (err) {
      logger.error('Fallo al actualizar el estado de la reserva', err);
    }
  }
);

// createBooking (Fase A): reemplaza el addDoc directo del widget público.
// Antes NADA verificaba disponibilidad al escribir -- dos reservas al mismo
// horario simplemente coexistían. `runTransaction` + lecturas vía `tx.get()`
// (nunca `db.get()` suelto: si no, Firestore no trackea el read-set y se
// pierde la garantía de serialización que es todo el punto de la
// transacción) hacen que dos llamadas concurrentes al mismo slot se
// resuelvan en orden: la segunda relee el estado ya actualizado y encuentra
// el solape. Toda la lógica de decisión vive en resolveCreateBooking()
// (createBooking.js, puro, testeado sin emulador) -- acá solo se hace I/O.
exports.createBooking = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const payload = request.data || {};
    const svcId = typeof payload.svcId === 'string' ? payload.svcId : '';
    // Guard explícito: `.doc('')` lanza una excepción cruda de Admin SDK
    // (no un permission-denied ni un HttpsError legible) antes de llegar a
    // resolveCreateBooking. isValidBookingPayload() replica `is string` de
    // isValidBooking() en firestore.rules a propósito -- esa regla tampoco
    // exige que svcId sea no-vacío -- así que este guard vive acá, en el
    // límite de I/O, no en la validación pura.
    if (!svcId) throw new HttpsError('invalid-argument', 'svcId es requerido.');

    const dayKey = dateKeyOf(typeof payload.date === 'string' ? payload.date : '');
    const { start, end } = dayBoundsOf(dayKey);
    const db = getFirestore(app);

    const result = await db.runTransaction(async (tx) => {
      // businessInfo/main va junto con el resto de las lecturas, ANTES de
      // cualquier escritura -- regla dura de transacciones de Firestore: una
      // lectura después de un set() falla o pierde la garantía de
      // serialización (mismo motivo por el que todo acá usa tx.get(), nunca
      // db.get() suelto).
      const [serviceSnap, staffSnap, bookingsSnap, blocksSnap, businessInfoSnap] = await Promise.all([
        tx.get(db.collection('services').doc(svcId)),
        tx.get(db.collection('staff').where('status', '==', 'active')),
        tx.get(db.collection('bookings').where('date', '>=', start).where('date', '<', end)),
        tx.get(db.collection('scheduleBlocks').where('date', '==', dayKey)),
        tx.get(db.collection('businessInfo').doc('main')),
      ]);

      const resolved = resolveCreateBooking({
        payload,
        now: new Date(),
        service: serviceSnap.exists ? { id: serviceSnap.id, ...serviceSnap.data() } : null,
        staff: staffSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        bookingsForDay: bookingsSnap.docs.map(d => d.data()),
        scheduleBlocksForDay: blocksSnap.docs.map(d => d.data()),
        // businessInfo/main puede no existir todavía (negocio recién
        // configurado) o existir sin `tz` (creado antes de Fase 2) --
        // resolveBusinessTz() cae a DEFAULT_TZ en ambos casos, nunca
        // bloquea la reserva.
        businessTz: resolveBusinessTz(businessInfoSnap.exists ? businessInfoSnap.data() : null),
        // Mismo doc ya leído arriba, sin I/O adicional. bufferMin ausente
        // -> resolveBufferMin cae a 0 (comportamiento actual, sin margen).
        bufferMin: resolveBufferMin(businessInfoSnap.exists ? businessInfoSnap.data() : null),
      });
      if (!resolved.ok) return resolved;

      const ref = db.collection('bookings').doc();
      tx.set(ref, { ...resolved.doc, createdAtTs: FieldValue.serverTimestamp() });
      return { ok: true, id: ref.id };
    });

    if (!result.ok) throw new HttpsError(result.code, result.message);
    return { id: result.id };
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
  // La vista incluye las dos fuentes de ocupación que son POR FECHA y que el
  // público no puede leer directo: las reservas y los bloqueos puntuales
  // (scheduleBlocks). Sin los bloqueos acá, el widget -- que lee esta vista y
  // ya no llama a getAvailability -- volvería a ofrecer horas bloqueadas.
  //
  // La colación recurrente (staff.schedule[dow].break) NO entra acá a
  // propósito: es semanal, no por fecha, y `staff` es lectura pública que el
  // widget ya carga en refreshCatalog(), así que la aplica en cliente (ver
  // isBarberFreeAt en public/index.html) junto al horario de apertura, que ya
  // se resuelve ahí. Meterla también en la vista obligaría a recalcular todas
  // las fechas futuras ante cada escritura de `staff` -- y saveAdmin reescribe
  // todos los docs de staff en cada guardado del admin -- o dejaría la vista
  // desactualizada al cambiar una colación. Una sola fuente por señal.
  //
  // `staff` sí se pasa (aunque no se use para la colación, al omitir `dow`):
  // computeAvailability lo necesita para saber qué barberos están activos y
  // así aceptar sus scheduleBlocks.
  const [bookingsSnap, staffSnap, blocksSnap] = await Promise.all([
    db.collection('bookings').where('date', '>=', start).where('date', '<', end).get(),
    db.collection('staff').where('status', '==', 'active').get(),
    db.collection('scheduleBlocks').where('date', '==', dateKey).get(),
  ]);
  const bookings = bookingsSnap.docs.map(d => d.data());
  const staff = staffSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const scheduleBlocks = blocksSnap.docs.map(d => d.data());
  const { barberBusy } = computeAvailability({
    bookings, staff, barberId: 'any', scheduleBlocks,
  });
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

// Mismo mantenimiento de `availability/{dateKey}` que onBookingWritten, pero
// ante cambios de bloqueos puntuales de horario: sin esto, crear/editar/
// borrar un bloqueo desde la Agenda no se reflejaría en el widget público
// hasta que alguna reserva de esa misma fecha cambiara por casualidad.
// `date` en scheduleBlocks ya es el día puro 'YYYY-MM-DD' (lo escribe así el
// modal del admin), así que no necesita dateKeyOf.
exports.onScheduleBlockWritten = onDocumentWritten(
  { document: 'scheduleBlocks/{id}', region: 'southamerica-east1' },
  async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    // Igual que con las reservas: si el bloqueo se movió de fecha hay que
    // recalcular la vieja (para liberarla) y la nueva.
    const dates = new Set();
    if (before && before.date) dates.add(before.date);
    if (after && after.date) dates.add(after.date);
    if (!dates.size) return;
    const db = getFirestore(app);
    await Promise.all([...dates].map(dk => recomputeAvailabilityForDate(db, dk)));
  }
);

// ══ RESEÑAS DE GOOGLE ══
// Espeja el perfil de Google Business del negocio en `googleReviews/main`,
// que el landing lee como cualquier otro doc público (mismo patrón que la
// vista `availability`): el visitante nunca habla con Google, así que la
// sección pinta al instante y una API key facturable jamás toca el navegador.
//
// La escritura es siempre `merge: true` — el panel admin guarda su propia
// lista curada en el campo `manualReviews` del MISMO doc, y una sincronización
// no debe borrarla: es el respaldo que mantiene la sección viva si el perfil
// de Google se cae, se queda sin API key o todavía no tiene reseñas.
const REVIEWS_DOC = 'main';
// Ventana anti-rebote del botón "Sincronizar ahora" del panel. El schedule
// diario ya cubre la actualización real; esto solo evita que diez clics
// seguidos se traduzcan en diez llamadas facturadas a Places.
const REVIEWS_MIN_AGE_MINUTES = 10;

async function syncGoogleReviewsToFirestore(db, apiKey, { force = false, now = new Date() } = {}) {
  const reviewsRef = db.collection('googleReviews').doc(REVIEWS_DOC);
  const [reviewsSnap, infoSnap] = await Promise.all([
    reviewsRef.get(),
    db.collection('businessInfo').doc('main').get(),
  ]);
  const current = reviewsSnap.exists ? reviewsSnap.data() : null;
  if (!force && isFresh(current, now, REVIEWS_MIN_AGE_MINUTES)) {
    return { ok: true, skipped: 'fresh', fetchedAt: current.fetchedAt };
  }

  const info = infoSnap.exists ? infoSnap.data() : {};
  // Orden de resolución del placeId: el configurado a mano en el panel gana
  // (permite apuntar a la ficha correcta si Google devuelve otra), después el
  // ya resuelto y guardado, y recién entonces se gasta una búsqueda por texto.
  let placeId = (info.googlePlaceId || '').trim() || (current && current.placeId) || '';
  let resolvedNow = false;
  if (!placeId) {
    placeId = await searchPlaceId(info, { apiKey });
    resolvedNow = true;
    if (!placeId) {
      // No es un error: un negocio sin nombre/dirección cargados en el panel,
      // o sin ficha de Google todavía, simplemente no tiene qué espejar.
      logger.warn('googleReviews: no se pudo resolver el placeId desde businessInfo', {
        name: info.name || '', addr: info.addr || '',
      });
      return { ok: false, reason: 'place-not-found' };
    }
  }

  const doc = await fetchPlaceDetails(placeId, { apiKey, now });
  await reviewsRef.set({ ...doc, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  // El placeId resuelto por búsqueda se persiste en businessInfo para que la
  // próxima corrida no vuelva a pagar un searchText: es el único dato de
  // Places que los términos permiten cachear sin límite de tiempo.
  if (resolvedNow) {
    await db.collection('businessInfo').doc('main').set({ googlePlaceId: placeId }, { merge: true });
  }
  return { ok: true, placeId, rating: doc.rating, userRatingCount: doc.userRatingCount, reviews: doc.reviews.length };
}

// Actualización desatendida. Una vez al día sobra: el contenido de un place
// se puede cachear hasta 30 días según los términos de Places, y una barbería
// no recibe reseñas al minuto. Cron en la zona del negocio, a una hora en que
// nadie está mirando la web.
exports.refreshGoogleReviews = onSchedule(
  {
    schedule: '0 6 * * *',
    timeZone: 'America/Santiago',
    region: 'southamerica-east1',
    secrets: [GOOGLE_PLACES_API_KEY],
  },
  async () => {
    try {
      const result = await syncGoogleReviewsToFirestore(getFirestore(app), GOOGLE_PLACES_API_KEY.value(), { force: true });
      logger.info('googleReviews: sincronización programada', result);
    } catch (err) {
      // No se relanza: que Places falle un día no debe dejar la función en
      // estado de error ni disparar reintentos que gasten cuota. El doc
      // anterior sigue publicado y la sección se ve igual — exactamente lo que
      // se espera de un espejo cacheado.
      logger.error('googleReviews: falló la sincronización programada', err);
    }
  }
);

// Botón "Sincronizar ahora" del panel: sirve para ver el resultado al toque
// después de configurar el placeId o de pedirle una reseña a un cliente, sin
// esperar al cron. Admin-only — es una llamada facturable.
exports.syncGoogleReviews = onCall(
  { region: 'southamerica-east1', secrets: [GOOGLE_PLACES_API_KEY] },
  async (request) => {
    assertAdmin(request);
    try {
      return await syncGoogleReviewsToFirestore(
        getFirestore(app),
        GOOGLE_PLACES_API_KEY.value(),
        { force: Boolean(request.data && request.data.force) }
      );
    } catch (err) {
      logger.error('googleReviews: falló la sincronización manual', err);
      // El mensaje de Places ('API key not valid', 'Places API has not been
      // used in project...') es justo lo que necesita ver quien está
      // configurando esto, así que viaja al panel en vez de un genérico.
      throw new HttpsError('unavailable', err.message || 'No se pudo consultar Google.');
    }
  }
);
