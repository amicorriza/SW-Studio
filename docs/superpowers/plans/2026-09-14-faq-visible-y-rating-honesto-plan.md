# FAQ visible + quitar aggregateRating hardcodeado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En `public/index.html`, quitar el `aggregateRating` hardcodeado del JSON-LD `HairSalon` y hacer visibles las 8 preguntas frecuentes que hoy solo existen dentro del JSON-LD `FAQPage`.

**Architecture:** Dos ediciones puntuales y aisladas sobre el mismo archivo monolítico (no hay bundler ni build step): quitar una propiedad JSON, y agregar CSS + una `<section>` nueva con `<details>/<summary>` (acordeón nativo, sin JS). El `FAQPage` JSON-LD no se toca — solo se refleja su contenido, con tildes correctas, en el HTML visible.

**Tech Stack:** HTML/CSS/JS plano sin bundler, spec de referencia: `docs/superpowers/specs/2026-09-14-faq-visible-y-rating-honesto-design.md`. Sin test runner para este archivo — la verificación de cada tarea es estructural (grep/Node) más una revisión visual manual descrita al final.

---

## File Structure

| File | Change |
|---|---|
| `public/index.html` | **Modify.** (1) Quita `aggregateRating` del bloque `HairSalon` JSON-LD. (2) Agrega CSS `.faq-list`/`.faq-item` junto a `.s-rule`/`.s-body`. (3) Agrega `<section id="faq">` con 8 `<details>` entre `#ubicacion` y el comentario `<!-- INSTAGRAM -->`. |

---

### Task 1: Quitar `aggregateRating` del JSON-LD `HairSalon`

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Confirmar el texto actual antes de editar**

Run: `grep -n "aggregateRating" public/index.html`
Expected: una sola línea, algo como:
```
68:    "aggregateRating":{"@type":"AggregateRating","ratingValue":"5.0","reviewCount":"15","bestRating":"5","worstRating":"1"}
```
Si el número de línea o el contenido exacto no calzan con esto, el archivo cambió desde que se escribió este plan — no adivines, busca el bloque `HairSalon` (`"@type":"HairSalon"`) y ubica `aggregateRating` dentro de él por contexto.

- [ ] **Step 2: Quitar la propiedad**

Reemplazar:

```json
    "employee":[
      {"@type":"Person","name":"Victoria","jobTitle":"Barbera Senior","description":"4 años de experiencia, especializada en asesoría con visagismo y atención personalizada."}
    ],
    "aggregateRating":{"@type":"AggregateRating","ratingValue":"5.0","reviewCount":"15","bestRating":"5","worstRating":"1"}
  }
```

con:

```json
    "employee":[
      {"@type":"Person","name":"Victoria","jobTitle":"Barbera Senior","description":"4 años de experiencia, especializada en asesoría con visagismo y atención personalizada."}
    ]
  }
```

(Nota la coma que se quita después del `]` de `employee` — sin quitarla el JSON queda inválido.)

- [ ] **Step 3: Verificar que el bloque `HairSalon` sigue siendo JSON válido y ya no tiene `aggregateRating`**

Run:
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const blocks = [...html.matchAll(/<script type=\"application\/ld\+json\">([\s\S]*?)<\/script>/g)].map(m => m[1]);
const hairSalon = blocks.map(b => JSON.parse(b)).find(o => o['@type'] === 'HairSalon');
if (!hairSalon) throw new Error('No se encontró el bloque HairSalon');
if ('aggregateRating' in hairSalon) throw new Error('aggregateRating sigue presente');
if (hairSalon.employee[0].name !== 'Victoria') throw new Error('employee quedó dañado');
console.log('OK: HairSalon es JSON válido, sin aggregateRating, employee intacto');
"
```
Expected: `OK: HairSalon es JSON válido, sin aggregateRating, employee intacto` — si tira una excepción, el JSON quedó mal formado (revisa comas) o la propiedad sigue ahí.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
fix(seo): quitar aggregateRating hardcodeado del schema HairSalon

El schema afirmaba 5.0/15 reseñas de forma estática mientras el
widget visible de reseñas trata ese mismo dato como no confirmado
(arranca en 0 y solo se llena si el fetch a Google Places responde).
Mismo criterio fail-closed ahora en el schema: no afirma un número
hasta tenerlo confirmado.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

### Task 2: Sección FAQ visible

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Confirmar los puntos de inserción antes de editar**

Run: `grep -n 'id="ubicacion"\|<!-- INSTAGRAM -->\|\.s-rule{width' public/index.html`
Expected: tres líneas — la apertura de `<section id="ubicacion" ...>`, el comentario `<!-- INSTAGRAM -->`, y la regla `.s-rule{width:40px;height:1px;background:var(--steel-mid);margin:18px 0 28px}`. Si los números de línea no calzan con los del spec (`~2004`, `~2031`, `~409`), ubica los mismos tres anclas por el texto, no por el número de línea.

- [ ] **Step 2: Agregar el CSS del acordeón**

Justo después de la línea `.s-rule{width:40px;height:1px;background:var(--steel-mid);margin:18px 0 28px}` (y antes de `.s-body{...}`, o inmediatamente después de `.s-body` — cualquiera de las dos posiciones es válida, ambas están en el mismo bloque `<style>` de reglas por sección), insertar:

```css
.faq-list{max-width:720px;margin:0 auto}
.faq-item{border-bottom:1px solid rgba(17,17,17,.12);padding:22px 0}
.faq-item summary{
  font-size:17px;font-weight:600;color:var(--ink);
  cursor:pointer;list-style:none;
  display:flex;align-items:center;justify-content:space-between;gap:16px
}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item summary::after{content:'+';font-size:22px;font-weight:300;color:var(--steel-mid);flex-shrink:0;transition:transform .2s}
.faq-item[open] summary::after{transform:rotate(45deg)}
.faq-item p{margin:14px 0 0;font-size:15.5px;line-height:1.7;color:#3A3A3A}
```

- [ ] **Step 3: Verificar que el CSS quedó bien insertado**

Run: `grep -c "\.faq-item" public/index.html`
Expected: `6` (las 6 líneas de la Step 2 que mencionan `.faq-item` — `.faq-item{`, `.faq-item summary{`, `.faq-item summary::-webkit-details-marker`, `.faq-item summary::after`, `.faq-item[open]`, `.faq-item p{`). Si da 0, el bloque no se insertó.

- [ ] **Step 4: Insertar la sección FAQ**

Justo después del `</section>` que cierra `#ubicacion` y antes del comentario `<!-- INSTAGRAM -->`, insertar:

```html
<!-- FAQ -->
<section id="faq" style="background:var(--off-white)">
  <div class="rev" style="max-width:720px;margin:0 auto;text-align:center">
    <p class="s-ey">Resolvemos tus dudas</p>
    <h2 class="s-ti">Preguntas<br><em>frecuentes</em></h2>
    <div class="s-rule" style="margin-inline:auto"></div>
  </div>
  <div class="faq-list rev" style="margin-top:32px">
    <details class="faq-item">
      <summary>¿Dónde queda Scissor White?</summary>
      <p>Cochrane 635, Oficina 303, Torre B, Edificio Centro Plaza, Concepción, Chile.</p>
    </details>
    <details class="faq-item">
      <summary>¿Cómo agendo una cita?</summary>
      <p>Reserva online 24/7 en nuestra plataforma propia.</p>
    </details>
    <details class="faq-item">
      <summary>¿Cuál es el horario de atención?</summary>
      <p>Lunes a viernes de 10:00 a 20:00 hrs y sábado de 10:00 a 17:00 hrs. Domingo cerrado.</p>
    </details>
    <details class="faq-item">
      <summary>¿Qué servicios ofrecen?</summary>
      <p>Asesoría de imagen con visagismo, corte de cabello adulto y niño, corte con tijeras (mullet, moicano, mod cut, shaggy y warrior cut), corte con perfilado de barba simple o con toallas calientes, corte con lavado premium Reuzel y undercut mujer. Además somos distribuidores de productos Slick Gorilla.</p>
    </details>
    <details class="faq-item">
      <summary>¿Atienden niños?</summary>
      <p>Sí, atendemos niños de 2 a 10 años con un servicio de corte específico para ellos.</p>
    </details>
    <details class="faq-item">
      <summary>¿Qué es el visagismo?</summary>
      <p>El visagismo analiza la forma de tu rostro, tus rasgos y tu estilo de vida para definir el corte, la barba y el peinado que mejor armonizan contigo, y que además sean fáciles de mantener en el día a día.</p>
    </details>
    <details class="faq-item">
      <summary>¿Puedo cancelar o modificar mi reserva?</summary>
      <p>Puedes cancelar hasta 3 horas antes de tu hora agendada y modificar tu reserva hasta 2 veces.</p>
    </details>
    <details class="faq-item">
      <summary>¿Atienden cortes de mujer?</summary>
      <p>Sí. Ofrecemos undercut mujer: degradado de nuca y rapados con diseño.</p>
    </details>
  </div>
</section>

```

- [ ] **Step 5: Verificar la sección — 8 preguntas, sin romper el resto del archivo**

Run:
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const faqMatch = html.match(/<section id=\"faq\"[\s\S]*?<\/section>/);
if (!faqMatch) throw new Error('No se encontró <section id=\"faq\">');
const faqHtml = faqMatch[0];
const detailsCount = (faqHtml.match(/<details class=\"faq-item\">/g) || []).length;
if (detailsCount !== 8) throw new Error('Se esperaban 8 <details>, hay ' + detailsCount);
const summaryCount = (faqHtml.match(/<summary>/g) || []).length;
if (summaryCount !== 8) throw new Error('Se esperaban 8 <summary>, hay ' + summaryCount);
['¿Dónde queda', '¿Cómo agendo', '¿Cuál es el horario', '¿Qué servicios ofrecen', '¿Atienden niños', '¿Qué es el visagismo', '¿Puedo cancelar', '¿Atienden cortes de mujer'].forEach(q => {
  if (!faqHtml.includes(q)) throw new Error('Falta la pregunta: ' + q);
});
console.log('OK: sección #faq con 8 preguntas, todas presentes con tildes');
"
```
Expected: `OK: sección #faq con 8 preguntas, todas presentes con tildes`.

Run también: `node -e "JSON.parse(require('fs').readFileSync('public/index.html','utf8').match(/<script type=\"application\/ld\+json\">([\s\S]*?FAQPage[\s\S]*?)<\/script>/)[1])" && echo "FAQPage JSON-LD sigue siendo válido"`
Expected: `FAQPage JSON-LD sigue siendo válido` — confirma que no se tocó por accidente el JSON-LD original al insertar la sección cerca de otro contenido.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
feat(seo): hacer visibles las preguntas frecuentes del landing

Las 8 preguntas ya existían en el FAQPage JSON-LD pero nunca en el
HTML renderizado -- ningún motor de búsqueda ni sistema de IA podía
citarlas como texto. Se agregan como acordeón nativo (<details>) justo
después de Ubicación: el texto queda en el DOM aunque esté colapsado,
así que sigue siendo extraíble sin alargar la página para el
visitante. El FAQPage JSON-LD no se modifica.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

## Verificación manual (fuera del alcance de los checks automatizados de arriba)

`public/index.html` no tiene test runner ni build step — antes de dar el goal por cerrado:

1. Abrir el archivo en un navegador (o el sitio en staging tras el deploy) y confirmar visualmente: la sección "Preguntas frecuentes" aparece entre Ubicación e Instagram, las 8 preguntas están colapsadas por defecto, cada una se expande al hacer clic (ícono `+` gira a `×`), y el estilo calza con el resto del sitio (mismo fondo `--off-white` que Ubicación, misma tipografía de encabezado que Nosotros/Servicios).
2. Pegar la URL en el [Rich Results Test](https://search.google.com/test/rich-results) de Google (una vez desplegado) y confirmar que el bloque `HairSalon` ya no reporta `aggregateRating`.
3. Opcional, para cerrar el loop con la auditoría de hoy: re-correr `/claude-seo-ai:audit https://scissorwhite.cl` (o `/claude-seo-ai:compare --baseline latest --against https://scissorwhite.cl`) después del deploy y confirmar que `M5.jsonld.aggregaterating_unverified` y `M11.passage.faq_content_schema_only` ya no aparecen.
