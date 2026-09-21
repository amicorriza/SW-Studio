# Scissor White — Encuesta de satisfacción post-atención + sorteo manual

- **Fecha:** 2026-09-20
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Alcance:** `functions/index.js`, `functions/email.js`, `public/encuesta.html` (nuevo), `firestore.rules`. Feature nueva, aprobada por Aldo tras brainstorming con vista previa visual del correo.

## Contexto (verificado en el código)

- `functions/shared/attendance.js` (`applyAction`, acción `end`) deja la reserva en `status:'completed'` con `endedAt` (ISO), `actualDur`, `durSource`. `exports.markAttendance` (`functions/index.js:1009-1062`) es quien aplica esto vía transacción — no hay ningún otro lugar donde una reserva pase a `completed`.
- Ya existe el patrón exacto a seguir para "correo con acción vía token, callable de lectura + callable de escritura, página standalone":
  - `exports.getBookingForReminderAction`/`exports.respondToBookingReminder` (`functions/index.js:509-608`) — buscan por `reminderToken` (no por `code`, que no es único por diseño), devuelven una whitelist de campos, nunca el token de vuelta, son idempotentes (`{ok:true, already:true}` en el segundo intento).
  - `public/confirmar-cita.html` — página standalone, `code`+`t` en la URL, `type="module"` importando de `js/data.js`, loading → formulario → pantalla de gracias.
- Ya existe el patrón exacto para el disparo con retraso: `exports.sendBookingReminders` (`functions/index.js:372-495`) — `onSchedule`, corre cada 15 min, criterio "debido" (sin ventana que se cierre, reintenta hasta lograrlo), interruptor `businessInfo.remindersEnabled` (apagado por defecto), query amplia por `date` + filtro fino en JS por el instante real.
- `firestore.indexes.json` ya tiene un índice `bookings(status, date)` (líneas 15-18) — la query nueva (`status=='completed'` + rango de `date`) lo reutiliza tal cual, **no hace falta declarar un índice nuevo**.
- `googleReviews/main` ya cachea `writeReviewUri` (el link oficial "escribe una reseña", armado con el placeId — `functions/googleReviews.js:100-104`), refrescado a diario por `refreshGoogleReviews` y a mano por `syncGoogleReviews` desde el panel. Se lee ese campo, no se toca `functions/googleReviews.js` para nada.
- `functions/email.js` tiene `renderNewDesignShell` (líneas 136-141), pero está armado para una **cita futura** (número de hora grande, aviso de ventana de cambios de 3h) — no calza con "avisar sobre una visita que ya terminó". Se diseñó un shell nuevo, más compacto, para este correo específico (ver mockup validado en la sección de Diseño) — reutiliza las constantes compartidas (`SITE_URL`, `EMAIL_HERO_URL`, `esc()`, las fuentes) pero no llama a `renderNewDesignShell`.
- Decisión de negocio ya tomada con Aldo: **el premio (sorteo de 30% de descuento) se separa de la reseña de Google** — incentivar reseñas viola las políticas de Google (riesgo real de que Google elimine reseñas o suspenda la ficha). El correo pide la encuesta sin mencionar la reseña; la invitación a dejar reseña aparece aparte, después de responder, sin condicionar el premio a hacerlo.
- Sorteo: **manual**. El sistema solo guarda las respuestas; Aldo revisa la colección en la consola de Firebase cuando quiera hacer el sorteo y entrega el premio a mano. Cero canje de cupón, cero integración con el flujo de reservas.

## Diseño

### Disparo: `exports.sendSatisfactionSurveys`

Nueva función programada (`onSchedule`), cada 5 minutos, mismo criterio "debido" que `sendBookingReminders`:

- Interruptor de seguridad: `businessInfo.surveysEnabled !== true` → no hace nada (default apagado, igual que `remindersEnabled`/`nudgesEnabled`).
- Query: `bookings.where('status','==','completed').where('date','>=', ayer).where('date','<', mañana)` (reutiliza el índice `(status, date)` existente, sin índice nuevo).
- Filtro fino en JS (lógica pura, sin I/O — nuevo módulo `functions/surveys.js`, mismo patrón que `functions/reminders.js`): "debida" si `endedAt` fue hace **10 minutos o más**, `surveySentAt` no está seteado, y hace **menos de 24 horas** (tope de seguridad — pasado un día, preguntar "¿cómo estuvo tu corte?" ya no tiene sentido, se descarta sin reintentar más).
- Igual que `sendBookingReminders`: sin `email` no hay a quién mandarle (reserva por teléfono) → se salta. Falla individual no aborta el lote; se loguea y la corrida siguiente reintenta (mientras siga dentro de las 24h).
- Al enviar: `sendSurveyEmail(booking, {...})` y luego `update({surveySentAt: <ISO>})`.

### Correo: `renderSurveyEmail` / `sendSurveyEmail` (`functions/email.js`)

Diseño validado con el usuario vía mockup visual (versión final "v4" del brainstorming). Estructura (compacta, pensada para caber en una pantalla sin scroll):

1. Header delgado: logo 46px + "SCISSOR WHITE · CONCEPCIÓN".
2. Franja de foto real (`EMAIL_HERO_URL`, 200px) con degradado oscuro y texto superpuesto directo (sin tarjeta flotante): "SCISSOR WHITE · CONCEPCIÓN" + "Gracias por confiar en nosotros."
3. Eyebrow "TU OPINIÓN" + título Audiowide "¿Cómo estuvo tu visita?" + intro de una frase que ya incluye servicio y profesional inline (sin tabla de detalle aparte): *"Hola, {nombre} — gracias por venir. Cuéntanos en 30 segundos cómo estuvo tu {servicio} con {profesional}."*
4. 5 botones de estrellas en una fila (1 a 5), cada uno un link a `https://scissorwhite.cl/encuesta.html?code={code}&t={token}&rating={n}` — el de 5 estrellas destacado (fondo negro) como el "default" visual, igual criterio que un botón primario en los otros correos.
5. Línea del sorteo, sin mención de Google: *"Responder te deja participando en el sorteo mensual de un 30% de descuento en tu próximo corte."*
6. Footer delgado de una línea: "Más que cortes, creamos identidad." + link al sitio.

No se envía si `!b.email` (igual criterio que el resto de los correos al cliente).

### Página `public/encuesta.html`

Mismo patrón que `confirmar-cita.html`: standalone, `code`+`t`+`rating` (opcional, precarga la selección) en la URL, `type="module"` importando de `js/data.js`.

Flujo:
1. Carga → `getBookingForSurvey(code, token)`. Si el token no es válido o el `code` no calza: "Este link no es válido." Si `status !== 'completed'`: mensaje genérico ("Esta encuesta ya no está disponible") — no debería pasar en la práctica (el correo solo sale para reservas completadas), pero se cubre por si el link se reenvía o se abre tarde de más.
2. Si ya existe una respuesta para esa reserva (`b.surveyResponseAt` ya seteado): pantalla de gracias directa ("Ya recibimos tu opinión, ¡gracias!"), sin permitir enviar dos veces — mismo criterio idempotente que `confirmar-cita.html`.
3. Si no: muestra las mismas 5 estrellas (la que vino en `?rating=` queda preseleccionada, pero se puede cambiar tocando otra), más un campo de texto opcional ("¿algo que quieras contarnos? (opcional)"), y un botón "Enviar".
4. Al enviar → `submitSatisfactionSurvey(code, token, rating, comment)` → pantalla de gracias: *"¡Gracias por tu opinión! Quedaste participando en el sorteo mensual de un 30% de descuento."* + un link aparte, más chico, sin botón: *"¿Nos dejarías también una reseña en Google? [link]"* apuntando a `googleReviews/main.writeReviewUri` (se pide vía `getBookingForSurvey`, que lo incluye en la respuesta — no se agrega una llamada nueva a Firestore desde el cliente).

### Callables nuevos (`functions/index.js`)

Mismo patrón exacto que `getBookingForReminderAction`/`respondToBookingReminder` — búsqueda por `reminderToken`, nunca por `code` solo; nunca devuelven el token; idempotentes.

```js
exports.getBookingForSurvey = onCall({ region: 'southamerica-east1' }, async (request) => {
  // busca por reminderToken, valida code, valida status === 'completed'
  // devuelve: { code, svcName, barberName, status, alreadyAnswered: !!b.surveyResponseAt, writeReviewUri }
  // writeReviewUri sale de googleReviews/main (lectura best-effort: si el doc no existe o no tiene el campo, '' -- la página simplemente no muestra el link de reseña)
});

exports.submitSatisfactionSurvey = onCall({ region: 'southamerica-east1' }, async (request) => {
  // busca por reminderToken, valida code y status === 'completed'
  // valida rating: entero 1-5
  // comment: string, recortado a un máximo razonable (500 caracteres) para no permitir un payload gigante
  // idempotente: si b.surveyResponseAt ya existe, devuelve {ok:true, already:true} sin crear un segundo doc
  // si no: transacción -- crea surveys/{autoId} (bookingId, code, rating, comment, clientName: b.name, clientEmail: b.email, submittedAt) + update(ref, {surveyResponseAt: nowISO})
});
```

### Datos: colección `surveys/{id}`

```js
{ bookingId, code, rating: 1-5, comment: '' , clientName, clientEmail, submittedAt }
```

`firestore.rules`: `match /surveys/{id} { allow read: if isAdmin(); allow write: if false; }` — mismo criterio que `bookings`/`patients`: ningún cliente escribe directo, todo pasa por el callable con Admin SDK. Aldo revisa la colección en la consola de Firebase para el sorteo mensual — no se construye ninguna pantalla de admin para esto (decisión ya tomada).

Campo nuevo en `bookings/{id}`: `surveySentAt` (cuándo se mandó el correo) y `surveyResponseAt` (cuándo respondió) — mismo patrón que `reminderSentAt`/`respondedAt`.

Campo nuevo en `businessInfo/main`: `surveysEnabled` (booleano, ausente = apagado).

## Testing

- `functions/test/surveys.test.js` (nuevo, puro, sin emulador): casos de "debido" para `findBookingsNeedingSurvey` — igual estructura que `functions/test/reminders.test.js` (dentro de la ventana, en el borde de 10 min, en el borde de 24h, ya tiene `surveySentAt`, `endedAt` corrupto no tumba el lote).
- Verificación manual (no automatizable sin emulador + Resend real): activar `surveysEnabled` en staging, completar una atención de prueba, confirmar que el correo llega ~10-15 min después con el diseño validado, que cada botón de estrella lleva a `encuesta.html` con la calificación correcta preseleccionada, que enviar la encuesta funciona y que un segundo intento (recargar la página o volver a tocar el link) no duplica la respuesta.

## Fuera de alcance

- Cualquier automatización del sorteo o canje de cupón — decisión explícita de Aldo, sorteo 100% manual por ahora.
- Vista de administración para las respuestas — se revisan directo en la consola de Firebase.
- Tocar `functions/googleReviews.js` — solo se lee el campo `writeReviewUri` ya cacheado, sin modificar esa lógica.
- Condicionar el premio a dejar la reseña de Google — violaría las políticas de Google, decisión ya descartada explícitamente.
