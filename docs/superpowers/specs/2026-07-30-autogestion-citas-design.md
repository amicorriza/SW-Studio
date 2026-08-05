# Scissor White — Autogestión de citas (confirmar / modificar / cancelar)

- **Fecha:** 2026-07-30
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Spec 1 de 2.** Este documento cubre el portal de autogestión del cliente (confirmar asistencia, modificar, cancelar), los emails de respaldo, y el recordatorio 24h antes de la cita. La **notificación push real al admin cuando se cancela una cita** queda en un Spec 2 separado, que se engancha al cambio de `status` a `'cancelled'` que este spec introduce — así el Spec 1 queda 100% funcional y probado por sí solo antes de sumar la infraestructura de push (FCM + service worker).
- Este documento es un addendum a los diseños Firebase existentes (`docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md`, `2026-07-02-scissor-white-v19-update-design.md`) y complementa — sin superponerse — al módulo de WhatsApp (`2026-07-06-whatsapp-kapso-design.md`), que dejó explícitamente fuera de alcance los avisos de cancelación/edición.

## Contexto (estado actual, verificado en el código)

- `onBookingCreated` (`functions/index.js`) hoy solo envía el email de "Reserva Confirmada" (Resend, `functions/email.js`) al crear la reserva. No existe ningún flujo de autogestión para el cliente.
- El FAQ y el modal de reserva en `public/index.html` ya **prometen** "cancela o reagenda hasta 3 horas antes, modifica hasta 2 veces, directamente desde la plataforma" — pero eso no está implementado.
- `bookings/{id}` es un doc por reserva. Las reservas públicas se crean con `addDoc` (ID autogenerado, distinto del campo `code`); las creadas/editadas desde el admin usan `code` como ID del doc.
- `firestore.rules`: `bookings` permite `create` público (validado por `isValidBooking()`), pero `read/update/delete` son **solo admin**. Por eso `getAvailability` y `getClubStatus` ya existen como Cloud Functions `onCall` (Admin SDK, bypassa las reglas) — el público nunca lee `bookings` directo.
- El panel admin (`getBookings()` en `public/js/data.js`) hace una lectura única de la colección, **sin `onSnapshot`** — no hay tiempo real. Esto confirma que, sin push (Spec 2), el admin no se entera de una cancelación hasta refrescar el panel manualmente.
- **Bug lateral que este trabajo destapa:** `computeAvailability` (`functions/availability.js`) y `checkConflict` (admin, `public/index.html`) cuentan **todas** las reservas del día como "ocupado" sin filtrar por `status`. Si no se corrige, cancelar una cita no libera el horario. Se corrige como parte de este spec (no es opcional: el feature de cancelar queda roto sin esto).
- El botón "Eliminar cita" del admin hoy no borra realmente el doc en Firestore (`saveBookings` solo hace `set/merge`, nunca `delete`) — es un bug preexistente, fuera de alcance de este spec. El nuevo flujo de cancelación **no reutiliza ese camino**: cancelar es un cambio de `status` vía Cloud Function, no un borrado.

## Decisiones tomadas con el usuario

1. **Punto de entrada:** ambos — el link de gestión funciona tanto desde el email de confirmación inicial como desde un recordatorio enviado 24h antes de la cita.
2. **Seguridad del link:** token nuevo de alta entropía por reserva (no se reutiliza el `code` visible, que no fue diseñado para ser secreto).
3. **Push a admin:** push real del navegador (FCM), no una alerta solo-si-el-panel-está-abierto. Se implementa en el Spec 2.
4. **Modificar cita:** reutiliza el mismo widget público de reserva, precargado con los datos actuales.
5. **Reglas de negocio:** se aplican server-side — cancelar/modificar bloqueado a menos de 3 horas de la cita; modificar bloqueado tras 2 modificaciones (cancelar sigue disponible).
6. **Recordatorio:** 24 horas antes de la hora exacta de la cita (ventana rodante, no una hora fija del día anterior).
7. **"Confirmar cita":** confirmación de asistencia — se guarda en el doc y se refleja en la Agenda del admin.
8. **Email de modificación:** estilo antes/después (valores anteriores tachados + nuevos), igual al ejemplo de cancelación de referencia.
9. **Cancelar:** requiere un modal de confirmación ("¿Seguro?") antes de ejecutar — fricción para evitar cancelaciones accidentales.

## Arquitectura y modelo de datos

### Campos nuevos en `bookings/{id}`

| Campo | Tipo | Descripción |
|---|---|---|
| `manageToken` | string (32 hex) | Secreto de acceso al link de autogestión. Generado con `crypto.getRandomValues` en el navegador (no `Math.random`, que ya se usa para `code` y no es apto como secreto). Se genera tanto en el widget público (`createBooking`) como en el modal admin, para que toda reserva tenga un link de gestión válido. |
| `attendanceConfirmed` | bool (default `false`) | Se marca `true` cuando el cliente toca "Confirmar cita". |
| `attendanceConfirmedAt` | timestamp | Momento de la confirmación. |
| `modifyCount` | number (default `0`) | Incrementado en cada modificación exitosa vía autogestión. Tope: 2. |
| `status` | string | Se suma el valor `'cancelled'` a los ya existentes (`'pending'`). |
| `cancelledAt` | timestamp | Momento de la cancelación. |
| `reminderSentAt` | timestamp | Evita reenviar el recordatorio 24h si una corrida se solapa con otra. |

`isValidBooking()` en `firestore.rules` se actualiza para exigir `manageToken` (string, `size() >= 24`) en el `create` público. No cambian los permisos de lectura/escritura — el resto sigue siendo solo-admin.

### Por qué todo pasa por Cloud Functions

El cliente nunca puede leer ni escribir `bookings` directo (regla ya existente). Los tres nuevos endpoints son `onCall` HTTPS, región `southamerica-east1`, mismo patrón que `getAvailability`/`getClubStatus`:

- `getBookingForManage({ code, token })` — lectura: valida `token` contra el doc (busca por `manageToken == token`), devuelve solo los campos necesarios para pintar la tarjeta (fecha, hora, servicio, barbero, precio, `status`, `attendanceConfirmed`, `modifyCount`). Nunca expone `manageToken` de vuelta ni datos de otras reservas.
- `confirmBookingAttendance({ code, token })` — marca `attendanceConfirmed:true` + `attendanceConfirmedAt`. Idempotente.
- `cancelBooking({ code, token })` — valida token, valida regla de 3 horas server-side (nunca confiar en el reloj del navegador), marca `status:'cancelled'` + `cancelledAt`, dispara el email de cancelación, agrega entrada en `adminLog` (`action:'client_cancelled_booking'`). Este cambio de `status` es el gancho que usará el Spec 2 para el push.
- `modifyBooking({ code, token, svcId, barberId, date, time })` — valida token, valida 3h + `modifyCount < 2` + disponibilidad real del nuevo horario (reusa `computeAvailability`, excluyendo la propia reserva y las canceladas), actualiza el doc, incrementa `modifyCount`, dispara el email de modificación con los valores anteriores capturados antes del update.

### Fix de disponibilidad (obligatorio para que cancelar funcione)

`computeAvailability` (`functions/availability.js`) y `checkConflict` (`public/index.html`, usado por el admin) se actualizan para excluir `status === 'cancelled'` al calcular horarios ocupados/conflictos. Sin esto, una reserva cancelada seguiría bloqueando ese horario para siempre.

## Flujos

### Página nueva: `public/mi-reserva.html`

Página liviana y separada del `index.html` (5800 líneas), para no inflar el bundle principal. Lee `?code=SW-XXXX&t=<token>` de la URL, llama a `getBookingForManage`, y pinta:

- Detalle de la cita (fecha, hora, servicio, barbero).
- Los 3 botones de la referencia: **Confirmar cita** (verde) / **Modificar cita** (naranja) / **Cancelar cita** (rojo).
- Reglas de negocio reflejadas en la UI (validadas de nuevo server-side en cada acción, nunca solo en el cliente):
  - Menos de 3 horas para la cita → "Modificar" y "Cancelar" deshabilitados, con texto "Para cambios de último minuto, escríbenos por WhatsApp" (mismo link de WhatsApp que ya usa el email de confirmación).
  - `modifyCount >= 2` → solo "Modificar" deshabilitado, con texto explicativo. Cancelar sigue disponible.
  - `status === 'cancelled'` → se muestra solo "Esta cita ya fue cancelada", sin botones.

### Confirmar cita

Toque directo → `confirmBookingAttendance`. Sin modal de confirmación (acción positiva, sin riesgo). Sin email de respaldo (no es un cambio que requiera evidencia). Mensaje en pantalla: "¡Gracias, te esperamos!". En la Agenda del admin aparece un badge "✓ Confirmada por cliente" junto a la hora.

### Cancelar cita

Toque → modal "¿Seguro que quieres cancelar tu cita del [fecha] a las [hora]?" (Cancelar / Volver) → `cancelBooking`. Tras confirmar: pantalla de éxito ("Tu cita fue cancelada exitosamente", igual al tono de la referencia) + email de respaldo enviado en paralelo.

### Modificar cita

No es una pantalla nueva: `mi-reserva.html` redirige a `index.html#reservar&editCode=...&editToken=...`. El JS del `#booking-overlay` existente detecta ese modo "edición" vía el hash, precarga fecha/hora/servicio/barbero actuales (con otra llamada a `getBookingForManage`), y deja elegir un nuevo horario con el mismo motor de disponibilidad real (`getAvailability`, ya excluyendo canceladas). Al confirmar, en vez de `createBooking` se llama a `modifyBooking`. Éxito → pantalla de confirmación (reusa la que ya existe) + email de respaldo.

## Emails de respaldo

Mismo sistema visual que ya existe en `functions/email.js` (hero oscuro, tarjeta de detalle con filas etiqueta/valor, tipografía Cormorant Garamond + Jost, banda oscura de marca, footer) — se agregan dos renders nuevos siguiendo el patrón de `renderClientEmail`:

- **`renderCancelEmail(b)`** — título "Tu reserva fue cancelada" + badge rojo "Cancelada" (junto al código, mismo lugar donde el ejemplo de referencia muestra "Cita #... Cancelada"). Fecha, hora, barbero y sucursal se muestran **tachados** (`text-decoration:line-through`), igual que la captura de referencia.
- **`renderModifyEmail(oldB, newB)`** — título "Tu reserva fue modificada". Cada fila que cambió (fecha, hora, y barbero si cambió) muestra el valor anterior tachado encima y el nuevo valor debajo; las filas que no cambiaron (servicio, precio, código) se muestran normales, una sola vez.

Ambas reutilizan `detailRow`, `dateParts`, `fmtCLP`, `esc` ya existentes en `email.js` — no se duplica la lógica de formato.

También se agrega el bloque visual de los 3 botones (verde/naranja/rojo, igual a la referencia) tanto en `renderClientEmail` (reemplazando el CTA actual "VER MI RESERVA", que hoy apunta solo al home) como en el nuevo email de recordatorio. **Los 3 enlazan a la misma URL**, `mi-reserva.html?code=...&t=...` — ninguno ejecuta la acción directo desde el email. Un link de email que cancelara/confirmara con solo un GET sería inseguro: clientes de correo como Gmail o Outlook (Safe Links) siguen/prefetchean links automáticamente por seguridad, lo que dispararía la acción sin que el cliente haga nada. La página `mi-reserva.html` es la que ejecuta la acción real, tras el tap explícito (y el modal de confirmación en el caso de cancelar).

## Recordatorio 24 horas antes

Nueva función `onSchedule` en `functions/reminders.js`, corre cada 15 minutos. En cada corrida:

1. Calcula la ventana `[ahora + 24h, ahora + 24h + 15min)`.
2. Busca `bookings` con `status == 'pending'`, fecha/hora de la cita dentro de esa ventana, y `reminderSentAt` sin definir.
3. Envía el email de recordatorio (con el bloque de 3 botones) a cada una, y marca `reminderSentAt`.

La ventana de 15 min coincide exactamente con el intervalo de la corrida — sin huecos ni duplicados por diseño; `reminderSentAt` es el respaldo si una corrida se atrasa o se reintenta.

## Toques en el panel admin (Agenda)

- Citas con `status:'cancelled'` se muestran con estilo "cancelada" (tachado / opacidad reducida — mismo espíritu que el patrón ya existente de libre/ocupado) en vez de desaparecer, para mantener trazabilidad. No cuentan como conflicto de horario (ver fix de disponibilidad).
- Badge "✓ Confirmada por cliente" cuando `attendanceConfirmed:true`.
- Sin más cambios al admin — el resto de la Agenda, Dashboard, Clientes, etc. sigue igual.

## Manejo de errores

Mismo criterio que ya aplica hoy para email/WhatsApp: cada acción del cliente (confirmar/modificar/cancelar) es una operación server-side que valida todo antes de escribir — si la validación falla (token inválido, fuera de la ventana de 3h, tope de modificaciones alcanzado, horario ya no disponible), la Cloud Function devuelve un error explícito (`HttpsError`) y la página muestra el mensaje correspondiente sin tocar el doc. El envío del email de respaldo, si falla, se loguea (`adminLog`, mismo patrón que `email_failed`) pero **no revierte** el cambio ya aplicado (la cancelación/modificación ya es válida y real; el email es respaldo, no la fuente de verdad).

## Testing

### Unit tests (`node:test`, mismo estilo que `email.test.js` / `availability.test.js`)

- `functions/test/reminders.test.js` (o junto a un nuevo `functions/bookingRules.js` con la lógica pura): `canModify(booking, now)` y `canCancel(booking, now)` — casos con >3h, exactamente 3h (límite), <3h, y `modifyCount` en 0/1/2.
- `functions/test/email.test.js`: casos nuevos para `renderCancelEmail` (contiene tachado, badge "Cancelada", código) y `renderModifyEmail` (contiene valor anterior y nuevo, tachado solo en lo que cambió).
- `functions/test/availability.test.js`: caso nuevo verificando que una reserva `status:'cancelled'` no aparece en `barberBusy`.

### Prueba manual (emulador)

1. Crear una reserva de prueba desde la UI pública → verificar que el email de confirmación trae el link a `mi-reserva.html` con `code` + `token` válidos.
2. Abrir ese link → confirmar asistencia → verificar `attendanceConfirmed:true` en el doc y el badge en la Agenda admin.
3. Cancelar desde `mi-reserva.html` → verificar modal de confirmación, `status:'cancelled'` en el doc, email de cancelación recibido, y que el horario vuelve a aparecer disponible en `getAvailability`.
4. Modificar una reserva nueva → verificar `modifyCount:1`, el widget precargado con los datos correctos, el nuevo horario validado contra disponibilidad real, y el email de modificación con el formato antes/después.
5. Repetir modificación una segunda vez (`modifyCount:2`) y verificar que una tercera queda bloqueada con el mensaje correspondiente.
6. Forzar una reserva a <3h de la cita (ajustando la hora en el emulador) y verificar que modificar/cancelar quedan bloqueados con el mensaje de WhatsApp.
7. Crear una reserva con fecha/hora dentro de la ventana de 24h±15min y correr manualmente la función de recordatorio → verificar que llega el email y que `reminderSentAt` evita un segundo envío en la corrida siguiente.

## Fuera de alcance (explícitamente)

- Push real al admin al cancelar — **Spec 2**, se engancha al cambio de `status` a `'cancelled'` que este spec introduce.
- Avisos de cancelación/modificación por WhatsApp (ya excluido en `2026-07-06-whatsapp-kapso-design.md`).
- Reintentos automáticos de envío de email.
- Autenticación real de cliente (cuentas, login) — todo sigue siendo por token en el link, sin login.
- Arreglar el bug preexistente de "Eliminar cita" del admin (no borra el doc en Firestore) — no relacionado con este flujo, que usa cambio de `status`, no borrado.
