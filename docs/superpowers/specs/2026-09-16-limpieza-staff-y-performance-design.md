# Scissor White — Quitar staff retirado del fallback, externalizar el widget, hero.jpg a WebP

- **Fecha:** 2026-09-16
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Alcance:** `public/index.html`, `public/admin/index.html`, `public/js/booking-widget.js` (nuevo), `public/assets/hero.webp` (nuevo binario). Tres cambios independientes, aprobados por Aldo, del reporte de auditoría SEO/GEO y de una pregunta de negocio aparte.

## Contexto (estado actual, verificado)

### 1. Esteban y Ariel

Verificado directo contra Firestore de producción (`staff` tiene lectura pública, `GET https://firestore.googleapis.com/v1/projects/scissor-white/databases/(default)/documents/staff` devuelve **un solo documento: `victoria`**). El comentario de `functions/scripts/backfillRetiredServices.js:12-13` lo confirma explícitamente: *"esteban/ariel, que fueron borrados de producción a propósito"*.

Lo que queda de ellos son restos en dos arreglos JS de fallback (se usan mientras Firestore no ha respondido, o si falla — el widget público "falla abierto: si la disponibilidad no carga, muestra todo disponible"):

- `public/index.html:3072-3076`, `BARBERS` (fallback del widget de reservas):
  ```js
  let BARBERS = [
    {id:'victoria', name:'Victoria', init:'V', role:'Barbera Senior · Visagismo', photo:'/assets/barbero-victoria.jpg'},
    {id:'esteban', name:'Esteban', init:'E', role:'Barbero'},
    {id:'ariel', name:'Ariel', init:'A', role:'Barbero'}
  ];
  ```
- `public/admin/index.html:1696-1700`, `DT` (fallback del panel admin, ya con `status:'inactive'` para ambos):
  ```js
  var DT=[
    {id:'victoria',name:'Victoria',role:'Barbera Senior · Visagismo',days:'Lun — Sáb',bio:'4 años de experiencia, especializada en asesoría con visagismo.',status:'active',photo:'/assets/barbero-victoria.jpg',schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'17:00'}]},
    {id:'esteban',name:'Esteban',role:'Barbero',days:'Lun — Vie',bio:'',status:'inactive',photo:'',schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:false}]},
    {id:'ariel',name:'Ariel',role:'Barbero',days:'Lun — Vie',bio:'',status:'inactive',photo:'',schedule:[null,{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:true,start:'10:00',end:'20:00'},{open:false}]}
  ];
  ```

**Decisión:** quitar sus entradas de `BARBERS` y `DT`. `seed/data.js` (usado solo para poblar el emulador local) y los IDs `'esteban'`/`'ariel'` usados como fixtures genéricos en `functions/test/*` y `tests/*` **no se tocan** — no son "perfiles" de negocio, son datos de prueba para escenarios multi-barbero.

### 2. Script del widget de reservas (52 KB inline)

`public/index.html:3035-4098` es un único `<script>` clásico (sin `type="module"`, sin `defer`) que contiene todo el motor del widget de reservas: `(function(){ ... })();` en las líneas 3036-4097. Ya expone explícitamente a `window` lo que el HTML necesita llamar por `onclick`: `window.closeBK`, `window.openBK` (`public/index.html`, dentro del cuerpo del script), `window.bkGoTo`. El único otro `<script>` clásico que se ejecuta después de este en el documento (`<!-- INTRO ANIMADO -->`, líneas 4100-4137) no depende de nada que este script defina — solo toca `#sw-intro`, `sessionStorage` y `#navbar .nav-logo-img`. Los tres `<script type="module">` finales (`firebase-init.js`, `data.js`, `auth.js`) tampoco dependen de él en el sentido inverso.

`defer` **solo funciona en un `<script>` con `src`** — es la razón real por la que este script no puede diferirse quedándose inline. Externalizarlo a `public/js/booking-widget.js` (mismo patrón que `data.js`/`auth.js`) y cargarlo con `<script defer src="/js/booking-widget.js"></script>` logra el efecto que pedía la auditoría (dejar de bloquear el parser síncronamente) sin cambiar su comportamiento: sigue siendo un script clásico (no `type="module"`), así que no hereda strict-mode de módulos ni requiere tocar su contenido.

**Decisión:** mover el contenido de las líneas 3036-4097 (el `(function(){...})();` completo, sin modificarlo) a `public/js/booking-widget.js`, y reemplazar las líneas 3035-4098 por una sola línea `<script defer src="/js/booking-widget.js"></script>`.

### 3. `hero.jpg` a WebP

`public/assets/hero.jpg`: JPEG, 999×1080, 162.114 bytes — es el recurso de LCP de la página (`public/index.html:117`, `<link rel="preload" as="image" href="/assets/hero.jpg" fetchpriority="high">`, y el `<img>` en `public/index.html:1751`, dentro de `<section class="hero" id="inicio">`).

No hay `cwebp` ni ImageMagick instalados en el entorno, pero `playwright` ya es devDependency del proyecto (`package.json`) y trae Chromium. Se probó la conversión vía Chromium headless (cargar el JPEG en un `<canvas>` y exportar con `canvas.toDataURL('image/webp', 0.82)`): **107.314 bytes** (34% menos que el JPEG), mismas dimensiones 999×1080. Comando verificado y funcional durante el brainstorming de este spec.

`.hero-img{position:absolute;inset:0;...}` (`public/index.html:259-262`) posiciona el `<img>` de forma absoluta relativa a `.hero` (que es `position:relative`) — envolverlo en `<picture>` no rompe nada, porque `<picture>` no es un elemento posicionado y no interfiere con `position:absolute` de un descendiente.

**Decisión:** generar `public/assets/hero.webp` (calidad 0.82) con Chromium/Playwright. Envolver el `<img>` en un `<picture>` con `<source type="image/webp" srcset="/assets/hero.webp">` + el `<img>` original como fallback. Cambiar el `<link rel="preload">` para apuntar al WebP con `type="image/webp"` — los navegadores sin soporte WebP ignoran ese preload (por el `type` no coincidente) y descubren el JPEG del `<picture>` igual, con `fetchpriority="high"` ya puesto en el `<img>`.

## Diseño

### `public/index.html` — quitar Esteban/Ariel de `BARBERS`

Reemplazar (líneas 3072-3076):
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

### `public/admin/index.html` — quitar Esteban/Ariel de `DT`

Reemplazar (líneas 1696-1700):
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

### Extraer el widget de reservas a `public/js/booking-widget.js`

1. Crear `public/js/booking-widget.js` con exactamente el contenido de `public/index.html:3036-4097` (el `(function(){ ... })();` completo, byte por byte, sin modificar nada dentro).
2. En `public/index.html`, reemplazar el bloque completo de las líneas 3035-4098 (desde `<script>` hasta `</script>`, inclusive) por:
   ```html
   <script defer src="/js/booking-widget.js"></script>
   ```

Dado el tamaño (~1062 líneas), esto se hace con un script (Node), no retipeando el contenido a mano — ver el plan de implementación para el comando exacto.

### `hero.jpg` a WebP

1. Generar `public/assets/hero.webp` desde `public/assets/hero.jpg` usando Chromium vía Playwright (ya es devDependency), calidad 0.82, mismas dimensiones. Comando exacto en el plan de implementación.
2. En `public/index.html`, reemplazar (línea 117):
   ```html
   <link rel="preload" as="image" href="/assets/hero.jpg" fetchpriority="high">
   ```
   con:
   ```html
   <link rel="preload" as="image" href="/assets/hero.webp" type="image/webp" fetchpriority="high">
   ```
3. Reemplazar (línea 1751):
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
   `hero.jpg` **no se borra** — sigue siendo el fallback real para navegadores sin soporte WebP, y sigue usándose también como `og:image`/otros usos si los hubiera (no tocados por este spec).

## Testing

No hay test runner para `public/`. Verificación:

1. **Esteban/Ariel:** `grep -ci "esteban\|ariel" public/index.html public/admin/index.html` debe dar `0` en ambos. El widget de reservas (abrir el archivo o el sitio) debe mostrar solo a Victoria como opción de barbero.
2. **Script externalizado:** `node --check public/js/booking-widget.js` (sintaxis válida). Abrir el sitio y confirmar que reservar una cita sigue funcionando de punta a punta (abrir modal, elegir servicio/barbero/horario, confirmar) — es el único archivo que mueve lógica real, así que merece una prueba funcional manual, no solo estructural.
3. **hero.webp:** confirmar que el archivo existe, pesa menos que el JPEG, y que las dimensiones coinciden (999×1080). Ver la página y confirmar que el hero se ve igual (sin artefactos de compresión visibles).

## Fuera de alcance

- `seed/data.js`, fixtures de test (`functions/test/*`, `tests/*`) que usan IDs `esteban`/`ariel` — no son perfiles de negocio.
- Cualquier otro hallazgo de la auditoría SEO no pedido explícitamente (nodo `WebSite`, duplicado `Organization`, breadcrumb roto, `<main>` faltante, `og:image` chico, `Offer.url` faltante, footer con link muerto).
- Bios de Esteban/Ariel — ya no aplica, se eliminan en vez de completarse.
- Deploy — sigue siendo acción de Aldo.
