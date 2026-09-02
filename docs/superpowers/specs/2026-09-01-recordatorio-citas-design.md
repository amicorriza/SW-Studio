# Scissor White — Recordatorio de citas (confirmar / declinar) para reducir no-show

- **Fecha:** 2026-09-01
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Etapa:** B/C — confirmado con el usuario el 2026-09-01 que el proyecto ya avanzó de las etapas 0/A, donde "recordatorios" estaba explícitamente prohibido (ver CLAUDE.md, "PROHIBIDO en todas las etapas 0 y A").
- Este documento es independiente del spec `2026-07-30-autogestion-citas-design.md` (autogestión completa: confirmar/modificar/cancelar con `manageToken`, página `mi-reserva.html`). Esa branch (`feature/autogestion-citas`) quedó desactualizada respecto a main y nunca se fusionó; por decisión explícita del usuario, este spec se diseñó **desde cero**, sin heredar sus decisiones de arquitectura (no hay `manageToken`, no hay `mi-reserva.html`, no hay modificar/cancelar). Cualquier coincidencia con ese spec (ej. token de alta entropía, patrón de página intermedia) es porque el problema de seguridad subyacente es el mismo, no porque se haya reusado el diseño.

## Contexto (estado actual, verificado en el código)

- `buildBookingDoc()` (`functions/createBooking.js`) escribe `status: DEFAULT_BOOKING_STATUS` (`'pending'`, definido en `functions/shared/status.js`) y **nada en el repo lo cambia jamás** después de creada la reserva. `BOOKING_STATUSES` hoy solo contiene `'pending'` — no existe ninguna transición de estado real.
- `computeAvailability` (`functions/shared/availability.js`) no filtra reservas por `status` en absoluto — solo filtra staff por `status === 'active'`. Toda reserva, sin importar su estado, ocupa el horario para siempre.
- El doc de cada reserva (`bookings/{id}`) tiene ID autogenerado (`db.collection('bookings').doc()`), **distinto** del campo público `code`. El cliente solo conoce `code`, nunca el ID del doc.
- Cada reserva guarda `date` (string `YYYY-MM-DD`), `time` (string `HH:mm`) y `tz` (IANA, la zona horaria del negocio al momento de crear la reserva — ver comentario en `buildBookingDoc`). El instante real de la cita se calcula con `zonedInstant(dateKeyOf(date), time, tz)` (`functions/shared/timezone.js`), nunca con la hora del navegador — esto ya lo hace `createBooking.js` y este spec reutiliza el mismo criterio.
- `functions/email.js` ya tiene el sistema visual de emails (hero oscuro, `detailRow`, `dateParts`, `fmtCLP`, `esc`, banda de marca) usado por `renderClientEmail` y `renderShopEmail`. Resend ya está integrado (`sendBookingEmails`).
- Ya existe precedente de función programada: `exports.refreshGoogleReviews` (`onSchedule`, cron diario, `southamerica-east1`, `functions/index.js`) — mismo patrón de "un fallo no debe tirar la función a estado de error ni gastar reintentos".
- **Riesgo de despliegue conocido:** el deploy de Cloud Functions se hace a mano con una lista explícita de 8 nombres en `README.md` (líneas 155-157: `onBookingCreated, createBooking, getClubStatus, getAvailability, onBookingWritten, onScheduleBlockWritten, refreshGoogleReviews, syncGoogleReviews`). El propio CLAUDE.md documenta que `createBooking` quedó fuera de esa lista una vez y se congeló en silencio. Cualquier función nueva de este spec debe sumarse a esa lista explícitamente.
- Existe una branch separada `feature/whatsapp-kapso` que ya envía WhatsApp (vía Kapso) en paralelo al email cuando se crea una reserva, pero su spec (`2026-07-06-whatsapp-kapso-design.md`) dejó fuera a propósito los avisos de cancelación/modificación. Este spec no depende de esa branch ni la modifica — el canal elegido acá es solo email.

## Decisiones tomadas con el usuario

1. **Canal:** solo email (Resend), no WhatsApp ni SMS.
2. **Timing del recordatorio:** ventana rodante — exactamente 24h antes de la hora real de la cita (no un job diario a hora fija). Como las citas solo existen dentro del horario de atención del negocio, el envío también cae siempre dentro de ese horario; no hace falta una ventana de envío separada ni un "clamp" a horas nocturnas.
3. **Al declinar:** transición de estado real, `status: 'declined'`. Libera el horario (no se borra el documento). Es la primera transición de estado que introduce el repo.
4. **Al confirmar:** transición de estado real, `status: 'confirmed'` (no un campo booleano aparte). Permite distinguir de un vistazo "confirmada", "declinada" y "recordatorio enviado, sin respuesta".
5. **Seguridad del link:** token nuevo de alta entropía (`reminderToken`), no se reutiliza `code` (visible al cliente pero no diseñado para ser secreto).
6. **Vista admin:** sí entra en el alcance — badge en la Agenda para `confirmed` / `declined` / `pending` sin respuesta.

## Modelo de datos

### Campos nuevos en `bookings/{id}`

| Campo | Tipo | Descripción |
|---|---|---|
| `status` | string | Se suman `'confirmed'` y `'declined'` a `BOOKING_STATUSES` en `functions/shared/status.js` (hoy solo `'pending'`). |
| `reminderToken` | string (32 hex) | Generado server-side con `crypto.randomBytes(16).toString('hex')` (Node `crypto`, nunca `Math.random`) **en el momento de enviar el recordatorio**, no al crear la reserva. Esto mantiene `createBooking.js` y `buildBookingDoc()` sin tocar. |
| `reminderSentAt` | string ISO | Se setea junto con `reminderToken` al enviar el email. Evita reenvíos si una corrida se solapa con la siguiente, y es la señal (junto con `status`) que usa el admin para mostrar "sin respuesta". |
| `respondedAt` | string ISO | Se setea cuando el cliente confirma o declina (junto con el cambio de `status`). |

No se agrega ningún campo a `services`, `staff` ni `businessInfo`. No se toca `firestore.rules` para lectura/escritura directa del cliente — igual que hoy, todo pasa por Cloud Functions `onCall` con Admin SDK.

## Arquitectura

### `functions/reminders.js` (módulo nuevo, lógica pura)

- `findBookingsNeedingReminder(bookings, now)` — recibe un array de reservas candidatas (ya filtradas por Firestore a `status == 'pending'` y sin `reminderSentAt`) y el instante actual. Para cada una calcula `zonedInstant(dateKeyOf(b.date), b.time, b.tz)` y devuelve las que caen en `[now + 24h, now + 24h + 15min)`. Función pura, testeable sin emulador ni Firestore.
- Generación del token: `crypto.randomBytes(16).toString('hex')`.

### `functions/email.js` — nuevo render

- `renderReminderEmail(b, token)` — mismo estilo visual que `renderClientEmail` (reutiliza `detailRow`, `dateParts`, `fmtCLP`, `esc`; hero oscuro con fecha/hora, banda de marca). Dos botones, **Confirmar** (verde) y **Declinar** (rojo/neutro), cada uno apuntando a `https://scissorwhite.cl/confirmar-cita.html?code=<code>&t=<token>&r=confirm` (o `r=decline`).

### `functions/index.js` — dos exports nuevos

**`exports.sendBookingReminders`** (`onSchedule`, cada 15 minutos, `southamerica-east1`, secrets de Resend):

1. Calcula los 1-2 día-clave candidatos (`dayKey`) en que puede caer la ventana `[now+24h, now+24h+15min)`, considerando que el negocio opera en una zona horaria conocida (`businessInfo` o el `tz` ya guardado en reservas recientes).
2. Query: `bookings` con `where('status', '==', 'pending')` y `where('date', 'in', <día-clave candidatos>)`. Es muy probable que esto pida un índice compuesto nuevo en Firestore — mismo patrón que ya pasó con `scheduleBlocks` (ver `f69b583` en el historial). Se documenta como paso explícito del plan de implementación, no como sorpresa de última hora.
3. Filtra con `findBookingsNeedingReminder`.
4. Para cada reserva: genera `reminderToken`, envía `renderReminderEmail` vía `sendBookingEmails`/Resend, y solo si el envío fue exitoso escribe `reminderToken` + `reminderSentAt`. Un fallo individual se loguea (`adminLog`, patrón ya usado para `email_failed`) y no aborta el resto de la corrida — mismo criterio de resiliencia que `refreshGoogleReviews`.

**`exports.respondToBookingReminder`** (`onCall`, `southamerica-east1`):

- Entrada: `{ code, token, action }`, `action ∈ {'confirm', 'decline'}`.
- Busca la reserva con `where('reminderToken', '==', token)` — se busca por el token (32 hex, único por diseño), no por `code`; así la seguridad no depende de que `code` sea único, y no hace falta índice compuesto para esta query (una sola igualdad). `code` viaja en la URL solo por legibilidad/depuración y se valida que coincida con el doc encontrado, como chequeo adicional.
- Si no existe ningún doc con ese `reminderToken`, o el `code` no coincide con el que sí se encontró → `HttpsError('not-found', ...)` con el mismo mensaje genérico en ambos casos (no revelar cuál de las dos cosas falló).
- Si `status` ya no es `'pending'` (ya confirmó, ya declinó, o cambió por otra vía) → no es un error: devuelve `{ ok: true, already: true, status: <status actual> }` para que la página muestre "ya registramos tu respuesta", sin volver a escribir.
- Si todo es válido: `status = action === 'confirm' ? 'confirmed' : 'declined'`, más `respondedAt` (servidor). Idempotente por diseño (un segundo tap con el mismo link no rompe nada, cae en la rama "already").

### Página nueva `public/confirmar-cita.html`

Página liviana y separada de `index.html` (mismo criterio que se usó para no inflar el bundle principal en otros goals). Lee `?code=&t=&r=` de la URL:

- Muestra el resumen de la cita (fecha, hora, servicio, barbero) — para esto necesita un endpoint de lectura; se reutiliza el mismo `respondToBookingReminder` en modo lectura no es viable (cambiaría estado), así que se agrega una tercera función mínima **`getBookingForReminderAction({ code, token })`** (`onCall`), que busca por `reminderToken` (mismo criterio que `respondToBookingReminder`) y solo lee y devuelve los campos necesarios para pintar la tarjeta, sin escribir nada. Nunca devuelve `reminderToken` de vuelta.
- Pinta **un solo botón**, cuyo texto depende de `r` ("Sí, confirmo mi asistencia" / "No podré ir, declinar cita"). Tocar el botón es lo único que dispara `respondToBookingReminder` — cargar la página nunca ejecuta la acción. Esto es obligatorio, no cosmético: clientes de correo (Gmail, Outlook Safe Links) siguen/prefetchean automáticamente los links de un email por razones de seguridad, y un link que ejecutara la acción con un simple GET se dispararía solo sin que el cliente haga nada.
- Tras la acción: pantalla de éxito acorde ("¡Gracias, te esperamos!" / "Listo, liberamos tu horario") o el mensaje de "ya registrado" si `already: true`.

### Flujo end-to-end

`sendBookingReminders` corre cada 15 min → encuentra reservas a 24h exactas → genera token, envía email → cliente abre el email, toca Confirmar o Declinar → llega a `confirmar-cita.html` → toca el único botón de la página → `respondToBookingReminder` cambia `status` → la Agenda del admin refleja el badge correspondiente en la próxima carga.

## Disponibilidad (fix obligatorio)

`computeAvailability` (`functions/shared/availability.js`) se actualiza para excluir `status === 'declined'` al calcular horarios ocupados (`barberBusy`). Sin este cambio, declinar nunca libera el horario y la feature no cumple su propósito. `'confirmed'` y `'pending'` siguen ocupando el slot igual que hoy — no cambia nada para ellos.

Se verifica si `checkConflict()` en el admin (`public/admin/index.html`) — que según CLAUDE.md ya comparte el mismo criterio de minutos-desde-medianoche que `functions/shared/availability.js` — necesita el mismo ajuste para que el admin tampoco vea un horario declinado como ocupado al crear/editar citas manualmente. Se ajusta en la implementación si aplica.

## Vista admin (Agenda)

Badge junto a la hora de cada cita, derivado de `status` + `reminderSentAt` (sin necesidad de campos adicionales para esto):

- `status === 'confirmed'` → badge verde "✓ Confirmada por cliente".
- `status === 'declined'` → estilo atenuado/tachado (mismo espíritu visual que ya existe para libre/ocupado), badge rojo "✗ Declinada"; ya no cuenta como conflicto de horario (ver sección de disponibilidad).
- `status === 'pending'` y `reminderSentAt` presente → badge ámbar "Sin respuesta" — la señal que le permite al admin llamar proactivamente antes de que sea tarde.
- `status === 'pending'` y `reminderSentAt` ausente → sin badge (aún no le corresponde recordatorio; comportamiento idéntico al actual).

Sin más cambios al admin — Dashboard, Clientes, panel de Servicios, etc. siguen igual.

## Manejo de errores

- Token inválido o `code` inexistente en `respondToBookingReminder`/`getBookingForReminderAction` → `HttpsError('not-found', ...)` genérico, mismo mensaje en ambos casos.
- Reserva ya respondida → no es error, ver rama `already: true` arriba.
- Falla el envío del email de recordatorio para una reserva → se loguea en `adminLog` (patrón `email_failed` ya existente), no revierte nada (no hay nada que revertir todavía: `reminderToken`/`reminderSentAt` nunca se escriben si el envío falla), y la reserva queda elegible para reintento en la corrida siguiente (15 min después) porque sigue sin `reminderSentAt`.
- Falla la corrida completa del scheduler (ej. error no capturado) → se loguea (`logger.error`, mismo criterio que `refreshGoogleReviews`) y no se relanza; la corrida siguiente (15 min después) recoge lo que haya quedado pendiente.

## Riesgos de despliegue

- La lista manual de funciones en `README.md` (líneas 155-157) debe actualizarse para incluir `sendBookingReminders`, `respondToBookingReminder` y `getBookingForReminderAction` — riesgo ya documentado en CLAUDE.md (`createBooking` se cayó de esa lista una vez en silencio).
- La query de `sendBookingReminders` probablemente requiere un índice compuesto Firestore nuevo (`status` + `date`) — se declara explícitamente en el plan de implementación, no se descubre recién al desplegar (mismo problema que ya ocurrió con `scheduleBlocks`).
- Todo despliegue de esta feature va a **staging**, nunca a producción — los despliegues a producción los hace Aldo (invariante del proyecto).

## Testing

### Unit tests (`node:test`, mismo estilo que `email.test.js` / `availability.test.js`)

- `functions/test/reminders.test.js`:
  - `findBookingsNeedingReminder`: reservas dentro de la ventana, justo en el borde inicial/final, fuera de la ventana (antes y después), respeto del `tz` propio de cada reserva (dos reservas a la misma hora local pero con `tz` distinto no deben tratarse igual), y exclusión de reservas que ya tienen `reminderSentAt`.
- `functions/test/email.test.js`:
  - `renderReminderEmail`: contiene ambos botones, cada uno con la URL correcta (`code`, `token`, `r=confirm`/`r=decline`).
- `functions/test/availability.test.js`:
  - Caso nuevo: una reserva `status:'declined'` no aparece en `barberBusy`; una `status:'confirmed'` sí sigue apareciendo (comportamiento sin cambios).

### Prueba manual (emulador)

1. Crear una reserva de prueba y ajustar su `date`/`time` para que caiga dentro de la ventana de 24h±15min.
2. Correr `sendBookingReminders` manualmente → verificar el email recibido (dos botones, datos correctos) y que el doc tiene `reminderToken` + `reminderSentAt`.
3. Tocar el link de "Confirmar" → verificar que `confirmar-cita.html` NO ejecuta nada solo con cargar, tocar el botón → verificar `status:'confirmed'` en el doc y el badge verde en la Agenda admin.
4. Repetir con otra reserva usando el link de "Declinar" → verificar `status:'declined'`, badge rojo en la Agenda, y que `getAvailability` vuelve a ofrecer ese horario como libre.
5. Tocar el mismo link de confirmar/declinar una segunda vez → verificar la rama `already: true` (mensaje "ya registrado", sin sobreescribir `respondedAt`).
6. Forzar un `code`/`token` inválido en la URL → verificar el mensaje de error genérico, sin distinguir "código no existe" de "token incorrecto".

## Fuera de alcance (explícitamente)

- Modificar o cancelar la cita desde este flujo (eso es autogestión completa, spec separado si se retoma).
- WhatsApp o SMS como canal de recordatorio.
- Notificación push en tiempo real al admin cuando alguien declina — el admin la ve al revisar la Agenda, no al instante.
- Cualquier transición automática a un estado tipo "no-show" si el cliente nunca responde al recordatorio.
- Reintentos automáticos más allá de "la corrida siguiente 15 min después recoge lo que quedó sin `reminderSentAt`".
- Cualquier cambio a `feature/autogestion-citas` o `feature/whatsapp-kapso` — este spec no depende de esas branches ni las modifica.
