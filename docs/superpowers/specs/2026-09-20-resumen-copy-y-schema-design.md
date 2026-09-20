# Scissor White — Resumen visible, copy sin superlativos, y schema (canonical/contactType/sameAs)

- **Fecha:** 2026-09-20
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Alcance:** `public/index.html` únicamente. Seis cambios del resto de la auditoría SEO/GEO del 2026-09-14, aprobados por Aldo (incluye contenido visible nuevo/reescrito, autorizado explícitamente pese a la regla general de "no cambiar el diseño visual").

## Contexto (verificado en el código)

- `<link rel="canonical" href="https://scissorwhite.cl">` (línea 92) le falta la barra final, mismo defecto que ya se corrigió en el `BreadcrumbList` el 2026-09-20.
- `HairSalon.contactPoint.contactType` es `"customer service"` (agregado hoy mismo, commit `593dd71`) — `"reservations"` es más preciso para una barbería cuyo único teléfono publicado sirve para agendar.
- `HairSalon.sameAs` solo tiene Instagram (línea 45). Aldo compartió el link de su ficha de Google (`https://share.google/tiTVSZUanQBhdrufR`); se resolvió (sigue redirects) a una URL de resultados de búsqueda de Google con parámetros de sesión efímeros (`sca_esv`, `rlz`, `biw`, `sxsrf`, etc.) más un identificador estable: `kgmid=/g/11yyydsdds` (el Knowledge Graph ID de la ficha). Se usa `https://www.google.com/search?q=Scissor+White+Studio&kgmid=/g/11yyydsdds` — verificado que resuelve (HTTP 200) — en vez del link corto (puede vencer) o la URL completa con parámetros de sesión (no son estables ni reproducibles).
- Dos frases con superlativos sin sustento, ya señaladas por la auditoría (`public/index.html:1804` y `1896` — números de línea a la fecha de este spec, revisar por texto si cambiaron):
  - `"Scissor White nace en el corazón de Concepción para elevar el estándar de la barbería moderna. Desde Torre B, Cochrane 635, combinamos técnica de precisión con un espacio de diseño industrial que refleja quiénes somos."` — dentro de la misma sección `#nosotros` existe un dato real y ya visible que reemplaza el superlativo sin inventar nada: el tag `<div class="ab-tag">Est. 2026</div>` (año de fundación).
  - `"En SW Studio trabajamos con los mejores productos del mercado. Somos distribuidores de Slick Gorilla, la marca británica preferida por los mejores barberos del mundo."` — el hecho real (son distribuidores de una marca británica) se mantiene, se quitan las dos superlativas no verificables.
- No existe ningún párrafo-resumen cerca del `<h1>` que combine dirección, horario y rango de precios en una sola pieza citable — la auditoría del 14/09 lo señaló como oportunidad de alto impacto para IA (M11.summary.missing_tldr). El hero (`.h-sub`) es copy emocional corto, no el lugar correcto para un párrafo denso de hechos; la sección `#nosotros` (primera sección de contenido después del hero, ya tiene dos párrafos `.s-body`) es donde va, como tercer párrafo.

## Decisión

1. Canonical: agregar la barra final.
2. `contactType`: `"customer service"` → `"reservations"`.
3. `sameAs`: agregar la URL de Google Knowledge Graph resuelta, junto a Instagram.
4. Reescribir las dos frases con superlativos, quitando la afirmación no verificable y manteniendo el hecho real.
5. Agregar un tercer párrafo `.s-body` en `#nosotros` con el resumen (horario, dirección, servicios, rango de precios) — mismos hechos ya publicados en el JSON-LD y en el FAQ, sin inventar nada nuevo.

## Diseño

### Canonical

Reemplazar (línea 92):
```html
<link rel="canonical" href="https://scissorwhite.cl">
```
con:
```html
<link rel="canonical" href="https://scissorwhite.cl/">
```

### `contactType`

Reemplazar:
```json
"contactPoint":{"@type":"ContactPoint","telephone":"+56982514114","contactType":"customer service"},
```
con:
```json
"contactPoint":{"@type":"ContactPoint","telephone":"+56982514114","contactType":"reservations"},
```

### `sameAs`

Reemplazar:
```json
"sameAs":["https://www.instagram.com/scissorwhite.cl"],
```
con:
```json
"sameAs":["https://www.instagram.com/scissorwhite.cl","https://www.google.com/search?q=Scissor+White+Studio&kgmid=/g/11yyydsdds"],
```

### Frase 1 — "Nuestra Historia"

Reemplazar:
```html
      <p class="s-body">Scissor White nace en el corazón de Concepción para elevar el estándar de la barbería moderna. Desde Torre B, Cochrane 635, combinamos técnica de precisión con un espacio de diseño industrial que refleja quiénes somos.</p>
```
con:
```html
      <p class="s-body">Scissor White nace en el corazón de Concepción en 2026. Desde Torre B, Cochrane 635, combinamos técnica de precisión con un espacio de diseño industrial que refleja quiénes somos.</p>
```

### Frase 2 — sección Slick Gorilla

Reemplazar:
```html
      <p class="s-body">En SW Studio trabajamos con los mejores productos del mercado. Somos distribuidores de <strong>Slick Gorilla</strong>, la marca británica preferida por los mejores barberos del mundo.</p>
```
con:
```html
      <p class="s-body">En SW Studio trabajamos con productos de calidad profesional. Somos distribuidores de <strong>Slick Gorilla</strong>, marca británica especializada en styling para barbería.</p>
```

### Párrafo resumen nuevo

Insertar, justo después del segundo párrafo `.s-body` de `#nosotros` (`"Somos un equipo apasionado..."`) y antes del comentario `<!-- Team profiles -->`:
```html
      <p class="s-body" style="margin-top:14px">Atendemos de lunes a viernes de 10:00 a 20:00 hrs y sábado de 10:00 a 17:00 hrs, en Cochrane 635, Torre B, Concepción. Ofrecemos asesoría con visagismo, cortes con tijera, corte + barba y undercut mujer, con precios entre $8.000 y $65.000. Agenda tu hora online, 24/7.</p>
```

## Testing

No hay test runner para `public/`. Verificación:

1. `grep -c 'href="https://scissorwhite.cl/"' public/index.html` — debe incluir la línea del canonical (además de cualquier otra que ya use esa forma).
2. Parsear el JSON-LD `HairSalon` con Node: `contactPoint.contactType === "reservations"`, `sameAs` con 2 elementos (Instagram + la URL de Google), sin superlativos rotos en el JSON (no aplica, es texto libre de HTML, no del schema).
3. `grep -c "elevar el estándar\|mejores barberos del mundo" public/index.html` → `0` (las dos frases viejas ya no existen).
4. `grep -c "Atendemos de lunes a viernes" public/index.html` → `1` (el párrafo nuevo existe).
5. Vista manual: la sección "Nuestra Historia" debe verse igual en diseño (mismo estilo `.s-body`), solo con texto distinto y un párrafo extra.

## Fuera de alcance

- `og:image` a 1200×630 — no hay foto en mayor resolución disponible; queda pendiente si Aldo consigue una.
- `Offer.url` en los 11 servicios — sin URL específica por servicio a la que apuntar, el beneficio es marginal; se descarta.
- "Cada barbero del estudio aporta su sello personal" (plural, en la misma sección) — con solo Victoria activa en Firestore hoy, esta frase podría ya no ser precisa, pero es una decisión de negocio (¿van a sumar más barberos?) ajena a este goal — no se toca sin que Aldo lo pida.
