# Scissor White — Módulo de aviso de reserva por WhatsApp (Kapso)

- **Fecha:** 2026-07-06
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Contexto:** hoy `onBookingCreated` (`functions/index.js`) envía por email la confirmación de reserva al cliente y un aviso a la barbería, vía Resend (`functions/email.js`). Se quiere agregar un segundo canal, WhatsApp, usando [Kapso](https://kapso.ai) como proveedor. El objetivo inmediato es un **módulo de pruebas**: validar la integración usando el sandbox de Kapso, con la API key que ya existe (sin número de WhatsApp propio conectado todavía).
- Este documento es un addendum al diseño Firebase existente (`docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md`, `docs/superpowers/specs/2026-07-02-scissor-white-v19-update-design.md`): reutiliza la misma Cloud Function, la misma región (`southamerica-east1`) y el mismo patrón de secrets ya usado para Resend.

## Decisiones tomadas con el usuario

1. **Destinatario:** solo el **cliente** recibe el WhatsApp (el aviso a la barbería sigue siendo solo por email, sin cambios).
2. **Alcance:** solo el evento de **confirmación de reserva nueva** (el mismo trigger `onBookingCreated` que ya dispara el email). Cancelaciones/ediciones desde el admin quedan fuera de este alcance.
3. **Envío simultáneo, no bloqueante:** WhatsApp y email se disparan en paralelo; si uno falla, no debe afectar al otro ni a la reserva ya guardada — mismo criterio que ya aplica hoy el fallo de email (se loguea, no se relanza).
4. **Texto libre ahora, plantilla después, mismo módulo:** el sandbox de Kapso **no admite plantillas** (`templates`), solo texto libre y solo a números pre-registrados en la sesión de sandbox. Pero en producción real, como este mensaje lo inicia el sistema (no es respuesta a un mensaje del cliente dentro de la ventana de 24h que exige Meta), probablemente haga falta una plantilla aprobada. Por eso el módulo se diseña con un modo seleccionable (`text` | `template`) desde ya, aunque el modo `template` no se pueda probar en sandbox todavía.

## Arquitectura

Se agrega `functions/whatsapp.js`, paralelo a `functions/email.js`, sin dependencias nuevas (Node 20 trae `fetch` global; no se necesita agregar un cliente HTTP).

### `functions/whatsapp.js`

```
normalizePhone(phone)
  → limpia el formato chileno con espacios ("+56 9 8251 4114") a E.164 sin "+" ("56982514114"),
    que es lo que exige la API de Meta/Kapso.

buildTextBody(b)
  → arma el string del mensaje de texto libre (modo "text"): fecha, hora, servicio,
    barbero, código. Contenido equivalente al email al cliente, en formato plano.

buildTemplateComponents(b)
  → arma el array de variables posicionales para el modo "template"
    (formato que exige Meta para plantillas aprobadas: [{ type: 'body', parameters: [...] }]).

sendBookingWhatsApp(b, { apiKey, phoneNumberId, mode, templateName, templateLang })
  → POST a https://api.kapso.ai/meta/whatsapp/v24.0/{phoneNumberId}/messages
    headers: X-API-Key, Content-Type: application/json
    body (mode === 'text'):     { messaging_product:'whatsapp', to, type:'text', text:{ body } }
    body (mode === 'template'): { messaging_product:'whatsapp', to, type:'template',
                                   template:{ name: templateName, language:{ code: templateLang },
                                   components: buildTemplateComponents(b) } }
  → lanza si la respuesta HTTP no es 2xx (para que el caller decida qué hacer con el error).

module.exports = { normalizePhone, buildTextBody, buildTemplateComponents, sendBookingWhatsApp };
```

### `functions/index.js`

Secrets nuevos (mismo patrón `defineSecret` ya usado para Resend):

- `KAPSO_API_KEY`
- `KAPSO_PHONE_NUMBER_ID`
- `WHATSAPP_MODE` (`text` en sandbox/pruebas, `template` en producción)
- `WHATSAPP_TEMPLATE_NAME` / `WHATSAPP_TEMPLATE_LANG` (solo se leen si `WHATSAPP_MODE === 'template'`)

Dentro de `onBookingCreated`, el bloque que hoy hace `try { sendBookingEmails(...) } catch` pasa a disparar ambos canales en paralelo con `Promise.allSettled`, y escribe el resultado de cada uno por separado:

```js
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

const updates = {
  emailStatus: emailResult.status === 'fulfilled' ? 'sent' : 'failed',
  whatsappStatus: waResult.status === 'fulfilled' ? 'sent' : 'failed',
};
await snap.ref.update(updates);

if (emailResult.status === 'rejected') { logger.error('Fallo al enviar emails', emailResult.reason); /* adminLog: email_failed */ }
if (waResult.status === 'rejected') { logger.error('Fallo al enviar WhatsApp', waResult.reason); /* adminLog: whatsapp_failed */ }
```

La sincronización de `patients` que ya existe después no cambia.

## Flujo de datos

`onDocumentCreated('bookings/{id}')` → lee `b` → dispara email y WhatsApp en simultáneo vía `Promise.allSettled` → escribe `emailStatus` + `whatsappStatus` en el mismo doc de booking → por cada canal que falló, agrega una entrada en `adminLog` (mismo patrón ya existente, con `action: 'whatsapp_failed'` para el nuevo caso) → sincroniza `patients` (sin cambios).

## Manejo de errores

Cada canal es independiente y no bloquea a los demás ni relanza el error hacia arriba — mismo criterio que ya aplica hoy para el email. Sin reintentos automáticos en esta primera etapa (no hay indicio de que se necesiten todavía; se puede agregar después si el sandbox o producción muestran fallos intermitentes).

## Testing

### Unit tests (`functions/test/whatsapp.test.js`, mismo estilo `node:test` que `email.test.js`)

- `normalizePhone`: casos con espacios (`"+56 9 8251 4114"` → `"56982514114"`), ya en E.164, sin `+56`.
- `buildTextBody`: contiene nombre, servicio, barbero, fecha/hora y código.
- `buildTemplateComponents`: arma el array de parámetros en el orden esperado.

No se mockea la llamada HTTP de `sendBookingWhatsApp` (mismo criterio que hoy: `sendBookingEmails` tampoco se testea directamente, solo las funciones puras de render).

### Prueba manual en sandbox (el módulo de pruebas pedido)

1. En el dashboard de Kapso: **WhatsApp → Sandbox**, registrar el número de teléfono de prueba (recibe un código de 6 caracteres, se responde ese código como mensaje al número sandbox para activar la sesión).
2. En `functions/.env` (gitignored, para el emulador): `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID` (el del sandbox), `WHATSAPP_MODE=text`.
3. Levantar el emulador y crear una reserva de prueba desde la UI pública, usando como teléfono el número ya registrado en la sesión de sandbox.
4. Verificar: (a) llega el mensaje de WhatsApp al número de prueba, (b) `whatsappStatus: 'sent'` queda escrito en el doc de `bookings` en el emulador, (c) si se prueba con un número **no** registrado en el sandbox, `whatsappStatus` debe quedar en `'failed'` y quedar logueado en `adminLog` — así se valida también el camino de error sin romper nada más.

### Camino a producción (documentado, no implementado en este módulo)

Cuando se conecte el número real del local a Kapso: crear y conseguir aprobación de una plantilla de WhatsApp con el mismo contenido del mensaje de confirmación, y al desplegar cambiar los secrets `WHATSAPP_MODE=template`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` — sin tocar código.

## Fuera de alcance (explícitamente)

- Avisos de cancelación/edición de reserva por WhatsApp.
- Aviso a la barbería por WhatsApp (sigue siendo solo email).
- Reintentos automáticos ante fallo de envío.
- Creación/aprobación real de la plantilla de WhatsApp en Kapso (queda documentada como paso futuro, no es parte de este trabajo).
