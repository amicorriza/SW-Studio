(function(){
// ═══════════════════════════════════════
// DATA — catálogo de servicios SW Studio
// Los arreglos de abajo son solo el fallback inicial: en cuanto Firestore
// responde (refreshCatalog), CATS y BARBERS se reemplazan con los datos
// reales del admin (colecciones `services` y `staff`, filtradas por activo).
// ═══════════════════════════════════════
let CATS = [
  {id:'a', name:'Asesorías', items:[
    {id:'vis', name:'Asesoría con VISAGISMO', dur:120, price:55000, tag:'Premium', ts:'s',
     desc:'Servicio premium de asesoría personalizada en imagen. Analizamos tu rostro y estilo de vida para recomendarte el corte ideal mediante visagismo. Incluye corte de cabello, perfilado de cejas, masaje, lavado capilar, cómo peinar tu corte y una cortesía a elección. El objetivo es que te veas bien y que el corte sea fácil de mantener en tu día a día.'},
    {id:'vis-b', name:'Asesoría con VISAGISMO + Barba simple', dur:120, price:65000, tag:'Premium', ts:'s',
     desc:'Experiencia completa de barbería. Asesoría personalizada aplicando visagismo en corte y barba, adaptando el estilo según tu perfil facial, mentón y nariz para lograr mayor equilibrio y definición.'}
  ]},
  {id:'c', name:'Corte de cabello', items:[
    {id:'adulto', name:'Corte de cabello adulto', dur:60, price:18000,
     desc:'Corte según tu estilo, perfilado de ceja, lavado con masaje capilar y asesoría exprés de cómo peinarte y qué producto usar. Cortesía a elección incluida.'},
    {id:'nino', name:'Corte de cabello niño (2-10 años)', dur:45, price:16000,
     desc:'Corte especializado para los más pequeños, con paciencia y atención al detalle.'},
    {id:'lavado-p', name:'Corte de cabello + lavado premium', dur:50, price:21000,
     desc:'Nuestro lavado premium incluye limpieza profunda con Reuzel Daily Shampoo, seguido de una exfoliación capilar con Reuzel Scrub Shampoo para eliminar residuos, grasa y células muertas, dejando el cuero cabelludo limpio y revitalizado. Finalizamos con Reuzel Daily Conditioner, que hidrata, suaviza y aporta brillo al cabello.'},
    {id:'tj-b', name:'Corte con tijeras + barba simple', dur:70, price:35000,
     desc:'Corte trabajado con tijera y textura, más perfilado y definición de barba.'},
    {id:'tijeras', name:'Corte con tijeras (longitud media/larga)', dur:60, price:25000,
     desc:'Incluye todo tipo de cortes con tijera y textura, como mullet, moicano, mod cut, shaggy y warrior cut, adaptados a tu estilo. Servicio completo con cortesía a elección, lavado de cabello, masaje capilar y perfilado de cejas.'},
    {id:'cb', name:'Corte de cabello + barba simple', dur:60, price:23000,
     desc:'Combo clásico: corte de cabello completo más perfilado y definición de barba.'},
    {id:'tj-bt', name:'Corte con tijeras + perfilado de barba con toallas caliente', dur:90, price:40000,
     desc:'Corte trabajado con tijeras más perfilado de barba con ritual de toallas calientes. La experiencia más completa del estudio.'},
    {id:'cb-tc', name:'Corte de cabello + barba toallas calientes', dur:75, price:30000,
     desc:'Corte de cabello más perfilado de barba premium con ritual de toallas calientes.'},
    {id:'uc-m', name:'Undercut mujer', dur:35, price:8000,
     desc:'Degradado de nuca y rapados con diseño, que realzan tu estilo y actitud. Un acabado moderno, prolijo y hecho a tu medida.'}
  ]}
];

let BARBERS = [
  {id:'victoria', name:'Victoria', init:'V', role:'Barbera Senior · Visagismo', photo:'/assets/barbero-victoria.jpg'}
];

// ══ CATÁLOGO DESDE FIRESTORE ══
// Reemplaza CATS/BARBERS con los datos reales del admin. Se llama en cada
// apertura del widget para que altas/bajas/eliminaciones se reflejen sin
// recargar la página. Si la lectura falla (offline, emulador caído) se
// conserva el último catálogo bueno.
const CAT_NAMES = {a:'Asesorías', c:'Corte de cabello', b:'Barba'};
async function refreshCatalog(){
  if(!window.SWData) return;
  const { services, staff, tz, bufferMin } = await window.SWData.loadCatalog();
  // BUSINESS_TZ/TODAY/TODAY_KEY/MAX_DATE arrancan en DEFAULT_TZ (ver más
  // abajo) y se corrigen acá a la zona real del negocio en cuanto Firestore
  // responde -- `tz` puede venir ausente (negocio recién configurado, o
  // businessInfo/main de antes de Fase 2), de ahí el fallback. Mismo criterio
  // para `bufferMin`.
  BUSINESS_TZ = tz || DEFAULT_TZ;
  BUSINESS_BUFFER_MIN = Number.isFinite(bufferMin) ? bufferMin : DEFAULT_BUFFER_MIN;
  TODAY_KEY = dateKeyInZone(new Date(), BUSINESS_TZ);
  TODAY = dateKeyToDate(TODAY_KEY);
  MAX_DATE = new Date(TODAY); MAX_DATE.setMonth(MAX_DATE.getMonth()+2);
  // El panel admin fija el orden del catálogo en el entero `s.order` (arrastrar
  // / ↑↓ en Servicios). Se respeta acá para que el widget muestre los servicios
  // en el mismo orden que ve el negocio; los que no traigan `order` (catálogo
  // viejo) caen al final conservando su orden relativo (sort estable).
  const activeSvcs = (services||[]).filter(s=>s.status==='active')
    .slice()
    .sort((a,b)=>(a.order==null?1e9:a.order)-(b.order==null?1e9:b.order));
  if(activeSvcs.length){
    CATS = Object.keys(CAT_NAMES).map(cid=>({
      id: cid, name: CAT_NAMES[cid],
      items: activeSvcs.filter(s=>s.cat===cid).map(s=>({
        id:s.id, name:s.name, dur:s.dur, price:s.price,
        tag:s.tag||'', ts:s.ts||'', desc:s.desc||'', cat:s.cat
      }))
    })).filter(c=>c.items.length);
  }
  const activeStaff = (staff||[]).filter(s=>s.status==='active');
  if(activeStaff.length){
    BARBERS = [
      ...activeStaff.map(b=>({
        id:b.id, name:b.name,
        init:(b.name&&b.name[0]||'?').toUpperCase(),
        role:b.role||'Barbero',
        photo:b.photo||'',
        // schedule[dow] (0=Dom..6=Sáb): {open,start,end}|null|undefined.
        // Usado por hoursRangeFor() para que el calendario/horarios respeten
        // el horario propio de este barbero en vez del HOURS genérico.
        schedule: b.schedule||null
      }))
    ];
  }
}

const HOURS = {1:[10,20],2:[10,20],3:[10,20],4:[10,20],5:[10,20],6:[10,17],0:null};
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// 'HH:MM' -> minutos desde medianoche. Mismo criterio que
// functions/shared/availability.js#toMinutes (no se puede importar acá:
// este <script> es plano, sin bundler).
function toMin(hhmm){
  const parts=String(hhmm||'0:0').split(':');
  return (parseInt(parts[0],10)||0)*60+(parseInt(parts[1],10)||0);
}

// Rango de minutos abiertos [inicio,fin) de un día (dow=Date.getDay(),
// 0=Dom..6=Sáb), o null si está cerrado. Preferencia (según 4b del plan):
// - Si hay un barbero específico elegido (no 'any') y trae `schedule`
//   cargado (de refreshCatalog/Firestore), se usa schedule[dow] tal cual.
// - Si no ('any', sin barbero elegido aún, o el barbero no trae schedule
//   -p.ej. quedó en el arreglo de respaldo sin Firestore-), se usa el
//   horario general HOURS como fallback.
function hoursRangeFor(dow, barber){
  if(barber && !barber.any && Array.isArray(barber.schedule)){
    const day=barber.schedule[dow];
    if(!day || !day.open) return null;
    return [toMin(day.start), toMin(day.end)];
  }
  const h=HOURS[dow];
  return h ? [h[0]*60, h[1]*60] : null;
}

// ══ ZONA HORARIA DEL NEGOCIO ══
// Copia deliberada de dateKeyInZone()/DEFAULT_TZ en
// functions/shared/timezone.js -- este <script> es plano, sin bundler, no
// puede importar ese módulo (mismo motivo ya documentado para
// overlaps()/isRangeFree() en functions/shared/availability.js). Misma
// copia también en public/admin/index.html. Cambiar la lógica en cualquiera
// de los tres sin revisar los otros dos es el tipo de divergencia
// silenciosa que ya nos mordió con isValidBooking()/isValidBookingPayload().
//
// PRINCIPIO (Fase 2): la zona del NEGOCIO gobierna todo -- el reloj/zona del
// navegador de quien reserva no debe influir en nada. Por eso "hoy" para el
// calendario nunca sale de `new Date()` a secas: siempre pasa por acá, con
// `tz` explícito (el del negocio, cargado vía loadCatalog), nunca asumido
// del entorno del navegador.
const DEFAULT_TZ = 'America/Santiago';
const DEFAULT_BUFFER_MIN = 0;
function dateKeyInZone(instant, tz){
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit',
  }).formatToParts(instant);
  const get = t => parts.find(p=>p.type===t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
// 'YYYY-MM-DD' -> Date a medianoche LOCAL DEL NAVEGADOR de ese día calendario.
// No es una fuga de la zona del cliente: QUÉ día es ya lo resolvió
// dateKeyInZone() contra la zona del negocio -- esto solo envuelve ese día ya
// decidido en el mismo tipo de objeto que usa renderCal() para las celdas
// (new Date(y,m,d), también medianoche local), para poder compararlos.
function dateKeyToDate(dateKey){
  const [y,m,d] = dateKey.split('-').map(Number);
  return new Date(y, m-1, d);
}
// Instante real -> 'HH:MM' de pared en `tz`. Copia deliberada de
// timeKeyInZone() en functions/shared/timezone.js -- mismo motivo que las de
// arriba. Existe por un hallazgo concreto: el widget decidía qué horarios de
// "hoy" ya pasaron con la hora del NAVEGADOR de quien reserva, no la del
// negocio -- alguien reservando desde otra zona veía disponibilidad
// distinta de la real (ver su uso en renderSlots).
function timeKeyInZone(instant, tz){
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour:'2-digit', minute:'2-digit', hour12:false,
  }).formatToParts(instant);
  const get = t => parts.find(p=>p.type===t).value;
  const hour = get('hour')==='24' ? '00' : get('hour');
  return `${hour}:${get('minute')}`;
}
// 'YYYY-MM-DD' -> día de la semana (0=Dom..6=Sáb), para indexar
// staff.schedule[dow]. Zona-independiente a propósito: el día de la semana
// de una fecha calendario es el mismo mirado desde cualquier zona -- no hay
// ningún `tz` que pasarle. Mismo criterio que createBooking.js en el
// servidor.
function dowOfDateKey(dateKey){
  return new Date(dateKey+'T00:00:00Z').getUTCDay();
}

// STATE
let S = {step:1, svc:null, barber:null, date:null, time:null, club:'member'};
let calCursor = new Date(); calCursor.setDate(1);
// Arrancan con DEFAULT_TZ (mismo espíritu que el fallback inicial de
// CATS/BARBERS más arriba) -- refreshCatalog() los corrige a la zona real
// del negocio en cuanto responde Firestore. TODAY_KEY es la versión string
// de TODAY (para comparar contra S.date, que ahora es string -- ver
// renderSlots); BUSINESS_TZ queda disponible para timeKeyInZone() en el
// mismo lugar.
let BUSINESS_TZ = DEFAULT_TZ;
let BUSINESS_BUFFER_MIN = DEFAULT_BUFFER_MIN;
let TODAY_KEY = dateKeyInZone(new Date(), BUSINESS_TZ);
let TODAY = dateKeyToDate(TODAY_KEY);
let MAX_DATE = new Date(TODAY); MAX_DATE.setMonth(MAX_DATE.getMonth()+2);

// Disponibilidad real en tiempo real, vía subscribeAvailability (onSnapshot
// sobre la vista materializada `availability/{fecha}` -- ver
// functions/index.js:onBookingWritten). AVAIL es el último snapshot recibido
// (o el resultado "todo disponible" del fail-open):
// {barberBusy:{<barberId>:[{start,end}]}}. Los barberos activos ya NO viven
// acá -- se derivan de BARBERS (ver activeBarberIds()), que el widget ya
// mantiene en vivo vía refreshCatalog(). AVAIL_LOADING indica que la
// suscripción inicial todavía no entrega su primer snapshot, para el estado
// de carga breve de renderSlots(). availUnsub guarda el "unsubscribe" de la
// suscripción vigente (se reemplaza cada vez que cambia fecha/barbero, y se
// cierra al cerrar el widget -- ver loadAvailability/closeBK).
let AVAIL = {barberBusy:{}};
let AVAIL_LOADING = false;
let availUnsub = null;
function activeBarberIds(){ return BARBERS.filter(b=>!b.any).map(b=>b.id); }

// ══ OPEN / CLOSE ══
// aria-modal="true" (ver el div arriba) no mueve el foco por sí solo -- sin
// esto, un lector de pantalla o alguien navegando por teclado quedaba con
// el foco en lo que tenía detrás del overlay. lastFocusedBK guarda qué
// tenía el foco antes de abrir para devolvérselo al cerrar.
let lastFocusedBK = null;
function openBK(){
  // El CTA del menú móvil abre el wizard: hay que cerrar el menú antes, o queda
  // abierto detrás del overlay y su cm() posterior desbloquearía el scroll.
  if(typeof cm === 'function') cm();
  lastFocusedBK = document.activeElement;
  document.getElementById('booking-overlay').style.display='flex';
  document.body.style.overflow='hidden';
  // Reset state
  S = {step:1, svc:null, barber:null, date:null, time:null};
  renderSvcs(); renderBarbers(); renderCal(); updateSummary();
  bkGoTo(1);
  var first = document.getElementById('booking-overlay').querySelector('button,input,select,textarea,[tabindex]');
  if(first) first.focus();
  // Refrescar catálogo desde Firestore y re-pintar solo lo que el usuario
  // aún no seleccionó (para no pisar una selección en curso).
  refreshCatalog().then(()=>{
    if(!S.svc) renderSvcs();
    if(!S.barber) renderBarbers();
    // TODAY puede haberse corregido de DEFAULT_TZ a la zona real del
    // negocio -- si el usuario ya eligió una fecha, no se toca (mismo
    // criterio que servicio/barbero: no pisar una selección en curso).
    if(!S.date) renderCal();
  }).catch(e=>console.error('No se pudo cargar el catálogo desde Firestore', e));
}
function closeBK(){
  document.getElementById('booking-overlay').style.display='none';
  document.body.style.overflow='';
  if(availUnsub){ availUnsub(); availUnsub=null; }
  if(lastFocusedBK && document.body.contains(lastFocusedBK)) lastFocusedBK.focus();
  lastFocusedBK = null;
}
window.closeBK = closeBK;
window.openBK = openBK;

  // ══ CLUB SW — toggle Miembro/Invitado ══
  function updateClubUI(){
    var opts = document.querySelectorAll('.bk-club-opt');
    var welcome = document.getElementById('bk-club-welcome');
    if(!opts.length) return;
    opts.forEach(function(o){
      var isSel = o.dataset.club === S.club;
      o.classList.toggle('bk-club-selected', isSel);
    });
    if(welcome){
      welcome.classList.toggle('bk-show', S.club === 'member');
    }
  }
  document.querySelectorAll('.bk-club-opt').forEach(function(o){
    o.addEventListener('click', function(){
      S.club = o.dataset.club;
      updateClubUI();
    });
  });
  // Initial UI sync
  updateClubUI();


document.getElementById('bk-backdrop').addEventListener('click', closeBK);
document.getElementById('bk-close').addEventListener('click', closeBK);
document.addEventListener('keydown', e=>{if(e.key==='Escape') closeBK()});

// Hook all "Agendar" / "reservar" buttons on the landing
function hookButtons(){
  document.querySelectorAll(
    'a[href="reservar.html"], .nav-cta, .btn-p[href="reservar.html"], .book-btn, .svc-tag, .mob a.mob-cta'
  ).forEach(el=>{
    el.addEventListener('click', e=>{
      e.preventDefault(); openBK();
    });
  });
  // Generic catch for any button with text "Agendar"
  document.querySelectorAll('a, button').forEach(el=>{
    const txt = el.textContent.trim().toLowerCase();
    if((txt==='agendar' || txt.startsWith('reservar') || txt.includes('cita') || txt.includes('agenda')) && !el.dataset.bkHooked){
      el.dataset.bkHooked='1';
      el.addEventListener('click', e=>{e.preventDefault(); openBK()});
    }
  });
}
document.addEventListener('DOMContentLoaded', hookButtons);
setTimeout(hookButtons, 500);

// ══ IMÁGENES DEL SITIO — overrides manuales desde el panel admin ══
// Cada <img data-img-slot="..."> conserva su src por defecto en /assets/;
// si el admin subió un reemplazo (colección `siteImages`), se pisa el src
// acá. Falla abierto: sin Firestore/offline, la página se ve igual que
// siempre con las imágenes por defecto.
async function applySiteImageOverrides(){
  if(!window.SWData) return;
  try{
    const overrides = await window.SWData.loadSiteImages();
    Object.keys(overrides).forEach(slot=>{
      document.querySelectorAll('[data-img-slot="'+slot+'"]').forEach(el=>{
        if(el.tagName === 'IMG') el.src = overrides[slot].url;
        else el.style.backgroundImage = "url('"+overrides[slot].url+"')";
      });
    });
  }catch(e){
    console.error('No se pudieron cargar las imágenes personalizadas del sitio', e);
  }
}
document.addEventListener('DOMContentLoaded', applySiteImageOverrides);

// ══ RESEÑAS DE GOOGLE ══
// Lee el espejo `googleReviews/main` que mantienen las Cloud Functions
// (refreshGoogleReviews diaria + syncGoogleReviews desde el panel) y dibuja la
// sección. El navegador NUNCA habla con Google acá: sin API key en el front,
// sin script de terceros, sin iframe — la sección pinta a velocidad de
// Firestore y no arrastra el tiempo de carga de la página.
//
// Falla cerrada: cualquier problema (offline, doc inexistente, perfil sin
// reseñas) deja la sección oculta. Una sección de confianza a medio dibujar
// genera exactamente lo contrario de lo que busca.
(function(){
  var MAX_CARDS = 12;

  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function fmtRating(n){
    return (Number(n) || 0).toLocaleString('es-CL', {minimumFractionDigits:1, maximumFractionDigits:1});
  }

  // Places manda `relativePublishTimeDescription` ya localizado ("hace 2
  // semanas"), así que esto es solo el respaldo para las reseñas curadas a
  // mano desde el panel, que traen fecha ISO pelada.
  function relTime(iso){
    var t = Date.parse(iso || '');
    if(!isFinite(t)) return '';
    var days = Math.floor((Date.now() - t) / 86400000);
    if(days < 1) return 'hoy';
    if(days < 7) return 'hace ' + days + (days === 1 ? ' día' : ' días');
    if(days < 31){ var w = Math.floor(days/7); return 'hace ' + w + (w === 1 ? ' semana' : ' semanas'); }
    if(days < 365){ var m = Math.floor(days/30); return 'hace ' + m + (m === 1 ? ' mes' : ' meses'); }
    var y = Math.floor(days/365);
    return 'hace ' + y + (y === 1 ? ' año' : ' años');
  }

  // El doc trae dos listas: las que devolvió Places y las curadas a mano.
  // Las de Google mandan siempre; `manualReviews` es la red de seguridad para
  // cuando el perfil todavía no tiene reseñas con texto, no hay API key
  // configurada o Google devolvió vacío. Nunca se mezclan: mostrar juntas unas
  // verificadas y otras escritas por el negocio es justamente el tipo de cosa
  // que destruye la confianza que la sección busca construir.
  function pickReviews(d){
    var api = Array.isArray(d.reviews) ? d.reviews : [];
    if(api.length) return {list: api, verified: true};
    var manual = Array.isArray(d.manualReviews) ? d.manualReviews : [];
    return {list: manual, verified: false};
  }

  function starsHtml(rating, small){
    var pct = Math.max(0, Math.min(100, (Number(rating) || 0) / 5 * 100));
    return '<span class="gr-stars' + (small ? ' sm' : '') + '" role="img" aria-label="' +
      fmtRating(rating) + ' de 5">' +
      '<span class="gr-stars-fill" style="width:' + pct.toFixed(2) + '%"></span></span>';
  }

  function avatarHtml(r){
    var ini = (r.author || '?').trim().charAt(0).toUpperCase();
    if(!r.photo) return '<span class="gr-av-ini" aria-hidden="true">' + esc(ini) + '</span>';
    // referrerpolicy no-referrer: las fotos de perfil viven en
    // lh3.googleusercontent.com y responden 403 a algunos referers. El onerror
    // cambia a la inicial en vez de dejar el icono de imagen rota.
    return '<img class="gr-av" src="' + esc(r.photo) + '" alt="" loading="lazy" decoding="async"' +
      ' referrerpolicy="no-referrer"' +
      ' onerror="this.outerHTML=\'<span class=&quot;gr-av-ini&quot; aria-hidden=&quot;true&quot;>' + esc(ini) + '</span>\'">';
  }

  var G_MARK = '<svg class="gr-src" width="15" height="15" viewBox="0 0 48 48" aria-hidden="true" focusable="false">' +
    '<path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>' +
    '<path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>' +
    '<path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>' +
    '<path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg>';

  // `dup` marca la copia de la marquesina: se esconde de lectores de pantalla
  // y se saca del orden de tabulación, para que las mismas cinco reseñas no se
  // anuncien ni se recorran dos veces.
  function cardHtml(r, verified, dup){
    var when = r.relativeTime || relTime(r.publishTime);
    var name = esc(r.author || 'Cliente de Google');
    var nameHtml = (r.profileUri && !dup)
      ? '<a class="gr-name" href="' + esc(r.profileUri) + '" target="_blank" rel="noopener nofollow">' + name + '</a>'
      : '<span class="gr-name">' + name + '</span>';
    var text = esc(r.text || '');
    return '<article class="gr-card"' + (dup ? ' aria-hidden="true"' : '') + '>' +
      '<div class="gr-card-top">' + avatarHtml(r) +
        '<div class="gr-who">' + nameHtml +
          (when ? '<span class="gr-when">' + esc(when) + '</span>' : '') +
        '</div>' + (verified ? G_MARK : '') +
      '</div>' +
      starsHtml(r.rating, true) +
      '<p class="gr-text">' + text + '</p>' +
      // El botón solo aparece si el texto probablemente se corta (5 líneas ~
      // 320 caracteres). Ponerlo siempre dejaría "Leer más" bajo reseñas de
      // dos líneas, que ya se leen enteras.
      (text.length > 320 ? '<button class="gr-more" type="button"' + (dup ? ' tabindex="-1"' : '') + '>Leer más</button>' : '') +
      (r.translated && r.originalText
        ? '<p class="gr-orig">Original: ' + esc(r.originalText) + '</p>' : '') +
    '</article>';
  }

  // Sube un número de 0 al valor real cuando la sección entra en pantalla.
  // Es el único movimiento "gratis" de la sección: cuesta nada y hace que el
  // puntaje se lea como un dato que se está calculando, no como texto fijo.
  function countUp(el, target, format){
    var reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    if(reduce){ el.textContent = format(target); return; }
    var start = performance.now(), dur = 1100;
    function step(now){
      var p = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = format(target * eased);
      if(p < 1) requestAnimationFrame(step);
      else el.textContent = format(target);
    }
    requestAnimationFrame(step);
  }

  function render(d){
    var picked = pickReviews(d);
    var list = picked.list.slice(0, MAX_CARDS);
    var rating = Number(d.rating) || 0;
    var count = Number(d.userRatingCount) || 0;

    // Sin puntaje Y sin reseñas no hay nada que probar: la sección no se
    // muestra. Con puntaje pero sin texto (perfil con estrellas y ningún
    // comentario) sí vale la pena: el panel de puntaje solo ya es prueba.
    if(!rating && !list.length) return;

    var sec = document.getElementById('resenas');
    if(!sec) return;

    var see = document.getElementById('gr-see');
    var write = document.getElementById('gr-write');
    var mapsUri = d.googleMapsUri || 'https://maps.google.com/?q=Cochrane+635+Torre+B+Concepci%C3%B3n+Chile';
    see.href = mapsUri;
    see.setAttribute('aria-label', 'Ver el perfil de Google de SW Studio con las ' + count + ' opiniones');
    if(d.writeReviewUri) write.href = d.writeReviewUri;
    else write.hidden = true;

    var starsFill = document.getElementById('gr-stars-fill');
    var starsBox = document.getElementById('gr-stars');
    starsBox.setAttribute('aria-label', fmtRating(rating) + ' de 5 estrellas en Google');

    // El total de opiniones del perfil (`count`) es un número distinto de la
    // cantidad de tarjetas: Places entrega como máximo 5 reseñas con texto,
    // pero el promedio resume todas. Se comunica así a propósito.
    var countEl = document.getElementById('gr-count');
    var ratingEl = document.getElementById('gr-rating');
    if(!count) document.querySelector('.gr-score-lbl').innerHTML = 'de puntaje en Google';

    // Modo respaldo: las tarjetas son las reseñas curadas en el panel, no las
    // que devolvió Google. Decir "4,9 sobre 137 opiniones en Google" mientras
    // se muestran reseñas escritas desde el panel sería exactamente la clase
    // de afirmación que destruye la confianza que la sección busca construir.
    // Sin puntaje real se esconde el bloque numérico entero (quedan el sello y
    // los botones al perfil), y el pie deja de prometer una actualización
    // diaria que en este modo no existe.
    if(!picked.verified){
      if(!rating){
        document.querySelector('.gr-score-main').hidden = true;
        // El separador solo tiene sentido entre el puntaje y el sello; sin
        // puntaje quedaría una línea suelta al inicio del panel.
        document.querySelector('.gr-score-div').hidden = true;
      }
      document.querySelector('.gr-note').innerHTML =
        'Opiniones de clientes de SW Studio. Mirá el perfil completo y dejá la tuya en Google.';
    }

    var track = document.getElementById('gr-track');
    var rail = document.getElementById('gr-rail');
    if(list.length){
      var cards = function(dup){
        return list.map(function(r){ return cardHtml(r, picked.verified, dup); }).join('');
      };
      track.innerHTML = '<div class="gr-half">' + cards(false) + '</div>' +
                        '<div class="gr-half gr-dup" aria-hidden="true">' + cards(true) + '</div>';
      // Velocidad proporcional al contenido: pocas reseñas no deben pasar
      // volando ni muchas arrastrarse. ~7s por tarjeta, acotado.
      track.style.setProperty('--gr-dur', Math.min(90, Math.max(34, list.length * 7)) + 's');
      // Con una o dos tarjetas la marquesina se ve como un hueco que se
      // desplaza: mejor dejarlas quietas y centradas.
      if(list.length < 3) rail.classList.add('gr-static');
    } else {
      rail.hidden = true;
    }

    sec.hidden = false;
    document.querySelectorAll('.gr-nav').forEach(function(el){ el.hidden = false; });

    // Los contadores arrancan al entrar en pantalla, no al cargar el doc: si
    // se animaran ahora, la sección está a tres pantallas de distancia y nadie
    // vería el movimiento.
    var seen = false;
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting || seen) return;
        seen = true; io.disconnect();
        countUp(ratingEl, rating, fmtRating);
        if(count) countUp(countEl, count, function(v){ return Math.round(v).toLocaleString('es-CL'); });
        starsFill.style.width = Math.max(0, Math.min(100, rating / 5 * 100)).toFixed(2) + '%';
      });
    }, {threshold:.25});
    io.observe(document.querySelector('.gr-score'));

    // "Leer más": expande la tarjeta y congela la marquesina mientras se lee,
    // porque un texto que se abre y se sigue moviendo es ilegible.
    track.addEventListener('click', function(e){
      var btn = e.target.closest('.gr-more');
      if(!btn) return;
      var card = btn.closest('.gr-card');
      var open = card.classList.toggle('open');
      btn.textContent = open ? 'Leer menos' : 'Leer más';
      rail.classList.toggle('is-paused', !!track.querySelector('.gr-card.open'));
    });
  }

  async function loadGoogleReviewsSection(){
    if(!window.SWData || !window.SWData.loadGoogleReviews) return;
    try{
      var d = await window.SWData.loadGoogleReviews();
      if(d) render(d);
    }catch(e){
      console.error('No se pudieron cargar las reseñas de Google', e);
    }
  }
  document.addEventListener('DOMContentLoaded', loadGoogleReviewsSection);
})();

// ══ STEP NAVIGATION ══
function bkGoTo(n){
  S.step = n;
  document.querySelectorAll('.bk-screen').forEach(s=>s.classList.remove('active'));
  const scr = document.getElementById('bks-'+n);
  if(scr){ scr.classList.add('active'); scr.parentElement.scrollTop=0; }
  else {
    // confirmation
    document.getElementById('bks-done').classList.add('active');
    document.getElementById('bk-stepper').style.display='none';
  }
  document.querySelectorAll('.bk-step').forEach(s=>{
    const sn=parseInt(s.dataset.s);
    s.classList.remove('bk-active','bk-done');
    if(sn<n) s.classList.add('bk-done');
    else if(sn===n) s.classList.add('bk-active');
  });
  document.querySelectorAll('.bk-sline').forEach((l,i)=>{
    l.style.background = (i+1<n) ? 'var(--bk-ink)' : 'var(--bk-g200)';
  });
}
window.bkGoTo = bkGoTo;

// ══ RENDER SERVICES ══
function renderSvcs(){
  const tabs=document.getElementById('bk-cat-tabs');
  const wrap=document.getElementById('bk-svcs');
  tabs.innerHTML = CATS.map((c,i)=>
    `<button class="bk-cat ${i===0?'bk-active-cat':''}" data-cid="${c.id}">${c.name}</button>`
  ).join('');
  wrap.innerHTML = CATS.map((c,i)=>`
    <div class="bk-cat-group ${i===0?'bk-active-cat-g':''}" data-gid="${c.id}">
      ${c.items.map(s=>`
        <div class="bk-svc" data-sid="${s.id}" data-gid="${c.id}">
          ${s.tag?`<span class="bk-tag bk-tag-${s.ts}">${s.tag}</span>`:''}
          <span class="bk-svc-name">${s.name}</span>
          <span class="bk-svc-price">$${s.price.toLocaleString('es-CL')}</span>
          ${s.desc?`<span class="bk-svc-desc">${s.desc}</span>`:''}
          <span class="bk-svc-meta">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            ${s.dur} min
          </span>
          <span class="bk-svc-check"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="4 10 8.5 15 17 5" stroke-linecap="round"/></svg></span>
        </div>
      `).join('')}
    </div>
  `).join('');

  tabs.querySelectorAll('.bk-cat').forEach(t=>{
    t.addEventListener('click',()=>{
      tabs.querySelectorAll('.bk-cat').forEach(x=>x.classList.remove('bk-active-cat'));
      t.classList.add('bk-active-cat');
      const id=t.dataset.cid;
      wrap.querySelectorAll('.bk-cat-group').forEach(g=>{
        g.classList.toggle('bk-active-cat-g', g.dataset.gid===id);
      });
    });
  });

  wrap.querySelectorAll('.bk-svc').forEach(el=>{
    el.addEventListener('click',()=>{
      wrap.querySelectorAll('.bk-svc').forEach(x=>x.classList.remove('bk-sel'));
      el.classList.add('bk-sel');
      const cat=CATS.find(c=>c.id===el.dataset.gid);
      S.svc=cat.items.find(s=>s.id===el.dataset.sid);
      document.getElementById('bk-next1').disabled=false;
      updateSummary();
    });
  });
}

// ══ RENDER BARBERS ══
function renderBarbers(){
  const wrap=document.getElementById('bk-barbers');
  wrap.innerHTML=BARBERS.map(b=>`
    <div class="bk-barber" data-bid="${b.id}">
      <div class="bk-bav">${b.photo?`<img src="${b.photo}" alt="${b.name}">`:b.init}</div>
      <div class="bk-bname">${b.name}</div>
      <div class="bk-brole">${b.role}</div>
    </div>
  `).join('');
  wrap.querySelectorAll('.bk-barber').forEach(el=>{
    el.addEventListener('click',()=>{
      wrap.querySelectorAll('.bk-barber').forEach(x=>x.classList.remove('bk-sel'));
      el.classList.add('bk-sel');
      S.barber=BARBERS.find(b=>b.id===el.dataset.bid);
      document.getElementById('bk-next2').disabled=false;
      // Bug confirmado: cambiar de barbero antes no volvía a renderizar nada
      // de la fecha/horarios (solo el click de un día lo hacía). El horario
      // elegido puede dejar de ser válido para el nuevo barbero (cerrado ese
      // día, u ocupado), así que se limpia antes de recalcular el resumen.
      if(S.date){
        S.time=null;
        document.getElementById('bk-next3').disabled=true;
      }
      updateSummary();
      // El calendario también depende del barbero elegido (horario propio
      // vía hoursRangeFor), así que se repinta siempre; los horarios (y su
      // suscripción a disponibilidad real) solo si ya hay una fecha elegida.
      renderCal();
      if(S.date) loadAvailability();
    });
  });
  // Con un solo profesional activo (sin contar 'Sin preferencia'),
  // preseleccionar para no bloquear el paso.
  if(!S.barber){
    const activos = BARBERS.filter(function(b){ return !b.any; });
    if(activos.length===1){
      const only = wrap.querySelector('[data-bid="'+activos[0].id+'"]');
      if(only){
        only.classList.add('bk-sel');
        S.barber = activos[0];
        document.getElementById('bk-next2').disabled=false;
        updateSummary();
      }
    }
  }
}

// ══ CALENDAR ══
function renderCal(){
  const y=calCursor.getFullYear(), m=calCursor.getMonth();
  document.getElementById('bk-cal-month').textContent=`${MONTHS[m]} ${y}`;
  const wrap=document.getElementById('bk-cal-days');
  const first=new Date(y,m,1);
  let startCol=(first.getDay()+6)%7;
  const last=new Date(y,m+1,0).getDate();
  let html='';
  for(let i=0;i<startCol;i++) html+=`<button class="bk-day bk-empty"></button>`;
  for(let d=1;d<=last;d++){
    // date: solo para aritmética de calendario (comparar contra TODAY/
    // MAX_DATE, que son el mismo tipo de objeto -- medianoche local del
    // navegador de un día calendario ya resuelto). dateKey (string) es lo
    // que se guarda/compara de acá en adelante -- S.date ya no es Date.
    const date=new Date(y,m,d);
    const dow=date.getDay();
    const dateKey=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isPast=date<TODAY;
    const isClosed=hoursRangeFor(dow,S.barber)===null;
    const isBeyond=date>MAX_DATE;
    const isToday=dateKey===TODAY_KEY;
    const isSel=S.date===dateKey;
    let cls='bk-day';
    if(isPast||isBeyond) cls+=' bk-past';
    else if(isClosed) cls+=' bk-closed';
    if(isToday) cls+=' bk-today';
    if(isSel) cls+=' bk-selday';
    const data=(!isPast&&!isClosed&&!isBeyond)?`data-day="${dateKey}"`:'' ;
    html+=`<button class="${cls}" ${data}>${d}</button>`;
  }
  wrap.innerHTML=html;
  wrap.querySelectorAll('.bk-day[data-day]').forEach(el=>{
    el.addEventListener('click',()=>{
      wrap.querySelectorAll('.bk-day').forEach(x=>x.classList.remove('bk-selday'));
      el.classList.add('bk-selday');
      S.date=el.dataset.day;
      S.time=null;
      loadAvailability();
      updateSummary();
      document.getElementById('bk-next3').disabled=!(S.date&&S.time);
    });
  });
  document.getElementById('bk-cprev').disabled=(y===TODAY.getFullYear()&&m===TODAY.getMonth());
  const nc=new Date(calCursor); nc.setMonth(nc.getMonth()+1);
  document.getElementById('bk-cnext').disabled=(nc>MAX_DATE);
}

document.getElementById('bk-cprev').addEventListener('click',()=>{
  calCursor.setMonth(calCursor.getMonth()-1); renderCal();
});
document.getElementById('bk-cnext').addEventListener('click',()=>{
  calCursor.setMonth(calCursor.getMonth()+1); renderCal();
});

// ══ SLOTS — disponibilidad real ══
// ¿Está libre `barberId` en [candStart,candEnd) (minutos desde medianoche),
// según los rangos ocupados en bruto que llegaron por subscribeAvailability?
// Mismo criterio de solape que checkConflict/parseDt en el panel admin:
// candStart < end && candEnd > start. AVAIL.barberBusy[id] puede venir
// ausente (sin reservas ese día) -- se lee con `|| []`. Cada rango trae
// `kind` ('booking'|'block', nunca 'break' -- ver recomputeAvailabilityForDate
// en functions/index.js); BUSINESS_BUFFER_MIN solo se aplica contra
// kind:'booking', igual que en checkConflict (admin) y overlaps() (server).
function isBarberFreeAt(barberId, candStart, candEnd){
  const busy=(AVAIL.barberBusy||{})[barberId]||[];
  if(busy.some(r=>{
    const buf = r.kind==='booking' ? BUSINESS_BUFFER_MIN : 0;
    return candStart<toMin(r.end)+buf && candEnd>toMin(r.start)-buf;
  })) return false;
  // Colación recurrente: se resuelve en cliente, no vía la vista materializada
  // `availability/{fecha}`. Es semanal (no por fecha) y viene en `staff`, que
  // es lectura pública y refreshCatalog() ya mantiene al día en BARBERS[] --
  // igual que el horario de apertura, que hoursRangeFor() también resuelve
  // acá. Así siempre refleja el último cambio del admin, sin obligar a
  // recalcular todas las fechas futuras de la vista ante cada guardado.
  // Ver recomputeAvailabilityForDate() en functions/index.js.
  const b=BARBERS.find(x=>x.id===barberId);
  const day=(b && Array.isArray(b.schedule) && S.date) ? b.schedule[dowOfDateKey(S.date)] : null;
  const brk=day && day.break;
  if(brk && brk.start && brk.end && candStart<toMin(brk.end) && candEnd>toMin(brk.start)) return false;
  return true;
}

// ¿Está disponible un slot candidato [candStart,candEnd) para la selección
// actual (S.barber)? Un barberId ausente de activeBarberIds() es
// inactivo/inexistente: no disponible. Para 'any'/sin barbero elegido:
// disponible si existe AL MENOS UN barbero activo libre en ese horario; si no
// hay ningún barbero activo, no hay nada que ofrecer.
function isSlotAvailable(candStart, candEnd){
  const activeIds=activeBarberIds();
  if(S.barber && !S.barber.any){
    if(activeIds.indexOf(S.barber.id)===-1) return false;
    return isBarberFreeAt(S.barber.id, candStart, candEnd);
  }
  return activeIds.some(id=>isBarberFreeAt(id, candStart, candEnd));
}

// Se suscribe en tiempo real a la disponibilidad de la fecha actual
// (subscribeAvailability -- ver public/js/data.js) y vuelve a pintar los
// horarios cada vez que cambia, sin necesidad de recargar ni de que el
// usuario vuelva a interactuar. Cierra siempre la suscripción anterior antes
// de abrir una nueva (cambio de fecha/barbero, o cierre del widget en
// closeBK) para no dejar listeners huérfanos.
// FALLA ABIERTO: cualquier error de la suscripción se trata como "todo
// disponible" -- nunca debe bloquear ni romper la reserva.
function loadAvailability(){
  // Limpia el aviso de "ese horario ya fue tomado" de un intento anterior --
  // cualquier cambio de fecha/barbero que llegue hasta acá invalida ese
  // aviso (ver el catch de #bk-submit).
  const takenEl=document.getElementById('bk-slot-taken-msg');
  if(takenEl){ takenEl.style.display='none'; takenEl.textContent=''; }
  if(availUnsub){ availUnsub(); availUnsub=null; }
  if(!S.date){ AVAIL_LOADING=false; renderSlots(); return; }
  const dow=dowOfDateKey(S.date);
  if(!hoursRangeFor(dow,S.barber)){
    // Día cerrado para el barbero/horario vigente: no tiene sentido
    // suscribirse a disponibilidad real; renderSlots ya muestra "Cerrado
    // este día".
    AVAIL_LOADING=false;
    renderSlots();
    return;
  }
  AVAIL_LOADING=true;
  renderSlots();
  // S.date ya ES el date-key -- antes había que derivarlo de un ISO
  // instante (.toISOString().slice(0,10)), ya no hace falta.
  availUnsub=window.SWData.subscribeAvailability(S.date, function(barberBusy){
    AVAIL={barberBusy:barberBusy||{}};
    AVAIL_LOADING=false;
    renderSlots();
  }, function(e){
    console.error('No se pudo suscribir a disponibilidad real (fail-open: se muestra todo disponible)', e);
    AVAIL={barberBusy:{}};
    AVAIL_LOADING=false;
    renderSlots();
  });
}

function renderSlots(){
  const lbl=document.getElementById('bk-slots-lbl');
  const cont=document.getElementById('bk-slots');
  if(!S.date){cont.innerHTML=`<div class="bk-slots-empty">Elige un día del calendario.</div>`;return}
  const dow=dowOfDateKey(S.date);
  const range=hoursRangeFor(dow,S.barber);
  if(!range){cont.innerHTML=`<div class="bk-slots-empty">Cerrado este día.</div>`;return}
  const [start,end]=range; // minutos desde medianoche
  const dur=S.svc?.dur||30;
  lbl.textContent=`Horarios disponibles`;
  if(AVAIL_LOADING){
    cont.innerHTML=`<div class="bk-slots-empty">Buscando horarios disponibles…</div>`;
    return;
  }
  let cands=[];
  let cur=start;
  while(cur+dur<=end){
    cands.push(cur);
    cur+=30;
  }
  // Hallazgo de Fase 2: esto comparaba contra `new Date()` en hora del
  // NAVEGADOR de quien reserva -- alguien reservando desde una zona
  // distinta a la del negocio veía disponibilidad distinta de la real (ej.
  // desde una zona adelantada, horarios que en el negocio todavía no pasan
  // se ocultaban igual). TODAY_KEY y timeKeyInZone() están en hora del
  // negocio, nunca en la del navegador.
  if(S.date===TODAY_KEY){
    const minStart=toMin(timeKeyInZone(new Date(), BUSINESS_TZ))+30;
    cands=cands.filter(m=>m>minStart);
  }
  if(!cands.length){cont.innerHTML=`<div class="bk-slots-empty">Sin horarios disponibles. Prueba otra fecha.</div>`;return}
  // Siempre se renderizan TODOS los horarios candidatos (nunca se omite uno
  // del DOM) -- los ocupados quedan tachados/atenuados con bk-taken en vez
  // de desaparecer, a pedido explícito del usuario.
  cont.innerHTML=cands.map(m=>{
    const hh=Math.floor(m/60), mm=m%60;
    const s=`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    const taken=!isSlotAvailable(m, m+dur);
    return `<button class="bk-slot${taken?' bk-taken':''}" data-t="${s}"${taken?' disabled':''}>${s}</button>`;
  }).join('');
  // Los slots bk-taken no reciben listener de click -- ni siquiera llegan a
  // depender de pointer-events:none del CSS para quedar inertes.
  cont.querySelectorAll('.bk-slot:not(.bk-taken)').forEach(el=>{
    el.addEventListener('click',()=>{
      cont.querySelectorAll('.bk-slot').forEach(x=>x.classList.remove('bk-selslot'));
      el.classList.add('bk-selslot');
      S.time=el.dataset.t;
      updateSummary();
      document.getElementById('bk-next3').disabled=false;
    });
  });
}

// ══ SUMMARY ══
function setSumVal(id, val, muted=false){
  const el=document.getElementById(id);
  el.textContent=val;
  el.className='bk-sum-val'+(muted?' bk-muted':'');
}
function updateSummary(){
  if(S.svc){
    setSumVal('ss-svc',S.svc.name);
    setSumVal('ss-dur',`${S.svc.dur} min`);
    document.getElementById('bk-sum-total').textContent=`$${S.svc.price.toLocaleString('es-CL')}`;
  } else {
    setSumVal('ss-svc','—',true);
    setSumVal('ss-dur','—',true);
    document.getElementById('bk-sum-total').textContent='—';
  }
  setSumVal('ss-barber', S.barber?S.barber.name:'—', !S.barber);
  setSumVal('ss-date', S.date?dateKeyToDate(S.date).toLocaleDateString('es-CL',{weekday:'short',day:'numeric',month:'short'}):'—', !S.date);
  setSumVal('ss-time', S.time?`${S.time} hrs`:'—', !S.time);
}

// ══ NAVIGATION BUTTONS ══
document.getElementById('bk-next1').addEventListener('click',()=>bkGoTo(2));
document.getElementById('bk-next2').addEventListener('click',()=>bkGoTo(3));
document.getElementById('bk-next3').addEventListener('click',()=>bkGoTo(4));

// ══ FORM VALIDATION & SUBMIT ══
function validate(){
  let ok=true;
  const n=document.getElementById('bkf-name');
  const p=document.getElementById('bkf-phone');
  const e=document.getElementById('bkf-email');
  const c=document.getElementById('bkf-consent');
  [n,p,e].forEach(f=>f.parentElement.classList.remove('bk-err'));
  document.getElementById('bk-consent-err').style.display='none';
  if(!n.value.trim()||n.value.trim().length<2){n.parentElement.classList.add('bk-err');ok=false}
  if(!/^[\d\s\+\-\(\)]{7,}$/.test(p.value.trim())){p.parentElement.classList.add('bk-err');ok=false}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.value.trim())){e.parentElement.classList.add('bk-err');ok=false}
  if(!c.checked){document.getElementById('bk-consent-err').style.display='block';ok=false}
  return ok;
}

function genCode(){
  return `SW-${Date.now().toString(36).toUpperCase().slice(-4)}${Math.floor(Math.random()*900+100)}`;
}

// Firestore/Cloud Functions no aplican timeout propio: si la red falla a
// medias (token de Auth colgado, conexión bloqueada/intermitente) la promesa
// de addDoc/httpsCallable puede quedar pendiente para siempre y el await
// nunca la resuelve ni la rechaza -- el botón "Procesando..." se queda
// colgado sin dar error. withTimeout() fuerza un rechazo a los N ms para que
// el flujo siga por el mismo camino de error que ya manejan los try/catch.
function withTimeout(promise, ms, label){
  return Promise.race([
    promise,
    new Promise((_, reject)=>setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

// Mapa explícito error -> mensaje para el submit de reserva. Punto de
// extensión único: sumar una entrada nueva no implica reescribir el handler.
const BK_SUBMIT_WHATSAPP_LINK = '<a href="https://wa.me/56982514114?text=Hola%2C%20tuve%20un%20problema%20al%20agendar%20mi%20cita" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">escríbenos por WhatsApp</a>';
const BK_SUBMIT_ERROR_MESSAGES = {
  default: 'No pudimos confirmar tu reserva por un problema de conexión. Nada quedó agendado -- ' + BK_SUBMIT_WHATSAPP_LINK + ' y lo coordinamos al toque, o inténtalo de nuevo.',
};
// Códigos de createBooking (Fase A) que significan "ese horario específico
// ya no está disponible" -- NO es un problema de conexión: hay que refrescar
// la grilla y volver al paso 3, no mostrar la pantalla de error genérica del
// paso 4 (ver el catch de #bk-submit). Van con mensaje propio porque el
// usuario necesita saber cosas distintas: su horario se lo ganaron
// (already-exists, elige otro) versus no queda nadie disponible
// (resource-exhausted, elige otro horario u otro barbero).
const BK_SLOT_TAKEN_MESSAGES = {
  'already-exists': 'Ese horario acaba de ser tomado. Elige otro horario o barbero.',
  'resource-exhausted': 'No queda ningún barbero disponible en ese horario. Elige otro horario o barbero.',
};
// El SDK de Functions antepone 'functions/' al code de un HttpsError
// (ej. 'functions/already-exists') -- se saca acá una sola vez para que
// tanto el mapa de arriba como BK_SUBMIT_ERROR_MESSAGES usen el code "pelado".
function bkErrorCode(err){
  const raw = (err && err.code) || '';
  return raw.indexOf('functions/') === 0 ? raw.slice('functions/'.length) : raw;
}
function bkSubmitErrorMessage(err){
  const key = bkErrorCode(err) || (err && err.message) || '';
  return BK_SUBMIT_ERROR_MESSAGES[key] || BK_SUBMIT_ERROR_MESSAGES.default;
}

document.getElementById('bk-submit').addEventListener('click',()=>{
  if(!validate()) return;
  const btn=document.getElementById('bk-submit');
  const errEl=document.getElementById('bk-submit-err');
  const originalLabel=btn.innerHTML;
  errEl.style.display='none';
  btn.innerHTML='<span class="bk-spinner"></span> Procesando...';
  btn.disabled=true;
  setTimeout(async ()=>{
    const code=genCode();
    const fullname=document.getElementById('bkf-name').value.trim();
    const name=fullname.split(' ')[0];
    const email=document.getElementById('bkf-email').value.trim();
    const phone=document.getElementById('bkf-phone').value.trim();
    var clubVisitCount = 1;
    var clubBenefitReached = '';
    var saved = false;
    // ── Persistir la reserva en Firestore (dispara email + sync de patients) ──
    try{
      await withTimeout(window.SWData.createBooking({
        code, name:fullname, email, phone,
        svcId:S.svc?.id, svcName:S.svc?.name, svcCat:S.svc?.cat||'',
        price:S.svc?.price||0, dur:S.svc?.dur||0,
        barberId:S.barber?.id, barberName:S.barber?.name,
        date:S.date||'', time:S.time,
        club:S.club||'guest',
        createdAt:new Date().toISOString()
      }), 15000, 'createBooking');
      saved = true;
    }catch(e){
      console.error('No se pudo guardar la reserva', e);
      const slotMsg = BK_SLOT_TAKEN_MESSAGES[bkErrorCode(e)];
      if(slotMsg){
        // No es un fallo de conexión: el horario elegido ya no está libre.
        // Se vuelve al paso 3 con la grilla recargada en vez de mostrar la
        // pantalla de error genérica -- loadAvailability() limpia este
        // mismo aviso en su próxima llamada (cambio de fecha/barbero).
        bkGoTo(3);
        loadAvailability();
        const takenEl = document.getElementById('bk-slot-taken-msg');
        takenEl.textContent = slotMsg;
        takenEl.style.display = 'block';
      } else {
        errEl.innerHTML = bkSubmitErrorMessage(e);
        errEl.style.display='block';
      }
    } finally {
      btn.innerHTML = originalLabel;
      btn.disabled = false;
    }
    // El éxito depende del resultado real de la escritura: sin esto, un
    // fallo total de red igual mostraba "reserva confirmada" con código y
    // todo, sin ninguna reserva en Firestore.
    if(!saved) return;
    // Conteo de visitas Club SW vía Cloud Function (bookings es solo-staff).
    // Va en su propio try: si falla, la reserva YA quedó guardada y solo se
    // pierde el bloque de fidelización — no hay que reportarlo como error de reserva.
    try{
      if(S.club==='member' && email){
        const status = await withTimeout(window.SWData.getClubStatus(email), 8000, 'getClubStatus');
        clubVisitCount = status.visitCount;
        clubBenefitReached = status.benefitReached || '';
      }
    }catch(e){
      console.error('No se pudo obtener el estado del Club SW', e);
    }
    document.getElementById('bk-confirm-code').textContent=code;
    document.getElementById('bk-confirm-sub').textContent=
      `Hola ${name}, tu reserva está confirmada. Te enviamos un correo de confirmación a ${email}. Te esperamos en Cochrane 635, Torre B, Of. 303.`;

    // Build loyalty block for Club SW members
    var loyaltyBlock = '';
    if(S.club==='member'){
      var toBenefit1 = Math.max(0, 10 - clubVisitCount);
      var toBenefit2 = Math.max(0, 20 - clubVisitCount);
      var progress = Math.min(100, (clubVisitCount/20)*100);
      var msg = '';
      if(clubBenefitReached==='premium'){
        msg = '<strong>¡Felicitaciones, alcanzaste 10 cortes!</strong> Tu próximo servicio premium es <strong>cortesía del Club SW</strong>. Nos contactaremos contigo para coordinarlo.';
      } else if(clubBenefitReached==='asesoria'){
        msg = '<strong>¡Increíble, ya son 20 cortes!</strong> Tu <strong>asesoría con visagismo</strong> es completamente gratis. Te llamaremos para agendar tu sesión exclusiva.';
      } else if(clubVisitCount===1){
        msg = '<strong>Bienvenido al Club SW.</strong> Esta es tu primera visita. Te faltan <strong>9 cortes</strong> para tu servicio premium gratis, y <strong>19</strong> para tu asesoría con visagismo de cortesía.';
      } else {
        if(clubVisitCount<10){
          msg = 'Llevas <strong>'+clubVisitCount+' visitas</strong>. Te faltan <strong>'+toBenefit1+' cortes</strong> para tu servicio premium gratis y <strong>'+toBenefit2+'</strong> para tu asesoría con visagismo.';
        } else {
          msg = 'Llevas <strong>'+clubVisitCount+' visitas</strong>. Te faltan <strong>'+toBenefit2+' cortes</strong> para tu asesoría con visagismo de cortesía.';
        }
      }
      loyaltyBlock = '<div class="bk-loyalty-block">'+
        '<div class="bk-club-card-shimmer"></div>'+
        '<div class="bk-loyalty-hd">'+
          '<span class="bk-loyalty-hex">⬡</span>'+
          '<span class="bk-loyalty-title">Club SW</span>'+
          '<span class="bk-loyalty-counter">'+clubVisitCount+(clubVisitCount===1?' visita':' visitas')+'</span>'+
        '</div>'+
        '<div class="bk-loyalty-msg">'+msg+'</div>'+
        '<div class="bk-loyalty-progress"><div class="bk-loyalty-progress-fill" style="width:'+progress+'%"></div></div>'+
      '</div>';
    }
    document.getElementById('bk-confirm-details').innerHTML=loyaltyBlock+`
      <div class="bk-sum-row"><div class="bk-sum-lbl">Servicio</div><div class="bk-sum-val">${S.svc.name}</div></div>
      <div class="bk-sum-row"><div class="bk-sum-lbl">Barbero</div><div class="bk-sum-val">${S.barber.name}</div></div>
      <div class="bk-sum-row"><div class="bk-sum-lbl">Fecha & Hora</div><div class="bk-sum-val">${dateKeyToDate(S.date).toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'})} · ${S.time} hrs</div></div>
      <div class="bk-sum-row"><div class="bk-sum-lbl">Duración</div><div class="bk-sum-val">${S.svc.dur} minutos</div></div>
      <div class="bk-sum-row"><div class="bk-sum-lbl">Total</div><div class="bk-sum-val" style="font-family:'Orbitron',sans-serif;font-weight:600;font-size:16px">$${S.svc.price.toLocaleString('es-CL')}</div></div>
      <div class="bk-sum-row"><div class="bk-sum-lbl">Código</div><div class="bk-sum-val">${code}</div></div>
      <div class="bk-sum-row"><div class="bk-sum-lbl">Cliente</div><div class="bk-sum-val">${name}<br><span style="color:var(--bk-meta);font-size:12px">${phone} · ${email}</span></div></div>
    `;
    document.getElementById('bk-stepper').style.display='none';
    bkGoTo('done');
  },900);
});

})();
