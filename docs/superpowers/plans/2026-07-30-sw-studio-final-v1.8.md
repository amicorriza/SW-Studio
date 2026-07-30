# Plan: incorporar ajustes de «SW-Studio SITIO-WEB FINAL v1.8 VoBo-CLIENTE» a producción

## Contexto

El cliente envió un nuevo ZIP (`SW-Studio SITIO-WEB FINAL v1 8 VoBo-CLIENTE 2026-07-30 (1).zip`,
descargado hoy) con el mismo formato que el anterior: un único `index.html` de
1,57 MB (todo inline: CSS, JS, imágenes en base64) + `LEEME-PRIMERO.md`.

Producción (`public/index.html`, rama `feature/v20-sitio-final`) **ya tiene
integrada la primera versión de este mismo sistema de diseño** (commit
`8207692`, según el plan `docs/superpowers/plans/2026-07-28-sw-studio-final-v1.md`):
misma tipografía (Audiowide/Orbitron/Barlow Condensed/Inter), misma paleta
"acero" (`--steel-*`), mismo efecto de brillo metálico (`--metal-pos`), mismo
programa de fidelización "Club SW", mismo JSON-LD enriquecido, mismo
catálogo de 11 servicios, y conserva intacta toda la lógica real de Firebase
(`getAvailability`, horario por barbero, `getClubStatus`, Firebase Auth,
panel admin completo, herramienta de imágenes del sitio).

Se comparó el ZIP nuevo contra `public/index.html` (diff de texto con los
base64 reemplazados por marcadores, 70 hunks). La conclusión: **esta no es
una v2 estructural, es la ronda final de ajustes del cliente sobre el mismo
diseño ya integrado**. El delta real es acotado:

1. Un número de reseñas distinto en el JSON-LD.
2. Copys más largos/detallados en el array de fallback del widget de reservas
   (no en las tarjetas de la landing, que ya eran largas en ambos archivos).
3. Una animación de apertura (intro) que hoy no existe en producción.
4. Fotografías nuevas/dedicadas que hoy estaban rellenas por reutilización
   de otras imágenes (`nosotros-1.webp`/`nosotros-2.webp`/`galeria-1.jpg`).
5. Ningún cambio a la capa de datos, al widget de reservas, ni al panel
   admin — todo eso se preserva **verbatim**.

Decisiones confirmadas con el usuario:

| Punto | Decisión |
|---|---|
| `aggregateRating.reviewCount` | Actualizar de `"6"` a `"15"` (cliente confirma que son reales) |
| Descripciones de servicios (array de fallback del widget) | Restaurar la versión larga del ZIP nuevo |
| Intro animada (~3.7 s) | Sí, pero solo una vez por sesión de navegador (gate con `sessionStorage`) |
| Archivos sueltos `public/assets/galeria-1.jpeg` y `public/assets/reservas/` | Dejarlos como están — fuera de alcance de esta pasada |

---

## Fase 1 — JSON-LD: `aggregateRating`

`public/index.html:61` — `"reviewCount":"6"` → `"reviewCount":"15"`. Resto del
JSON-LD (`HairSalon`, `hasOfferCatalog`, `FAQPage` de 8 preguntas) ya
coincidía entre ambos archivos, sin cambios.

## Fase 2 — Descripciones de servicios (array de fallback del widget)

El array `CATS` que usa el widget de reservas como *fallback* mientras carga
Firestore tenía la versión corta (idéntica a `seed/data.js` y al array `DS`
de defaults del admin). La landing (`.svc-desc` de las 6 tarjetas
destacadas) y el array `DS` (defaults admin) ya eran idénticos en ambos
archivos — no se tocaron.

Se reemplazaron los 11 `desc:'...'` de `CATS` en `public/index.html` y los 11
`desc:` de `seed/data.js` por la redacción larga del ZIP.

**Propagación a Firestore real (pendiente/manual):** cambiar `seed/data.js`
no actualiza los documentos ya sembrados en producción. El siguiente paso es:

```bash
cd functions && node scripts/reconcileCatalog.js
```

revisar el reporte (debe mostrar 11 documentos con el campo `desc`
difiriendo, 0 altas/bajas) y solo después correr con `--apply`.

## Fase 3 — Intro animada (una vez por sesión)

Se portó desde el ZIP: CSS (`#sw-intro`, `#sw-intro-bg`, `#sw-intro-scrim`,
`#sw-intro-logo`, fases `.p1`/`.p2`/`.done`, `body.sw-intro-lock`,
`@keyframes swNavPop`, `@media(prefers-reduced-motion:reduce)`), markup
(`<div id="sw-intro">`, reutilizando `/assets/logo.png` para el logo en vez
de duplicar el base64) y el JS de fases (0s/2.1s/3.7s/4.6s) con una guarda
agregada:

```js
if (sessionStorage.getItem('sw-intro-seen')) { intro.remove(); return; }
sessionStorage.setItem('sw-intro-seen', '1');
```

`prefers-reduced-motion` sigue saltando la intro por completo, sin marcar la
sesión.

## Fase 4 — Fotografías nuevas

Se extrajeron del base64 del ZIP y se compararon por hash MD5 contra los
assets existentes para no reprocesar duplicados exactos (`galeria-2.jpg`,
`galeria-3.jpg`, `hero.jpg` y el retrato de equipo de Victoria resultaron
idénticos — no se tocaron). Las que sí eran distintas:

| Elemento | Antes | Ahora |
|---|---|---|
| Galería #1 | reutilizaba `galeria-1.jpg` ("Barbero…") | `galeria-1.webp` nuevo — "Letrero de neón de SW Studio…" |
| Galería #4 | reutilizaba `nosotros-2.webp` ("Cliente…") | slot nuevo `gal-cliente` → `gal-cliente.webp` (foto propia) |
| Galería #5 | reutilizaba `nosotros-1.webp` ("Equipo barberos…") | slot nuevo `gal-corte` → `gal-corte.webp` (barbera cortando) |
| Galería #6 | `galeria-4.webp` (interior con neón) | mismo slot, contenido actualizado (hash distinto al anterior) |
| Galería #7 | `galeria-5.webp` (zona de espera) | mismo slot, contenido actualizado — cambia a "sala con estaciones y espejos" |
| Nosotros — foto principal | `nosotros-1.webp` genérica | mismo slot, contenido actualizado — "Victoria atendiendo" |
| Nosotros — foto secundaria | `nosotros-2.webp` genérica | mismo slot, contenido actualizado — "Ambiente nocturno" |
| Teaser de reservas (`book-img`) | reutilizaba `galeria-1.jpg` (recorte paisaje) | slot nuevo `book-foto` → `book-foto.webp`, retrato dedicado 760×1139 |
| Intro (fondo) | no existía | slot nuevo `intro-bg` → `intro-bg.webp` |

Se descubrió que producción **compartía tres slots entre dos roles distintos**
(`nosotros-1` entre "Nosotros" y Galería #5; `nosotros-2` entre "Nosotros" y
Galería #4; `galeria-1` entre Galería #1 y el teaser de reservas) — relleno
de la integración anterior por falta de fotos propias. El ZIP nuevo trae
fotos dedicadas para cada rol, así que se desacoplaron: los slots originales
(`nosotros-1`, `nosotros-2`, `galeria-1`) se quedan con su contenido
actualizado para su rol principal, y se crearon 4 slots nuevos
(`gal-cliente`, `gal-corte`, `book-foto`, `intro-bg`) en `SITE_IMG_SLOTS` para
los roles que quedaron sin foto propia. Como consecuencia se extendió
`applySiteImageOverrides()` para soportar overrides sobre elementos sin
`.src` (el fondo de la intro es un `<div>` con `background-image`, no un
`<img>`).

También se portó el ajuste responsive del teaser de reservas
(`.book-wrap{aspect-ratio:760/1139}` + `.book-img{object-fit:contain}` en los
breakpoints de 1024px/640px) para que el nuevo retrato no se recorte como
antes recortaba la foto panorámica reutilizada.

`public/assets/galeria-1.jpg` queda en el repo sin referencias (ya no se usa
en ningún lado) — no se borró, por las mismas razones que los otros archivos
sueltos ya señalados en el plan anterior.

## Fase 5 — Limpieza menor

`public/index.html` — se eliminó `var PASS='sw2026',KEY='sw_adm_v2',BKEY='sw_bookings';`
(confirmado sin ningún uso en el resto del archivo; el login real usa
`window.SWAuth.signIn`).

## Lo que no se tocó

- `refreshCatalog()`, `loadAvailability()`, `isBarberFreeAt()`,
  `isSlotAvailable()`, `hoursRangeFor()`, `.bk-slot.bk-taken`,
  `createBooking()`, `getClubStatus()` — todo el flujo real de reservas.
- Panel admin: login con Firebase Auth, filtro por barbero, "Reservas por
  barbero", timeline con clusters/densidades, sombreado de medias horas
  ocupadas/libres.
- IDs de servicios, `seed/data.js` → `retiredServices`, `staff`.
- `public/assets/galeria-1.jpeg` y `public/assets/reservas/` (decisión del
  usuario: fuera de alcance).
- `firebase.json` / `functions/package.json` (cambio de Node 20→22 sin
  comitear, no relacionado con este trabajo).

---

## Archivos modificados

- `public/index.html` — reviewCount, array `CATS` (desc), intro animada
  (CSS+markup+JS), `SITE_IMG_SLOTS` (+4 slots, `galeria-1` src a `.webp`),
  `applySiteImageOverrides()` (soporte para `background-image`), `src`/`alt`
  de imágenes actualizados, CSS responsive del teaser, eliminación de la
  línea muerta `PASS/KEY/BKEY`.
- `public/assets/` — `nosotros-1.webp`, `nosotros-2.webp`, `galeria-4.webp`,
  `galeria-5.webp` (contenido reemplazado); `galeria-1.webp`, `gal-cliente.webp`,
  `gal-corte.webp`, `book-foto.webp`, `intro-bg.webp` (archivos nuevos).
- `seed/data.js` — 11 `desc` actualizados.

## Verificación

1. `cd functions && node --test` — no se tocó `functions/`, deben seguir en
   verde.
2. `cd functions && node scripts/reconcileCatalog.js` (sin `--apply`) —
   **bloqueado en este entorno**: falla con
   `TypeError: Cannot read properties of undefined (reading 'applicationDefault')`
   porque no hay credenciales de Application Default configuradas aquí (mismo
   bloqueo ya documentado para despliegues de este proyecto). Pendiente
   correrlo desde un entorno con las credenciales correctas antes de aplicar
   los 11 `desc` nuevos a Firestore real.
3. Verificación visual pendiente (abrir `index.html` o levantar el emulador):
   intro en pestaña de incógnito / segunda carga en la misma sesión /
   `prefers-reduced-motion`; galería con 7 fotos sin slots compartidos;
   descripciones largas en el widget; teaser de reservas con el retrato sin
   recorte extraño; panel admin sin rastro de `sw2026`.
4. Responsive a 380/640/1024/1440 px.
5. Validar el JSON-LD actualizado (reviewCount 15) en el Rich Results Test
   antes de desplegar.
6. `git status` — confirmar que no se tocó nada fuera de la lista de
   archivos modificados (los dos archivos sueltos de `public/assets/`
   quedaron intactos, por decisión del usuario).
