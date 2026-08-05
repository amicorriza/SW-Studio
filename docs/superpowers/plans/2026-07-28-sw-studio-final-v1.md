# Plan: integrar «SW-Studio SITIO-WEB FINAL v1.0» al proyecto Firebase

## Contexto

El ZIP `SW-Studio SITIO-WEB FINAL v1.0 2026-07-28.zip` contiene un solo
`index.html` de 1,67 MB (todo inline: CSS, JS, imágenes en base64) más un
`LEEME-PRIMERO.md`. Es una **bifurcación de la misma base de código** que
`public/index.html`: mismas secciones (`inicio/nosotros/servicios/galeria/
partner/agenda/ubicacion`), mismas clases, mismo widget de reservas y mismo
panel admin. El diff contra `public/index.html` son ~840 líneas cambiadas
sobre ~5.300.

La diferencia clave: **el ZIP se ramificó antes de la migración a Firebase**.
Trae trabajo nuevo de diseño, contenido y SEO que producción no tiene, pero
su backend es `localStorage` + contraseña en texto plano (`PASS='sw2026'`),
y perdió `getAvailability`, `getClubStatus`, `refreshCatalog`, Firebase Auth
y los horarios por barbero.

El objetivo es **descomponer el archivo monolítico y llevar solo sus mejoras
hacia adelante**, sobre la estructura actual (`public/` + `functions/` +
`seed/`), sin retroceder ni un milímetro en la capa de datos.

### Decisiones ya tomadas por el usuario

1. **Catálogo**: se adopta el recorte a 11 servicios. Los 15 documentos que
   salen (8 retirados + 6 reemplazados por rename + `mub`) NO se borran de
   Firestore: quedan `status:'inactive'` para no romper `bookings.svcId`,
   el conteo Club SW ni «Servicios más demandados».
2. **IDs**: se adoptan los IDs nuevos del ZIP (`lp→lavado-p`, `tj→tijeras`,
   `tjb→tj-b`, `tjbt→tj-bt`, `cbtc→cb-tc`, `ucm→uc-m`). Requiere migración
   explícita en Firestore.
3. **Alcance**: completo — sitio público, widget de reservas y panel admin.

---

## Lo que el ZIP aporta (se porta) vs. lo que retrocede (se descarta)

| Área | Se porta | Se descarta del ZIP |
|---|---|---|
| Datos | — | `localStorage` en reservas, clientes y admin |
| Auth | — | `PASS='sw2026'`, quitar `#adm-email` |
| Catálogo | 11 servicios, textos nuevos | `const CATS`/`BARBERS` estáticos, sin `refreshCatalog()` |
| Horarios | Horario partido en textos y JSON-LD | `isTaken()` pseudoaleatorio (hash %28), pérdida de `getAvailability`, `hoursRangeFor`, `.bk-taken` |
| Imágenes | 4 assets nuevos + 2 conversiones WebP | base64 inline (el repo ya externalizó a `/assets/`) |
| Admin | Nav pegajosa, agenda con columnas, densidades | Quitar filtro por barbero y «Reservas por barbero» |
| Scripts | — | Quitar los `<script type="module">` de `/js/*.js` |

Además el ZIP **borra el fix del bug de cambio de barbero** documentado en
`public/index.html:2700-2706` (no re-renderizaba fecha/horarios). Se conserva
el fix actual.

---

## Fase 0 — Preparación

1. **Higiene del árbol de trabajo.** `git status` muestra
   `public/assets/galeria-1.jpg` borrado localmente (existe en HEAD, 90.296 B)
   y sin trackear `public/assets/galeria-1.jpeg` y `public/assets/reservas/`.
   El HTML referencia `/assets/galeria-1.jpg` en dos lugares (galería y
   `book-img`), así que un deploy desde este checkout serviría dos 404.
   Restaurar con `git checkout -- public/assets/galeria-1.jpg` y decidir qué
   hacer con los dos archivos sin trackear (el `.jpeg` de 98 KB parece una
   variante duplicada; `reservas/galeria-1.jpg` es byte-idéntico al de HEAD).
2. Crear rama `feature/v20-sitio-final` desde `main` (el repo ya usa este
   patrón: `feature/v19-firebase-migration`, `feature/whatsapp-kapso`).
3. Copiar este plan a `docs/superpowers/plans/2026-07-28-sw-studio-final-v1.md`
   siguiendo la convención de `docs/superpowers/`.

---

## Fase 1 — SEO y datos estructurados (`public/index.html`, `<head>`, L1–90)

- `viewport`: agregar `viewport-fit=cover`.
- Reescribir `meta description`, `keywords` y `og:description` con el
  vocabulario real (visagismo, corte con tijeras, mullet/shaggy/mod cut,
  lavado premium Reuzel, undercut mujer).
- JSON-LD `HairSalon`:
  - `priceRange`: `"$$"` → `"$8.000 - $65.000"`.
  - `openingHoursSpecification`: partir en dos bloques (L–V 10:00–20:00,
    Sáb 10:00–17:00). Hoy declara L–S 10–20, que es falso.
  - `hasOfferCatalog`: reemplazar los 7 nombres genéricos («Corte Clásico»,
    «Fade & Degradé») por las 11 ofertas reales con `price`, `priceCurrency`,
    `availability`, `description`, `serviceType` y `provider`.
- JSON-LD `FAQPage`: de 5 a 8 preguntas (horario partido, servicios reales,
  niños 2–10 años, qué es el visagismo, cancelación, cortes de mujer).
- **`aggregateRating`: verificar antes de aplicar.** El ZIP sube
  `reviewCount` de 6 a 15. Solo adoptarlo si hay 15 reseñas reales; datos
  estructurados inventados exponen a una acción manual de Google.
- **Oportunidad extra (pendiente #2 del LEEME):** el `<head>` actual no tiene
  `og:image` ni `twitter:image` (solo `twitter:card`), así que compartir el
  enlace no muestra miniatura. A diferencia del ZIP, acá sí hay assets
  servidos por hosting: agregar ambas apuntando a una imagen 1200×630 en
  `https://scissorwhite.cl/assets/`.

## Fase 2 — Legibilidad y tipografía (bloque `<style>` del sitio público)

Es el cambio más extenso del ZIP y es transversal. Portar tal cual:

- Base: `text-rendering:optimizeLegibility`, `-webkit-text-size-adjust:100%`,
  `img{max-width:100%}`, `.hero{height:100svh}`.
- Subida general de tamaños y bajada de `letter-spacing` en nav, hero,
  `.s-ey`/`.s-body`, `.stat-*`, `.bi-*`, `.loc-addr`, `.partner-quote`,
  footer y widget de reservas.
- Contraste: `var(--steel-dark)` → `#4E5A68` en texto sobre claro;
  `rgba(255,255,255,.5)` → `.68`/`.86` en secciones oscuras;
  `text-shadow` en el texto del hero y `.bld-cap` (que va sobre fotos).
- Nuevo bloque de legibilidad dentro de `@media(max-width:1024px)`,
  ampliación del de `@media(max-width:640px)` y un `@media(max-width:380px)`
  nuevo.

Sin cambios de estructura HTML: es CSS puro sobre clases que ya existen.

## Fase 3 — Sitio público: Servicios, galería, equipo y horarios

**3a. Sección Servicios rediseñada** (`public/index.html:1249-1300`).
Hoy hay una grilla estática de 19 tarjetas con un comentario que la declara
explícitamente «copia estática (4ª ubicación)» a sincronizar a mano. El ZIP
la reemplaza por 6 destacados + un bloque «Descubre más»:

- Tarjeta: número grande con degradado metálico (`.svc-n`), nombre, fila
  `duración · precio` donde **el precio se revela en hover/focus** (y al
  primer toque en táctil, vía `@media(hover:none)` + clase `.svc-open`),
  descripción editorial larga y tag «Reservar».
- Grilla `repeat(3,1fr)` con `gap:1px` sobre fondo claro; 2 columnas en
  tablet, 1 en móvil.
- Bloque `.svc-more` con botón «Ver todos los servicios» → `openBK()`.
- JS: `.svc-tag` usa `stopPropagation()` para no chocar con el handler de
  tarjeta táctil; nuevo handler para `.svc-more-btn`.

Beneficio de mantenimiento: la 4ª copia baja de 19 ítems a 6 con copy
editorial propio. Actualizar el comentario del bloque para reflejar las
ubicaciones reales tras el cambio (destacados, `CATS`, `DS`, `seed/data.js`).

**3b. Galería**: de 5 a 7 fotos. `grid-template-rows` pasa a 3 filas de 400px,
`.gal-item:nth-child(6){grid-column:span 2}`, y se ajustan las filas en los
breakpoints de 1024px y 640px. Las dos fotos nuevas llevan
`loading="lazy" decoding="async"`.

**3c. Retrato de Victoria** en la tarjeta de equipo: nuevas clases
`.team-card-ph`, `.team-card-body`, `.team-photo` (círculo de 112px, 84px en
móvil, grayscale → color en hover, anillo con degradado vía `mask-composite`).

**3d. Horario partido en el sitio**: el `.bi-val` de «Horario» pasa a dos
líneas (L–V 10–20 / Sáb 10–17). La constante `HOURS` del widget ya tiene
`6:[10,17]` — solo el texto visible y el JSON-LD estaban desactualizados.

**3e. Textos menores**: CTA secundario del hero «Nuestros servicios» →
«Ver galería» (`#galeria`); enlaces de servicios del footer a los reales;
`.s-body` de la sección Servicios reescrito; `team-days` de Victoria
«Mar — Sáb» → «Lun — Sáb».

**3f. Assets** (extraídos del base64 del ZIP a `public/assets/`):

| Nuevo archivo | Origen | Tamaño |
|---|---|---|
| `equipo-victoria.jpg` | retrato tarjeta equipo | 67 KB |
| `galeria-4.webp` | interior con letrero de neón | 95 KB |
| `galeria-5.webp` | zona de espera | 80 KB |
| `barbero-victoria.jpg` | avatar del widget de reservas | 9,5 KB |

Además el ZIP trae `nosotros-1` y `nosotros-2` convertidas a WebP: 432 KB →
26 KB y 479 KB → 40 KB. Adoptarlas (`nosotros-1.webp`, `nosotros-2.webp`)
ahorra ~845 KB en la carga inicial; el LEEME dice que se verificó con PSNR.
El resto de las imágenes embebidas son byte-idénticas a las de `public/assets/`.

## Fase 4 — Widget de reservas

Portar, **manteniendo intactos** `refreshCatalog()`, `loadAvailability()`,
`isSlotAvailable()`, `hoursRangeFor()`, `.bk-slot.bk-taken`, `createBooking()`
y `getClubStatus()`:

- **Políticas del estudio**: bloque `.bk-pol` con lista numerada (puntualidad
  10 min · cancelación 3 h antes · dos inasistencias ⇒ pago adelantado) sobre
  el checkbox de consentimiento, que pasa a caja con borde y realce
  `:has(input:checked)`. Copy del error: «Debes aceptar las políticas del
  estudio para continuar.»
- **Bloque «Recuerda»** (`#bk-confirm-terms`) en la pantalla de confirmación.
- **Descripción en las tarjetas de servicio**: `.bk-svc-desc` con clamp a 2
  líneas que se expande al seleccionar; la grilla de `.bk-svc` pasa a 3 filas
  y `.bk-svc-meta`/`.bk-svc-check` bajan a `grid-row:3`. El texto sale de
  `s.desc`, que ya llega desde Firestore vía `refreshCatalog()`.
- **Foto de barbero**: `.bk-bav img` y `renderBarbers()` usando `b.photo`.
  Adaptación: en el repo `BARBERS` se arma en `refreshCatalog()` desde
  `staff`, así que hay que propagar el campo `photo` ahí (hoy no se copia).
- **Preselección con un solo profesional** — adaptada: el ZIP compara
  `BARBERS.length===1`, pero acá `BARBERS[0]` siempre es «Sin preferencia».
  La condición correcta es `BARBERS.filter(b=>!b.any).length===1`.
- Título del paso 2: «Elige tu barbero» → «Tu barbero».

## Fase 5 — Panel de administración

- **Navegación**: el scroll horizontal se aísla en `#adm-nav-links` (con
  máscara de degradado a la derecha, `scroll-snap` y clase `at-end` que la
  apaga al llegar al final) y **«Salir» queda `position:sticky` a la
  derecha**, siempre visible. Incluye el IIFE que alterna `at-end`.
- **Barra superior** responsiva: `min-height`, `flex:1 1 auto;min-width:0` en
  el título para que no empuje los botones, `#adm-ss` oculto bajo 560px y
  escalado de botones en 560px/380px.
- **Agenda — reposicionamiento de tarjetas (el cambio de fondo real).** Hoy
  las tarjetas se posicionan `left:5px;right:5px`, así que dos citas
  solapadas se tapan entre sí. El ZIP agrupa los eventos en clusters de
  solapamiento y los reparte en columnas (`left:calc(x% + 4px)`,
  `width:calc(w% - 8px)`), sube la escala a `PXM=1.2` (72px/hora) y añade
  tres densidades (`''`/`compact`/`mini`) que ajustan el contenido al alto
  disponible, más `title` con el detalle y expansión al pasar el cursor.
- **Merge necesario en la agenda**: el ZIP elimina el sombreado
  ocupado/libre de las medias horas y la etiqueta «Libre», que se agregaron
  a propósito en el commit `a096ce1`. Se adopta el clustering y las
  densidades **conservando** los dos `.a-tl-half` dentro de cada
  `.a-tl-slot` (36px cada uno, ya que el slot pasa a 72px), la clase
  `a-tl-busy` y la etiqueta `.a-tl-lbl`. Se descarta el `background-image`
  con la línea a 35px que el ZIP usa como sustituto: es redundante.
  `.a-tl-hour` sube a 72px para no desalinear la columna de horas.
- **No portar**: la eliminación del filtro por barbero (`#a-bk-filter-barber`)
  ni de «Reservas por barbero» (`#a-barber-stats`). El ZIP los quitó porque
  su copia del negocio tiene un solo profesional; el repo mantiene tres
  registros de staff.
- **Sí portar la eliminación del botón «+ Datos demo»** (`#a-bk-seed` /
  `seedDemo()`), por seguridad: en la versión Firebase, `seedDemo` escribe 50
  documentos nuevos en `bookings`, y cada uno dispara `onBookingCreated`
  (`functions/index.js:17`) → **50 correos reales vía Resend** al cliente
  demo y a `SHOP_EMAIL`. Un botón así no debería existir en el panel de
  producción. Si prefieres conservarlo para desarrollo, la alternativa es
  dejarlo visible solo contra el emulador; dilo y lo hago así.
- **Copy**: «Guardar paciente» → «Guardar cliente», «Pacientes» → «Clientes»,
  vaciar la mención a datos demo en el estado vacío de estadísticas.
- **No portar** los cambios de fotos de cliente (`ph.url` → `ph.src`,
  `savePatients` local): pertenecen al backend `localStorage`. El repo usa
  Firebase Storage con `{url, path, date}`.

## Fase 6 — Catálogo: código y migración de Firestore

**6a. Mapeo completo** (19 actuales → 11 nuevos):

| Actual | Nuevo | Cambio |
|---|---|---|
| `vis` | `vis` | nombre → «Asesoría con VISAGISMO», desc nueva |
| `vis-b` | `vis-b` | nombre → «… + Barba simple», desc nueva |
| `nino` | `nino` | nombre → «Corte de cabello niño (2-10 años)» |
| `cb` | `cb` | nombre → «Corte de cabello + barba simple» |
| `lp` | **`lavado-p`** | rename; precio 21.000 igual |
| `tj` | **`tijeras`** | rename; duración 75 → 60 min |
| `tjb` | **`tj-b`** | rename; 70 min / 35.000 igual |
| `tjbt` | **`tj-bt`** | rename; 90 min / 40.000 igual |
| `cbtc` | **`cb-tc`** | rename; 75 min / 30.000 igual |
| `ucm` | **`uc-m`** | rename; 35 min / 8.000 igual |
| — | **`adulto`** | nuevo: 45 min / $18.000 |
| `promo`, `fm`, `mu`, `mub`, `ras` | — | retirados (cat. `c`) |
| `bs`, `btc`, `rbs`, `rbtc` | — | retirados (cat. `b` completa) |

Categoría `c` se renombra «Cortes» → «Corte de cabello». La `b` («Barba»)
queda sin servicios activos; `refreshCatalog()` ya la descarta con
`.filter(c=>c.items.length)`, así que basta con dejar la etiqueta en el mapa
para que el admin siga rotulando los documentos inactivos.

**6b. `seed/data.js`** — pasa a exportar dos arreglos:

- `services`: los 11 activos, con los nombres, duraciones, precios y
  descripciones nuevas.
- `retiredServices`: los 15 documentos que salen (9 retirados + 6 IDs
  antiguos renombrados), cada uno con `status:'inactive'` y un comentario de
  bloque explicando por qué siguen ahí (referencias históricas en
  `bookings.svcId`).
- `staff`: Victoria pasa a `days:'Lun — Sáb'` y su `schedule[1]` (lunes) a
  `{open:true,start:'10:00',end:'20:00'}`. Se le agrega `photo` con la ruta
  del nuevo avatar.

**Descripciones**: el ZIP tiene tres variantes de texto por servicio. Se usan
las **medias** (las de su arreglo `DS`) como `desc` canónico en
`seed/data.js`, porque son las que se renderizan en las tarjetas del widget
(`.bk-svc-desc`, clamp a 2 líneas). Las descripciones largas y editoriales
quedan escritas a mano en los 6 destacados de la landing, que es copy de
marketing, no dato de catálogo.

**6c. `seed/seed.js`**: escribe solo `services` (los 11), no
`retiredServices` — un emulador nuevo no necesita arrastrar historia.

**6d. `functions/scripts/reconcileCatalog.js`**: en `main()`, calcular el
estado esperado con `services.concat(retiredServices)`. No hay que cambiar la
firma de `computeIntended()` (está exportada). Con eso, un solo
`--apply` sobre producción: crea los 7 documentos nuevos, actualiza los 4 que
conservan ID y **baja a `inactive` los 15 legados** — sin borrar nada, que es
justo la garantía que el script ya documenta.

**6e. Copias en `public/index.html`**: actualizar los tres arreglos que
duplican el catálogo — `CATS` (`:2322`, fallback del widget), `CAT_NAMES`
(`:2381`), `DS` (`:~3890`, defaults del admin) y `CN` (`:3865`) — a los 11
servicios y a la categoría `c` renombrada.

**6f. `functions/test/patients.test.js:7`**: el fixture usa
`svcId:'lp', svcName:'Corte + Lavado Premium'`. Actualizar a `lavado-p` para
que el test no documente un ID muerto.

---

## Archivos a modificar

- `public/index.html` — el grueso de las fases 1–5 y 6e
- `public/assets/` — 4 archivos nuevos + 2 conversiones WebP; restaurar
  `galeria-1.jpg`
- `seed/data.js` — catálogo, `retiredServices`, staff
- `seed/seed.js` — escribir solo activos
- `functions/scripts/reconcileCatalog.js` — incluir retirados en el esperado
- `functions/test/patients.test.js` — fixture
- `README.md` — actualizar el conteo de servicios si lo menciona
- `docs/superpowers/plans/2026-07-28-sw-studio-final-v1.md` — copia del plan

## Verificación

1. **Tests de funciones** (rápidos, sin emulador):
   `cd functions && node --test` → deben seguir en verde tras 6f.
2. **Emulador end-to-end**:
   ```bash
   firebase emulators:start          # :5000 sitio, :4000 UI
   cd seed && FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=scissor-white npm run seed
   ```
   - Firestore muestra 11 servicios activos y Victoria con lunes abierto.
   - Landing: 6 destacados, precio oculto hasta hover; en móvil el primer
     toque revela el precio y «Reservar» abre el widget.
   - Galería con 7 fotos y la 6ª ocupando dos columnas.
   - Widget: las tarjetas muestran descripción, aparecen las políticas y no
     se puede confirmar sin marcar el checkbox; la confirmación muestra
     «Recuerda»; Victoria sale preseleccionada con foto.
   - Horarios: crear una reserva y comprobar que ese bloque queda **tachado**
     (`.bk-taken`) al volver a abrir — confirma que `getAvailability` sigue
     mandando y que no se coló el `isTaken()` pseudoaleatorio del ZIP.
   - Admin: login con Firebase Auth (email + contraseña, no `sw2026`); crear
     dos citas solapadas y verificar que se reparten en columnas sin taparse;
     las medias horas ocupadas siguen sombreadas y las libres muestran
     «Libre»; «Salir» permanece visible al hacer scroll de la nav en móvil.
3. **Reconciliación (solo reporte, contra producción real)**:
   ```bash
   cd functions && node scripts/reconcileCatalog.js
   ```
   Revisar a mano el diff: 7 creaciones, 4 actualizaciones, 15 a `inactive`,
   0 en «solo en producción». Recién después correr con `--apply`.
4. **Responsive y datos estructurados**: revisar a 380 / 640 / 1024 / 1440 px
   y validar el JSON-LD en el Rich Results Test antes del deploy.
5. **Deploy**:
   ```bash
   firebase deploy --only "hosting,functions:onBookingCreated,functions:getClubStatus,functions:getAvailability" --project scissor-white
   ```

## Riesgos

- **Renombrar IDs parte las estadísticas por servicio**: las reservas
  históricas quedan apuntando a `lp`/`tj`/… y las nuevas a
  `lavado-p`/`tijeras`/…, así que «Servicios más demandados» mostrará el
  mismo servicio dos veces mientras haya historia de ambos lados. Es la
  consecuencia esperada de la decisión tomada; si molesta, se resuelve
  después con un script que reescriba `svcId` en `bookings`.
- **`reconcileCatalog.js --apply` es el único paso que toca producción.**
  Correrlo siempre primero en modo reporte y leer el diff completo.
- **`aggregateRating`**: no publicar 15 reseñas si no existen.
