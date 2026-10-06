# Scissor White — Suspensión del servicio por falta de pago

- **Fecha:** 2026-10-05
- **Proyecto:** Scissor White / SW Studio
- **Alcance:** `firestore.rules`, `functions/index.js`, `functions/shared/license.js` (nuevo), `functions/scripts/license.js` (nuevo), `public/js/data.js`, `public/admin/index.html`, `public/barbero/index.html`, `public/login/index.html`, `public/js/booking-widget.js`, `public/index.html` (solo markup del overlay). Aprobado por Aldo tras brainstorming (enfoque A).

## Contexto (verificado en el código)

- Aldo es dueño del proyecto Firebase `scissor-white` y de la facturación. La dueña del salón es admin del panel (custom claim `admin:true`) y no tiene acceso a la consola.
- Hoy no hay ninguna forma de suspender el servicio sin medidas extremas (`firebase hosting:disable` o borrar funciones), que botan también el landing.
- `businessInfo/main` **no sirve** para guardar el interruptor: las reglas dejan escribirlo al admin (`firestore.rules:25`) y `saveAdmin()` lo reescribe entero (`batch.set(doc(db,'businessInfo','main'), D.info)`, `public/js/data.js:69`). Una marca puesta ahí desaparece al primer guardado del panel.
- Ya existe el patrón de interruptor en tareas programadas: `remindersEnabled`, `nudgesEnabled` y `surveysEnabled` en `businessInfo` (`functions/index.js:397`, `:522`, `:1239`).
- Ningún cliente escribe `bookings`: todo pasa por los callables `createBooking`, `adminSaveBooking` y `markAttendance` (`firestore.rules:69-72`). Por eso, gatear esos callables corta toda la operación de reservas.
- La PWA del barbero no habla con Firestore; usa solo callables (`getMyDay`, `getMyRange`, `getMyClients`, `markAttendance`).

## Objetivo

Aldo puede suspender o reactivar SW Studio cambiando **un solo campo**, sin desplegar ni perder datos. Mientras esté suspendido:

- El landing **sigue en línea** (SEO y clientes del salón intactos).
- El widget de reservas, el panel admin y la PWA del barbero dejan de operar.
- No salen correos ni avisos automáticos (recordatorios, encuestas y avisos al barbero).

Al reactivar, todo vuelve exactamente como estaba.

## Diseño

### Fuente de verdad: `license/main`

Documento nuevo, separado de `businessInfo`:

```js
license/main = {
  status: 'active' | 'warning' | 'suspended',
  message: string,     // opcional; lo que ve la dueña en el panel. OJO: license/main es de lectura
                       // pública, así que el texto debe ser neutro ("Contacta a soporte para reactivar").
  suspendAt: string,   // opcional, 'YYYY-MM-DD'; solo para el texto del banner de warning
  updatedAt: string,   // ISO, lo escribe el script
}
```

- **Reglas:** `allow read: if true; allow write: if false;`. Nadie puede escribirlo desde un cliente, ni siquiera el admin. Solo la consola de Firebase o el Admin SDK (o sea, Aldo).
- **Si no existe, o tiene un `status` desconocido, el sistema está activo.** Así desplegar esto no cambia nada en producción hasta que Aldo cree el documento, y se respeta el invariante "el widget falla abierto".
- `warning` **no** se escala solo a `suspended` cuando llega `suspendAt`. La suspensión siempre es manual: `suspendAt` es solo texto del banner. Automatizarla sería suspender por error si el pago llega tarde por un día.

### Estados

| Estado | Panel admin | PWA barbero | Widget público | Tareas programadas |
|---|---|---|---|---|
| `active` / ausente | normal | normal | normal | normal |
| `warning` | banner fijo: "Pago pendiente. El servicio se suspenderá el {suspendAt}." + `message` | normal | normal | normal |
| `suspended` | pantalla completa "Servicio suspendido" + `message` + botón Cerrar sesión | pantalla "Servicio suspendido temporalmente" | texto neutro en lugar del flujo de reserva | no envían nada |

El público **nunca** ve el motivo. El widget dice algo como: "Las reservas online no están disponibles por ahora. Escríbenos por WhatsApp", con el contacto que ya tiene el landing.

### Lógica pura: `functions/shared/license.js`

Mismo patrón que `status.js` y `attendance.js` (puro, testeable sin emulador):

- `normalizeLicense(data)`: devuelve `{ status, message, suspendAt }`. Si `data` es `undefined`, `null` o trae un `status` desconocido, devuelve `status: 'active'`.
- `isSuspended(license)`: `license.status === 'suspended'`.

### Servidor (la capa que de verdad corta)

En `functions/index.js`:

- `readLicense(db)`: lee `license/main` y normaliza. Cachea el resultado en memoria 60 s por instancia, para no agregar una lectura en cada llamada. Consecuencia aceptada: suspender o reactivar tarda hasta 1 minuto en verse en el servidor.
- `assertActive(db)`: si está suspendido, lanza `HttpsError('failed-precondition', 'Servicio suspendido.', { license: 'suspended' })`. Los frontends reconocen `details.license`. El `message` **no** viaja en el error: `createBooking` lo devolvería a cualquier visitante.

Se llama al principio de estos callables (después de validar la auth, antes de cualquier escritura):

| Callable | Motivo |
|---|---|
| `createBooking` | reserva pública |
| `adminSaveBooking` | reserva desde el panel |
| `markAttendance` | operación del barbero y del admin |
| `getMyDay`, `getMyRange`, `getMyClients` | la PWA entera |
| `linkStaffAccount`, `adminLogEvent` | operaciones del panel |

**Siguen funcionando a propósito:**

- `getAvailability` y `getClubStatus`: solo leen, y el widget ya no llega a usarlos.
- `getBookingForReminderAction` y `respondToBookingReminder`: los usa un cliente final que hace clic en un correo enviado *antes* de la suspensión. Castigarlo no le cobra nada a nadie.
- `refreshGoogleReviews` y `syncGoogleReviews`: alimentan el landing, que sigue en línea, y CLAUDE.md prohíbe tocar el módulo de reseñas. El panel igual queda tapado por el overlay.
- Triggers `onBookingCreated`, `onBookingWritten` y `onScheduleBlockWritten`: sin cambios, porque con los callables cerrados no se crean reservas nuevas.

**Tareas programadas** `sendBookingReminders`, `sendSatisfactionSurveys` y `staffAttendanceNudges`: si `isSuspended(await readLicense(db))`, registran un log y salen sin enviar nada. Es el mismo patrón que sus interruptores actuales y va justo al lado de ellos.

### Reglas de Firestore

- Función nueva `licenseActive()`:
  ```
  function licenseActive() {
    let p = /databases/$(database)/documents/license/main;
    return !exists(p) || get(p).data.get('status', 'active') != 'suspended';
  }
  ```
- Las **escrituras** del admin pasan de `isAdmin()` a `isAdmin() && licenseActive()` en `services`, `staff`, `businessInfo`, `siteImages`, `googleReviews`, `patients`, `scheduleBlocks`, `adminLog`, `staffAccounts` y en el `delete` de `bookings`.
- Las **lecturas** del admin no cambian. Los datos de los clientes del salón son de la dueña: durante la suspensión no se destruyen ni se le niegan. La pantalla de suspensión tapa el panel, y si ella pide un export, Aldo lo entrega desde la consola sin tocar nada.
- `staffDevices/{uid}` (tokens FCM del barbero) no cambia: es inofensivo, y la PWA ya queda bloqueada por `getMyDay`.
- `isAdmin()` no cambia. El criterio admin sigue duplicado en cinco lugares; esto **no** agrega una sexta copia de ese predicado, sino una función distinta.
- **Storage queda fuera:** solo guarda imágenes del sitio, y gatearlo exige reglas cross-service con permisos IAM extra.

**Riesgo a verificar en los tests de reglas:** `saveAdmin()` escribe en batch. Firestore limita los `get()`/`exists()` a 20 por request de batch, aunque un mismo documento leído varias veces se cobra una sola vez. Hay que fijar con un test que un batch del tamaño real del catálogo (todos los servicios + staff + businessInfo) pasa con la licencia activa.

### Frontends

- **`public/js/data.js`:** `readLicense()` hace `getDoc(license/main)` y devuelve los datos crudos o `null`. Si la lectura falla, devuelve `null`; nunca lanza error, para fallar abierto. La normalización vive en cada consumidor con la misma regla (desconocido = activo), igual que la copia deliberada de `status.js` en el admin.
- **Panel admin:** al arrancar (junto a `loadAdmin()`) lee la licencia. Con `suspended` muestra un overlay a pantalla completa que no se puede cerrar, con el `message` y el botón Cerrar sesión. Con `warning` muestra un banner fijo arriba. Además, cualquier error de callable con `details.license === 'suspended'` muestra el mismo overlay, por si la suspensión ocurre con el panel abierto. El overlay usa el estilo existente del panel, sin cambiar el diseño visual.
- **PWA barbero:** no lee Firestore. Si `getMyDay` responde `failed-precondition` con `details.license === 'suspended'`, muestra la pantalla "Servicio suspendido temporalmente. Consulta con la administración", con el botón Salir.
- **Widget (`public/js/booking-widget.js` + markup en `public/index.html`):** `openBK()` lee la licencia. Con `suspended`, el wizard se reemplaza por el texto neutro y el CTA de WhatsApp. Si `createBooking` igual responde suspendido (por ejemplo, la página se cargó antes de suspender), muestra el mismo texto en vez de un error genérico.

### Cómo suspende Aldo

- **Opción 1, consola:** Firestore → `license/main` → editar `status`.
- **Opción 2, script:** `node functions/scripts/license.js suspended --message "..."`, `... warning --suspend-at 2026-10-15` o `... active`. Usa el Admin SDK con las credenciales locales de Aldo (`gcloud auth application-default login`), escribe `updatedAt` y muestra el estado resultante.

### Despliegue

Lo hace Aldo: reglas + las funciones modificadas (lista explícita de nombres, como dice el README; no hay funciones nuevas) + hosting. El orden no importa gracias al "ausente = activo". Después del deploy, crear `license/main` con `status:'active'` para dejar el documento a mano.

## Fe de erratas (2026-10-05, al escribir el plan)

- El widget vive en `public/js/booking-widget.js`, no inline en `public/index.html`. La licencia se lee en `openBK()` y no en `loadCatalog()`, para que `loadCatalog` siga devolviendo solo el catálogo.
- `syncGoogleReviews` queda **sin** gatear: CLAUDE.md prohíbe tocar el módulo de reseñas.
- `license/main` es de lectura pública, así que `message` debe ser neutro y no viaja en el `HttpsError`.
- `/login` y `redirigirSiEsBarbero()` del panel tratan un `getMyDay` suspendido como "es barbero" y lo mandan a `/barbero/`, donde ve la pantalla de suspensión en vez de "tu cuenta no tiene acceso".

## Fuera de alcance

- Cobro, facturación o suspensión automática por fecha.
- Multi-tenant (varios salones). Hoy hay un proyecto Firebase por cliente; si eso cambia, `license` pasaría a ir por tenant.
- Storage.
- Aspectos contractuales: recomendado, pero no es código. Los términos deberían decir que el servicio se suspende por falta de pago y que los datos se conservan.

## Pruebas

- **Unit** (`functions/test`): `normalizeLicense` con `undefined`, `{}`, `status` desconocido, `warning` y `suspended`.
- **Reglas** (`tests/rules`):
  - Un admin escribe con la licencia ausente, `active` o `warning`, y **no** puede escribir con `suspended`.
  - Un admin **sí puede leer** con `suspended`.
  - Nadie (ni el admin ni un anónimo) puede escribir `license/main`, y el público puede leerlo.
  - Un batch del tamaño real del catálogo pasa con la licencia activa.
- **E2E de callables** (`tests/e2e/callables.mjs`): con `suspended`, `createBooking`, `adminSaveBooking`, `markAttendance` y `getMyDay` responden `failed-precondition` con `details.license`, y `respondToBookingReminder` sigue funcionando. Las tareas programadas no envían nada.
- **Navegador:** overlay del admin con `suspended`, banner con `warning`, pantalla de la PWA y texto neutro del widget. El landing carga normal con `suspended`.

## Documentación

- `CLAUDE.md`: agregar a "Estado conocido" que `license/main` es el interruptor de suspensión, que no va en `businessInfo` (y por qué) y que su ausencia significa activo.
- `README.md`: sección corta "Suspender / reactivar el servicio".
