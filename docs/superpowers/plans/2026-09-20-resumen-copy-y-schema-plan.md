# Resumen visible, copy sin superlativos y schema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tres cambios en `public/index.html`: normalizar canonical/contactType/sameAs en el schema, quitar dos superlativos sin sustento del copy visible, y agregar un párrafo resumen factual nuevo en "Nuestra Historia".

**Architecture:** Tres ediciones de texto independientes sobre el mismo archivo, en regiones distintas que no se solapan. Ningún cambio de diseño visual salvo el texto en sí — mismas clases CSS, mismo layout.

**Tech Stack:** HTML/CSS/JS plano sin bundler. Spec de referencia: `docs/superpowers/specs/2026-09-20-resumen-copy-y-schema-design.md`. Sin test runner para `public/` — verificación con grep/Node.

---

## File Structure

| File | Change |
|---|---|
| `public/index.html` | **Modify**, tres veces: canonical + `contactType` + `sameAs` en el `<head>`; dos frases reescritas en el body; un párrafo `.s-body` nuevo en `#nosotros`. |

Las tres tareas no interfieren entre sí — el orden no importa.

---

### Task 1: Schema — canonical, `contactType`, `sameAs`

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Confirmar el texto actual**

Run: `grep -n 'rel="canonical"\|"contactType":"customer service"\|"sameAs":\["https://www.instagram.com/scissorwhite.cl"\]' public/index.html`

Expected: tres líneas —
```
XXXX:  <link rel="canonical" href="https://scissorwhite.cl">
XXXX:    "contactPoint":{"@type":"ContactPoint","telephone":"+56982514114","contactType":"customer service"},
XXXX:    "sameAs":["https://www.instagram.com/scissorwhite.cl"],
```

- [ ] **Step 2: Canonical**

Reemplazar:
```html
  <link rel="canonical" href="https://scissorwhite.cl">
```
con:
```html
  <link rel="canonical" href="https://scissorwhite.cl/">
```

- [ ] **Step 3: `contactType`**

Reemplazar:
```json
    "contactPoint":{"@type":"ContactPoint","telephone":"+56982514114","contactType":"customer service"},
```
con:
```json
    "contactPoint":{"@type":"ContactPoint","telephone":"+56982514114","contactType":"reservations"},
```

- [ ] **Step 4: `sameAs`**

Reemplazar:
```json
    "sameAs":["https://www.instagram.com/scissorwhite.cl"],
```
con:
```json
    "sameAs":["https://www.instagram.com/scissorwhite.cl","https://www.google.com/search?q=Scissor+White+Studio&kgmid=/g/11yyydsdds"],
```

- [ ] **Step 5: Verificar**

Run:
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const blocks = [...html.matchAll(/<script type=\"application\/ld\+json\">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
const hs = blocks.find(b => b['@type'] === 'HairSalon');
if (hs.contactPoint.contactType !== 'reservations') throw new Error('contactType mal: ' + hs.contactPoint.contactType);
if (hs.sameAs.length !== 2) throw new Error('sameAs mal: ' + JSON.stringify(hs.sameAs));
if (!hs.sameAs.includes('https://www.google.com/search?q=Scissor+White+Studio&kgmid=/g/11yyydsdds')) throw new Error('Falta la URL de Google en sameAs');
console.log('OK: contactType=reservations, sameAs con 2 URLs (Instagram + Google)');
"
grep -c 'href="https://scissorwhite.cl/"' public/index.html
```
Expected:
```
OK: contactType=reservations, sameAs con 2 URLs (Instagram + Google)
```
(el segundo comando debe dar al menos `1` — el canonical; puede haber más ocurrencias de esa URL exacta en otras partes del archivo, eso está bien).

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
fix(seo): normalizar canonical, contactType y sameAs del schema

Barra final en el canonical (mismo criterio ya aplicado al
breadcrumb); contactType más preciso para una barbería
("reservations" en vez de "customer service" genérico); sameAs suma
la ficha de Google Business (Knowledge Graph ID resuelto desde el
link corto que compartió Aldo, no el link corto en sí -- puede
vencer -- ni la URL de búsqueda con parámetros de sesión efímeros).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

### Task 2: Quitar los dos superlativos sin sustento

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Confirmar el texto actual**

Run: `grep -n "elevar el estándar de la barbería moderna\|preferida por los mejores barberos del mundo" public/index.html`

Expected: dos líneas, una por cada frase (ver Step 2 y 3 para el texto completo esperado).

- [ ] **Step 2: Frase de "Nuestra Historia"**

Reemplazar:
```html
      <p class="s-body">Scissor White nace en el corazón de Concepción para elevar el estándar de la barbería moderna. Desde Torre B, Cochrane 635, combinamos técnica de precisión con un espacio de diseño industrial que refleja quiénes somos.</p>
```
con:
```html
      <p class="s-body">Scissor White nace en el corazón de Concepción en 2026. Desde Torre B, Cochrane 635, combinamos técnica de precisión con un espacio de diseño industrial que refleja quiénes somos.</p>
```

- [ ] **Step 3: Frase de la sección Slick Gorilla**

Reemplazar:
```html
      <p class="s-body">En SW Studio trabajamos con los mejores productos del mercado. Somos distribuidores de <strong>Slick Gorilla</strong>, la marca británica preferida por los mejores barberos del mundo.</p>
```
con:
```html
      <p class="s-body">En SW Studio trabajamos con productos de calidad profesional. Somos distribuidores de <strong>Slick Gorilla</strong>, marca británica especializada en styling para barbería.</p>
```

- [ ] **Step 4: Verificar**

Run:
```bash
grep -c "elevar el estándar de la barbería moderna" public/index.html
grep -c "preferida por los mejores barberos del mundo" public/index.html
grep -c "en el corazón de Concepción en 2026" public/index.html
grep -c "marca británica especializada en styling para barbería" public/index.html
```
Expected:
```
0
0
1
1
```

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
fix(seo): quitar superlativos sin sustento del copy visible

"Elevar el estándar de la barbería moderna" y "la marca preferida
por los mejores barberos del mundo" son afirmaciones no verificables.
Se reemplazan por hechos reales ya publicados en la misma página (el
año de fundación, que son distribuidores de la marca) sin inventar
nada nuevo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

### Task 3: Párrafo resumen nuevo en "Nuestra Historia"

**Files:**
- Modify: `public/index.html`

**Nota:** si esta tarea se ejecuta después de la Task 2, el segundo párrafo de `#nosotros` sigue siendo `"Somos un equipo apasionado..."` (Task 2 no lo toca) — el texto de abajo sigue siendo válido sin importar el orden entre las tareas.

- [ ] **Step 1: Confirmar el texto actual**

Run: `grep -n 'Somos un equipo apasionado' -A2 public/index.html`

Expected:
```
XXXX:      <p class="s-body" style="margin-top:14px">Somos un equipo apasionado por el detalle, el estilo urbano y la excelencia. Cada barbero del estudio aporta su sello personal.</p>
XXXX:
XXXX:      <!-- Team profiles -->
```

- [ ] **Step 2: Insertar el párrafo nuevo**

Reemplazar:
```html
      <p class="s-body" style="margin-top:14px">Somos un equipo apasionado por el detalle, el estilo urbano y la excelencia. Cada barbero del estudio aporta su sello personal.</p>

      <!-- Team profiles -->
```
con:
```html
      <p class="s-body" style="margin-top:14px">Somos un equipo apasionado por el detalle, el estilo urbano y la excelencia. Cada barbero del estudio aporta su sello personal.</p>
      <p class="s-body" style="margin-top:14px">Atendemos de lunes a viernes de 10:00 a 20:00 hrs y sábado de 10:00 a 17:00 hrs, en Cochrane 635, Torre B, Concepción. Ofrecemos asesoría con visagismo, cortes con tijera, corte + barba y undercut mujer, con precios entre $8.000 y $65.000. Agenda tu hora online, 24/7.</p>

      <!-- Team profiles -->
```

- [ ] **Step 3: Verificar**

Run: `grep -c "Atendemos de lunes a viernes" public/index.html`
Expected: `1`

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
feat(seo): agregar párrafo resumen (horario/dirección/precios) en Nuestra Historia

Ningún lugar de la página combinaba dirección, horario, servicios y
rango de precios en un párrafo citable de una sola vez -- justo lo
que un sistema de IA necesita para responder "qué es y dónde queda
Scissor White" sin tener que ensamblar la respuesta de varias
secciones. Mismos hechos ya publicados en el schema y el FAQ, nada
nuevo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

## Verificación manual final

Abrir el sitio y confirmar visualmente la sección "Nuestra Historia": las dos frases reescritas se leen bien en contexto, y el párrafo nuevo no rompe el espaciado ni el diseño (mismo estilo `.s-body` que los otros dos párrafos).
