# Quitar staff retirado, externalizar widget, hero.webp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quitar a Esteban y Ariel (ya borrados de Firestore de producción) de los dos arreglos de fallback JS que aún los mencionan, mover el motor del widget de reservas a un archivo externo para poder diferir su carga, y convertir `hero.jpg` a WebP con fallback.

**Architecture:** Tres cambios independientes en `public/`. Los dos primeros tocan `public/index.html` en zonas distintas del archivo pero **tienen una dependencia de orden real**: la Tarea 2 extrae por completo el bloque `<script>` donde vive `BARBERS` (el arreglo que la Tarea 1 edita), así que **la Tarea 1 debe hacerse antes que la Tarea 2** — si se invierte el orden, `BARBERS` ya no estará en `public/index.html` sino en el nuevo `public/js/booking-widget.js`, y las instrucciones de la Tarea 1 (escritas contra `public/index.html`) no encontrarán el texto. La Tarea 3 (`hero.jpg`) es independiente de las otras dos (toca líneas fuera del script que se mueve) y puede hacerse en cualquier momento.

**Tech Stack:** HTML/CSS/JS plano sin bundler, Node.js para los scripts de extracción/conversión, Playwright (ya devDependency) para renderizar y exportar WebP vía Chromium headless. Spec de referencia: `docs/superpowers/specs/2026-09-16-limpieza-staff-y-performance-design.md`. Sin test runner para `public/` — verificación estructural (grep/`node --check`) más un paso de verificación funcional manual para la Tarea 2.

---

## File Structure

| File | Change |
|---|---|
| `public/index.html` | **Modify** (Tarea 1: quita 2 entradas de `BARBERS`). **Modify** (Tarea 2: reemplaza el `<script>` de 1062 líneas por una línea `<script defer src="/js/booking-widget.js"></script>`). **Modify** (Tarea 3: `<link rel="preload">` y `<img>`→`<picture>` del hero). |
| `public/admin/index.html` | **Modify** (Tarea 1: quita 2 entradas de `DT`). |
| `public/js/booking-widget.js` | **Create** (Tarea 2: contenido extraído verbatim del `<script>` que hoy vive inline en `index.html`). |
| `public/assets/hero.webp` | **Create** (Tarea 3: generado desde `hero.jpg` vía Chromium/Playwright). |

**Orden obligatorio: Tarea 1 → Tarea 2. Tarea 3 en cualquier momento.**

---

### Task 1: Quitar Esteban y Ariel de los fallbacks

**Files:**
- Modify: `public/index.html`
- Modify: `public/admin/index.html`

- [ ] **Step 1: Confirmar el texto actual en `public/index.html`**

Run: `grep -n "let BARBERS" -A4 public/index.html`
Expected:
```
XXXX:let BARBERS = [
XXXX:  {id:'victoria', name:'Victoria', init:'V', role:'Barbera Senior · Visagismo', photo:'/assets/barbero-victoria.jpg'},
XXXX:  {id:'esteban', name:'Esteban', init:'E', role:'Barbero'},
XXXX:  {id:'ariel', name:'Ariel', init:'A', role:'Barbero'}
XXXX:];
```
(los números de línea exactos no importan, el texto sí — si no calza, busca `let BARBERS` por contexto, no por número de línea).

- [ ] **Step 2: Editar `BARBERS`**

Reemplazar:
```js
let BARBERS = [
  {id:'victoria', name:'Victoria', init:'V', role:'Barbera Senior · Visagismo', photo:'/assets/barbero-victoria.jpg'},
  {id:'esteban', name:'Esteban', init:'E', role:'Barbero'},
  {id:'ariel', name:'Ariel', init:'A', role:'Barbero'}
];
```
con:
```js
let BARBERS = [
  {id:'victoria', name:'Victoria', init:'V', role:'Barbera Senior · Visagismo', photo:'/assets/barbero-victoria.jpg'}
];
```

- [ ] **Step 3: Confirmar el texto actual en `public/admin/index.html`**

Run: `grep -n "var DT=" -A4 public/admin/index.html`
Expected:
```
XXXX:var DT=[
XXXX:  {id:'victoria',name:'Victoria',role:'Barbera Senior · Visagismo',days:'Lun — Sáb',bio:'4 años de experiencia, especializada en asesoría con visagismo.',status:'active',photo:'/assets/barbero-victoria.jpg',schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'17:00'}]},
XXXX:  {id:'esteban',name:'Esteban',role:'Barbero',days:'Lun — Vie',bio:'',status:'inactive',photo:'',schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:false}]},
XXXX:  {id:'ariel',name:'Ariel',role:'Barbero',days:'Lun — Vie',bio:'',status:'inactive',photo:'',schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:false}]}
```

- [ ] **Step 4: Editar `DT`**

Reemplazar:
```js
var DT=[
  {id:'victoria',name:'Victoria',role:'Barbera Senior · Visagismo',days:'Lun — Sáb',bio:'4 años de experiencia, especializada en asesoría con visagismo.',status:'active',photo:'/assets/barbero-victoria.jpg',schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'17:00'}]},
  {id:'esteban',name:'Esteban',role:'Barbero',days:'Lun — Vie',bio:'',status:'inactive',photo:'',schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:false}]},
  {id:'ariel',name:'Ariel',role:'Barbero',days:'Lun — Vie',bio:'',status:'inactive',photo:'',schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:false}]}
];
```
con:
```js
var DT=[
  {id:'victoria',name:'Victoria',role:'Barbera Senior · Visagismo',days:'Lun — Sáb',bio:'4 años de experiencia, especializada en asesoría con visagismo.',status:'active',photo:'/assets/barbero-victoria.jpg',schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'17:00'}]}
];
```

- [ ] **Step 5: Verificar**

Run: `grep -ci "esteban\|ariel" public/index.html public/admin/index.html`
Expected:
```
public/index.html:0
public/admin/index.html:0
```

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/admin/index.html
git commit -m "$(cat <<'EOF'
fix(web): quitar a Esteban y Ariel de los fallbacks de staff

Ya estaban borrados de Firestore de producción a propósito (solo
existe Victoria) -- verificado leyendo la colección staff en vivo.
Lo que quedaba eran restos en BARBERS (widget público) y DT (panel
admin), los dos arreglos de fallback que se muestran si Firestore
no responde a tiempo. El widget falla abierto, así que dejarlos ahí
era un riesgo real de mostrar staff que ya no existe.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

### Task 2: Extraer el widget de reservas a `public/js/booking-widget.js`

**Depends on: Task 1 must be committed first** (esta tarea extrae por completo el bloque `<script>` donde vive `BARBERS`; si corre antes que la Tarea 1, la Tarea 1 no encontrará el texto en `public/index.html`).

**Files:**
- Modify: `public/index.html`
- Create: `public/js/booking-widget.js`

- [ ] **Step 1: Confirmar que existe el bloque a extraer**

Run: `grep -n "^<script>$" public/index.html`
Expected: al menos dos líneas (el widget de reservas y el intro animado son dos `<script>` clásicos separados). No hace falta que el número de línea calce con nada específico — el script de extracción del Step 2 ubica el bloque por su contenido, no por número de línea.

- [ ] **Step 2: Correr el script de extracción**

Run (desde la raíz del repo):
```bash
node - <<'NODESCRIPT'
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');

const openMarker = '<script>\n(function(){\n// ═══════════════════════════════════════\n// DATA — catálogo de servicios SW Studio';
const scriptTagStart = html.indexOf(openMarker);
if (scriptTagStart === -1) throw new Error('No se encontró el marcador de apertura del script del widget de reservas');

const closeMarker = '\n})();\n</script>';
const closeIdx = html.indexOf(closeMarker, scriptTagStart);
if (closeIdx === -1) throw new Error('No se encontró el cierre })();\\n</script> del script');

const scriptTagEnd = closeIdx + closeMarker.length;
const jsStart = scriptTagStart + '<script>\n'.length;
const jsEnd = closeIdx + '\n})();'.length;
const jsContent = html.slice(jsStart, jsEnd);

if (!jsContent.startsWith('(function(){')) throw new Error('El contenido extraído no empieza con (function(){');
if (!jsContent.endsWith('})();')) throw new Error('El contenido extraído no termina con })();');

fs.writeFileSync('public/js/booking-widget.js', jsContent + '\n');

const replacement = '<script defer src="/js/booking-widget.js"></script>';
const newHtml = html.slice(0, scriptTagStart) + replacement + html.slice(scriptTagEnd);
fs.writeFileSync('public/index.html', newHtml);

console.log('OK: extraído a public/js/booking-widget.js (' + jsContent.length + ' bytes), index.html actualizado');
NODESCRIPT
```
Expected: `OK: extraído a public/js/booking-widget.js (NNNNN bytes), index.html actualizado` (el número de bytes no importa, solo que no haya tirado una excepción).

Si el script lanza `No se encontró el marcador de apertura` o `No se encontró el cierre`, el archivo cambió de forma que invalida el marcador — no fuerces el reemplazo a mano; reporta BLOCKED con el mensaje de error exacto.

- [ ] **Step 3: Verificar que el archivo nuevo es JS válido**

Run: `node --check public/js/booking-widget.js`
Expected: sin salida (exit code 0). Cualquier salida es un error de sintaxis — no debería pasar si el Step 2 extrajo el bloque completo correctamente, pero si pasa, reporta BLOCKED.

- [ ] **Step 4: Verificar que `public/index.html` quedó consistente**

Run:
```bash
grep -c "let BARBERS" public/index.html public/js/booking-widget.js
grep -c '<script defer src="/js/booking-widget.js"></script>' public/index.html
grep -c "window.closeBK\|window.openBK\|window.bkGoTo" public/index.html public/js/booking-widget.js
```
Expected:
```
public/index.html:0
public/js/booking-widget.js:1
1
public/index.html:0
public/js/booking-widget.js:3
```
(`BARBERS` y los tres `window.X =` deben estar SOLO en el archivo nuevo, nunca en `index.html`; el nuevo `<script defer>` debe aparecer exactamente una vez).

- [ ] **Step 5: Verificación funcional manual (no automatizable sin servir el archivo)**

Esto requiere que `public/index.html` se sirva desde un origen http(s) real (Firebase Hosting local emulator o el sitio en staging/producción tras el deploy) — abrirlo como `file://` puede fallar por cómo el SDK de Firebase resuelve el origen. Si tienes forma de levantar `firebase emulators:start --only hosting` o similar localmente, hazlo y confirma en el navegador:
1. La consola no muestra errores (`Uncaught ReferenceError`, etc.) al cargar la página.
2. El botón para abrir el modal de reservas (`onclick="openBK(...)"` en el HTML) sigue abriendo el modal.
3. Se puede completar un flujo de reserva de principio a fin: elegir servicio → elegir horario → llenar datos → ver la confirmación.

Si no tienes forma de levantar un servidor local en este momento, dilo explícitamente en tu reporte (no lo saltees en silencio) — esta verificación queda pendiente para cuando el cambio esté en staging.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/booking-widget.js
git commit -m "$(cat <<'EOF'
perf(web): externalizar el motor del widget de reservas

El script inline de ~52KB bloqueaba el parser síncronamente. defer
solo funciona con <script src>, así que había que sacarlo del HTML
para poder diferirlo. Mismo contenido, sin cambios de lógica --
sigue siendo un script clásico (no type="module"), expone los mismos
window.closeBK/openBK/bkGoTo que ya usaban los onclick del HTML.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

### Task 3: `hero.jpg` a WebP

**Files:**
- Create: `public/assets/hero.webp`
- Modify: `public/index.html`

- [ ] **Step 1: Generar el WebP con Chromium vía Playwright**

Run (desde la raíz del repo — `playwright` ya es devDependency, no hace falta instalar nada):
```bash
node - <<'NODESCRIPT'
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const jpegPath = path.resolve('public/assets/hero.jpg');
  const jpegBuf = fs.readFileSync(jpegPath);
  const dataUrl = 'data:image/jpeg;base64,' + jpegBuf.toString('base64');

  const result = await page.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return { w: img.naturalWidth, h: img.naturalHeight, webpDataUrl: canvas.toDataURL('image/webp', 0.82) };
  }, dataUrl);

  if (result.w !== 999 || result.h !== 1080) throw new Error('Dimensiones inesperadas: ' + result.w + 'x' + result.h + ' (se esperaba 999x1080)');

  const webpBuf = Buffer.from(result.webpDataUrl.split(',')[1], 'base64');
  fs.writeFileSync('public/assets/hero.webp', webpBuf);
  console.log('OK: hero.webp generado,', webpBuf.length, 'bytes (jpeg original:', jpegBuf.length, 'bytes)');
  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
NODESCRIPT
```
Expected: `OK: hero.webp generado, NNNNNN bytes (jpeg original: 162114 bytes)` — el número de bytes del WebP debería ser bastante menor que 162114 (se probó ~107000 durante el diseño de este plan, un ±10% de variación es normal y aceptable).

- [ ] **Step 2: Confirmar el texto actual del preload y el `<img>` en `public/index.html`**

Run: `grep -n 'rel="preload" as="image" href="/assets/hero.jpg"\|<img src="/assets/hero.jpg"' public/index.html`
Expected: dos líneas, una con el `<link rel="preload"...>` y otra con el `<img src="/assets/hero.jpg" ...>`. Si el texto no calza exactamente, busca por `hero.jpg` en el archivo y ubica ambas ocurrencias por contexto.

- [ ] **Step 3: Editar el preload**

Reemplazar:
```html
<link rel="preload" as="image" href="/assets/hero.jpg" fetchpriority="high">
```
con:
```html
<link rel="preload" as="image" href="/assets/hero.webp" type="image/webp" fetchpriority="high">
```

- [ ] **Step 4: Envolver el `<img>` en `<picture>`**

Reemplazar:
```html
  <img src="/assets/hero.jpg" alt="Interior Scissor White barbería premium Concepción" class="hero-img" data-img-slot="hero" width="999" height="1080" fetchpriority="high">
```
con:
```html
  <picture>
    <source srcset="/assets/hero.webp" type="image/webp">
    <img src="/assets/hero.jpg" alt="Interior Scissor White barbería premium Concepción" class="hero-img" data-img-slot="hero" width="999" height="1080" fetchpriority="high">
  </picture>
```

**No borres `public/assets/hero.jpg`** — sigue siendo el fallback real para navegadores sin soporte WebP.

- [ ] **Step 5: Verificar**

Run:
```bash
ls -la public/assets/hero.webp public/assets/hero.jpg
grep -c '<picture>' public/index.html
grep -c 'href="/assets/hero.webp" type="image/webp"' public/index.html
grep -c 'src="/assets/hero.jpg"' public/index.html
```
Expected: ambos archivos existen (`hero.webp` con un tamaño claramente menor a `hero.jpg`), `<picture>` aparece al menos 1 vez, el preload al webp aparece 1 vez, y `src="/assets/hero.jpg"` sigue apareciendo 1 vez (el `<img>` de fallback dentro del `<picture>` — si tu editor u otro código ya usaba `hero.jpg` en otro lado, el conteo puede ser mayor a 1, eso está bien, solo confirma que no bajó a 0).

- [ ] **Step 6: Commit**

```bash
git add public/assets/hero.webp public/index.html
git commit -m "$(cat <<'EOF'
perf(web): hero.jpg a WebP con fallback JPEG

hero.jpg es el recurso de LCP de la página (162KB, JPEG sin
optimizar). Se genera hero.webp (calidad 0.82, mismas dimensiones,
~34% menos bytes) vía Chromium/Playwright -- no hay cwebp ni
ImageMagick en el entorno. El <img> queda envuelto en <picture> con
el WebP como <source> preferido; el JPEG original se mantiene como
fallback real, no se borra. El preload apunta al WebP con
type="image/webp" para que los navegadores sin soporte lo ignoren
y usen el fallback del <picture> igual.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VwGrGQ1M6UTrorJhqW6YSd
EOF
)"
```

---

## Verificación manual final (fuera del alcance de los checks automatizados de arriba)

1. Abrir el sitio (staging o local con emulador) y confirmar que el hero se ve igual visualmente (sin artefactos de compresión) y que el widget de reservas completa un flujo de reserva de punta a punta (esto repite el Step 5 de la Tarea 2 si no se pudo hacer en su momento).
2. Confirmar en el widget de reservas que solo aparece Victoria como opción de barbero.
3. Lighthouse/PageSpeed Insights contra el sitio desplegado, para confirmar que el LCP mejoró respecto a la medición de la auditoría del 2026-09-14 (no bloqueante para este plan).
