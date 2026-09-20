# Scissor White — Quick wins de schema y semántica del landing

- **Fecha:** 2026-09-20
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Alcance:** `public/index.html` únicamente. Cuatro arreglos de bajo esfuerzo y bajo riesgo, del lote "quick wins" de la auditoría SEO/GEO del 2026-09-14, aprobados por Aldo.

## Contexto (estado actual, verificado en el código — no en la auditoría vieja)

### 1. Falta `<main>`

`public/index.html` no tiene ningún elemento `<main>`. La estructura real del `<body>` (línea 1707) es: `<nav id="navbar">` (1717) + el menú móvil (`<div>` que cierra en la línea 1749) → todas las secciones de contenido (`#inicio` en 1752 hasta la sección Instagram, que cierra en la línea 2100) → `<footer>` (2103). No hay ninguna regla CSS que dependa de que `.hero` u otras secciones sean hijas directas de `<body>` (se verificó: cero selectores `body >` en el archivo), así que envolver el contenido en `<main>` no rompe nada visual.

### 2. Breadcrumb — el hallazgo original de la auditoría estaba mal, corregido acá

El `BreadcrumbList` JSON-LD (líneas 73-80) es:
```json
{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
  {"@type":"ListItem","position":1,"name":"Inicio","item":"https://scissorwhite.cl"},
  {"@type":"ListItem","position":2,"name":"Servicios","item":"https://scissorwhite.cl#servicios"},
  {"@type":"ListItem","position":3,"name":"Galería","item":"https://scissorwhite.cl#galeria"},
  {"@type":"ListItem","position":4,"name":"Reservar","item":"https://scissorwhite.cl#agenda"}
]}
```
La auditoría del 14/09 afirmó que `#agenda` "no corresponde a ningún ancla real" y sugirió cambiarlo por `#reservar`. **Se verificó de nuevo y esa afirmación es falsa**: la sección de reservas SÍ tiene `id="agenda"` (`<section class="book" id="agenda">`, línea 1985) — es un ancla real. Lo que en realidad NO existe en ningún lugar del archivo es un elemento con `id="reservar"`: los cinco links que usan `href="#reservar"` (nav "Agendar", CTA móvil, CTA del hero, botón del propio formulario, footer "Agendar Online" — todos con `target="_blank"`) apuntan a un ancla que no existe. Aplicar la "corrección" que sugería la auditoría habría dejado el breadcrumb apuntando a algo roto en vez de a lo único que sí funciona.

**Decisión:** el breadcrumb mantiene `#agenda` sin cambios (es correcto). Lo único que sí es un defecto real y verificable: al ítem 1 (Inicio) le falta el `/` final que sí tiene la URL canónica (`<link rel="canonical" href="https://scissorwhite.cl">` — que TAMBIÉN le falta, pero no está en el alcance de este goal tocar el canonical), y a los ítems 2-4 les falta el `/` antes del `#fragmento` para tener la misma forma que la URL real del sitio. Se normaliza esa barra en los 4 ítems.

El bug real de los cinco links `href="#reservar"` que apuntan a un ancla inexistente **no se corrige en este goal** — es un bug de navegación del cliente (no de schema/SEO), afecta 5 lugares distintos y decidir si la solución es cambiar el `id` de la sección o los `href` de los links es una decisión de UX que merece su propio goal, no un quick win.

### 3. `Organization` duplicado — se elimina, no se le agrega `@id`

El bloque `HairSalon` (líneas 19-68) ya tiene `"sameAs":["https://www.instagram.com/scissorwhite.cl"]` (línea 43) — exactamente el mismo dato que trae el bloque `Organization` separado (líneas 70-72: `{"@context":"https://schema.org","@type":"Organization","name":"Scissor White - SW Studio","url":"https://scissorwhite.cl","sameAs":["https://www.instagram.com/scissorwhite.cl"]}`). El `Organization` es 100% redundante — `name`, `url` y `sameAs` ya están en `HairSalon`, que además es un tipo más específico que ya extiende semánticamente a `Organization`. En vez de agregarle un `@id` compartido (como sugería una de las opciones de la auditoría), se elimina el bloque completo — es la opción que la propia auditoría dejaba abierta ("o quitarlo — HairSalon ya extiende Organization semánticamente") y es más simple que mantener dos bloques sincronizados.

Los campos que sí faltaban y son recomendados por Google (`Organization.logo`, `Organization.contactPoint`) se agregan directo al bloque `HairSalon`, con datos ya verificados en el propio sitio — nada inventado:
- `logo`: `/assets/logo.png` ya existe y se confirmó que mide 400×400 (`file public/assets/logo.png` → `PNG image data, 400 x 400`).
- `contactPoint`: el mismo teléfono que ya está en `HairSalon.telephone` (`+56982514114`), con `contactType:"customer service"` — categoría genérica que describe para qué sirve ese teléfono en una barbería (agendar/consultar), no un dato inventado. No se agrega `email` porque no hay ninguno publicado en el sitio para no inventarlo.

### 4. Link muerto del footer

`public/index.html:2140`: `<li><a href="#">Torre B, Concepción</a></li>` — el único `<a>` de esa lista cuyo `href` es `"#"` puro. La línea justo arriba (2139) ya resuelve la misma dirección con un link real: `<a href="https://maps.google.com/?q=Cochrane+635+Concepción" target="_blank">Cochrane 635, Of. 303</a>`. Se usa la misma URL.

## Diseño

### `<main>`

Insertar `<main>` inmediatamente después del `</div>` que cierra el menú móvil (línea 1749) y antes del comentario `<!-- HERO -->` (línea 1751):
```html
</div>

<main>
<!-- HERO -->
<section class="hero" id="inicio">
```

Insertar `</main>` inmediatamente después del `</section>` que cierra la sección Instagram (línea 2100) y antes del comentario `<!-- FOOTER -->` (línea 2102):
```html
</section>

</main>
<!-- FOOTER -->
<footer>
```

`<nav>`, el menú móvil y `<footer>` quedan fuera de `<main>` (son chrome del sitio, no contenido).

### Breadcrumb — normalizar la barra final

Reemplazar (líneas 73-80):
```json
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
    {"@type":"ListItem","position":1,"name":"Inicio","item":"https://scissorwhite.cl"},
    {"@type":"ListItem","position":2,"name":"Servicios","item":"https://scissorwhite.cl#servicios"},
    {"@type":"ListItem","position":3,"name":"Galería","item":"https://scissorwhite.cl#galeria"},
    {"@type":"ListItem","position":4,"name":"Reservar","item":"https://scissorwhite.cl#agenda"}
  ]}
  </script>
```
con:
```json
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
    {"@type":"ListItem","position":1,"name":"Inicio","item":"https://scissorwhite.cl/"},
    {"@type":"ListItem","position":2,"name":"Servicios","item":"https://scissorwhite.cl/#servicios"},
    {"@type":"ListItem","position":3,"name":"Galería","item":"https://scissorwhite.cl/#galeria"},
    {"@type":"ListItem","position":4,"name":"Reservar","item":"https://scissorwhite.cl/#agenda"}
  ]}
  </script>
```
(`#agenda` no cambia — ver el análisis de la sección de Contexto.)

### Quitar el `Organization` duplicado, agregar `logo`/`contactPoint` a `HairSalon`

Reemplazar (líneas 29-30, dentro del bloque `HairSalon`):
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

Eliminar por completo (líneas 70-72):
```html
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Organization","name":"Scissor White - SW Studio","url":"https://scissorwhite.cl","sameAs":["https://www.instagram.com/scissorwhite.cl"]}
  </script>
```

### Link muerto del footer

Reemplazar (línea 2140):
```html
        <li><a href="#">Torre B, Concepción</a></li>
```
con:
```html
        <li><a href="https://maps.google.com/?q=Cochrane+635+Concepción" target="_blank">Torre B, Concepción</a></li>
```

## Testing

No hay test runner para `public/`. Verificación:

1. `grep -c "<main>" public/index.html` y `grep -c "</main>" public/index.html` → `1` cada uno.
2. Los 4 bloques `<script type="application/ld+json">` restantes (`HairSalon`, `BreadcrumbList`, `FAQPage` — el de `Organization` desaparece, quedan 3) deben seguir siendo JSON válido: extraerlos con Node y `JSON.parse()` cada uno.
3. `HairSalon.logo.width` y `HairSalon.logo.height` deben ser `400`; `HairSalon.contactPoint.telephone` debe ser `"+56982514114"`.
4. `BreadcrumbList.itemListElement[3].item` debe seguir siendo `"https://scissorwhite.cl/#agenda"` (con la barra agregada, sin cambiar el ancla).
5. `grep -c 'href="#"' public/index.html` → debe bajar en 1 respecto al conteo actual (el link del footer ya no es `href="#"`).
6. Vista manual: abrir el sitio y confirmar que nada se ve distinto (ningún cambio de este goal debería alterar el diseño visual — son cambios de estructura semántica y schema, no de contenido visible salvo el link del footer que ahora funciona).

## Fuera de alcance

- El bug real de los 5 links `href="#reservar"` que apuntan a un ancla inexistente — es un bug de navegación, no de SEO, y decidir la solución (cambiar el `id` de la sección vs. cambiar los 5 `href`) es una decisión de UX aparte.
- El `<link rel="canonical" href="https://scissorwhite.cl">` sin barra final — mismo defecto que tenía el breadcrumb, pero tocar el canonical es más delicado (afecta cómo Google indexa la URL) y no estaba en la lista de quick wins aprobada.
- `og:image` bajo 1200×630, `Offer.url` faltante en los 11 servicios, TL;DR/resumen visible, `sameAs` con el perfil de Google Business — quedan para después, no son parte de este goal.
