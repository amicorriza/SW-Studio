# Scissor White — SW Studio

Sitio web de la barbería **Scissor White / SW Studio** (Cochrane 635, Of. 303, Torre B,
Concepción, Chile): landing, sistema de reservas online y panel de administración.
**En producción sobre Firebase**: https://scissorwhite.cl

- Los clientes agendan 24/7 y reciben **confirmación por email** (template SW Studio, vía Resend).
- El staff administra reservas, servicios, barberos y clientes desde un panel protegido por **Firebase Auth**.
- **Club SW**: programa de fidelización (servicio premium gratis a las 10 visitas, asesoría con visagismo a las 20).
- **Reseñas de Google en vivo**: el puntaje y las opiniones del perfil de
  Google Business se espejan a diario en la sección *"La voz de quienes
  vuelven"* del landing, sin scripts de terceros ni API keys en el navegador.
- **Disponibilidad real por barbero**: horario semanal, colación recurrente y
  bloqueos puntuales (trámites, imprevistos) se reflejan al instante en el
  widget público de reservas.
- El panel vive en una página aparte, **`/admin/`**, desindexada por `robots.txt`.

## Arquitectura

| Pieza | Detalle |
|---|---|
| Hosting | Firebase Hosting (`public/`), proyecto `scissor-white` |
| Datos | Firestore (`bookings`, `patients`, `services`, `staff`, `businessInfo`, `scheduleBlocks`, `availability`, `googleReviews`, `adminLog`) |
| Funciones | Cloud Functions v2 Node 22, región `southamerica-east1` |
| Emails | Resend (secretos `RESEND_API_KEY`, `FROM_EMAIL`, `SHOP_EMAIL`) |
| Reseñas | Google Places API (New), secreto `GOOGLE_PLACES_API_KEY` |
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

- **`refreshGoogleReviews`** (schedule diario, 06:00 America/Santiago) y
  **`syncGoogleReviews`** (callable admin-only, botón "Sincronizar ahora" del
  panel): traen puntaje, total de opiniones y reseñas del perfil de Google
  Business vía Places API (New) y las escriben en `googleReviews/main`, que el
  landing lee como cualquier doc público. La API key vive en Secret Manager y
  nunca baja al navegador — ver [Reseñas de Google](#reseñas-de-google).

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
│   ├── js/               # firebase-init.js, data.js (Firestore), auth.js (login),
│   │                     #   metrics.js (agregaciones puras del Dashboard) e
│   │                     #   insights.js (motor de recomendaciones) — <script>
│   │                     #   clásicos, no hablan con Firestore, require-ables por Node
│   ├── barbero/          # PWA del profesional: index.html, manifest, sw.js, íconos
│   └── assets/email/     # logo.png, salon.png — imágenes del email de confirmación
├── functions/            # Cloud Functions v2 (ver arriba)
│   ├── email.js          # render del template de email + envío vía Resend
│   ├── patients.js       # upsert de clientes + conteo Club SW
│   ├── shared/           # availability.js, timezone.js, validate.js, status.js, attendance.js
│   ├── scripts/          # reconcileCatalog, backfillAvailability, setAdminClaim
│   └── test/             # node --test (sin emulador)
├── seed/                 # carga inicial a Firestore
├── tests/unit/           # node --test de las agregaciones del Dashboard (npm test)
├── tests/browser/        # scripts Playwright standalone (no vitest)
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

> **`functions/.secret.local` ya está versionado con valores falsos** para
> `RESEND_API_KEY`/`FROM_EMAIL`/`SHOP_EMAIL` — no hay que crearlo ni copiarlo
> de ningún lado. Es el mecanismo real para que el emulador use valores
> locales en vez de ir a buscar los secretos reales a Secret Manager
> (`functions/.env` NO cumple esa función — ver `functions/.env.example` y
> [Deploy](#deploy)). Confirmado el 2026-08-05: sin este archivo, el
> emulador usó los secretos reales de producción en pruebas locales, con
> probable envío de emails reales. Nunca reemplazar sus valores por reales,
> aunque sea temporalmente — el archivo se versiona.

Tests de funciones (rápidos, sin emulador):

```bash
cd functions && node --test
```

Tests de las agregaciones del Dashboard (`public/js/metrics.js`) y del motor
de recomendaciones (`public/js/insights.js`):

```bash
npm test        # node --test "tests/unit/**/*.test.js"
```

Test de navegador del Dashboard (requiere Playwright, no es dependencia del repo):

```bash
npm i -D playwright && npx playwright install chromium
node tests/browser/dashboard.mjs          # Dashboard de métricas
node tests/browser/barbero.mjs            # PWA del barbero (/barbero/)
node tests/browser/admin-asistencia.mjs   # asistencia y cancelar-sin-borrar
```

Estos tres **stubbean `window.SWData`**: verifican la interfaz, no la
integración. Para el camino completo hay pruebas end-to-end contra el
emulador, con Firebase Auth, callables y Firestore de verdad:

```bash
firebase emulators:start --project scissor-white   # en otra terminal
npm run test:e2e
```

`test:e2e` resiembra antes de cada suite, y eso **no es opcional**: las tres
mutan las mismas reservas (cerrar una atención, marcar un no-show, cancelar),
así que sin limpiar se pisan entre ellas. Las suites son:

| Suite | Qué cubre |
|---|---|
| `tests/e2e/callables.mjs` | `getMyDay`, `markAttendance`, `linkStaffAccount`: permisos, idempotencia, transiciones inválidas, corrección de horas admin-only, y que cancelar conserve el documento |
| `tests/e2e/nudges.mjs` | selección de avisos sobre datos reales, el interruptor `nudgesEnabled`, y que un token muerto no aborte la corrida ni deje marcadores |
| `tests/e2e/navegador.mjs` | recorrido clic a clic: la PWA completa (incluida la sesión que sobrevive una recarga en frío), el Dashboard con datos reales, y que la Agenda refleje lo que se marcó desde el teléfono |

Los datos de prueba los siembra `functions/scripts/seedEmulatorE2E.mjs`: crea
las cuentas (`admin@scissorwhite.cl` / `admin123`, `victoria@scissorwhite.cl`
/ `barbero123`), las vincula al staff, deja horarios coherentes y siembra
citas de hoy más un histórico ya medido.

> **La entrega del push no se puede probar localmente**: no existe emulador de
> FCM, así que el envío siempre falla en el emulador (y las pruebas verifican
> justamente que eso no rompa nada). Probarlo de verdad exige un teléfono
> contra staging.

## Deploy

> **`functions/.env` rompe el deploy de funciones.** Cloud Run rechaza que
> `RESEND_API_KEY`/`FROM_EMAIL`/`SHOP_EMAIL` vengan a la vez de Secret Manager
> (`defineSecret`, producción) y de una env var cargada desde `functions/.env`
> (pensado solo para el emulador) — el deploy falla con `Secret environment
> variable overlaps non secret environment variable`. **Antes de cualquier
> `firebase deploy --only functions:...`, sacar `functions/.env` del
> directorio** (ej. renombrarlo a `functions/.env.local-emulador` — ya cubierto
> por `.gitignore`) y devolverlo a `functions/.env` después, para volver a
> poder usar el emulador local.

```bash
# Hosting + reglas/índices de Firestore + solo las funciones de este repo
# (nombres explícitos: evita que el CLI ofrezca borrar `api`, ver nota arriba)
firebase deploy --project scissor-white --only \
  hosting,firestore:rules,firestore:indexes,\
functions:onBookingCreated,functions:createBooking,functions:getClubStatus,\
functions:getAvailability,functions:onBookingWritten,functions:onScheduleBlockWritten,\
functions:refreshGoogleReviews,functions:syncGoogleReviews,\
functions:getMyDay,functions:markAttendance,functions:linkStaffAccount,\
functions:staffAttendanceNudges,functions:getMyRange,functions:getMyClients,functions:adminSaveBooking,\
functions:sendBookingReminders,functions:respondToBookingReminder,functions:getBookingForReminderAction
```

Son **11 nombres — uno por cada `exports.` de `functions/index.js`**. Antes de
deployar, verificar que no falte ninguno:

```bash
grep -oE "^exports\.[a-zA-Z]+" functions/index.js
```

> ⚠️ `createBooking` **faltaba en esta lista** hasta 2026-08-23: se agregó en
> Fase A y el comando documentado nunca se actualizó. Un deploy con la lista
> vieja no rompe nada de forma visible — las funciones ausentes simplemente no
> se actualizan — pero deja `createBooking` congelado en la versión desplegada,
> en silencio. Es exactamente el tipo de deriva que este comando explícito
> existe para evitar, así que conviene correr el `grep` de arriba cada vez.

`refreshGoogleReviews` es la primera función programada del proyecto: su primer
deploy habilita Cloud Scheduler en el proyecto de GCP.

Los secretos de Resend se administran con `firebase functions:secrets:set` (ver
runbook en `docs/`). El template de email vive en `functions/email.js`
(`renderClientEmail`); sus imágenes deben existir publicadas en
`https://scissorwhite.cl/assets/email/` — los clientes de correo bloquean
imágenes embebidas (data-URI).

## Dashboard de KPI

Dos niveles de lectura, con un interruptor arriba a la izquierda.

**Vista simple** (la que se abre por defecto) responde cinco preguntas y nada
más: *cuánto vendí · cuántas reservas hubo · cuántos clientes llegaron ·
cuántos no llegaron · cuánto deja una visita promedio.* Debajo, la tendencia
de ingresos por semana y como máximo dos tarjetas: una prioridad y una
oportunidad.

**Ver detalle** agrega el porqué: tiempo planificado vs. tiempo real por
servicio (con la desviación), el reparto de asistencia, la ocupación efectiva,
el mapa de ocupación por día y hora, el desglose por servicio y por
profesional, la retención y el CSV.

Tres cosas que conviene saber al leerlo:

- **Las recomendaciones aparecen recién con 10 atenciones medidas**, y las que
  hablan de precio con 20. Antes de eso el panel muestra los datos y dice
  cuántas lleva registradas. Es deliberado: con cuatro atenciones medidas una
  sola que se alargó mueve la mediana lo suficiente como para "recomendar"
  subir un precio.
- **Nunca aparecen más de tres**, y como mucho una de cada tipo: una prioridad,
  una oportunidad y un reconocimiento. Hay 13 reglas compitiendo por esos tres
  cupos, ordenadas por impacto: primero lo que hace perder dinero (inasistencias,
  ventas que caen atendiendo lo mismo), después las desviaciones de tiempo,
  después la ocupación, y al final las señales positivas.
- **El tiempo real es la mediana, no el promedio.** Una atención de dos horas
  no arrastra la conclusión de todo el servicio.
- **El pie de nota dice cuánto del número está medido.** Mientras el equipo no
  use la app del barbero, los ingresos siguen asumiendo que toda cita pasada
  ocurrió, igual que antes; la nota lo declara y el porcentaje sube solo.

Ninguna tarjeta cambia precios ni duraciones. Sugieren rangos para que decida
una persona.

## App del barbero (`/barbero/`)

PWA instalable donde el profesional ve su agenda del día y registra qué pasó
con cada cita: **Llegó / No llegó / Iniciar atención / Finalizar atención**.
De ahí salen la asistencia real, el tiempo real por servicio y la desviación
respecto de lo planificado — los KPI que el Dashboard todavía no puede
calcular. Ver `docs/superpowers/specs/2026-09-06-medicion-atencion-real-design.md`.

No habla con Firestore: todo pasa por callables (`getMyDay`,
`markAttendance`). La única excepción es `staffDevices/{uid}`, donde cada
dispositivo guarda su token de FCM.

### Puesta en marcha (una vez)

1. **Clave VAPID.** Ya está configurada en `public/barbero/index.html`. Si
   alguna vez hay que regenerarla (Consola → Cloud Messaging → *Web Push
   certificates*), tener presente que **todos los tokens ya registrados dejan
   de servir** y cada profesional tiene que volver a tocar "Activar avisos".
   Es pública por diseño, igual que el resto de `firebaseConfig`: **no** va a
   Secret Manager ni a `functions/.env`.

   Para verificarla sin desplegar: `node tests/e2e/push-token.mjs` (con el
   emulador corriendo). Registra un token real contra FCM y comprueba que
   llegue a `staffDevices`. Abre una ventana de navegador a propósito:
   Chromium headless deshabilita las notificaciones, y los contextos normales
   de Playwright son incógnito, donde Chrome no soporta la Push API.
2. **Una cuenta por barbero.** Consola → Authentication → *Add user* (correo +
   contraseña). Solo crear la cuenta.
3. **Vincular.** Panel admin → Personal → botón **Vincular cuenta** en la ficha
   del barbero, y escribir ese correo. El UID lo resuelve el servidor
   (`linkStaffAccount`) y lo guarda en `staffAccounts/{staffId}` — **no** en
   `staff/{id}`, que es de lectura pública y dejaría el correo y el UID del
   profesional a la vista de cualquiera. Sin este paso, el barbero entra pero
   ve "esta cuenta no está vinculada".
4. **Permiso de Auth para el service account.** `linkStaffAccount` resuelve el
   correo con `getUserByEmail`, y el service account de las funciones
   (`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`) **no puede leer
   usuarios de Auth por defecto**, aunque sí escriba en Firestore. Sin este
   paso el panel responde `auth/insufficient-permission` al vincular:

   ```powershell
   gcloud projects add-iam-policy-binding scissor-white --member="serviceAccount:801854192115-compute@developer.gserviceaccount.com" --role="roles/firebaseauth.viewer"
   ```

   Alcanza con *viewer*: `getUserByEmail` es la ÚNICA llamada a `getAuth()` en
   todo el repo y solo lee. No hace falta redesplegar -- IAM se evalúa en cada
   invocación -- pero puede tardar hasta un minuto en propagarse.

   > Ojo con la cuenta: `gcloud config get-value project` puede apuntar a otro
   > proyecto. El proyecto va como argumento posicional, así que el comando de
   > arriba es correcto igual, pero verificá con `gcloud auth list` que la
   > cuenta activa sea la dueña de `scissor-white`.

5. **Activar los avisos.** `businessInfo/main.nudgesEnabled = true`, a mano en
   Firestore. Hasta entonces `staffAttendanceNudges` corre cada 2 minutos y no
   manda nada — mismo interruptor que `remindersEnabled`. **Desplegar no es
   activar.** La anticipación del aviso se ajusta en el panel Info
   (*"Avisar al profesional (min antes)"*, default 10).
6. **En el teléfono**, el barbero entra a `scissorwhite.cl/barbero/`, y toca
   **Activar avisos**.

> **iPhone:** el push web exige **iOS 16.4 o superior** *y* que la app se haya
> agregado a la pantalla de inicio (Compartir → *Agregar a inicio*). Abierta
> como pestaña de Safari no llega ninguna notificación — es una restricción
> del sistema, no un problema de la app. En Android funciona directo desde
> Chrome, aunque conviene instalarla igual.

Los íconos (192/512 y el *maskable*) se regeneran con
`node scripts/make-barbero-icons.mjs`.

> **Índice nuevo.** `getMyDay` consulta `barberId ==` + rango sobre `date`, y
> Firestore exige que el campo de igualdad vaya **primero** en el índice
> compuesto. El que ya existía es `bookings(date, barberId)` y **no** sirve
> para esa consulta, así que `firestore.indexes.json` suma
> `bookings(barberId, date)`. Se despliega con
> `firebase deploy --only firestore:indexes`, que ya está en el comando de
> arriba; hasta que el índice termine de construirse, la app del barbero
> devuelve error al cargar la agenda.

## Puesta en marcha de la medición (orden importa)

> **No hay proyecto de staging aparte.** `.firebaserc` apunta a un solo
> Firebase (`scissor-white`) y no hay targets de hosting. Un canal de preview
> aísla el **front-end**, pero Firestore, Functions y Auth son **los mismos
> que producción**. Por eso este orden: primero lo que no cambia nada visible,
> después el front en un canal, y el interruptor de avisos al final.

### 1. Backend aditivo (no cambia nada visible)

```bash
firebase deploy --project scissor-white --only firestore:indexes
firebase deploy --project scissor-white --only firestore:rules
```

El índice `bookings(barberId, date)` es nuevo y tarda unos minutos en
construirse; hasta que termine, la app del barbero da error al cargar la
agenda. Las reglas solo suman el bloque `staffDevices/{uid}`.

Después las funciones. **Hay que desplegar las dieciocho, no solo las nuevas** —
el comando completo está en [Deploy](#deploy).

> **Un despliegue parcial sería una regresión.** `functions/shared/availability.js`
> cambió: ahora `computeAvailability` filtra por `BLOCKING_STATUSES`. En lo que
> está desplegado hoy no filtra por estado **en absoluto**, así que toda reserva
> ocupa el horario. Si se despliegan solo las funciones nuevas, el admin nuevo
> cancela una cita (queda como `cancelled`, ya no se borra) pero el
> `getAvailability` viejo la sigue contando como ocupada: **ese horario no se
> libera nunca** en el widget público. Hoy cancelar sí lo libera, porque borra
> el documento. Lo mismo aplica a `onBookingWritten` y `onScheduleBlockWritten`,
> que recalculan `availability/{fecha}` con la misma función.

Los nombres van explícitos siempre: sin ellos el CLI ofrece borrar `api`, que
pertenece a otra rama.

> **En PowerShell** (que es donde se despliega este proyecto) el comando va en
> **una sola línea** y con la lista **entre comillas**. La continuación `\` es
> de bash: en PowerShell rompe el comando y las líneas siguientes se ejecutan
> sueltas. Y sin comillas, el CLI avisa *"If you are using PowerShell make sure
> you place quotes around any comma-separated lists"*.
>
> ```powershell
> firebase deploy --project scissor-white --only "functions:onBookingCreated,functions:createBooking,functions:getClubStatus,functions:getAvailability,functions:onBookingWritten,functions:onScheduleBlockWritten,functions:sendBookingReminders,functions:respondToBookingReminder,functions:getBookingForReminderAction,functions:refreshGoogleReviews,functions:syncGoogleReviews,functions:getMyDay,functions:markAttendance,functions:linkStaffAccount,functions:staffAttendanceNudges,functions:getMyRange,functions:getMyClients,functions:adminSaveBooking"
> ```


Esto instala además dos trabajos de Cloud Scheduler nuevos
(`sendBookingReminders` y `staffAttendanceNudges`), que con
`refreshGoogleReviews` suman tres — el tope de la cuota gratuita. **Los dos
quedan en no-op**: sin `remindersEnabled` ni `nudgesEnabled` no mandan nada.
Desplegar no es activar.

### 2. Front-end a un canal de preview, NO a producción

```bash
firebase hosting:channel:deploy medicion --project scissor-white --expires 7d
```

Devuelve una URL tipo `scissor-white--medicion-xxxx.web.app`. Ahí se prueba
`/barbero/` y `/admin/` sin tocar scissorwhite.cl.

> Ojo: ese canal escribe en la Firestore **real**. Si cancelás una cita de
> prueba, se cancela de verdad (queda con `status:'cancelled'`, ya no se
> borra). Conviene usar una cita creada para probar.

### 3. Cuentas del equipo

Consola → Authentication → *Add user*, una por profesional. Después, en el
panel del canal de preview: **Personal → Vincular cuenta** y escribir ese
correo.

### 4. Recién ahora, activar los avisos

`businessInfo/main.nudgesEnabled = true`, a mano en Firestore.

A partir de ese momento salen pushes **reales sobre citas reales**, cada 2
minutos, a los dispositivos registrados. Por eso va último.

Prueba de punta a punta: sembrar una cita a ~10 minutos, bloquear el teléfono
y esperar el aviso *"Se acerca la hora de atención con…"*.

### 5. Cuando esté probado, front a producción

```bash
firebase deploy --project scissor-white --only hosting
```

Esto publica también el admin nuevo: dashboard de dos vistas y **cancelar que
archiva en vez de borrar**. Es el paso que cambia lo que ve el equipo todos
los días.

## Reseñas de Google

La sección *"La voz de quienes vuelven"* del landing (`#resenas`, entre
Productos y Agenda) muestra el puntaje real del perfil de Google Business y las
reseñas que devuelve la API, en una marquesina que se pausa al pasar el mouse.

**Cómo funciona.** Nada de esto ocurre en el navegador del visitante: una
Cloud Function consulta Places una vez al día y deja el resultado en
`googleReviews/main` (lectura pública, escritura solo admin). El landing lee
ese doc y listo. Eso mantiene la API key fuera del cliente — una key de Places
expuesta en el front se puede usar desde cualquier origen y la factura la paga
el cliente —, evita sumarle a la página la latencia de Google, y deja el costo
en una llamada diaria en vez de una por visita.

**Puesta en marcha** (una sola vez):

1. En Google Cloud, sobre el proyecto `scissor-white`, habilitar **Places API
   (New)** y crear una API key restringida a esa API.
2. Cargarla como secreto y desplegar:
   ```bash
   firebase functions:secrets:set GOOGLE_PLACES_API_KEY --project scissor-white
   ```
3. En el panel, *Info & Contacto → Reseñas de Google*, apretar **Sincronizar
   ahora**. El Place ID se resuelve solo a partir del nombre y la dirección del
   negocio y queda guardado en `businessInfo.googlePlaceId`; solo hay que
   pegarlo a mano si Google devuelve otro local.

**Mientras tanto** (y como red de seguridad): el mismo panel permite cargar
*reseñas de respaldo*, que se guardan en `googleReviews/main.manualReviews` y
que ninguna sincronización pisa. Se muestran **solo** si Google todavía no
devuelve ninguna reseña con texto, y se ocultan solas apenas haya reales. Nunca
se mezclan con las verificadas: las de respaldo no llevan la marca de Google.

**Límites y política.**

- Place Details (New) devuelve **como máximo 5 reseñas** — no hay parámetro
  para pedir más. El promedio y el total (`4,9 sobre 137 opiniones`) sí
  resumen el perfil completo, y así se comunican en la sección.
- Las reseñas se guardan y muestran **en el orden que las devuelve Google, sin
  filtrar por puntaje**: la política de Places prohíbe alterarlas o mostrarlas
  selectivamente. Aparte, una barbería que solo exhibe 5★ elegidas a dedo
  genera menos confianza, no más.
- La sección incluye la atribución que exige Google: logo, nombre y foto del
  autor, enlace al perfil y al listado completo.
- **No se agrega `aggregateRating` al JSON-LD** del sitio a propósito: marcar
  como propias reseñas recolectadas en otra plataforma va contra las
  directrices de datos estructurados de Google y arriesga una acción manual.

## Documentación

- Diseño: [`docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md`](docs/superpowers/specs/2026-06-01-scissor-white-firebase-design.md)
- Plan de migración (ejecutado): [`docs/superpowers/plans/2026-06-02-scissor-white-firebase-migration.md`](docs/superpowers/plans/2026-06-02-scissor-white-firebase-migration.md)
- Vista de Lista en la Agenda: [`docs/superpowers/specs/2026-07-30-agenda-lista-vista-design.md`](docs/superpowers/specs/2026-07-30-agenda-lista-vista-design.md)
- Bloqueo de horarios (colación + puntuales), con su sección de trabajo futuro
  —agenda multi-barbero en columnas—: [`docs/superpowers/specs/2026-07-31-bloqueo-horarios-design.md`](docs/superpowers/specs/2026-07-31-bloqueo-horarios-design.md)
- Módulo WhatsApp/Kapso (planificado): ver `docs/superpowers/specs/`
