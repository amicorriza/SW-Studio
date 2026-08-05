# Vista de Lista en Agenda (admin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar una vista de lista (tabla plana, ordenable por columna) a la Agenda del panel admin, alternable con la línea de tiempo por día ya existente, para poder ver/editar/eliminar próximas citas más rápido que con la línea de tiempo.

**Architecture:** Todo el cambio vive en `public/index.html` (HTML + CSS + JS inline, sin build step, sin framework). Se reutilizan `getBookings()`, `openBookingModal()`, el flujo de borrado ya existente (`openDel` + `saveBookings`), y el patrón visual de tabla que ya usa la sección Clientes (`.a-t`/`.a-tw`/`.a-tag`/`.a-tacts`). No hay cambios en Firestore, `firestore.rules` ni Cloud Functions.

**Tech Stack:** HTML/CSS/JS vanilla (ES2015, sin transpilar), Firebase Hosting + Firestore (SDK modular vía `public/js/data.js`).

**Nota sobre testing:** el panel admin no tiene suite de tests automatizada (es JS vanilla embebido en un único HTML, sin test runner de frontend — confirmado: no hay ningún archivo de test que referencie funciones de `index.html`; los tests existentes son solo para `functions/` y `firestore.rules`). Por eso, cada tarea de este plan reemplaza el paso clásico "run automated test" por una verificación manual concreta en el navegador (usando el emulador de Firebase Hosting, `firebase emulators:start`), tal como ya especifica la sección "Testing" de la spec. Esto sigue el patrón ya establecido en el código, no introduce un framework de testing nuevo para un solo feature.

**Spec de referencia:** `docs/superpowers/specs/2026-07-30-agenda-lista-vista-design.md`

---

## Antes de empezar

- [ ] **Paso 0: Confirmar que el emulador de Firebase levanta el sitio**

Run: `firebase emulators:start --only hosting,firestore,auth,functions`
Expected: consola muestra `✔  hosting: Local server: http://localhost:5000` (y el resto de emuladores en verde). Dejar corriendo en una terminal aparte durante todo el plan — cada tarea lo usa para verificar en `http://localhost:5000`.

Nota: el login del panel admin (botón ⬡ en el footer del sitio) requiere una cuenta real de Firebase Auth ya existente para este proyecto. Este plan no crea usuarios de prueba — usa las credenciales de administrador que ya tengas.

---

### Task 1: Maquetar el interruptor Día/Lista y el contenedor de la vista de Lista

**Files:**
- Modify: `public/index.html` (CSS ~línea 3957, HTML del panel `adm-p-calendar` ~líneas 3350-3371)

- [ ] **Step 1: Agregar los estilos CSS del toggle y de la tabla de lista**

Buscar en `public/index.html` esta línea (dentro del bloque `/* ═══ AGENDA / CALENDAR ═══ */`):

```css
.a-bk-filter{margin-left:auto}
.a-bk-filter select{padding:7px 10px;font-size:12px}
```

Reemplazar por (agrega las reglas nuevas, sin tocar las dos líneas existentes):

```css
.a-bk-filter{margin-left:auto}
.a-bk-filter select{padding:7px 10px;font-size:12px}

/* View toggle (Día / Lista) */
.a-vtoggle{display:flex;background:var(--a-off);border:1.5px solid var(--a-g2);border-radius:8px;overflow:hidden;flex-shrink:0}
.a-vtoggle button{font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:8px 13px;border:none;background:transparent;color:var(--a-meta);cursor:pointer;transition:all .18s}
.a-vtoggle button.a-on{background:var(--a-ink);color:#fff}

/* List view */
#a-bk-list-controls{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
#a-bk-list-controls input{flex:1;min-width:200px}
#a-bk-list-controls select{max-width:200px}
.a-sortable{cursor:pointer;user-select:none}
.a-sortable:hover{color:var(--a-txt)}
.a-sort-arrow{margin-left:4px;opacity:.5;display:inline-block;min-width:9px}
.a-sort-arrow.a-sort-active{opacity:1}
```

- [ ] **Step 2: Agregar el botón de toggle en el header de la Agenda**

Buscar:

```html
          <div id="a-bk-alert" class="a-alert"></div>
          <div class="a-sh">
            <div><div class="a-st">Agenda de Citas</div><div class="a-ss">Gestiona, mueve y reasigna reservas</div></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="a-btn a-btn-p" id="a-bk-new">+ Nueva cita</button>
            </div>
          </div>
```

Reemplazar por:

```html
          <div id="a-bk-alert" class="a-alert"></div>
          <div class="a-sh">
            <div><div class="a-st">Agenda de Citas</div><div class="a-ss">Gestiona, mueve y reasigna reservas</div></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <div class="a-vtoggle">
                <button type="button" id="a-bk-view-day" class="a-on">📅 Día</button>
                <button type="button" id="a-bk-view-list">☰ Lista</button>
              </div>
              <button class="a-btn a-btn-p" id="a-bk-new">+ Nueva cita</button>
            </div>
          </div>
```

- [ ] **Step 3: Envolver la vista Día y agregar el contenedor de la vista Lista**

Buscar:

```html
          <!-- Date navigation -->
          <div id="a-bk-nav">
            <button class="a-cdn" id="a-bk-prev">◀</button>
            <div id="a-bk-date-lbl"></div>
            <button class="a-cdn" id="a-bk-next">▶</button>
            <button class="a-cdn a-cdn-today" id="a-bk-today">Hoy</button>
            <div class="a-bk-filter">
              <select class="a-in" id="a-bk-filter-barber" style="max-width:200px">
                <option value="">Todos los barberos</option>
              </select>
            </div>
          </div>
          <!-- Day timeline view -->
          <div id="a-bk-timeline"></div>
        </div>
```

Reemplazar por:

```html
          <div id="a-bk-day-view">
            <!-- Date navigation -->
            <div id="a-bk-nav">
              <button class="a-cdn" id="a-bk-prev">◀</button>
              <div id="a-bk-date-lbl"></div>
              <button class="a-cdn" id="a-bk-next">▶</button>
              <button class="a-cdn a-cdn-today" id="a-bk-today">Hoy</button>
              <div class="a-bk-filter">
                <select class="a-in" id="a-bk-filter-barber" style="max-width:200px">
                  <option value="">Todos los barberos</option>
                </select>
              </div>
            </div>
            <!-- Day timeline view -->
            <div id="a-bk-timeline"></div>
          </div>
          <!-- List view -->
          <div id="a-bk-list-view" style="display:none">
            <div id="a-bk-list-controls">
              <input class="a-in" id="a-bk-list-search" placeholder="🔍 Buscar por nombre de cliente...">
              <select class="a-in" id="a-bk-list-filter-barber">
                <option value="">Todos los barberos</option>
              </select>
            </div>
            <div class="a-tw">
              <table class="a-t">
                <thead>
                  <tr>
                    <th class="a-sortable" data-sort="day">Día<span class="a-sort-arrow" data-arrow="day"></span></th>
                    <th class="a-sortable" data-sort="time">Hora<span class="a-sort-arrow" data-arrow="time"></span></th>
                    <th class="a-sortable" data-sort="name">Cliente<span class="a-sort-arrow" data-arrow="name"></span></th>
                    <th class="a-sortable" data-sort="svc">Servicio<span class="a-sort-arrow" data-arrow="svc"></span></th>
                    <th class="a-sortable" data-sort="barber">Barbero<span class="a-sort-arrow" data-arrow="barber"></span></th>
                    <th class="a-sortable" data-sort="price">Precio<span class="a-sort-arrow" data-arrow="price"></span></th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody id="a-bk-list-body"></tbody>
              </table>
            </div>
          </div>
        </div>
```

- [ ] **Step 4: Verificación manual**

Run: `firebase emulators:start --only hosting,firestore,auth,functions` (si no sigue corriendo del Paso 0), abrir `http://localhost:5000`, hacer clic en el ⬡ del footer, iniciar sesión de admin, ir a "Agenda".
Expected: se ven los dos botones "📅 Día" / "☰ Lista" junto a "+ Nueva cita", con "Día" resaltado. La línea de tiempo sigue funcionando exactamente igual que antes (navegación de fecha, filtro de barbero, tarjetas de citas). Los botones del toggle todavía **no hacen nada al hacer clic** — eso se conecta en la Tarea 2. No debe haber errores nuevos en la consola del navegador.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(agenda): maquetar toggle Día/Lista y contenedor de vista de lista"
```

---

### Task 2: Estado de sesión, filtro de barbero compartido y toggle funcional

**Files:**
- Modify: `public/index.html` (variables de sesión ~línea 4306, función `renderCalendar` ~línea 4594-4606, listener de `a-bk-filter-barber` ~línea 4591)

- [ ] **Step 1: Agregar las variables de sesión de la vista de lista**

Buscar:

```js
var bkDate = new Date(); bkDate.setHours(0,0,0,0);
var bkFilter = '';
```

Reemplazar por:

```js
var bkDate = new Date(); bkDate.setHours(0,0,0,0);
var bkFilter = '';
var bkView = 'day';
var bkListSearch = '';
var bkListSortKey = 'day';
var bkListSortDir = 'asc';
```

- [ ] **Step 2: Extraer el poblado del `<select>` de barbero a una función compartida**

Buscar (dentro de `function renderCalendar(){...}`):

```js
  // Update barber filter options
  var sel = g('a-bk-filter-barber');
  var curVal = sel.value;
  sel.innerHTML = '<option value="">Todos los barberos</option>' +
    D.staff.filter(function(s){return s.status==='active'}).map(function(s){
      return '<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>';
    }).join('');
  sel.value = curVal;
```

Reemplazar por:

```js
  // Update barber filter options
  renderBarberFilterOptions(g('a-bk-filter-barber'));
```

Justo antes de `function renderCalendar(){`, agregar la nueva función compartida:

```js
function renderBarberFilterOptions(sel){
  var curVal = sel.value;
  sel.innerHTML = '<option value="">Todos los barberos</option>' +
    D.staff.filter(function(s){return s.status==='active'}).map(function(s){
      return '<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>';
    }).join('');
  sel.value = curVal;
}

function renderCalendar(){
```

- [ ] **Step 3: Sincronizar el filtro de barbero entre la vista Día y la vista Lista**

Buscar:

```js
g('a-bk-filter-barber').addEventListener('change', function(){ bkFilter = this.value; renderCalendar(); });
```

Reemplazar por:

```js
function onBarberFilterChange(val){
  bkFilter = val;
  g('a-bk-filter-barber').value = val;
  g('a-bk-list-filter-barber').value = val;
  renderCalendar();
  renderBookingList();
}
g('a-bk-filter-barber').addEventListener('change', function(){ onBarberFilterChange(this.value); });
g('a-bk-list-filter-barber').addEventListener('change', function(){ onBarberFilterChange(this.value); });
```

- [ ] **Step 4: Agregar el toggle de vista (con una versión temporal de `renderBookingList`)**

Inmediatamente después del bloque agregado en el Step 3, agregar:

```js
function renderBookingList(){
  // Implementación completa en la Tarea 3 — por ahora solo mantiene
  // sincronizado el select de barbero de la vista Lista.
  renderBarberFilterOptions(g('a-bk-list-filter-barber'));
}

function setBkView(view){
  bkView = view;
  g('a-bk-view-day').classList.toggle('a-on', view==='day');
  g('a-bk-view-list').classList.toggle('a-on', view==='list');
  g('a-bk-day-view').style.display = view==='day' ? '' : 'none';
  g('a-bk-list-view').style.display = view==='list' ? '' : 'none';
  if(view==='list') renderBookingList();
}
g('a-bk-view-day').addEventListener('click', function(){ setBkView('day'); });
g('a-bk-view-list').addEventListener('click', function(){ setBkView('list'); });
```

- [ ] **Step 5: Verificación manual**

Recargar `http://localhost:5000` (admin ya logueado), ir a Agenda.
Expected: clic en "☰ Lista" oculta la línea de tiempo y muestra la tabla vacía (sin filas todavía, eso es normal — se implementa en la Tarea 3) con el botón "Lista" resaltado y el filtro de barbero visible arriba de la tabla. Clic en "📅 Día" vuelve a mostrar la línea de tiempo con "Día" resaltado. Cambiar el filtro de barbero en la vista Día y volver a Lista debe mostrar el mismo barbero seleccionado en el filtro de Lista (y viceversa). Sin errores nuevos en consola.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat(agenda): estado de sesión y toggle funcional Día/Lista"
```

---

### Task 3: Implementar `renderBookingList` — filtro, orden por defecto y filas

**Files:**
- Modify: `public/index.html` (reemplaza el stub de `renderBookingList` agregado en la Tarea 2; `function renderBookingsViews` ~línea 4494)

- [ ] **Step 1: Reemplazar el stub por la implementación completa**

Buscar (el stub agregado en la Tarea 2, Step 4):

```js
function renderBookingList(){
  // Implementación completa en la Tarea 3 — por ahora solo mantiene
  // sincronizado el select de barbero de la vista Lista.
  renderBarberFilterOptions(g('a-bk-list-filter-barber'));
}
```

Reemplazar por:

```js
function renderBookingList(){
  renderBarberFilterOptions(g('a-bk-list-filter-barber'));

  var now = new Date();
  var q = bkListSearch.toLowerCase().trim();
  var rows = getBookings()
    .map(function(b){
      var dt = parseDt(b.date ? b.date.substring(0,10) : '', b.time);
      var dtDay = b.date ? parseYmd(b.date.substring(0,10)) : null;
      return {bk:b, dt:dt, dtDay:dtDay};
    })
    .filter(function(e){
      if(!e.dt || e.dt < now) return false;
      if(bkFilter && e.bk.barberId !== bkFilter) return false;
      if(q && (e.bk.name||'').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });

  var CMP = {
    day: function(a,b){ return a.dtDay - b.dtDay; },
    time: function(a,b){ return (a.bk.time||'').localeCompare(b.bk.time||''); },
    name: function(a,b){ return (a.bk.name||'').localeCompare(b.bk.name||'', 'es'); },
    svc: function(a,b){ return (a.bk.svcName||'').localeCompare(b.bk.svcName||'', 'es'); },
    barber: function(a,b){ return (a.bk.barberName||'').localeCompare(b.bk.barberName||'', 'es'); },
    price: function(a,b){ return (a.bk.price||0) - (b.bk.price||0); }
  };
  rows.sort(function(a,b){
    var r = CMP[bkListSortKey](a,b);
    if(bkListSortDir === 'desc') r = -r;
    if(r !== 0) return r;
    return a.dt - b.dt; // criterio secundario estable
  });

  // Indicador visual de la columna/dirección activa
  document.querySelectorAll('#a-bk-list-view .a-sort-arrow').forEach(function(span){
    span.classList.remove('a-sort-active');
    span.textContent = '';
  });
  var activeArrow = document.querySelector('#a-bk-list-view .a-sort-arrow[data-arrow="'+bkListSortKey+'"]');
  if(activeArrow){
    activeArrow.classList.add('a-sort-active');
    activeArrow.textContent = bkListSortDir === 'asc' ? '▲' : '▼';
  }

  var body = g('a-bk-list-body');
  if(!rows.length){
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888;padding:30px">' +
      (q ? 'Sin resultados para tu búsqueda.' : 'Sin citas próximas.') +
      '</td></tr>';
    return;
  }

  body.innerHTML = rows.map(function(e){
    var b = e.bk;
    var dayStr = e.dtDay ? e.dtDay.toLocaleDateString('es-CL') : '—';
    var overTag = b.over ? ' <span class="a-bk-card-over-tag">Sobrecupo</span>' : '';
    return '<tr data-code="'+esc(b.code)+'">' +
      '<td>'+esc(dayStr)+'</td>' +
      '<td>'+esc(b.time||'')+'</td>' +
      '<td><div class="a-tn">'+esc(b.name||'Cliente')+'</div>'+overTag+'</td>' +
      '<td>'+esc(b.svcName||'')+'</td>' +
      '<td>'+esc(b.barberName||'')+'</td>' +
      '<td>'+fmtCLP(b.price)+'</td>' +
      '<td><div class="a-tacts">' +
        '<button class="a-btn a-btn-g" data-lst-edit="'+esc(b.code)+'" style="padding:5px 9px;font-size:9px">✎</button>' +
        '<button class="a-btn a-btn-danger" data-lst-del="'+esc(b.code)+'" style="padding:5px 8px;font-size:9px">✕</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');

  body.querySelectorAll('tr[data-code]').forEach(function(row){
    row.addEventListener('click', function(e){
      if(e.target.closest('.a-tacts')) return;
      var bk = getBookings().find(function(x){return x.code===row.dataset.code});
      if(bk) openBookingModal(bk);
    });
  });
  body.querySelectorAll('[data-lst-edit]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var bk = getBookings().find(function(x){return x.code===btn.dataset.lstEdit});
      if(bk) openBookingModal(bk);
    });
  });
  body.querySelectorAll('[data-lst-del]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var code = btn.dataset.lstDel;
      openDel('¿Eliminar esta cita? Esta acción no se puede deshacer.', function(){
        var bookings = getBookings().filter(function(b){return b.code !== code});
        saveBookings(bookings);
        log('Eliminó cita', code);
        showAlert('a-bk-alert','ok','Cita eliminada.');
      });
    });
  });
}
```

- [ ] **Step 2: Mantener la Lista sincronizada con Firestore en tiempo real**

Buscar:

```js
function renderBookingsViews(){
  renderDash(); renderStats(); renderCalendar(); updateBadges();
}
```

Reemplazar por:

```js
function renderBookingsViews(){
  renderDash(); renderStats(); renderCalendar(); renderBookingList(); updateBadges();
}
```

- [ ] **Step 3: Verificación manual**

Recargar el admin, ir a Agenda → Lista.
Expected: si ya hay citas próximas cargadas (creadas antes en la vista Día, con "+ Nueva cita"), aparecen como filas ordenadas por Día y luego Hora ascendente, con las 7 columnas correctas y el precio formateado (ej. `$18.000`). Una cita marcada "Sobrecupo" muestra el tag junto al nombre. Clic en una fila (o en ✎) abre el modal de edición con los datos correctos; guardar un cambio ahí actualiza la fila en la Lista sin recargar la página. Clic en ✕ pide confirmación y, al confirmar, la reserva desaparece tanto de la Lista como de la línea de tiempo. Si no hay ninguna próxima cita, se ve el mensaje "Sin citas próximas." Los encabezados de columna todavía no reordenan al hacer clic (Tarea 4) ni el buscador filtra (Tarea 4).

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat(agenda): renderizar filas de la vista de lista con orden por defecto y acciones"
```

---

### Task 4: Orden interactivo por cabecera y buscador de cliente

**Files:**
- Modify: `public/index.html` (agrega listeners cerca de donde termina `renderBookingList`)

- [ ] **Step 1: Agregar los listeners de clic en cabecera y de búsqueda**

Buscar el cierre de la función `renderBookingList` agregada en la Tarea 3 (la línea `}` que sigue inmediatamente después del bloque `body.querySelectorAll('[data-lst-del]')...` del Step 1 de la Tarea 3), y agregar justo después:

```js
document.querySelectorAll('#a-bk-list-view th[data-sort]').forEach(function(th){
  th.addEventListener('click', function(){
    var key = th.dataset.sort;
    if(bkListSortKey === key){
      bkListSortDir = bkListSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      bkListSortKey = key;
      bkListSortDir = 'asc';
    }
    renderBookingList();
  });
});

g('a-bk-list-search').addEventListener('input', function(e){
  bkListSearch = e.target.value;
  renderBookingList();
});
```

- [ ] **Step 2: Verificación manual**

Con al menos 3-4 citas de prueba en distintos días/horas/barberos/precios (crear las que falten con "+ Nueva cita" para tener datos variados), en la vista Lista:
- Clic en "Día" una vez → filas ascendentes por fecha, flecha ▲ junto a "Día". Clic de nuevo → descendente, flecha ▼.
- Clic en "Cliente" → orden alfabético por nombre; clic de nuevo → alfabético inverso.
- Clic en "Precio" → orden numérico ascendente/descendente.
- Escribir parte del nombre de un cliente en el buscador → la tabla se filtra a esas filas; borrar el texto → vuelven todas.
- Combinar filtro de barbero + búsqueda → se aplican ambos a la vez (AND).
- Confirmar que una cita con fecha/hora ya pasada no aparece en ningún caso.

Expected: todo lo anterior se comporta como se describe, sin errores en consola.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(agenda): orden por cabecera y buscador de cliente en la vista de lista"
```

---

### Task 5: Verificación final end-to-end

**Files:** ninguno (solo verificación; no se espera código nuevo salvo fixes puntuales que surjan)

- [ ] **Step 1: Recorrido completo en el emulador**

Con el emulador corriendo (`firebase emulators:start --only hosting,firestore,auth,functions`), repetir de punta a punta el checklist de la sección "Testing" de la spec (`docs/superpowers/specs/2026-07-30-agenda-lista-vista-design.md`):

1. Crear 4-5 citas de prueba en distintos días/horas/barberos/precios (incluyendo una marcada "Sobrecupo").
2. Alternar Día → Lista → Día: la línea de tiempo funciona exactamente igual que antes de este plan.
3. En Lista: aparecen todas las próximas citas (no solo las de "hoy"), ordenadas por Día/Hora ascendente por defecto.
4. Clic en cada cabecera ordenable una vez (asc) y dos veces (desc): Día, Cliente, Servicio, Barbero, Precio.
5. Filtrar por barbero y buscar por nombre de cliente combinados.
6. Editar una cita desde la Lista y confirmar que se actualiza sin recargar.
7. Eliminar una cita desde la Lista y confirmar que desaparece de ambas vistas.
8. Confirmar que una cita ya pasada no aparece en la Lista.

Expected: los 8 puntos pasan sin errores de consola ni comportamiento inesperado.

- [ ] **Step 2: Si algo falla, corregir y volver a commitear**

Si algún punto del checklist falla, arreglar el código correspondiente en `public/index.html`, repetir el punto que falló, y commitear el fix por separado (no amend de commits anteriores):

```bash
git add public/index.html
git commit -m "fix(agenda): <describir el fix puntual>"
```

- [ ] **Step 3: Detener el emulador**

Run: `Ctrl+C` en la terminal donde corre `firebase emulators:start` (o cerrar esa terminal).
