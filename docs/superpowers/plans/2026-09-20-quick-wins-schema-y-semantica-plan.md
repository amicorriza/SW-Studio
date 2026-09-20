# Quick wins de schema y semántica — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuatro arreglos de bajo esfuerzo en `public/index.html`: envolver el contenido en `<main>`, normalizar las URLs del breadcrumb, fusionar el `Organization` duplicado en `HairSalon` (agregando `logo`/`contactPoint`), y arreglar un link muerto del footer.

**Architecture:** Cuatro ediciones de texto independientes sobre el mismo archivo monolítico, en regiones distintas que no se solapan. Ningún cambio de comportamiento JS ni de diseño visual — son estructura semántica y datos de schema.

**Tech Stack:** HTML/CSS/JS plano sin bundler. Spec de referencia: `docs/superpowers/specs/2026-09-20-quick-wins-schema-y-semantica-design.md`. Sin test runner para `public/` — verificación estructural con Node (parseo de JSON-LD, grep) más una revisión visual manual final.

---

## File Structure

| File | Change |
|---|---|
| `public/index.html` | **Modify**, cuatro veces: `<main>`/`</main>` alrededor del contenido; barra final en el `BreadcrumbList`; el bloque `Organization` se elimina y `HairSalon` gana `logo`+`contactPoint`; el link muerto del footer apunta a Maps. |

Las cuatro tareas no interfieren entre sí (tocan líneas distintas) — el orden entre ellas no importa, pero se ejecutan una por una igual, con su propio commit cada una.

---

### Task 1: Envolver el contenido en `<main>`

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Confirmar los dos puntos de inserción**

Run: `grep -n '^</div>$\|<!-- HERO -->\|class="ig">\|<!-- FOOTER -->' public/index.html`

Expected: debe aparecer, en este orden, el `</div>` que cierra el menú móvil (justo antes de `<!-- HERO -->`), y más abajo `<section class="ig">` seguido, unas líneas después, por `<!-- FOOTER -->`. Si el texto exacto no calza, busca por contexto (el `</div>` correcto es el que precede inmediatamente al comentario `<!-- HERO -->`; el punto de cierre correcto es el `</section>` que sigue a la sección con `class="ig"`, justo antes de `<!-- FOOTER -->`).

- [ ] **Step 2: Insertar `<main>`**

Reemplazar:
```html
</div>

<!-- HERO -->
<section class="hero" id="inicio">
```
con:
```html
</div>

<main>
<!-- HERO -->
<section class="hero" id="inicio">
```

- [ ] **Step 3: Insertar `</main>`**

Reemplazar:
```html
    Ver Instagram
  </a>
</section>

<!-- FOOTER -->
<footer>
```
con:
```html
    Ver Instagram
  </a>
</section>

</main>
<!-- FOOTER -->
<footer>
```

- [ ] **Step 4: Verificar**

Run: `grep -c "<main>" public/index.html && grep -c "</main>" public/index.html`
Expected:
```
1
1
```

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
fix(seo): envolver el contenido del landing en <main>

No había ningún <main> en la página -- ayuda a que Google (y
cualquier lector/asistente) distinga el contenido real de la
navegación y el footer. Nav, menú móvil y footer quedan fuera a
propósito, son chrome del sitio, no contenido.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

### Task 2: Normalizar las URLs del `BreadcrumbList`

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Confirmar el texto actual**

Run: `grep -n '"@type":"BreadcrumbList"' -A6 public/index.html`
Expected:
```
XXXX:  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
XXXX:    {"@type":"ListItem","position":1,"name":"Inicio","item":"https://scissorwhite.cl"},
XXXX:    {"@type":"ListItem","position":2,"name":"Servicios","item":"https://scissorwhite.cl#servicios"},
XXXX:    {"@type":"ListItem","position":3,"name":"Galería","item":"https://scissorwhite.cl#galeria"},
XXXX:    {"@type":"ListItem","position":4,"name":"Reservar","item":"https://scissorwhite.cl#agenda"}
XXXX:  ]}
```
(los números de línea no importan, el texto sí).

**Importante:** `#agenda` es correcto y NO cambia — la sección de reservas real tiene `id="agenda"` (verificado). No lo confundas con `#reservar`, que es lo que usan los links de navegación pero no corresponde a ningún `id` real en la página (bug real, pero fuera de este plan).

- [ ] **Step 2: Agregar la barra final a las 4 URLs**

Reemplazar:
```json
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
    {"@type":"ListItem","position":1,"name":"Inicio","item":"https://scissorwhite.cl"},
    {"@type":"ListItem","position":2,"name":"Servicios","item":"https://scissorwhite.cl#servicios"},
    {"@type":"ListItem","position":3,"name":"Galería","item":"https://scissorwhite.cl#galeria"},
    {"@type":"ListItem","position":4,"name":"Reservar","item":"https://scissorwhite.cl#agenda"}
  ]}
```
con:
```json
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
    {"@type":"ListItem","position":1,"name":"Inicio","item":"https://scissorwhite.cl/"},
    {"@type":"ListItem","position":2,"name":"Servicios","item":"https://scissorwhite.cl/#servicios"},
    {"@type":"ListItem","position":3,"name":"Galería","item":"https://scissorwhite.cl/#galeria"},
    {"@type":"ListItem","position":4,"name":"Reservar","item":"https://scissorwhite.cl/#agenda"}
  ]}
```

- [ ] **Step 3: Verificar**

Run:
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const blocks = [...html.matchAll(/<script type=\"application\/ld\+json\">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
const bc = blocks.find(b => b['@type'] === 'BreadcrumbList');
const urls = bc.itemListElement.map(i => i.item);
const expected = [
  'https://scissorwhite.cl/',
  'https://scissorwhite.cl/#servicios',
  'https://scissorwhite.cl/#galeria',
  'https://scissorwhite.cl/#agenda',
];
if (JSON.stringify(urls) !== JSON.stringify(expected)) throw new Error('URLs no coinciden: ' + JSON.stringify(urls));
console.log('OK: BreadcrumbList con barra final en las 4 URLs, #agenda sin tocar');
"
```
Expected: `OK: BreadcrumbList con barra final en las 4 URLs, #agenda sin tocar`

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
fix(seo): normalizar la barra final en las URLs del BreadcrumbList

Las 4 URLs no traían la barra final que sí tiene el sitio real
(https://scissorwhite.cl/, no https://scissorwhite.cl). El ancla
#agenda del último ítem es correcta y no se toca -- la sección de
reservas real tiene id="agenda"; #reservar (lo que usan los links de
navegación) no corresponde a ningún id real, pero ese es un bug de
navegación aparte, no de este arreglo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

### Task 3: Quitar el `Organization` duplicado, agregar `logo`/`contactPoint` a `HairSalon`

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Confirmar el texto actual**

Run: `grep -n '"telephone":"+56982514114"\|"@type":"Organization"' public/index.html`
Expected: la línea `"telephone":"+56982514114",` dentro del bloque `HairSalon`, y la línea del bloque `Organization` completo (`{"@context":"https://schema.org","@type":"Organization",...}`).

- [ ] **Step 2: Agregar `logo` y `contactPoint` a `HairSalon`**

Reemplazar:
```json
    "telephone":"+56982514114",
    "image":"https://scissorwhite.cl/assets/og-image.jpg",
```
con:
```json
    "telephone":"+56982514114",
    "logo":{"@type":"ImageObject","url":"https://scissorwhite.cl/assets/logo.png","width":400,"height":400},
    "contactPoint":{"@type":"ContactPoint","telephone":"+56982514114","contactType":"customer service"},
    "image":"https://scissorwhite.cl/assets/og-image.jpg",
```

- [ ] **Step 3: Eliminar el bloque `Organization` completo**

Reemplazar:
```html
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Organization","name":"Scissor White - SW Studio","url":"https://scissorwhite.cl","sameAs":["https://www.instagram.com/scissorwhite.cl"]}
  </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList"
```
con:
```html
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList"
```

**Ojo:** este `replace` deja intacto el resto de la línea de `BreadcrumbList` (todo lo que sigue después de `"@type":"BreadcrumbList"` en esa misma línea) — solo borra el bloque `Organization` completo y el `<script>`/`</script>` que lo envolvía. Si ya hiciste la Task 2 antes que esta, el texto de `BreadcrumbList` en tu archivo ya tiene las URLs con barra final — eso no afecta este reemplazo, que solo depende del texto hasta `"@type":"BreadcrumbList"`.

- [ ] **Step 4: Verificar**

Run:
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const blocks = [...html.matchAll(/<script type=\"application\/ld\+json\">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
console.log('total bloques ld+json:', blocks.length);
console.log('tipos:', blocks.map(b => b['@type']));
const hs = blocks.find(b => b['@type'] === 'HairSalon');
if (!hs) throw new Error('No se encontró HairSalon');
if (hs.logo.width !== 400 || hs.logo.height !== 400) throw new Error('logo mal: ' + JSON.stringify(hs.logo));
if (hs.contactPoint.telephone !== '+56982514114') throw new Error('contactPoint mal: ' + JSON.stringify(hs.contactPoint));
if (blocks.some(b => b['@type'] === 'Organization')) throw new Error('Todavía existe un bloque Organization');
console.log('OK: 3 bloques (HairSalon con logo+contactPoint, BreadcrumbList, FAQPage), sin Organization');
"
```
Expected:
```
total bloques ld+json: 3
tipos: [ 'HairSalon', 'BreadcrumbList', 'FAQPage' ]
OK: 3 bloques (HairSalon con logo+contactPoint, BreadcrumbList, FAQPage), sin Organization
```

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
fix(seo): fusionar Organization en HairSalon, agregar logo y contactPoint

El bloque Organization era 100% redundante -- name/url/sameAs ya
estaban en HairSalon, que además es un tipo más específico que ya
extiende semánticamente a Organization. Se elimina en vez de
agregarle un @id compartido. logo (400x400, ya verificado en el
archivo real) y contactPoint (mismo teléfono ya publicado) son las
dos propiedades recomendadas por Google que faltaban.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

### Task 4: Arreglar el link muerto del footer

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Confirmar el texto actual**

Run: `grep -n 'Torre B, Concepción</a>' public/index.html`
Expected: `XXXX:        <li><a href="#">Torre B, Concepción</a></li>`

- [ ] **Step 2: Editar**

Reemplazar:
```html
        <li><a href="#">Torre B, Concepción</a></li>
```
con:
```html
        <li><a href="https://maps.google.com/?q=Cochrane+635+Concepción" target="_blank">Torre B, Concepción</a></li>
```

- [ ] **Step 3: Verificar**

Run: `grep -c 'href="#"' public/index.html`
Expected: `0` (era el único link con `href="#"` puro en todo el archivo; si el conteo da distinto de 0, hay otro más que no estaba contemplado — repórtalo, no lo toques).

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
fix(web): arreglar link muerto del footer (Torre B, Concepción)

Era el único <a href="#"> del footer -- su hermano de arriba
(Cochrane 635, Of. 303) ya resolvía la misma dirección con un link
real a Maps. Se usa la misma URL.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

## Verificación manual final

Abrir el sitio (o el archivo) y confirmar que nada se ve distinto — estos cuatro cambios son estructura semántica y datos de schema, no diseño visual, salvo el link del footer que ahora funciona (clic en "Torre B, Concepción" debe abrir Google Maps en una pestaña nueva).
