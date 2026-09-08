// functions/index.js — envía emails al crear una reserva.
'use strict';
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');
const { sendBookingEmails, sendReminderEmail, sendReminderResponseEmail } = require('./email.js');
const { buildPatientUpsert, countClubVisits } = require('./patients.js');
const { computeAvailability, dateKeyOf, dayBoundsOf } = require('./shared/availability.js');
const { resolveCreateBooking } = require('./createBooking.js');
const { resolveBusinessTz, resolveBufferMin, resolveNudgeLeadMin, dateKeyInZone } = require('./shared/timezone.js');
const { searchPlaceId, fetchPlaceDetails, isFresh } = require('./googleReviews.js');
const { REMINDER_LEAD_MS, REMINDER_WINDOW_MS, generateReminderToken, findBookingsNeedingReminder } = require('./reminders.js');
const { ATTENDANCE_ACTIONS, applyAction, computeNudges, SNOOZE_MS } = require('./shared/attendance.js');
const { aggregateMyClients } = require('./shared/clients.js');
const { isValidAdminBookingPayload } = require('./shared/validate.js');
const { DEFAULT_BOOKING_STATUS } = require('./shared/status.js');

const app = initializeApp();
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const FROM_EMAIL = defineSecret('FROM_EMAIL');
const SHOP_EMAIL = defineSecret('SHOP_EMAIL');
const GOOGLE_PLACES_API_KEY = defineSecret('GOOGLE_PLACES_API_KEY');

// Mismo criterio de admin que isAdmin() en firestore.rules. Está duplicado a
// propósito y NO por descuido: las reglas son CEL y no pueden importar JS.
//
// El UID escrito a mano que servía de respaldo se retiró el 2026-09-07, de los
// cuatro sitios a la vez (este, firestore.rules y storage.rules ×2) — dejar uno
// con el claim y otro con el UID produce un admin que puede una cosa y no la
// otra. Sumar un admin ahora es poner el claim, sin tocar código.
function assertAdmin(request) {
  const auth = request.auth;
  if (!auth || auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Solo el panel de administración puede hacer esto.');
  }
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

    // buildBookingDoc() (functions/createBooking.js) ya genera reminderToken
    // para el camino público -- acá se cubre el otro camino de creación (el
    // panel admin escribe el doc directo, sin pasar por ese builder) para
    // que TODA reserva termine con un token válido, sin importar por dónde
    // se creó. Si ya venía con uno, se reutiliza tal cual -- nunca se
    // sobreescribe uno existente (el email ya pudo haber salido con él).
    const reminderToken = b.reminderToken || generateReminderToken();
    if (!b.reminderToken) bookingUpdate.reminderToken = reminderToken;

    // Email opcional (panel admin): sin email no hay a quién enviarle, así
    // que ni se intenta -- 'skipped' es un estado distinto de 'failed' (que
    // significa "había email pero el envío falló") para no ensuciar adminLog
    // con fallos de un envío que nunca correspondía intentar.
    if (email) {
      try {
        await sendBookingEmails({ ...b, email }, reminderToken, {
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

// ══ RECORDATORIO DE CITAS (confirmar/declinar) ══
// "Debido", no ventana de coincidencia única: una reserva se vuelve
// candidata cuando su instante real queda a 24h (REMINDER_LEAD_MS) o menos de
// distancia, y sigue siéndolo en TODAS las corridas siguientes -- hasta que
// el envío tenga éxito (reminderSentAt) o la cita ya haya ocurrido -- ver
// functions/reminders.js. Esto es lo que hace real el reintento: una
// ventana de coincidencia única [now+24h, now+24h+15min) descartaría para
// siempre una reserva cuyo único turno cayó en una corrida que falló (ver
// el test de regresión en functions/test/reminders.test.js). Mismo criterio
// de resiliencia que refreshGoogleReviews: toda la función corre dentro de
// un try/catch, un fallo (de la query, de Resend, de lo que sea) no debe
// tirarla a estado de error ni impedir que la corrida siguiente reintente.
exports.sendBookingReminders = onSchedule(
  { schedule: 'every 15 minutes', region: 'southamerica-east1', secrets: [RESEND_API_KEY, FROM_EMAIL] },
  async () => {
    try {
      const db = getFirestore(app);
      // Se ancla `now` a la grilla fija de 15 min (el mismo ancho que
      // REMINDER_WINDOW_MS) en vez de usar la hora real de invocación --
      // onSchedule no garantiza puntualidad al segundo (cold start, hiccup
      // de GCP). No es indispensable para el reintento en sí (eso ya lo da
      // el diseño "debido" de reminders.js), pero mantiene la query y los
      // logs alineados a bloques predecibles.
      const rawNow = new Date();
      const now = new Date(Math.floor(rawNow.getTime() / REMINDER_WINDOW_MS) * REMINDER_WINDOW_MS);
      const businessInfoSnap = await db.collection('businessInfo').doc('main').get();
      const businessInfoData = businessInfoSnap.exists ? businessInfoSnap.data() : null;

      // Interruptor de seguridad: por defecto (campo ausente) la función NO
      // manda nada -- corta ANTES de tocar `bookings`, así que tampoco
      // depende todavía del índice compuesto que esa query necesita. Recién
      // manda emails reales cuando alguien activa `remindersEnabled:true` a
      // mano en businessInfo/main, después de verificar en staging que el
      // flujo (recordatorio -> confirmar-cita.html -> Agenda) se ve bien.
      // Deploy != activación: el primer despliegue de este goal deja el
      // Cloud Scheduler instalado pero en no-op a propósito.
      if (!businessInfoData || businessInfoData.remindersEnabled !== true) {
        logger.info('sendBookingReminders: remindersEnabled no está activado, no se envía nada esta corrida.');
        return;
      }

      const businessTz = resolveBusinessTz(businessInfoData);

      // Ventana amplia por fecha calendario, desde HOY (no desde now+24h:
      // una reserva "debida" puede tener su cita en cualquier punto entre
      // ahora y ~mañana a esta hora, incluyendo turnos que ya deberían
      // haberse recordado y no se recordaron por una falla previa) hasta
      // el borde superior de "debido" -- el filtro fino por instante real
      // ocurre en findBookingsNeedingReminder(), en JS puro. Mismo patrón
      // de "query amplia por date + filtro preciso en memoria" que ya usa
      // createBooking.js.
      const startDateKey = dateKeyInZone(now, businessTz);
      const dueByInstant = new Date(now.getTime() + REMINDER_LEAD_MS + REMINDER_WINDOW_MS);
      const endDateKey = dateKeyInZone(dueByInstant, businessTz);
      const { end: endBound } = dayBoundsOf(endDateKey);

      const snap = await db.collection('bookings')
        .where('status', '==', 'pending')
        .where('date', '>=', startDateKey)
        .where('date', '<', endBound)
        .get();

      // `code` es generado en el cliente (Date.now() en base36 + un
      // aleatorio de 3 dígitos, ver public/index.html) sin unicidad
      // reforzada del lado del servidor -- no es apto como clave de
      // emparejamiento: una colisión mandaría el recordatorio de una
      // reserva a los datos de otra. Se usa el ID real del doc de
      // Firestore (`d.id`, único por diseño) en su lugar, viajando en un
      // campo `_docId` que findBookingsNeedingReminder() ignora sin
      // problema (solo lee status/reminderSentAt/date/time/tz).
      const items = snap.docs
        .map((d) => ({ ref: d.ref, data: { ...d.data(), _docId: d.id } }))
        .filter((item) => !item.data.reminderSentAt);
      const itemsByDocId = new Map(items.map((item) => [item.data._docId, item]));
      const toRemindData = findBookingsNeedingReminder(items.map((item) => item.data), now,
        // Sin esto, una reserva con date/time corrupto no recibe recordatorio
        // NUNCA y no queda ni una linea que lo diga.
        (id, err) => logger.error('Reserva ilegible al buscar recordatorios', {
          bookingId: id || null, message: (err && err.message) || String(err),
        }));
      const toRemind = toRemindData.map((b) => itemsByDocId.get(b._docId)).filter(Boolean);

      for (const item of toRemind) {
        const b = item.data;
        // Sin email no hay a quién recordarle -- mismo criterio que
        // onBookingCreated (una reserva tomada por teléfono puede no traer
        // email).
        if (!b.email) continue;
        // Toda reserva ya trae reminderToken desde su creación (ver
        // buildBookingDoc/onBookingCreated) -- se reutiliza el mismo, nunca
        // se genera uno nuevo acá: si el cliente ya recibió el email de
        // "reserva confirmada" con ese token, un token distinto en el
        // recordatorio invalidaría silenciosamente ese link viejo. Solo se
        // genera uno nuevo como respaldo para reservas de antes de este
        // cambio, que no tienen el campo.
        const token = b.reminderToken || generateReminderToken();
        try {
          await sendReminderEmail(b, token, {
            apiKey: RESEND_API_KEY.value(),
            fromEmail: FROM_EMAIL.value(),
          });
          await item.ref.update({ reminderToken: token, reminderSentAt: new Date().toISOString() });
          logger.info('Recordatorio enviado', { code: b.code });
        } catch (err) {
          logger.error('Fallo al enviar recordatorio', err);
          try {
            await db.collection('adminLog').add({
              action: 'reminder_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
            });
          } catch (err2) {
            logger.error('Fallo al registrar adminLog de reminder_failed', err2);
          }
          // No relanzar: un fallo individual no debe abortar el resto de
          // la corrida -- y como esta reserva sigue "debida" (no piso
          // inferior en reminders.js), la corrida siguiente (15 min
          // después) vuelve a intentarla porque reminderSentAt nunca se
          // escribió. Riesgo aceptado, no resuelto acá: dos corridas
          // solapadas (reintento del scheduler sobre una corrida lenta)
          // podrían ambas generar un token distinto para la misma reserva
          // antes de que la primera escriba -- el segundo `update` gana y
          // el primer email queda con un link inválido. Baja probabilidad
          // dado el volumen de este negocio; no se agrega una transacción
          // de "reclamo" por ahora, mismo criterio pragmático que ya
          // aplica a otras corridas de este archivo (ver
          // recomputeAvailabilityForDate: "se autocorrigen").
        }
      }
    } catch (err) {
      // Un fallo antes de llegar al loop (ej. índice compuesto faltante en
      // la query, businessInfo inaccesible) no debe dejar la función en
      // estado de error -- la corrida siguiente, 15 min después, vuelve a
      // intentar desde cero. Mismo criterio que refreshGoogleReviews.
      logger.error('Fallo la corrida de sendBookingReminders', err);
    }
  }
);

// respondToBookingReminder: el cliente nunca puede leer ni escribir
// `bookings` directo (ver firestore.rules) -- esta función valida el
// reminderToken (búsqueda por el TOKEN, no por `code`: es único por
// diseño, así la seguridad no depende de que `code` lo sea) y aplica la
// transición de estado. Idempotente: un segundo tap del mismo link no
// rompe nada, cae en la rama `already`. Tras confirmar/declinar (nunca en
// la rama `already`, que no cambió nada) se avisa por email a los
// correos del negocio (SHOP_EMAIL) para que el barbero se entere sin
// depender de revisar la Agenda -- best-effort: si el envío falla, se
// loguea mismo criterio que onBookingCreated, pero NO revierte la
// transición ya escrita (el status es la fuente de verdad, el email es
// respaldo).
exports.respondToBookingReminder = onCall(
  { region: 'southamerica-east1', secrets: [RESEND_API_KEY, FROM_EMAIL, SHOP_EMAIL] },
  async (request) => {
    const data = request.data || {};
    const code = typeof data.code === 'string' ? data.code.trim() : '';
    const token = typeof data.token === 'string' ? data.token.trim() : '';
    const action = data.action;
    if (!token || (action !== 'confirm' && action !== 'decline')) {
      throw new HttpsError('invalid-argument', 'Datos inválidos.');
    }

    const db = getFirestore(app);
    const snap = await db.collection('bookings').where('reminderToken', '==', token).limit(1).get();
    // Mismo mensaje genérico si el token no existe o si el `code` no calza
    // con el que sí se encontró -- no revelar cuál de las dos cosas falló.
    if (snap.empty || snap.docs[0].data().code !== code) {
      throw new HttpsError('not-found', 'No encontramos esa reserva.');
    }

    const doc = snap.docs[0];
    const b = doc.data();
    if (b.status !== 'pending') {
      return { ok: true, already: true, status: b.status };
    }

    const status = action === 'confirm' ? 'confirmed' : 'declined';
    await doc.ref.update({ status, respondedAt: new Date().toISOString() });

    try {
      await sendReminderResponseEmail(b, action, {
        apiKey: RESEND_API_KEY.value(),
        fromEmail: FROM_EMAIL.value(),
        shopEmail: SHOP_EMAIL.value(),
      });
    } catch (err) {
      logger.error('Fallo al avisar al negocio la respuesta del cliente', err);
      try {
        await db.collection('adminLog').add({
          action: 'reminder_response_notify_failed', item: b.code || '', date: new Date().toLocaleString('es-CL'),
        });
      } catch (err2) {
        logger.error('Fallo al registrar adminLog de reminder_response_notify_failed', err2);
      }
      // No relanzar: la transición de estado ya es válida y real, el aviso
      // al negocio es respaldo, no la fuente de verdad.
    }

    return { ok: true, already: false, status };
  }
);

// getBookingForReminderAction: lectura de solo lo necesario para pintar
// confirmar-cita.html antes de que el cliente decida -- nunca devuelve
// reminderToken de vuelta. Mismo criterio de búsqueda por reminderToken que
// respondToBookingReminder.
exports.getBookingForReminderAction = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const data = request.data || {};
    const code = typeof data.code === 'string' ? data.code.trim() : '';
    const token = typeof data.token === 'string' ? data.token.trim() : '';
    if (!token) throw new HttpsError('invalid-argument', 'Datos inválidos.');

    const db = getFirestore(app);
    const snap = await db.collection('bookings').where('reminderToken', '==', token).limit(1).get();
    if (snap.empty || snap.docs[0].data().code !== code) {
      throw new HttpsError('not-found', 'No encontramos esa reserva.');
    }

    const b = snap.docs[0].data();
    return {
      code: b.code, date: b.date, time: b.time, svcName: b.svcName,
      barberName: b.barberName, status: b.status,
    };
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

// ═══════════════ MEDICIÓN DE LA ATENCIÓN REAL (PWA /barbero) ═══════════════
// Fase 1 del reporte de KPI: Llegó / No llegó / Iniciar / Finalizar. Todo
// pasa por callables con Admin SDK -- igual que createBooking y
// getAvailability -- en vez de abrir `bookings` a un rol nuevo en
// firestore.rules. Las reglas son admin-o-nada y no tienen ningún predicado
// por-usuario; expresar ahí la pertenencia de una cita a un barbero, más la
// validación campo a campo de cada transición, sería CEL duplicado y frágil
// (ya costó caro una vez: una clave ausente en una regla produce un
// evaluation error, no un `false`).

// Resuelve el profesional a partir del usuario autenticado. El vínculo es
// staffAccounts/{staffId}, que escribe linkStaffAccount. Devuelve null si no hay
// ninguno: un usuario de Auth sin ficha de staff no es un barbero.
async function resolveStaffFor(db, request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  // El vínculo vive en staffAccounts (admin-only), NO en staff/{id}, que
  // tiene lectura pública para el widget de reservas -- ver firestore.rules.
  const link = await db.collection('staffAccounts').where('uid', '==', request.auth.uid).limit(1).get();
  if (link.empty) return null;
  const staffId = link.docs[0].id;
  const doc = await db.collection('staff').doc(staffId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

// Misma pregunta que assertAdmin(), pero devolviendo un booleano: markAttendance
// necesita SABER si es admin (puede marcar cualquier cita y corregir horas), no
// cortar. Los dos tienen que decir lo mismo -- este era el quinto sitio donde
// vivía el UID de respaldo, y no estaba en el inventario.
function isAdminRequest(request) {
  const auth = request.auth;
  return !!auth && auth.token.admin === true;
}

// Lo que la PWA puede ver de una reserva. Es una lista BLANCA: 'email' y
// 'phone' NO están, y no por olvido -- el barbero ve a quién atiende, no cómo
// contactarlo (decisión tomada con el usuario, ver el spec de la app
// completa). Un campo nuevo en 'bookings' no se filtra solo al teléfono.
function proyectarReserva(d, conFecha) {
  const b = d.data();
  const o = {
    id: d.id, code: b.code || '', name: b.name || '', time: b.time || '',
    dur: b.dur || 0, svcName: b.svcName || '', price: b.price || 0,
    status: b.status || 'pending', arrivedAt: b.arrivedAt || null,
    startedAt: b.startedAt || null, endedAt: b.endedAt || null,
    actualDur: Number.isFinite(b.actualDur) ? b.actualDur : null,
    nudgeEndCount: b.nudgeEndCount || 0,
  };
  // Métricas necesita la fecha y el servicio; la agenda del día no, porque ya
  // sabe de qué día es.
  if (conFecha) { o.date = String(b.date || '').slice(0, 10); o.svcId = b.svcId || ''; }
  return o;
}

// Días entre dos claves YYYY-MM-DD, sobre la clave y en UTC: construir un Date
// local acá metería el horario de verano del servidor en una fecha que ya
// viene resuelta en la zona del negocio.
function diasEntre(desde, hasta) {
  const a = String(desde).split('-').map(Number);
  const b = String(hasta).split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

// Sin tope, un 'from' de hace tres años baja el historial completo a un
// teléfono -- y lo paga la cuota de lecturas, no quien lo pidió.
const MAX_RANGO_DIAS = 92;

// La agenda del día del barbero que llama. Devuelve solo los campos que la
// PWA pinta -- no toda la reserva.
exports.getMyDay = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const db = getFirestore(app);
    const staff = await resolveStaffFor(db, request);
    if (!staff) throw new HttpsError('permission-denied', 'Esta cuenta no está vinculada a ningún profesional.');

    const businessInfoSnap = await db.collection('businessInfo').doc('main').get();
    const tz = resolveBusinessTz(businessInfoSnap.exists ? businessInfoSnap.data() : null);
    const dayKey = dateKeyOf(request.data && request.data.date) || dateKeyInZone(new Date(), tz);
    const { end } = dayBoundsOf(dayKey);

    // Igualdad sobre `barberId` + rango sobre `date`. Firestore exige que el
    // campo de igualdad vaya PRIMERO en el índice compuesto, así que el que
    // ya existía -- bookings(date, barberId) -- NO sirve acá: hizo falta
    // agregar bookings(barberId, date) en firestore.indexes.json. El >= / <
    // además captura las reservas del admin, cuyo `date` trae sufijo 'T...Z'.
    //
    // Devuelve UN SOLO día: el de `request.data.date`, o hoy en la zona del
    // negocio. La PWA no manda fecha y no tiene navegación de días -- es la
    // agenda de hoy, a propósito (spec de medición, §PWA).
    const snap = await db.collection('bookings')
      .where('barberId', '==', staff.id)
      .where('date', '>=', dayKey)
      .where('date', '<', end)
      .get();

    const bookings = snap.docs
      .map((d) => proyectarReserva(d, false))
      .sort((x, y) => String(x.time).localeCompare(String(y.time)));

    // `tz` viaja para que la PWA pinte "empezó a las HH:MM" en la hora del
    // NEGOCIO y no en la del dispositivo. Es el invariante del proyecto, y
    // acá no es teórico: un barbero que viaja, o un teléfono con la zona
    // mal configurada, mostraría horas que no coinciden con la agenda.
    // 'schedule' viaja acá en vez de tener su propia callable: getMyDay ya
    // resolvió la ficha, y la sección Horario de la PWA es de solo consulta
    // (decisión tomada con el usuario). Una superficie menos que auditar.
    return {
      staffId: staff.id, name: staff.name || '', date: dayKey, tz, bookings,
      schedule: staff.schedule || null,
    };
  }
);


// Registro de actividad del panel. Hasta el 2026-09-07, log() en
// public/admin/index.html escribía en un array en memoria, lo recortaba a 30 y
// no lo persistía ni lo mostraba en ninguna parte: había 23 llamadas anotando
// operaciones reales -- borrar un servicio, ajustar precios en masa, vincular
// una cuenta -- que se perdían al recargar la página.
//
// La hora y el autor los pone el SERVIDOR. Un registro de auditoría en el que
// el propio actor declara quién es y a qué hora actuó no sirve para auditar
// nada, y el reloj del navegador tampoco es fuente de verdad.
exports.adminLogEvent = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    assertAdmin(request);
    const db = getFirestore(app);
    const { action, item } = request.data || {};
    if (typeof action !== 'string' || action.trim() === '') {
      throw new HttpsError('invalid-argument', 'Falta la acción.');
    }
    const now = new Date();
    await db.collection('adminLog').add({
      action: String(action).slice(0, 120),
      item: String(item == null ? '' : item).slice(0, 300),
      // `ts` numérico para ordenar (loadAdmin ya ordenaba por este campo, que
      // hasta ahora nadie escribía) y `at` ISO para leerlo sin reconstruirlo.
      ts: now.getTime(),
      at: now.toISOString(),
      by: request.auth.uid,
      byEmail: (request.auth.token && request.auth.token.email) || '',
    });
    return { ok: true };
  }
);

// Crear o editar una reserva DESDE EL PANEL. Reemplaza la escritura directa a
// Firestore que hacía public/admin/index.html.
//
// Por qué existe: el camino público pasa por createBooking, que valida el
// payload y resuelve precio y duración contra el catálogo. El panel escribía
// directo, con precio, duración y nombres tomados del DOM y sin más control
// que isValidEmail() en las reglas. De ahí salían las reservas con date o time
// corruptos que hacen throw en zonedInstant() y dejan al cliente sin
// recordatorio y al barbero sin aviso -- el mismo dato que computeNudges y
// findBookingsNeedingReminder descartan.
exports.adminSaveBooking = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    assertAdmin(request);
    const db = getFirestore(app);
    const p = (request.data && request.data.booking) || {};

    if (!isValidAdminBookingPayload(p)) {
      throw new HttpsError('invalid-argument', 'Faltan datos de la cita o la fecha/hora no son válidas.');
    }

    // Precio y nombre del servicio SIEMPRE del catálogo, nunca del payload:
    // es un invariante del proyecto y acá no era teórico -- el panel los sacaba
    // de un dataset del DOM, que cualquiera puede editar desde la consola.
    const svcSnap = await db.collection('services').doc(String(p.svcId)).get();
    if (!svcSnap.exists) throw new HttpsError('not-found', 'Ese servicio no existe.');
    const svc = svcSnap.data();

    const staffSnap = await db.collection('staff').doc(String(p.barberId)).get();
    if (!staffSnap.exists) throw new HttpsError('not-found', 'Ese profesional no existe.');
    const staff = staffSnap.data();

    // La duración SÍ admite override: el panel tiene ese campo a propósito (una
    // atención puede salirse de lo estándar). Lo que no admite es basura, así
    // que se acota en vez de aceptarse tal cual.
    const durPayload = Number(p.dur);
    const durSvc = Number(svc.dur) || 0;
    const dur = (Number.isFinite(durPayload) && durPayload >= 5 && durPayload <= 480)
      ? Math.round(durPayload) : durSvc;

    const infoSnap = await db.collection('businessInfo').doc('main').get();
    const tz = resolveBusinessTz(infoSnap.exists ? infoSnap.data() : null);

    const id = String(p.id || p.code);
    const ref = db.collection('bookings').doc(id);
    const prev = await ref.get();
    const antes = prev.exists ? prev.data() : null;

    const doc = {
      code: String(p.code),
      name: String(p.name).trim(),
      email: String(p.email || '').trim().toLowerCase(),
      phone: String(p.phone || '').trim(),
      svcId: String(p.svcId),
      svcName: svc.name || '',
      svcCat: svc.cat || '',
      price: Number(svc.price) || 0,
      dur,
      barberId: String(p.barberId),
      barberName: staff.name || '',
      // Se guarda la CLAVE del día, no el 'YYYY-MM-DDTHH:mm:00.000Z' que
      // escribía el panel: esa forma es hora de pared mal etiquetada como UTC y
      // obligaba a todo el resto del sistema a desarmarla. dateKeyOf() sigue
      // aceptando las viejas, así que las que ya existen no se rompen.
      date: String(p.date),
      time: String(p.time),
      notes: String(p.notes || ''),
      over: !!p.over,
      tz,
      // El estado NUNCA se toma del payload: lo mueve markAttendance, que es
      // quien conoce las transiciones válidas. Al editar se conserva el que
      // tenga; al crear arranca en el default.
      status: (antes && antes.status) || DEFAULT_BOOKING_STATUS,
      club: (antes && antes.club) || 'guest',
      createdAt: (antes && antes.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      src: (antes && antes.src) || 'admin',
    };

    await ref.set(doc, { merge: true });
    return { ok: true, id, created: !prev.exists, price: doc.price, dur: doc.dur, svcName: doc.svcName };
  }
);

// Las reservas del barbero en un rango de fechas. Alimenta la sección
// Métricas, que reusa public/js/metrics.js tal cual -- por eso la proyección
// incluye 'date' y 'svcId'.
exports.getMyRange = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const db = getFirestore(app);
    const staff = await resolveStaffFor(db, request);
    if (!staff) throw new HttpsError('permission-denied', 'Esta cuenta no está vinculada a ningún profesional.');

    const from = dateKeyOf(request.data && request.data.from);
    const to = dateKeyOf(request.data && request.data.to);
    if (!from || !to) throw new HttpsError('invalid-argument', 'Faltan las fechas del rango.');
    if (from > to) throw new HttpsError('invalid-argument', 'El rango empieza después de terminar.');
    if (diasEntre(from, to) > MAX_RANGO_DIAS) {
      throw new HttpsError('invalid-argument', `El rango no puede pasar de ${MAX_RANGO_DIAS} días.`);
    }

    const { end } = dayBoundsOf(to);
    const snap = await db.collection('bookings')
      .where('barberId', '==', staff.id)
      .where('date', '>=', from)
      .where('date', '<', end)
      .get();

    const bookings = snap.docs
      .map((d) => proyectarReserva(d, true))
      .sort((x, y) => (x.date === y.date
        ? String(x.time).localeCompare(String(y.time))
        : String(x.date).localeCompare(String(y.date))));

    return { staffId: staff.id, from, to, bookings };
  }
);

// Los clientes que este barbero atendió. Se arma desde 'bookings' y NUNCA
// desde 'patients': esa colección tiene teléfono, correo, notas y fotos, y la
// decisión con el usuario es que nada de eso llegue al teléfono. La forma
// segura de garantizarlo no es filtrar campos al salir, es no abrir la
// colección. La agregación vive en shared/clients.js, pura y testeada.
exports.getMyClients = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const db = getFirestore(app);
    const staff = await resolveStaffFor(db, request);
    if (!staff) throw new HttpsError('permission-denied', 'Esta cuenta no está vinculada a ningún profesional.');

    const snap = await db.collection('bookings').where('barberId', '==', staff.id).get();
    const crudas = snap.docs.map((d) => {
      const b = d.data();
      // El correo entra SOLO para agrupar y muere acá: aggregateMyClients
      // devuelve un hash, nunca el correo.
      return { name: b.name || '', email: b.email || '', date: b.date || '', svcName: b.svcName || '', status: b.status || '' };
    });

    return { staffId: staff.id, clients: aggregateMyClients(crudas) };
  }
);

// Aplica una acción de asistencia. La hora la pone SIEMPRE el servidor: el
// reloj del teléfono del barbero no es fuente de verdad, y de ahí salen los
// KPI de tiempo real y desviación.
exports.markAttendance = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const db = getFirestore(app);
    const { bookingId, action, at, reason } = request.data || {};
    if (!bookingId || ATTENDANCE_ACTIONS.indexOf(action) === -1) {
      throw new HttpsError('invalid-argument', 'Falta la cita o la acción no es válida.');
    }

    const isAdmin = isAdminRequest(request);
    const staff = isAdmin ? null : await resolveStaffFor(db, request);
    if (!isAdmin && !staff) {
      throw new HttpsError('permission-denied', 'Esta cuenta no está vinculada a ningún profesional.');
    }
    // Corregir una hora ya registrada es una operación de auditoría: la hace
    // el admin desde la Agenda, no el barbero desde el teléfono.
    if (at && !isAdmin) throw new HttpsError('permission-denied', 'Solo el panel puede corregir una hora.');

    const ref = db.collection('bookings').doc(String(bookingId));

    return db.runTransaction(async (tx) => {
      // Dentro de la transacción solo tx.get(), nunca db.get() suelto --
      // invariante del proyecto.
      const doc = await tx.get(ref);
      if (!doc.exists) throw new HttpsError('not-found', 'Esa cita ya no existe.');
      const b = doc.data();

      // Un barbero solo marca sus propias citas; el admin, cualquiera.
      if (!isAdmin && b.barberId !== staff.id) {
        throw new HttpsError('permission-denied', 'Esa cita no es tuya.');
      }

      const patch = applyAction(b, action, new Date(), {
        by: isAdmin ? 'admin' : staff.id,
        reason: reason || null,
        atISO: at || null,
        snoozeMs: SNOOZE_MS,
      });

      // Idempotente por diseño: un segundo toque de la misma notificación
      // (o el mismo enlace profundo abierto dos veces) cae acá y no pisa la
      // hora original.
      if (!patch) return { ok: true, already: true, status: b.status || 'pending' };

      tx.update(ref, patch);
      return {
        ok: true,
        already: false,
        status: patch.status || b.status || 'pending',
        actualDur: Number.isFinite(patch.actualDur) ? patch.actualDur : null,
      };
    });
  }
);

// Vincula una cuenta de Firebase Auth (creada a mano en la consola) con la
// ficha de un profesional. Evita pegar UIDs a mano en el panel, que es
// exactamente el tipo de dato que se copia mal una vez y nadie nota.
exports.linkStaffAccount = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    assertAdmin(request);
    const db = getFirestore(app);
    const { staffId, email } = request.data || {};
    if (!staffId || !email) throw new HttpsError('invalid-argument', 'Falta el profesional o el correo.');

    let user;
    const correo = String(email).trim().toLowerCase();
    try {
      user = await getAuth(app).getUserByEmail(correo);
    } catch (e) {
      // Este catch se tragaba TODO y siempre culpaba al correo. Cuando la causa
      // real era otra -- el service account sin permiso sobre Identity Toolkit,
      // la API sin habilitar, un fallo de red -- mandaba al admin a crear en
      // Auth una cuenta que ya existía, y no dejaba ni una línea de log para
      // desmentirlo. Ahora el código real siempre va al log, y solo el caso
      // genuino conserva el mensaje amable.
      logger.error('linkStaffAccount getUserByEmail', {
        code: (e && e.code) || null, message: (e && e.message) || String(e), correo,
      });
      if (e && e.code === 'auth/user-not-found') {
        throw new HttpsError('not-found', 'No existe ninguna cuenta con ese correo. Creala primero en Firebase Auth.');
      }
      throw new HttpsError('internal',
        `No se pudo consultar Firebase Auth (${(e && e.code) || 'sin código'}). El detalle quedó en los logs de linkStaffAccount.`);
    }

    const ref = db.collection('staff').doc(String(staffId));
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Ese profesional no existe.');

    // Un mismo UID vinculado a dos fichas rompería resolveStaffFor (que toma
    // la primera que encuentre) de forma silenciosa y difícil de rastrear.
    const dup = await db.collection('staffAccounts').where('uid', '==', user.uid).get();
    const otra = dup.docs.find((d) => d.id !== String(staffId));
    if (otra) {
      const ficha = await db.collection('staff').doc(otra.id).get();
      const nombre = ficha.exists ? (ficha.data().name || otra.id) : otra.id;
      throw new HttpsError('already-exists', `Esa cuenta ya está vinculada a ${nombre}.`);
    }

    await db.collection('staffAccounts').doc(String(staffId)).set({
      uid: user.uid, authEmail: user.email || '', linkedAt: new Date().toISOString(),
    });

    // Limpieza: versiones anteriores guardaban el vínculo en el propio doc de
    // staff, que es de lectura pública. Si quedó alguno, se borra acá.
    if (snap.data().uid || snap.data().authEmail) {
      await ref.update({ uid: FieldValue.delete(), authEmail: FieldValue.delete() });
    }

    return { ok: true, uid: user.uid };
  }
);

// Avisos al profesional: "se acerca la hora", "¿comenzamos?", "¿finalizamos?".
// Corre cada 2 min porque el aviso de fin debe caer cerca del minuto exacto
// en que se cumple la duración planificada -- con la cadencia de 15 min de
// sendBookingReminders, "¿deseas finalizar?" llegaría hasta un cuarto de
// hora tarde y el dato de tiempo real perdería sentido.
//
// La query trae solo las citas de ayer y hoy (decenas de docs), nunca la
// colección entera. Ayer entra por las atenciones que quedaron abiertas
// cruzando la medianoche.
exports.staffAttendanceNudges = onSchedule(
  { schedule: 'every 2 minutes', timeZone: 'America/Santiago', region: 'southamerica-east1' },
  async () => {
    try {
      const db = getFirestore(app);
      const now = new Date();

      const businessInfoSnap = await db.collection('businessInfo').doc('main').get();
      const businessInfoData = businessInfoSnap.exists ? businessInfoSnap.data() : null;

      // Mismo interruptor de seguridad que sendBookingReminders: por defecto
      // (campo ausente) no manda nada, y corta ANTES de tocar `bookings`.
      // Desplegar deja el Cloud Scheduler instalado pero en no-op; los avisos
      // recién salen cuando alguien activa nudgesEnabled:true a mano, después
      // de verificar en staging que la PWA y el push se ven bien.
      // Deploy != activación.
      if (!businessInfoData || businessInfoData.nudgesEnabled !== true) {
        logger.info('staffAttendanceNudges: nudgesEnabled no está activado, no se envía nada.');
        return;
      }

      const tz = resolveBusinessTz(businessInfoData);
      const leadMin = resolveNudgeLeadMin(businessInfoData);

      const todayKey = dateKeyInZone(now, tz);
      const yesterdayKey = dateKeyInZone(new Date(now.getTime() - 24 * 60 * 60 * 1000), tz);
      const { end } = dayBoundsOf(todayKey);

      // Rango sobre `date` -- campo simple, sin índice compuesto nuevo. El
      // >= / < además captura las reservas del admin, cuyo `date` trae
      // sufijo 'T...Z' (ver public/admin/index.html).
      const snap = await db.collection('bookings')
        .where('date', '>=', yesterdayKey)
        .where('date', '<', end)
        .get();

      const refsById = new Map(snap.docs.map((d) => [d.id, d.ref]));
      // `_docId` viaja en el objeto porque computeNudges necesita devolver
      // con qué reserva se corresponde cada aviso; mismo patrón que usa
      // sendBookingReminders para no emparejar por `code` (que se genera en
      // el cliente y no tiene unicidad reforzada).
      const bookings = snap.docs.map((d) => ({ ...d.data(), _docId: d.id }));
      const nudges = computeNudges(bookings, now, {
        leadMin, tz,
        // Una reserva con date corrupto deja al barbero sin aviso. Antes se
        // descartaba sin dejar rastro; ahora al menos queda el código para
        // poder ir a mirarla.
        onSkip: (id, err) => logger.error('Reserva ilegible al calcular avisos', {
          bookingId: id || null, message: (err && err.message) || String(err),
        }),
      });
      if (!nudges.length) return;

      // uid -> staffId se deriva del lado del servidor leyendo `staff`.
      // NUNCA se confía en un staffId que haya escrito el cliente en
      // staffDevices: ahí solo se leen los tokens del dueño del documento.
      // El uid se lee de staffAccounts, NO del doc de staff: ese es de
      // lectura pública y por eso ya no guarda el vínculo. Buscarlo en el
      // lugar viejo no daría error -- simplemente no encontraría a nadie y
      // los avisos dejarían de salir sin que nada lo reporte.
      const cuentasSnap = await db.collection('staffAccounts').get();
      const tokensByStaff = {};
      await Promise.all(cuentasSnap.docs.map(async (c) => {
        const uid = c.data().uid;
        if (!uid) return;
        const dev = await db.collection('staffDevices').doc(uid).get();
        const tokens = dev.exists ? (dev.data().tokens || []) : [];
        if (tokens.length) tokensByStaff[c.id] = { uid, tokens };
      }));

      const nowISO = now.toISOString();
      const FIELD = { upcoming: 'nudgeUpcomingAt', start: 'nudgeStartAt', end: 'nudgeEndAt' };

      for (const n of nudges) {
        // Un fallo por reserva no aborta la corrida -- mismo criterio de
        // resiliencia que sendBookingReminders y refreshGoogleReviews.
        try {
          const target = tokensByStaff[n.barberId];
          if (!target) continue;

          // SOLO DATOS, sin clave `notification`. Si el payload trae
          // `notification`, el SDK de FCM en el service worker muestra la
          // notificación por su cuenta y onBackgroundMessage no corre de
          // forma confiable -- se perderían el `tag` (una notificación por
          // cita en vez de una pila), las acciones de Android y el `data`
          // que arma el enlace profundo. Con solo datos, el handler de
          // public/barbero/sw.js siempre es el que decide qué se muestra.
          const res = await getMessaging(app).sendEachForMulticast({
            tokens: target.tokens,
            data: { b: n.data.b, a: n.data.a, title: n.title, body: n.body },
          });

          // Purga de tokens muertos (teléfono reinstalado, permiso revocado,
          // app desinstalada): sin esto, cada corrida reintenta contra ellos
          // para siempre y el log se llena de errores que nadie puede
          // accionar.
          const muertos = res.responses
            .map((r, i) => (r.success ? null : target.tokens[i]))
            .filter(Boolean);
          if (muertos.length) {
            await db.collection('staffDevices').doc(target.uid)
              .update({ tokens: FieldValue.arrayRemove(...muertos) });
          }

          if (res.successCount > 0) {
            const patch = { [FIELD[n.kind]]: nowISO };
            if (n.kind === 'end') {
              // Consumir la posposición y contar el envío. El contador es lo
              // que hace efectivo el tope de MAX_END_NUDGES cuando el barbero
              // IGNORA la notificación en vez de posponerla -- sin esto solo
              // contaría las posposiciones explícitas y la app insistiría
              // para siempre.
              patch.snoozeUntil = null;
              patch.nudgeEndCount = FieldValue.increment(1);
            }
            await refsById.get(n.bookingId).update(patch);
          }
        } catch (e) {
          logger.error('staffAttendanceNudges: falló un aviso', n.bookingId, e);
        }
      }
    } catch (e) {
      // Mismo criterio que refreshGoogleReviews: se loguea y NO se relanza,
      // para no dejar la función en estado de error ni gastar reintentos.
      // La corrida de 2 min después recoge lo que haya quedado.
      logger.error('staffAttendanceNudges: falló la corrida', e);
    }
  }
);
