# Scissor White — FAQ visible + quitar aggregateRating hardcodeado

- **Fecha:** 2026-09-14
- **Proyecto:** Scissor White / SW Studio (barbería, Concepción, Chile)
- **Alcance:** `public/index.html` únicamente (landing). Dos cambios del reporte de auditoría SEO/GEO de hoy (`C:\Users\aldon\.claude\plugins\data\claude-seo-ai-claude-seo-ai\runs\scissorwhite.cl\2026-09-14T17-56-43Z\report.md`), aprobados por Aldo con autorización explícita para tocar el JSON-LD de reseñas y para agregar contenido visible nuevo.

## Contexto (estado actual, verificado en el código)

- `public/index.html` es un monolito vanilla (~4.000 líneas), sin bundler. CLAUDE.md prohíbe migrar a framework y "reescribir" (sustituir funciones) el archivo, pero editar/agregar contenido puntual no está prohibido.
- El bloque `HairSalon` JSON-LD (`public/index.html:19-69`) trae `"aggregateRating":{"@type":"AggregateRating","ratingValue":"5.0","reviewCount":"15","bestRating":"5","worstRating":"1"}` (línea 68) hardcodeado en el HTML estático. El widget visible de reseñas (`#resenas`, más abajo en el mismo archivo) arranca en `0,0` / `0 opiniones` y solo se llena si el fetch a Google Places (vía `googleReviews/main` en Firestore) responde con datos reales — la propia página ya sigue un criterio "fail-closed": no afirma un número hasta confirmarlo. El JSON-LD estático es la única pieza que no sigue ese criterio, porque nunca se actualiza (ni el cron diario `refreshGoogleReviews` ni el botón admin "Sincronizar ahora" tocan el HTML fuente — solo escriben en Firestore, y el HTML necesitaría un deploy de hosting para reflejar un cambio).
- El bloque `FAQPage` JSON-LD (`public/index.html:82-93`) trae 8 pares pregunta/respuesta que hoy son invisibles en el HTML renderizado — ningún motor de búsqueda ni sistema de IA los puede citar como texto porque nunca aparecen fuera del `<script type="application/ld+json">`. El texto de origen no lleva tildes (ej. "Donde queda", "Concepcion", "sabado", "ninos", "anos") — no queda claro si fue deliberado o un descuido, pero el resto de la página sí usa tildes correctas en todas partes, así que la versión visible debe llevarlas.
- Patrón visual reutilizable ya existente para encabezados de sección (`#nosotros`, `#servicios`, `#ubicacion`): `.s-ey` (ojo de aguja, mayúsculas), `.s-ti` (título con `<em>` en degradado), `.s-rule` (línea divisoria de 40px). `section{padding:120px 60px}` es la regla genérica que ya aplica a toda sección; no hace falta repetirla. El body usa `font-family:'Inter'` global, así que el texto de las respuestas no necesita declarar tipografía.
- No existe ningún patrón de acordeón (`<details>`/`<summary>`) en el archivo hoy — se introduce por primera vez, con estilo mínimo apoyado en tokens ya existentes (`var(--ink)`, `var(--steel-mid)`), sin colores ni tipografías nuevas.
- Orden actual de secciones: `#inicio` → `#nosotros` → `#servicios` → `#galeria` → `#partner` → `#resenas` → `#agenda` → `#ubicacion` → sección Instagram (sin id) → `<footer>`.

## Decisión

1. **`aggregateRating`:** se elimina la propiedad completa (línea 68) del bloque `HairSalon`. Nada más del bloque cambia.
2. **FAQ visible:** nueva `<section id="faq">` insertada inmediatamente después de que cierra `#ubicacion` (línea 2029) y antes del comentario `<!-- INSTAGRAM -->` (línea 2031). Usa `<details>/<summary>` (acordeón nativo, sin JS): el texto de cada respuesta queda en el DOM aunque esté visualmente colapsado, así que sigue siendo extraíble por un crawler de texto incluso cerrado — resuelve el hallazgo de la auditoría sin alargar la página para el visitante humano. El copy visible lleva tildes correctas; el JSON-LD `FAQPage` no se toca (fuera de alcance).
3. El `FAQPage` JSON-LD (líneas 82-93) permanece exactamente igual — solo se agrega la versión visible en el body, no se edita el schema.

## Diseño

### `public/index.html` — quitar `aggregateRating`

Reemplazar (línea 65-69):

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

(Se quita también la coma que quedaba después de `employee` para que el JSON siga siendo válido.)

### `public/index.html` — CSS del acordeón FAQ

Agregar, junto al resto de reglas de sección (cerca de `.s-rule`/`.s-body`, línea ~410, mismo bloque `<style>`):

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

`var(--ink)` y `var(--steel-mid)` ya existen (`:root`, líneas ~134-149). No se agrega ningún color, fuente ni breakpoint nuevo — los media queries genéricos de `section{padding:...}` (líneas 1311/1347) ya cubren esta sección sin cambios.

### `public/index.html` — sección FAQ visible

Insertar, entre el cierre de `#ubicacion` (línea 2029, `</section>`) y el comentario `<!-- INSTAGRAM -->` (línea 2031):

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

El orden y el texto de las 8 preguntas son exactamente los del `FAQPage` JSON-LD (líneas 82-93), solo con tildes y signos de interrogación de apertura restaurados — mismos hechos, mismas respuestas. El `FAQPage` JSON-LD no se modifica.

## Testing

No hay suite automatizada para `public/index.html` (es HTML/CSS/JS plano sin test runner). Verificación manual:

1. Abrir `public/index.html` en un navegador (o el sitio en staging tras el deploy) y confirmar:
   - El bloque `HairSalon` JSON-LD ya no incluye `aggregateRating` (inspeccionar el `<script type="application/ld+json">` o pegar la página en el [Rich Results Test](https://search.google.com/test/rich-results) de Google).
   - La nueva sección "Preguntas frecuentes" aparece entre Ubicación e Instagram, con las 8 preguntas colapsadas por defecto y que se expanden al hacer clic, sin JS de por medio.
   - El texto de las respuestas es legible en el DOM incluso con el `<details>` cerrado (`Ctrl+F` del navegador debe encontrar el texto de una respuesta sin necesidad de expandirla).
2. Correr `node "C:/Users/aldon/.claude/plugins/cache/claude-seo-ai/claude-seo-ai/0.2.0/scripts/validate-jsonld.mjs"` y `check-answerblocks.mjs` contra un snapshot nuevo del archivo para confirmar que `M5.jsonld.aggregaterating_unverified` y `M11.passage.faq_content_schema_only` ya no aparecen en un re-run de la auditoría (no bloqueante para este plan, pero es la forma de cerrar el loop con `/claude-seo-ai:compare`).

## Fuera de alcance

- El `FAQPage` JSON-LD (líneas 82-93) — no se edita, solo se refleja su contenido en el body.
- El resto del módulo de reseñas de Google (`#resenas`, `syncGoogleReviews`, `refreshGoogleReviews`, la nota HTML sobre "afirmaciones que destruyen confianza") — nada de eso cambia.
- Bios de Esteban y Ariel, mover el script inline de 52 KB, conversión de `hero.jpg` a WebP — pendientes de decisiones/contenido aparte, se resuelven en specs separados.
- Otros hallazgos de la misma auditoría (nodo `WebSite` faltante, duplicado `Organization`/`HairSalon` sin `@graph`, breadcrumb roto, `<main>` faltante, `og:image` bajo 1200×630, `Offer.url` faltante) — no pedidos en este goal.
