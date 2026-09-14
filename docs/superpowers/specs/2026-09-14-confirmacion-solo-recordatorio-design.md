# Scissor White — Confirmar/Declinar solo desde el recordatorio de 24h

- **Fecha:** 2026-09-14
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Alcance:** `functions/email.js` (render del correo de reserva recibida) y `functions/index.js` (llamada en `onBookingCreated`). No toca `renderReminderEmail`, `sendBookingReminders`, `confirmar-cita.html` ni `respondToBookingReminder`.

## Contexto (estado actual, verificado en el código)

- `onBookingCreated` (`functions/index.js:44-78`) dispara `sendBookingEmails(b, reminderToken, {...})` al instante en que se crea la reserva. `sendBookingEmails` (`functions/email.js:309-318`) llama a `renderClientEmail(b, token)`, que arma el correo "SW Studio — Reserva Recibida".
- `renderClientEmail` (`functions/email.js:159-174`) ya incluye hoy `confirmDeclineButtonsHtml(confirmUrl, declineUrl)` — los mismos botones **Confirmar asistencia** / **No podré ir** que usa el recordatorio de 24h antes (`renderReminderEmail`, `functions/email.js:233-245`), apuntando a `confirmar-cita.html` con el mismo `reminderToken` (`confirmDeclineUrls`, `functions/email.js:147-152`). Esto fue una decisión deliberada del plan `2026-09-08-correos-transaccionales-plan.md` ("no espera al recordatorio de 24h").
- `sendBookingReminders` (`functions/index.js:372-495`) solo selecciona reservas cuyo instante real cae a 24h o menos de distancia (`findBookingsNeedingReminder`, `functions/reminders.js`) — su ventana de tiempo funciona correctamente y no está en cuestión.
- **Problema real observado en producción:** los clientes usan los botones del correo inicial apenas reservan (a veces días antes de la cita), no los del recordatorio. El resultado es una "confirmación de asistencia" registrada en el momento de agendar, sin ningún valor como señal de que el cliente sigue queriendo ir — el propósito del recordatorio (confirmar cerca de la fecha) queda anulado porque la acción ya ocurrió mucho antes.
- El `reminderToken` se genera y persiste en el doc de la reserva independientemente de este correo (`buildBookingDoc` en `createBooking.js`, o el fallback en `onBookingCreated` línea 67-68) — no depende de que `renderClientEmail` lo use.

## Decisión

Los botones Confirmar/Declinar se retiran del correo de reserva recibida. La única vía para confirmar o declinar la asistencia pasa a ser el recordatorio de 24h antes (`renderReminderEmail`). El correo inicial vuelve a ser puramente informativo: confirma que la hora quedó agendada y anticipa que llegará un recordatorio.

No se toca la ventana de tiempo del recordatorio (24h, corrida cada 15 min) ni se agrega un acotamiento a horario comercial (8:00-22:00) — con el origen del problema resuelto (ya no hay una vía de confirmar antes de tiempo), ese ajuste deja de ser necesario. Si después de este cambio se siguen observando confirmaciones que no calzan con "un día antes", se evalúa aparte.

## Diseño

### `functions/email.js`

- `renderClientEmail(b, token)` pierde el parámetro `token` (ya no lo necesita) y pasa a `renderClientEmail(b)`.
- Se quita la llamada a `confirmDeclineUrls` y a `confirmDeclineButtonsHtml` dentro de la función. `belowRowsHtml` queda solo con `whatsappChangeNoteHtml()` (la nota de cambios por WhatsApp se mantiene — sigue siendo válida para cancelar o cambiar antes del recordatorio).
- Copy nuevo:
  - `preheader`: `'Tu hora quedó reservada. Te avisaremos antes de tu cita para que confirmes tu asistencia.'`
  - `introHtml`: `` `Hola, ${esc(b.name)}.<br>Tu hora quedó reservada. Te enviaremos un recordatorio antes de tu cita para que confirmes tu asistencia.` ``
  - `headlineHtml`, `eyebrow`, filas de detalle (`citaDetailRows`) y aviso de ventana de 3h (`visitNoticeHtml`): sin cambios.
- `sendBookingEmails(b, token, {...})` pierde el parámetro `token`: pasa a `sendBookingEmails(b, {apiKey, fromEmail, shopEmail})`. `renderShopEmail(b)` no usa token, así que la función queda sin ninguna necesidad de recibirlo.
- Nada más en el archivo cambia: `confirmDeclineUrls`, `confirmDeclineButtonsHtml`, `renderReminderEmail`, `renderConfirmationEmail`, `renderReminderResponseEmail` siguen igual (los sigue usando el recordatorio real).

### `functions/index.js`

- `onBookingCreated` (línea 76) deja de pasar `reminderToken` a `sendBookingEmails`: `await sendBookingEmails({ ...b, email }, { apiKey: RESEND_API_KEY.value(), fromEmail: FROM_EMAIL.value(), shopEmail: SHOP_EMAIL.value() })`.
- La generación y persistencia de `reminderToken` en el doc (líneas 67-68) **no cambia** — sigue haciendo falta para cuando `sendBookingReminders` lo use más adelante.

## Testing

`functions/test/email.test.js`:

- El test `'email al cliente incluye los botones Confirmar/Declinar con code+token+r correctos (no espera al recordatorio de 24h)'` (línea ~107) se reemplaza por uno que confirma la ausencia: `assert.doesNotMatch(html, /Confirmar asistencia/)` y `assert.doesNotMatch(html, /No podré ir/)` — mismo patrón que ya usa el test de `renderShopEmail` ("sin CTA orientada al cliente").
- El resto de los tests de `renderClientEmail` (nombre/código/servicio, diseño con fecha en hora de Chile, zona horaria guardada, borde de medianoche, fila Duración omitida, escape de HTML, ventana de 3h/tolerancia) se actualizan para llamar `renderClientEmail(booking)` sin el segundo argumento `'abc123token'`.
- Se agrega un test que verifique el nuevo copy: `assert.match(html, /Te enviaremos un recordatorio antes de tu cita/)`.
- `renderReminderEmail`, `renderShopEmail`, `renderReminderResponseEmail`, `renderConfirmationEmail`: sin cambios, deben seguir pasando tal cual.

Verificación manual sugerida (no automatizable sin Resend real): crear una reserva de prueba en staging con email propio y confirmar que el correo de "reserva recibida" llega sin botones y con el copy nuevo.

## Fuera de alcance

- Ventana de tiempo del recordatorio de 24h (`REMINDER_LEAD_MS`/`REMINDER_WINDOW_MS` en `functions/reminders.js`) y su posible acotamiento a horario comercial 8:00-22:00 — no aplica una vez resuelto el origen del problema.
- `confirmar-cita.html`, `respondToBookingReminder`, badges del admin (`Sin respuesta`, etc.) — no dependen del correo inicial, no cambian.
- Página de autogestión de reservas (reagendar/cancelar) — sigue pendiente, fuera de este spec (ver `docs/superpowers/specs/2026-09-08-gestion-reservas-design.md`).
