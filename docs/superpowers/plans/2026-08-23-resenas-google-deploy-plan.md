# Reseñas de Google en el landing — Plan de puesta en producción

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Llevar a producción la sección de reseñas de Google del landing (`#resenas`), que **ya está implementada y verificada localmente** pero vive sin commitear y sin la configuración de Google Cloud que la alimenta.

**Architecture:** El código no se toca salvo que la revisión encuentre algo. El trabajo real es: asegurar la implementación en una rama, configurar Places API (New) en el proyecto GCP `scissor-white`, cargar la API key en Secret Manager, desplegar hosting + reglas + las 8 Cloud Functions, y verificar en producción. La sección falla cerrada por diseño (sin datos queda `hidden`), así que un deploy sin la key **no rompe nada visible** — pero tampoco muestra nada, y esa ambigüedad es la trampa principal de este plan.

**Tech Stack:** Firebase (Hosting + Firestore + Cloud Functions v2 Node 22, región `southamerica-east1`), Google Places API (New), Secret Manager, Cloud Scheduler. Tests: `node:test` para `functions/`, `vitest` + `@firebase/rules-unit-testing` para `firestore.rules`.

**Spec:** No hay documento de diseño aparte — el diseño se resolvió durante la implementación y quedó documentado en **`README.md`, sección "Reseñas de Google"**, que es la referencia normativa de este plan (límites de la API, política de Google, modo respaldo). Leerla completa antes de empezar.

## Global Constraints

- **Rama:** nunca commitear ni deployar desde `main` directo. Rama de trabajo: `feature/resenas-google`.
- **Proyecto GCP/Firebase:** `scissor-white`. Región de funciones: `southamerica-east1`.
- **Deploy de funciones SIEMPRE con nombres explícitos.** El proyecto tiene desplegada una función `api` (`us-central1`, Node 20) que **no pertenece a este codebase** — es de la rama `feature/whatsapp-kapso`. Un `firebase deploy --only functions` sin nombres la ofrece para borrar.
- **La lista de deploy son 8 nombres**, uno por cada `exports.` de `functions/index.js`. Verificar con `grep -oE "^exports\.[a-zA-Z]+" functions/index.js` antes de cada deploy.
- **Nunca poner una API key real en un archivo del repo.** `functions/.secret.local` está versionado y solo lleva valores falsos. Producción: `firebase functions:secrets:set`.
- **`functions/.env` no debe existir al deployar.** Con secretos presentes, Cloud Run rechaza el deploy con `Secret environment variable overlaps non secret environment variable`.
- **Titularidad de la cuenta:** el proyecto Firebase de Scissor White **no debe quedar bajo `eflores@certimar.cl`**. Si eso no está resuelto, la Tarea 4 se bloquea (ver su nota).

---

## Estado de partida

La implementación está completa y verificada localmente al 2026-08-23. Lo que existe sin commitear:

| Archivo | Estado |
|---|---|
| `functions/googleReviews.js` | **nuevo** — módulo puro: normalización de Places, resolución de placeId, guard de frescura |
| `functions/test/googleReviews.test.js` | **nuevo** — 26 tests unitarios |
| `functions/index.js` | modificado — `refreshGoogleReviews` (schedule) + `syncGoogleReviews` (callable admin) + `assertAdmin()` |
| `firestore.rules` | modificado — `match /googleReviews/{id}` |
| `tests/rules/firestore.rules.test.js` | modificado — 4 tests nuevos |
| `public/index.html` | modificado — sección `#resenas` (CSS + HTML + JS), enlaces de menú, `[hidden]` global |
| `public/js/data.js` | modificado — `loadGoogleReviews` / `saveManualReviews` / `syncGoogleReviews` |
| `public/admin/index.html` | modificado — tarjeta "Reseñas de Google" en Info & Contacto |
| `functions/.secret.local` | modificado — `GOOGLE_PLACES_API_KEY` con valor **falso** para el emulador |
| `README.md` | modificado — sección "Reseñas de Google" + corrección de la lista de deploy |
| `tests/browser/resenas.mjs` | **nuevo** — 8 escenarios de la sección en navegador real |
| `tests/browser/admin-resenas.mjs` | **nuevo** — 18 checks del panel admin |
| `package.json` / `package-lock.json` | modificado — `playwright` como devDependency, que usan los dos scripts de arriba |
| `.gitignore` | modificado — ignora `.tmp-screenshots/` |
| `docs/superpowers/plans/2026-08-23-...` | **nuevo** — este plan |

**Verificación ya hecha (no hay que repetirla, sí confirmarla en la Tarea 1):** 121 tests de funciones, 23 tests de reglas contra el emulador, 8 escenarios de la sección en navegador real (incluida inyección XSS), 18 checks del panel admin. Los dos últimos son reproducibles: `tests/browser/`.

**Lo que NUNCA se probó:** una llamada real a Places API. Nadie ejecutó este código contra Google. Ese es el riesgo principal y lo aísla la Tarea 6.

---

## Antes de empezar

- [ ] **Paso 0: Confirmar que el árbol de trabajo es el esperado**

Run:
```bash
cd C:/Users/aldon/Documents/Proyectos/clients/scissor-white/scissor-white
git branch --show-current
git status --short
```

Expected: rama `main`, y exactamente estos 15 archivos (11 `M` + 4 `??`):
```
 M .gitignore
 M README.md
 M firestore.rules
 M functions/.secret.local
 M functions/index.js
 M package-lock.json
 M package.json
 M public/admin/index.html
 M public/index.html
 M public/js/data.js
 M tests/rules/firestore.rules.test.js
?? docs/superpowers/plans/2026-08-23-resenas-google-deploy-plan.md
?? functions/googleReviews.js
?? functions/test/googleReviews.test.js
?? tests/browser/
```

Si hay MÁS archivos modificados, alguien tocó otra cosa: parar y revisar antes de commitear. Si hay MENOS, el trabajo se perdió — parar.

---

### Task 1: Asegurar el trabajo en una rama

Ahora mismo todo vive solo en el árbol de trabajo, sobre `main`. Es el estado más frágil posible: un `git checkout` accidental lo borra. Esta tarea existe para que nada más dependa de eso.

**Files:**
- Ninguno se modifica. Solo git.

- [ ] **Step 1: Correr la suite de funciones antes de commitear**

Run: `cd functions && npm test`
Expected: `ℹ pass 121` y `ℹ fail 0`.

Si falla, **no commitear**: reportar cuál test falla y parar.

- [ ] **Step 2: Correr la suite de reglas contra el emulador**

Run (desde la raíz del repo):
```bash
npx firebase emulators:exec --only firestore "npx vitest run tests/rules/firestore.rules.test.js"
```
Expected: `Tests 23 passed (23)`.

Requiere Java (ya instalado: OpenJDK 21). En stderr aparecen líneas de `permission-denied` — son esperadas, las produce `assertFails` a propósito.

> **No corras `npm run test:rules`** (la suite completa): incluye `storage.rules.test.js`, que falla porque ese script solo levanta el emulador de Firestore, no el de Storage. Es una falla preexistente, ajena a este trabajo.

- [ ] **Step 3: Crear la rama y commitear**

```bash
cd C:/Users/aldon/Documents/Proyectos/clients/scissor-white/scissor-white
git checkout -b feature/resenas-google
git add -A
git commit -m "feat(web): sección de reseñas de Google en el landing

Espeja el perfil de Google Business en googleReviews/main vía Places API
(New) y lo muestra en una sección nueva (#resenas) entre Productos y Agenda.

- functions/googleReviews.js: módulo puro (normalización, resolución de
  placeId, guard de frescura), 26 tests con node:test
- refreshGoogleReviews (schedule diario 06:00 America/Santiago) y
  syncGoogleReviews (callable admin-only) — la API key vive en Secret
  Manager y nunca baja al navegador
- firestore.rules: googleReviews con lectura pública y escritura admin
- panel admin: estado, Place ID y reseñas de respaldo curadas a mano
- tests/browser/: verificación en navegador real de la sección y del panel
  (8 + 18 checks), con playwright como devDependency
- README: corrige la lista de deploy, que omitía createBooking desde Fase A

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Verificar que el árbol quedó limpio**

Run: `git status --short`
Expected: sin salida.

---

### Task 2: Revisión de código

La implementación no tuvo revisión externa. Esta tarea es la puerta antes de gastar dinero en GCP.

**Files:**
- Read: todos los del commit anterior.

- [ ] **Step 1: Revisar el diff completo**

Run: `git show --stat HEAD && git show HEAD`

Puntos a mirar con atención, en orden de riesgo:

1. **`functions/index.js` → `assertAdmin()`** — introduce un **cuarto** lugar donde vive el UID admin hardcodeado (`VUm858rENuNVzB4MAMtzLnGb1A63`). Los otros tres son `firestore.rules` (`isAdmin`) y `storage.rules` (×2). Confirmar que el comentario lo dice y que queda anotado como pendiente de Fase 3. **No intentar arreglarlo acá** — se retiran los cuatro juntos, no de a uno.
2. **`syncGoogleReviewsToFirestore`** — confirmar que la escritura es `{ merge: true }`. Sin eso, cada sincronización borraría `manualReviews` (las reseñas de respaldo del panel).
3. **`public/index.html` → `render()`** — confirmar que el modo respaldo (`picked.verified === false`) esconde el bloque de puntaje cuando no hay `rating` y cambia el texto del pie. Mostrar reseñas escritas desde el panel bajo el rótulo "opiniones en Google" sería una afirmación falsa.
4. **Escapado** — todo texto de Google pasa por `esc()` antes de ir a `innerHTML`. Hay un test de XSS que lo cubre, pero conviene leerlo.

- [ ] **Step 2: Registrar hallazgos**

Si la revisión encuentra algo, arreglarlo en un commit aparte sobre la misma rama y volver a correr las suites del Task 1 Steps 1-2. Si no encuentra nada, seguir.

---

### Task 3: Configurar Google Cloud

**Esta tarea la ejecuta una persona en la consola de GCP.** Un agente no puede: requiere sesión autenticada en el navegador y decisiones de facturación.

> ⚠️ **Bloqueo posible.** Hay una restricción registrada: el proyecto Firebase de Scissor White **no debe quedar bajo `eflores@certimar.cl`**. Esta tarea crea consumo facturable sobre ese proyecto. Si la titularidad no está resuelta, **parar acá** y saltar a la Tarea 8 (modo respaldo), que deja la sección funcionando sin Places API.

**Files:**
- Ninguno del repo.

- [ ] **Step 1: Confirmar facturación activa**

`console.cloud.google.com/billing` → verificar que el proyecto `scissor-white` tenga una cuenta de facturación vinculada. Places API la exige incluso para usar solo el tramo gratuito.

- [ ] **Step 2: Habilitar Places API (New)**

En la biblioteca de APIs hay **dos** entradas parecidas. Hay que habilitar **`Places API (New)`**, no `Places API` (legacy). El código llama a `places.googleapis.com/v1`, que es la nueva.

```bash
gcloud services enable places.googleapis.com --project scissor-white
```

O por consola: **APIs y servicios → Biblioteca** → "Places API (New)" → Habilitar.

Habilitar la legacy por error produce, más adelante: `Places API 403: Places API (New) has not been used in project ... before`.

- [ ] **Step 3: Crear la clave**

**APIs y servicios → Credenciales → Crear credenciales → Clave de API**. Copiarla a un lugar temporal seguro (no a un archivo del repo).

- [ ] **Step 4: Restringir la clave**

Editar la clave recién creada:

- **Restricciones de aplicación: `Ninguna`.** Es lo correcto acá aunque suene mal: la usa una Cloud Function, que sale por IPs dinámicas — restringir por IP la rompería. Y como nunca llega al navegador, no hay referrer que restringir.
- **Restricciones de API: `Restringir clave` → marcar solo `Places API (New)`.** Esta es la que protege de verdad: si la clave se filtra, no sirve para nada más.

- [ ] **Step 5: Poner un tope de cuota**

Como la clave no está restringida por IP, **este es el control real de presupuesto**.

**APIs y servicios → Places API (New) → Cuotas** → límite diario de **50 solicitudes/día**. El sistema hace 1 por día; 50 deja margen para pruebas y no deja que un error se transforme en factura.

Agregar además una alerta de presupuesto en **Billing → Budgets & alerts** (ej. US$5).

- [ ] **Step 6: Anotar el costo esperado**

El campo `reviews` dispara el SKU más caro, *Place Details Enterprise + Atmosphere*: **1.000 eventos gratis/mes**, después ~US$20 por 1.000. El consumo real es ~30 llamadas/mes (una diaria); el `searchText` que resuelve el Place ID corre **una sola vez** y queda cacheado en `businessInfo.googlePlaceId`. Esperado: **US$0**.

---

### Task 4: Cargar el secreto

**Files:**
- Ninguno del repo se modifica.

**Interfaces:**
- Consume: la API key creada en la Tarea 3.
- Produce: el secreto `GOOGLE_PLACES_API_KEY` en Secret Manager, que leen `refreshGoogleReviews` y `syncGoogleReviews` vía `defineSecret`.

- [ ] **Step 1: Verificar que `functions/.env` NO existe**

Run: `ls functions/.env 2>/dev/null && echo "EXISTE — MOVERLO" || echo "OK, no existe"`
Expected: `OK, no existe`.

Si existe, renombrarlo a `functions/.env.local-emulador` antes de seguir. Con secretos declarados, su presencia hace que Cloud Run rechace el deploy.

- [ ] **Step 2: Cargar la clave**

```bash
firebase functions:secrets:set GOOGLE_PLACES_API_KEY --project scissor-white
```

Pegar la clave y Enter. No queda en el historial del shell ni en ningún archivo.

- [ ] **Step 3: Verificar que quedó registrada**

Run: `firebase functions:secrets:access GOOGLE_PLACES_API_KEY --project scissor-white`
Expected: imprime la clave. Confirmar que coincide con la creada y que **no tiene espacios ni saltos de línea al final** — un `\n` pegado de más produce `API key not valid`.

- [ ] **Step 4: Confirmar que el emulador NO usa la clave real**

Run: `grep GOOGLE_PLACES_API_KEY functions/.secret.local`
Expected: `GOOGLE_PLACES_API_KEY=AIzaLocalFakeDoNotUse0000000000000000000`

Ese archivo se versiona. Si alguien puso ahí la clave real, **sacarla, rotar la clave en GCP y volver al Step 2**. Es exactamente la falla que el 2026-08-05 hizo que el emulador usara los secretos reales de Resend.

---

### Task 5: Desplegar

**Files:**
- Ninguno se modifica.

- [ ] **Step 1: Reconciliar la lista de funciones**

```bash
grep -oE "^exports\.[a-zA-Z]+" functions/index.js
firebase functions:list --project scissor-white
```

Expected del `grep` (8 nombres):
```
exports.onBookingCreated
exports.createBooking
exports.getClubStatus
exports.getAvailability
exports.onBookingWritten
exports.onScheduleBlockWritten
exports.refreshGoogleReviews
exports.syncGoogleReviews
```

En `functions:list` va a aparecer además `api` (`us-central1`, Node 20). **Es de otra rama y no se toca**: por eso el deploy va con nombres explícitos.

- [ ] **Step 2: Desplegar**

```bash
firebase deploy --project scissor-white --only \
  hosting,firestore:rules,\
functions:onBookingCreated,functions:createBooking,functions:getClubStatus,\
functions:getAvailability,functions:onBookingWritten,functions:onScheduleBlockWritten,\
functions:refreshGoogleReviews,functions:syncGoogleReviews
```

`refreshGoogleReviews` es la **primera función programada del proyecto**: el CLI va a pedir habilitar **Cloud Scheduler** y puede tardar más de lo normal. Aceptar.

- [ ] **Step 3: Verificar que las dos funciones nuevas quedaron arriba**

Run: `firebase functions:list --project scissor-white`
Expected: aparecen `refreshGoogleReviews` (scheduled) y `syncGoogleReviews` (callable), ambas en `southamerica-east1`, Node 22. `api` sigue intacta en `us-central1`.

---

### Task 6: Primera llamada real a Places

**El paso más incierto del plan.** Este código nunca corrió contra Google. Se aísla en su propia tarea para que, si falla, quede claro que falla acá y no en el deploy.

**Files:**
- Ninguno.

- [ ] **Step 1: Disparar la sincronización desde el panel**

Abrir `https://scissorwhite.cl/admin/` → iniciar sesión → **Info & Contacto** → bajar hasta **Reseñas de Google** → **Sincronizar ahora**.

Expected: `✓ Listo: N reseñas traídas desde Google.`

Tabla de diagnóstico si falla:

| Mensaje | Causa | Arreglo |
|---|---|---|
| `Places API 403: ...has not been used in project` | Se habilitó la legacy, no la (New) | Tarea 3 Step 2 |
| `Places API 400: API key not valid` | Clave mal pegada, con `\n`, o restringida a otra API | Tarea 4 Step 3 / Tarea 3 Step 4 |
| `No se encontró la ficha en Google` | `businessInfo.name`/`.addr` no matchean la ficha | Step 2 de esta tarea |
| `Tu sesión no tiene permisos de administrador` | El usuario no tiene el custom claim `admin` ni es el UID de respaldo | Revisar `functions/scripts/setAdminClaim.js` |
| `Places API 429` | Se tocó el tope de cuota de la Tarea 3 Step 5 | Subir el tope, o esperar al día siguiente |

- [ ] **Step 2: Solo si dio `No se encontró la ficha`**

El Place ID se resuelve automáticamente desde nombre + dirección. Si Google no encuentra la ficha o devuelve otro local, hay que pegarlo a mano:

1. Buscar el negocio en Google Maps.
2. Obtener el Place ID con el [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id) de Google.
3. Pegarlo en el campo **ID del lugar en Google (Place ID)** del panel.
4. **Guardar información** (el botón de arriba, no el de reseñas de respaldo).
5. Volver al Step 1.

- [ ] **Step 3: Confirmar el estado en el panel**

Después de una sincronización exitosa, la tarjeta debe mostrar una línea como:
```
Scissor White Studio — 5,0 ★ sobre N opiniones
M reseñas con texto publicadas en el sitio · Última sincronización: 23-08-2026, ...
Place ID: ChIJ...
```

Si `M` es 0 pero el perfil tiene reseñas: son reseñas **sin texto** (solo estrellas). Places no devuelve texto para esas y la sección no puede dibujarlas. En ese caso el panel de puntaje sí se muestra y el carrusel queda oculto — es correcto. Considerar la Tarea 8.

- [ ] **Step 4: Verificar el anti-rebote**

Apretar **Sincronizar ahora** de nuevo, inmediatamente.
Expected: `✓ Ya estaba al día (última sincronización: ...). Se puede volver a intentar en unos minutos.`

Esto confirma que el guard de 10 minutos funciona y que clics repetidos no gastan llamadas facturadas.

---

### Task 7: Verificar en producción

**Files:**
- Ninguno.

- [ ] **Step 1: Ver la sección en el sitio**

Abrir `https://scissorwhite.cl` en una ventana de incógnito (para saltar el `sessionStorage` del intro) y bajar hasta después de **Productos (Slick Gorilla)**.

Checklist visual:
- [ ] Aparece la sección oscura "RESEÑAS VERIFICADAS / La voz de quienes vuelven"
- [ ] El título **"La voz de"** se lee en blanco (si se ve casi negro, volvió el bug de herencia de `.s-ti`)
- [ ] El puntaje sube de 0,0 al valor real al entrar en pantalla
- [ ] Las tarjetas se desplazan solas y **se detienen al pasar el mouse**
- [ ] "Reseñas" aparece en el menú superior y en el footer
- [ ] "Ver en Google" abre la ficha correcta; "Escribir reseña" abre el formulario de Google

- [ ] **Step 2: Verificar en móvil**

En un teléfono real o con las devtools en modo dispositivo (≤900px):
- [ ] Las tarjetas **no** se mueven solas; se deslizan con el dedo
- [ ] Los botones ocupan el ancho completo
- [ ] La página **no** tiene scroll horizontal

- [ ] **Step 3: Confirmar que el cron quedó programado**

```bash
gcloud scheduler jobs list --project scissor-white --location southamerica-east1
```
Expected: un job cuyo nombre contiene `refreshGoogleReviews`, con schedule `0 6 * * *` y timezone `America/Santiago`.

Para probarlo sin esperar al día siguiente:
```bash
gcloud scheduler jobs run <NOMBRE_DEL_JOB> --project scissor-white --location southamerica-east1
```
Después, en el panel, el campo "Última sincronización" debe reflejar la hora de la corrida.

- [ ] **Step 4: Revisar logs**

```bash
firebase functions:log --project scissor-white --only refreshGoogleReviews
```
Expected: `googleReviews: sincronización programada` con `{ ok: true, placeId: ..., reviews: N }`.

---

### Task 8: Modo respaldo (solo si Places no está disponible)

**Ejecutar esta tarea si la Tarea 3 quedó bloqueada** (titularidad de la cuenta sin resolver, facturación no habilitada), **o si la Tarea 6 Step 3 mostró 0 reseñas con texto.** Deja la sección funcionando sin depender de Places.

**Files:**
- Ninguno del repo. Se escribe en Firestore desde el panel.

- [ ] **Step 1: Cargar reseñas de respaldo**

Panel → **Info & Contacto → Reseñas de Google → Reseñas de respaldo → + Agregar**. Completar nombre, puntaje y texto de cada una. **Guardar reseñas de respaldo**.

Estas se guardan en `googleReviews/main.manualReviews`, campo que **ninguna sincronización pisa**. Apenas Google devuelva reseñas con texto, las de respaldo se ocultan solas.

- [ ] **Step 2: Entender qué se va a ver**

En modo respaldo la sección **se auto-modera**, a propósito:
- Sin `rating` real, **esconde el bloque de puntaje** (no inventa un "5,0").
- El pie **deja de decir** "publicadas por clientes reales en el perfil de Google / se actualizan solas".
- Las tarjetas **no llevan la marca de Google**.

Es decir: muestra las opiniones sin presentarlas como verificadas por Google. **No editar el código para forzar que muestren la insignia** — sería afirmar algo falso sobre el origen de esas reseñas.

- [ ] **Step 3: Verificar en el sitio**

Recargar `https://scissorwhite.cl` e ir a la sección. Confirmar que las tarjetas aparecen y que **no** hay ningún "0,0" ni logo de Google sobre las tarjetas.

---

## Rollback

Si algo sale mal en producción, en orden de menor a mayor impacto:

1. **Ocultar solo la sección, sin tocar código ni deploy:** borrar el documento `googleReviews/main` desde la consola de Firestore. La sección vuelve a quedar `hidden` y el enlace del menú desaparece — la página queda exactamente como antes de este trabajo. Es el rollback más rápido y no requiere deploy.
2. **Revertir el hosting:** consola de Firebase → Hosting → historial de versiones → **Restaurar** la versión anterior.
3. **Revertir el código:** `git revert <sha>` sobre la rama y volver a deployar. Las funciones nuevas pueden quedar desplegadas sin daño: sin lecturas, no cuestan nada.

Para desactivar solo la actualización automática sin tocar el resto:
```bash
gcloud scheduler jobs pause <NOMBRE_DEL_JOB> --project scissor-white --location southamerica-east1
```

---

## Verificación en navegador (`tests/browser/`)

Los scripts que verificaron la sección **ya están en el repo**, portados desde el directorio temporal donde nacieron:

| Script | Qué cubre |
|---|---|
| `tests/browser/resenas.mjs` | 8 escenarios de la sección: sin doc en Firestore, doc vacío, solo puntaje, solo reseñas curadas, respaldo sin puntaje, marquesina estática con 2 reseñas, "Leer más" (incluye que el hover congele la marquesina), e inyección XSS en nombre y texto |
| `tests/browser/admin-resenas.mjs` | 18 checks del panel: carga del Place ID y del estado, alta/edición/borrado de reseñas de respaldo, descarte de filas vacías, y que "Sincronizar" no mande `force` |

Ambos levantan un servidor estático sobre `public/`, abortan las rutas a `gstatic.com`/`googleapis.com` para que el `data.js` real no pise el stub, e inyectan `window.SWData` con `page.addInitScript`.

- [ ] **Step 1: Correrlos**

```bash
node tests/browser/resenas.mjs
node tests/browser/admin-resenas.mjs
```
Expected: ambos terminan con `== TODO OK ==` y código de salida 0.

Requieren el navegador de Playwright. Si falla con "browser not found":
```bash
npx playwright install chromium
```

- [ ] **Step 2: Correrlos otra vez después de cualquier cambio en `public/index.html`**

Es el único control automático que tiene la sección: las suites de `functions/` y de reglas no ven el frontend.

### Mejora opcional (no bloqueante)

Son scripts standalone con `process.exit`, no tests de `vitest` como el resto del repo. Convertirlos al formato de `vitest` y agregar `"test:browser": "vitest run tests/browser"` al `package.json` de la raíz los integraría con el resto de las suites. No cambia la cobertura, solo la ergonomía.
