# Scissor White — SW Studio

Sitio web de la barbería **Scissor White / SW Studio** (Cochrane 635, Of. 303, Torre B,
Concepción, Chile): landing, sistema de reservas online y panel de administración.
**En producción sobre Firebase**: https://scissorwhite.cl

- Los clientes agendan 24/7 y reciben **confirmación por email** (template SW Studio, vía Resend).
- El staff administra reservas, servicios, barberos y clientes desde un panel protegido por **Firebase Auth**.
- **Club SW**: programa de fidelización (servicio premium gratis a las 10 visitas, asesoría con visagismo a las 20).
- **Disponibilidad real por barbero**: horario semanal, colación recurrente y
  bloqueos puntuales (trámites, imprevistos) se reflejan al instante en el
  widget público de reservas.
- El panel vive en una página aparte, **`/admin/`**, desindexada por `robots.txt`.

## Arquitectura

| Pieza | Detalle |
|---|---|
| Hosting | Firebase Hosting (`public/`), proyecto `scissor-white` |
| Datos | Firestore (`bookings`, `patients`, `services`, `staff`, `businessInfo`, `scheduleBlocks`, `availability`, `adminLog`) |
| Funciones | Cloud Functions v2 Node 22, región `southamerica-east1` |
| Emails | Resend (secretos `RESEND_API_KEY`, `FROM_EMAIL`, `SHOP_EMAIL`) |
| Auth | Firebase Auth (email/contraseña) para el panel admin |

### Cloud Functions

- **`onBookingCreated`** (trigger Firestore `bookings/{id}`): envía el email de
  confirmación al cliente (template "Reserva Confirmada" de SW Studio, responsivo,
  imágenes servidas desde `public/assets/email/`) y el aviso a la barbería; luego
  sincroniza la colección `patients` (upsert por email).
- **`getClubStatus`** (callable): cuenta visitas Club SW de un email — el cliente
  público no puede leer `bookings` directamente por reglas.
- **`getAvailability`** (callable): disponibilidad real por fecha/barbero
  (reservas + colación recurrente + bloqueos puntuales), sin exponer PII de
  otras reservas.
- **`onBookingWritten`** / **`onScheduleBlockWritten`** (triggers Firestore
  `bookings/{id}` y `scheduleBlocks/{id}`): recalculan la vista materializada
  `availability/{fecha}` (sin PII) que el widget público lee directo, en vez
  de llamar a `getAvailability` en cada render.

> ⚠️ El proyecto `scissor-white` también tiene desplegada una función `api`
> (https, `us-central1`, Node 20) que **no pertenece a este codebase** — es de
> la rama `feature/whatsapp-kapso`. Un `firebase deploy --only functions` sin
> especificar nombres la ofrece para borrar. Deployar funciones siempre con
> nombres explícitos (ver [Deploy](#deploy)).

## Panel de administración (`/admin/`)

Página independiente del sitio público; ambas comparten `public/js/`, así que
no hay lógica duplicada fuera del HTML. Se entra por el hexágono ⬡ del footer.

- **Agenda** — dos vistas sobre las mismas reservas:
  - *Día*: línea de tiempo de una jornada, con navegación ◀ ▶ / Hoy y filtro
    por barbero. Los bloqueos aparecen como tarjeta oscura; un clic los edita.
  - *Lista*: tabla plana **no atada a un día**, ordenable por cualquier columna
    y con buscador por cliente. El selector de alcance ofrece *Próximas*
    (por defecto), *Todas (con historial)* o *Entre dos fechas* — este último
    compara a nivel de día e incluye ambos extremos. Los bloqueos no aparecen
    acá: la Lista es de reservas de clientes.
- **Horarios** — horario semanal por barbero y **colación recurrente** (un
  rango por día, se repite todas las semanas).
- **Bloquear horario** (botón en Agenda) — bloqueo **puntual** para una fecha
  concreta, con motivo. Se crea desde la Agenda, no desde Horarios, porque el
  admin ya está mirando ese día cuando decide bloquearlo.

Colación y bloqueos le quitan esas horas al widget público. Si el admin igual
quiere agendar encima, recibe una advertencia con el motivo y puede forzarlo
marcando **Sobrecupo** — nunca es un bloqueo duro.

> Crear una reserva desde el panel exige `allow create: if isAdmin()` en
> `firestore.rules`: el payload del admin no lleva los campos `status`/`club`
> que arma el widget público, y en las reglas de Firestore **una clave ausente
> lanza error de evaluación, no `false`**. Al tocar ese payload, recordar que
> editar es `update` y crear es `create` — que una operación funcione no
> implica que la otra también.

## Estructura

```
scissor-white/
├── public/               # Firebase Hosting
│   ├── index.html        # sitio público: landing + widget de reservas
│   ├── admin/index.html  # panel de administración (ruta /admin/)
│   ├── robots.txt        # Disallow: /admin/
│   ├── js/               # firebase-init.js, data.js (Firestore), auth.js (login)
│   └── assets/email/     # logo.png, salon.png — imágenes del email de confirmación
├── functions/            # Cloud Functions v2 (ver arriba)
│   ├── email.js          # render del template de email + envío vía Resend
│   ├── patients.js       # upsert de clientes + conteo Club SW
│   ├── availability.js   # cálculo de disponibilidad (reservas + colación + bloqueos)
│   ├── scripts/          # reconcileCatalog, backfillAvailability, setAdminClaim
│   └── test/             # node --test (sin emulador)
├── seed/                 # carga inicial a Firestore
├── tests/rules/          # tests de reglas con el emulador
├── firebase.json         # Hosting + Firestore + Functions + Emuladores
└── firestore.rules       # público: crear reservas validadas; admin: todo lo demás
```

## Desarrollo

```bash
npm install
cd functions && npm install && cd ..
cd seed && npm install && cd ..

firebase emulators:start    # :5000 sitio, :5000/admin/ panel, :4000 UI
# en otra terminal, sembrar datos en el emulador:
cd seed && FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=scissor-white npm run seed && cd ..
```

Tests de funciones (rápidos, sin emulador):

```bash
cd functions && node --test
```

## Deploy

```bash
# Hosting + reglas/índices de Firestore + solo las funciones de este repo
# (nombres explícitos: evita que el CLI ofrezca borrar `api`, ver nota arriba)
firebase deploy --project scissor-white --only \
  hosting,firestore:rules,firestore:indexes,\
functions:onBookingCreated,functions:getClubStatus,functions:getAvailability,\
functions:onBookingWritten,functions:onScheduleBlockWritten
```

Los secretos de Resend se administran con `firebase functions:secrets:set` (ver
runbook en `docs/`). El template de email vive en `functions/email.js`
(`renderClientEmail`); sus imágenes deben existir publicadas en
`https://scissorwhite.cl/assets/email/` — los clientes de correo bloquean
imágenes embebidas (data-URI).

## Documentación

- Diseño: [`docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md`](docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md)
- Plan de migración (ejecutado): [`docs/superpowers/plans/2026-06-02-scissor-white-firebase-migration.md`](docs/superpowers/plans/2026-06-02-scissor-white-firebase-migration.md)
- Vista de Lista en la Agenda: [`docs/superpowers/specs/2026-07-30-agenda-lista-vista-design.md`](docs/superpowers/specs/2026-07-30-agenda-lista-vista-design.md)
- Bloqueo de horarios (colación + puntuales), con su sección de trabajo futuro
  —agenda multi-barbero en columnas—: [`docs/superpowers/specs/2026-07-31-bloqueo-horarios-design.md`](docs/superpowers/specs/2026-07-31-bloqueo-horarios-design.md)
- Módulo WhatsApp/Kapso (planificado): ver `docs/superpowers/specs/`
