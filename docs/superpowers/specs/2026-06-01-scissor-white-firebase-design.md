# Scissor White — Migración a Firebase (Diseño)

- **Fecha:** 2026-06-01
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Estado actual:** sitio de página única `index.html v15` (~1.4 MB, HTML/CSS/JS vanilla, imágenes en base64), persistencia en `localStorage`.
- **Objetivo:** dejar la estructura del proyecto lista para deploy en Firebase y un plan robusto paso a paso. Producto final: web funcional donde los clientes ven productos/servicios, agendan y reciben notificación por email de su reserva.
- **Enfoque aprobado:** A — capa de datos Firebase sobre el sitio actual (preservar UI + SEO ya pulidos).

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Canal de notificación al cliente | **Email automático** (Cloud Function + **Resend** como proveedor predeterminado; SendGrid como alternativa drop-in). WhatsApp = fase posterior. |
| Auth del panel admin | **Firebase Auth real** (email/contraseña por miembro del staff). |
| Alcance de esta sesión | **Estructura (andamiaje Firebase-ready) + plan escrito.** Sin modificar el código de la app, sin deploy. |
| Estrategia de migración | **Enfoque A**: mantener `index.html v15` y conectarle Firebase por debajo. |
| Región Firebase | `southamerica-east1` (São Paulo) por latencia desde Chile. |

## Arquitectura

- **Firebase Hosting** sirve `public/index.html` (HTTPS + CDN; dominio `scissorwhite.cl` luego).
- **Firestore** es la base central; reemplaza los 2 puntos de `localStorage`.
- **Firebase Auth** protege el panel admin; las reglas exigen auth para escribir.
- **Cloud Function** `onBookingCreated` se dispara al crear una reserva y envía emails.
- **Resend** como proveedor de email transaccional predeterminado (SendGrid como alternativa); API key en Secret Manager / `.env`.

### Diagrama

```
Cliente (landing + booking)        Staff (panel admin)
            │                              │
        Firebase Hosting  (sirve index.html, CDN+HTTPS)
            │                              │
        Firestore  ◀── reglas ──  Firebase Auth
            │ onCreate(booking)
        Cloud Function onBookingCreated ── Resend ─▶ email cliente + email barbería
```

## Modelo de datos (Firestore)

Mapeo desde `localStorage`:

| Hoy (`localStorage`) | Firestore |
|---|---|
| `sw_adm_v2` → servicios | `services/{id}` |
| `sw_adm_v2` → personal | `staff/{id}` |
| `sw_adm_v2` → horarios | embebido en `staff/{id}.schedule[]` |
| `sw_adm_v2` → info | `businessInfo/main` |
| `sw_adm_v2` → log | `adminLog/{id}` |
| `sw_bookings` (array) | `bookings/{id}` |

### Colecciones

> Nombres de campo **alineados con el modelo real** del `index.html` v15 (objeto `D` y array de bookings) para minimizar cambios — Enfoque A.

- **`services/{id}`**: `id, name, cat ('a'=Asesorías | 'c'=Cortes | 'b'=Barba), dur (min), price (CLP), tag, ts, status ('active'|…), desc, photo`. 19 docs. Rango $8.000–$65.000.
- **`staff/{id}`**: `id, name, role, days, bio, status, photo, schedule[]`. 4 docs: Victoria, Felipe, Esteban, Ariel. **Horario embebido**: `schedule` es un array indexado por `Date.getDay()` (0=Dom … 6=Sáb); cada posición es `null` (cerrado) o `{open:bool, start:'HH:MM', end:'HH:MM'}`.
- **`businessInfo/main`**: `name, addr, phone, ig, slogan, desc` (+ opcional `lat:-36.8270, lng:-73.0444`).
- **`bookings/{id}`**: campos que ya emite la app — `code, name, email, phone, svcId, svcName, svcCat, price, dur, barberId, barberName, date (ISO), time, createdAt` — **más nuevos**: `status (pending|confirmed|cancelled|done|noshow)`, `emailStatus (pending|sent|failed)`, `createdAtTs (serverTimestamp)`. El `code` que ya genera la app (`genCode()`) es el código de confirmación.
- **`adminLog/{id}`**: `action, item, date` (estructura actual `D.log`); opcional `byUid` al integrar Auth.

**Formulario de reserva:** ya captura nombre + **email** (`bkf-email`, validado en el front) + teléfono + consentimiento. **No requiere campos nuevos**; el email automático usa el `email` existente.

## Reglas de seguridad (Firestore)

- `businessInfo, services, staff`: `read: if true` (catálogo público); `write: if request.auth != null`. (Los horarios viajan dentro de `staff`.)
- `bookings`:
  - `create: if` payload válido — campos obligatorios presentes, `status == 'pending'`, sin campos no permitidos, tipos correctos.
  - `read, update, delete: if request.auth != null` (solo staff; protege datos personales del cliente). El cliente ve su confirmación en pantalla + email, no consulta la colección.
- `adminLog`: `read, write: if request.auth != null`.

### Índices (`firestore.indexes.json`)

Para el volumen de una barbería, el admin puede **cargar todas las reservas y filtrar en memoria** (como hoy), evitando índices al inicio. Si se escala, agregar compuestos:

- `bookings`: `barberId ASC, date ASC` (agenda por barbero).
- `bookings`: `status ASC, date ASC` (filtros del dashboard).

## Flujo de reserva + notificación

1. Cliente completa 4 pasos (servicio → barbero → fecha/hora → datos+email) → se escribe `bookings/{id}` con `status: pending`, `emailStatus: pending`.
2. `onBookingCreated` (trigger Firestore onCreate):
   - genera/valida `confirmationCode`,
   - envía email de **confirmación al cliente** y de **aviso a la barbería**,
   - actualiza el doc: `emailStatus: sent`. Si el proveedor falla → `emailStatus: failed` + `adminLog`; la reserva **no se pierde**; reintento por config de la function.
3. El admin ve la reserva en **Agenda** en tiempo real (listener Firestore).
4. Se mantiene el link de **WhatsApp directo** como respaldo de contacto.

**Fase 2 (anotada, no ahora):** función programada `sendReminder` 24h antes de la cita.

## Auth del admin

- El trigger actual (hex `⬡` en footer) abre un **login Firebase Auth** (email/contraseña) en lugar de comparar `sw2026`.
- Solo usuarios autenticados abren el panel y escriben datos (reforzado por reglas, no solo front).
- Cuentas iniciales del staff creadas en el script de setup; el staff cambia contraseñas luego.

## Manejo de errores

- **Escritura de reserva falla** → mensaje claro al cliente + fallback al link de WhatsApp.
- **Email falla** → reserva guardada; `emailStatus: failed` + `adminLog`; reintento por config.
- **Login** → mensajes de credencial inválida; sesión persistente.
- **Reglas** → denegaciones explícitas; nunca base abierta a escritura.

## Testing

- **Firebase Emulator Suite** (Auth + Firestore + Functions + Hosting) para E2E local sin tocar producción.
- Pruebas de **reglas** con `@firebase/rules-unit-testing` (cliente no lee reservas ajenas; no se escribe sin auth).
- **Checklist QA manual:** crear reserva → email recibido → aparece en Agenda → login admin → CRUD de servicios.

## Estructura del proyecto (andamiaje a crear)

```
scissor-white/
├── _source/                  # zip + v15 originales (archivo de respaldo)
├── public/
│   ├── index.html            # copia del v15 SIN modificar (entry de Hosting)
│   └── assets/               # vacío (imágenes externalizadas — fase 2)
├── functions/
│   ├── index.js              # esqueleto de onBookingCreated
│   ├── package.json
│   └── .env.example          # RESEND_API_KEY, SHOP_EMAIL, FROM_EMAIL
├── seed/
│   ├── seed.js               # esqueleto: 19 servicios / 4 staff / horarios / info
│   └── README.md
├── firebase.json             # hosting + functions + emulators
├── .firebaserc               # <TU_PROJECT_ID> placeholder
├── firestore.rules
├── firestore.indexes.json
├── .gitignore
├── .env.example
├── README.md                 # overview + cómo desplegar
└── docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md
```

## Fuera de alcance (ahora)

- Modificar el código de `index.html` (cablear `data.js`, login, etc.) — lo cubre el plan de implementación.
- Deploy real a Firebase (lo hace el dueño con sus credenciales).
- Externalización de imágenes base64 a `.webp` — fase 2.
- Notificación por WhatsApp / SMS — fase posterior.
- Recordatorio programado 24h antes — fase 2.

## Próximo paso

Generar el plan de implementación paso a paso con la skill `writing-plans`, y luego crear el andamiaje descrito arriba.
