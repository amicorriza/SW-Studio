# Scissor White — SW Studio

Sitio web de la barbería **Scissor White / SW Studio** (Cochrane 635, Of. 303, Torre B,
Concepción, Chile): landing, sistema de reservas online y panel de administración.
**En producción sobre Firebase**: https://scissorwhite.cl

- Los clientes agendan 24/7 y reciben **confirmación por email** (template SW Studio, vía Resend).
- El staff administra reservas, servicios, barberos y clientes desde un panel protegido por **Firebase Auth**.
- **Club SW**: programa de fidelización (servicio premium gratis a las 10 visitas, asesoría con visagismo a las 20).

## Arquitectura

| Pieza | Detalle |
|---|---|
| Hosting | Firebase Hosting (`public/`), proyecto `scissor-white` |
| Datos | Firestore (`bookings`, `patients`, `services`, `staff`, `businessInfo`, `adminLog`) |
| Funciones | Cloud Functions v2 Node 20, región `southamerica-east1` |
| Emails | Resend (secretos `RESEND_API_KEY`, `FROM_EMAIL`, `SHOP_EMAIL`) |
| Auth | Firebase Auth (email/contraseña) para el panel admin |

### Cloud Functions

- **`onBookingCreated`** (trigger Firestore `bookings/{id}`): envía el email de
  confirmación al cliente (template "Reserva Confirmada" de SW Studio, responsivo,
  imágenes servidas desde `public/assets/email/`) y el aviso a la barbería; luego
  sincroniza la colección `patients` (upsert por email).
- **`getClubStatus`** (callable): cuenta visitas Club SW de un email — el cliente
  público no puede leer `bookings` directamente por reglas.

## Estructura

```
scissor-white/
├── public/               # Firebase Hosting
│   ├── index.html        # app completa (landing + reservas + panel admin)
│   ├── js/               # firebase-init.js, data.js (Firestore), auth.js (login)
│   └── assets/email/     # logo.png, salon.png — imágenes del email de confirmación
├── functions/            # onBookingCreated + getClubStatus
│   ├── email.js          # render del template de email + envío vía Resend
│   ├── patients.js       # upsert de clientes + conteo Club SW
│   └── test/             # node --test (sin emulador)
├── seed/                 # carga inicial a Firestore
├── tests/rules/          # tests de reglas con el emulador
├── firebase.json         # Hosting + Firestore + Functions + Emuladores
└── firestore.rules       # público: crear reservas validadas; resto requiere auth
```

## Desarrollo

```bash
npm install
cd functions && npm install && cd ..
cd seed && npm install && cd ..

firebase emulators:start    # http://localhost:5000 (sitio), :4000 (UI)
# en otra terminal, sembrar datos en el emulador:
cd seed && FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=scissor-white npm run seed && cd ..
```

Tests de funciones (rápidos, sin emulador):

```bash
cd functions && node --test
```

## Deploy

```bash
# Hosting + las dos funciones del proyecto (evita tocar funciones ajenas al repo)
firebase deploy --only "hosting,functions:onBookingCreated,functions:getClubStatus" --project scissor-white
```

Los secretos de Resend se administran con `firebase functions:secrets:set` (ver
runbook en `docs/`). El template de email vive en `functions/email.js`
(`renderClientEmail`); sus imágenes deben existir publicadas en
`https://scissorwhite.cl/assets/email/` — los clientes de correo bloquean
imágenes embebidas (data-URI).

## Documentación

- Diseño: [`docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md`](docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md)
- Plan de migración (ejecutado): [`docs/superpowers/plans/2026-06-02-scissor-white-firebase-migration.md`](docs/superpowers/plans/2026-06-02-scissor-white-firebase-migration.md)
- Módulo WhatsApp/Kapso (planificado): ver `docs/superpowers/specs/`
