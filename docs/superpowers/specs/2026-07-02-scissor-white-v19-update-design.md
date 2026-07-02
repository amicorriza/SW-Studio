# Scissor White — Actualización del diseño Firebase para v19

- **Fecha:** 2026-07-02
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Contexto:** el andamiaje Firebase-ready y el plan de migración existentes (`docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md`, `docs/superpowers/plans/2026-06-02-scissor-white-firebase-migration.md`) se diseñaron sobre `index.html v15`. El usuario entregó una versión nueva, **v19** (`scissor_white_v19_completo.zip`), que agrega funcionalidad no contemplada en el diseño original.
- **Este documento es un addendum**, no un reemplazo: todo lo ya decidido en el spec de 2026-06-01 (Firestore como base, Firebase Auth para admin, Resend para email, región `southamerica-east1`, Enfoque A de preservar la UI) sigue vigente. Aquí solo se cubre lo que v19 agrega o cambia.

## Qué trae v19 que v15 no tenía

Verificado directamente en el código de ambos archivos (no solo en la documentación del zip):

| Versión | Qué agrega | Verificado |
|---|---|---|
| v16 | Base de datos de clientes (`sw_patients`) + exportación Excel | `nav Clientes` no existe en v15; sí en v19 |
| v17 | Club SW (fidelización, niveles 10/20 cortes) | campo `club` en el objeto de reserva, ausente en v15 |
| v18 | Columna "barbero atendiente / recurrente" en clientes | parte del módulo `patients`, ausente en v15 |
| v19 | Galería de hasta 4 fotos por cliente (doble clic, lightbox, compresión 1200px/82%) | `compressImage()`, `renderPatPhotos()`, ausentes en v15 |

`index.html` v15 tiene **6 puntos de `localStorage.getItem/setItem`** (los que documenta el plan actual). v19 tiene **10**: los mismos 6 más 4 nuevos alrededor de `PKEY = 'sw_patients'` (líneas ~4462-4470 del v19).

## Decisión: reemplazar la base

`public/index.html` pasa a ser una copia exacta de v19 (mismo patrón que Task 1.2 usó con v15). El v15 actual se conserva en `_source/` como respaldo histórico; se agrega también el v19 original (html + zip) a `_source/` por la misma razón.

## Modelo de datos — qué se agrega a Firestore

### Colección nueva: `patients/{id}`

Mapea 1:1 el objeto que hoy vive en `sw_patients`:

```
patients/{id}
  name:      string
  email:     string
  phone:     string
  notes:     string
  club:      'member' | 'guest'
  visits:    [{ code, date, svcId, svcName, price, barberName, club }]   // embebido, igual que hoy
  photos:    [{ url, path, date }]                                       // ver sección Storage — antes era {src: base64, date}
  createdAt: ISO string
```

`visits[]` se mantiene embebido (no subcolección): el volumen por cliente es bajo (una barbería, no cientos de visitas por persona) y el código actual ya lo trata como array en memoria — mantenerlo embebido minimiza el cambio de lógica.

### Campo nuevo en `bookings/{id}`

- `club: 'member' | 'guest'` — ya lo emite la app (`S.club||'guest'`, línea ~2588 del v19). Se agrega a la validación `isValidBooking()` en las reglas.

## Fotos de clientes → Firebase Storage (no Firestore)

Un documento de Firestore tiene un límite de 1 MB; 4 fotos en base64 (aunque comprimidas a 1200px/82%) pueden acercarse o superarlo, y de todas formas es mala práctica. Además la propia documentación técnica que trae el v19 (`INFORMACION_TECNICA.md`) ya recomienda este cambio.

- **Ruta:** `patients/{patientId}/{photoId}.jpg` — `photoId` se genera al subir (`pat_<timestamp>_<random>`, mismo esquema que usa el código para IDs de cliente).
- **Firestore solo guarda `{url, path, date}` por foto** (`path` se necesita para poder borrar el objeto de Storage al eliminar la foto).
- **El navegador sigue comprimiendo antes de subir** (`compressImage()` ya existe y no cambia); lo único que cambia es el destino del resultado: en vez de `stored.photos.push({src: compressedSrc, ...})` se sube el blob comprimido a Storage (`uploadBytes`) y se guarda la URL resultante.
- **Límite de 4 fotos y el botón de borrado por índice** se mantienen igual — al borrar, además de `splice()` en el array, se llama `deleteObject()` sobre el `path` guardado.

## Hallazgo que obliga a un cambio de diseño: el contador de Club SW

El mensaje de fidelización en la pantalla de confirmación pública ("Llevas 7 visitas, te faltan 3...") se calcula **hoy en el navegador del cliente, sin login**, filtrando *todas* las reservas guardadas en `localStorage` por email (línea ~2595 del v19: `bookings.filter(b => b.email===email && b.club==='member')`).

Con las reglas ya decididas en el spec original (`bookings: read, update, delete: if request.auth != null` — solo staff), el cliente público **no podrá leer esas reservas** tras la migración. Sin cambios, se perdería el conteo exacto justo en el momento en que más valor tiene (la confirmación).

**Solución:** una Cloud Function **Callable**, `getClubStatus(email)`:
- Corre con Admin SDK (sin restricción de reglas), cuenta las reservas `club:'member'` de ese email en `bookings`.
- El formulario público la invoca (`httpsCallable`) justo antes de renderizar el bloque de fidelización, en paralelo a `createBooking()`.
- Devuelve `{ visitCount, benefitReached }`, mismos datos que hoy calcula el filtro local — el HTML/CSS de la tarjeta de fidelización no cambia, solo el origen del dato.
- No abre lectura pública de `bookings` (que expondría reservas de otros clientes); el email nunca se usa para hacer `list`, solo se pasa como parámetro a una función server-side.

## Sincronización de `patients`

Hoy `syncPatientsFromBookings()` corre client-side, dentro del panel admin, cada vez que se abre la pestaña "Clientes": recorre todas las reservas y crea/actualiza el cliente correspondiente por email.

**Decisión (aprobada):** mover ese upsert al mismo trigger `onBookingCreated` que ya se usa para enviar los emails. Al crearse una reserva:
1. Busca `patients` por `email` (query, no por ID — el ID de paciente no es determinístico).
2. Si no existe, lo crea con los datos de la reserva.
3. Si existe, agrega la visita a `visits[]` (si el `code` no está ya) y sube `club` a `'member'` si corresponde.

Ventajas sobre el sync client-side: el cliente aparece en el panel en tiempo real sin depender de que un admin abra esa pestaña, y se evita una condición de carrera si hay dos sesiones de admin abiertas simultáneamente escribiendo sobre el mismo array de pacientes.

El panel admin dejará de llamar a `syncPatientsFromBookings()`; en su lugar simplemente lee la colección `patients` (ya sincronizada por la function), igual que hoy lee `services`/`staff`.

## Reglas de seguridad — qué se agrega

### Firestore (`firestore.rules`)

```
match /patients/{id} {
  allow read, write: if request.auth != null;
}
```

Mismo patrón que `bookings`/`adminLog`: nunca hay escritura pública directa a `patients` (confirmado en el código — la única vía de creación es `syncPatientsFromBookings()`, que solo corre dentro del panel admin autenticado; con el cambio de este documento, pasa a ser la Cloud Function, que usa Admin SDK y no está sujeta a estas reglas).

`isValidBooking()` se extiende con:
```
&& d.club is string && (d.club == 'member' || d.club == 'guest')
```

### Storage (`storage.rules`, archivo nuevo)

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /patients/{patientId}/{photoId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Solo staff autenticado lee y escribe fotos de clientes — son datos personales, no material de marketing público.

## Impacto en el plan de implementación existente

El plan (`2026-06-02-scissor-white-firebase-migration.md`) necesita, además de sus 6 puntos ya documentados:

- Fase 2 (seed): sin cambios — los 19 servicios y 4 barberos son idénticos en v19.
- Fase 3 (reglas): agregar el bloque de `patients` y el campo `club` a `isValidBooking()`; crear `storage.rules` + su test.
- Fase 4 (capa de datos): `SWData` gana `getPatients()`, `upsertPatient()`, `uploadPatientPhoto()`, `deletePatientPhoto()`; nuevo módulo o extensión de `firebase-init.js` para `getStorage()`.
- Fase 5 (parches a `index.html`): los 4 puntos nuevos de `sw_patients` (lectura/escritura de pacientes), el flujo de subida/borrado de fotos (`compressImage` → Storage), y el submit del booking público (agregar `club` al payload + llamada a `getClubStatus`).
- Fase 6 (Cloud Functions): `onBookingCreated` se extiende para upsertear `patients`; se agrega la function callable `getClubStatus`.
- Fase 7/QA: casos nuevos — crear reserva como Club SW → aparece/actualiza en `patients` → contador de fidelización correcto en la confirmación; subir/borrar foto → aparece/desaparece en Storage y en la ficha.

Esto se detalla como tareas concretas en el plan actualizado (siguiente paso, vía `writing-plans`).

## Fuera de alcance (igual que el spec original)

- Deploy real a Firebase.
- Externalización de imágenes base64 del catálogo (servicios/staff) — sigue siendo fase 2/9, ahora con la ventaja de que v19 trae las 12 fotos originales sueltas (`2_imagenes_originales/`) listas para usar.
- Notificación por WhatsApp/SMS, recordatorio programado 24h antes.
- Migrar `visits[]` a subcolección — no se justifica con el volumen actual.

## Próximo paso

Actualizar el plan de implementación paso a paso (`writing-plans`), extendiendo `2026-06-02-scissor-white-firebase-migration.md` con las tareas de este documento.
