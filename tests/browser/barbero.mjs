// PWA del barbero (/barbero/): agenda del día y registro de la atención.
//
// Script standalone (no vitest): se corre con `node tests/browser/barbero.mjs`.
// Mismo arnés que tests/browser/dashboard.mjs -- servidor estático sobre
// `public/`, window.SWAuth + window.SWData stubbeados con addInitScript, y
// gstatic/googleapis abortados para que los módulos reales no pisen el stub.
// Lo que se ejercita de verdad es el HTML/JS de la app.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const OUT = path.resolve(import.meta.dirname, '../../.tmp-screenshots');
const PORT = 4481;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png',
  '.webmanifest':'application/manifest+json','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.svg':'image/svg+xml' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p==='/') p='/index.html'; if(p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{ if(e){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'}); res.end(b); });
});
await new Promise(r=>server.listen(PORT,r));
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:412,height:915}, deviceScaleFactor:2 });
await ctx.route('**gstatic.com/**', r=>r.abort());
await ctx.route('**googleapis.com/**', r=>r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => {
  if(m.type()==='error' && !/ERR_FAILED|Failed to load resource|dynamically imported module|gstatic|firebasejs|manifest/i.test(m.text()))
    errors.push('console: '+m.text());
});

await page.addInitScript(() => {
  const iso = (minsAgo) => new Date(Date.now() - minsAgo*60000).toISOString();
  // Una cita por estado relevante, más una atención sin cerrar hace rato.
  window.__DAY = {
    staffId:'victoria', name:'Victoria', date:'2026-09-06', tz:'America/Santiago',
    bookings: [
      { id:'b-conf', code:'SW-1', name:'Ana Torres', time:'10:00', dur:45,
        svcName:'Corte de cabello', price:14000, status:'confirmed',
        arrivedAt:null, startedAt:null, endedAt:null, actualDur:null, nudgeEndCount:0 },
      { id:'b-arr', code:'SW-2', name:'Ben Rojas', time:'11:00', dur:30,
        svcName:'Perfilado de barba', price:9000, status:'arrived',
        arrivedAt:iso(5), startedAt:null, endedAt:null, actualDur:null, nudgeEndCount:0 },
      { id:'b-live', code:'SW-3', name:'Cata Díaz', time:'12:00', dur:45,
        svcName:'Corte de cabello', price:14000, status:'in_service',
        arrivedAt:iso(20), startedAt:iso(12), endedAt:null, actualDur:null, nudgeEndCount:0 },
      { id:'b-done', code:'SW-4', name:'Deb Soto', time:'13:00', dur:45,
        svcName:'Corte de cabello', price:14000, status:'completed',
        arrivedAt:iso(200), startedAt:iso(195), endedAt:iso(142), actualDur:53, nudgeEndCount:0 },
      { id:'b-noshow', code:'SW-5', name:'Eze Pérez', time:'14:00', dur:30,
        svcName:'Perfilado de barba', price:9000, status:'no_show',
        arrivedAt:null, startedAt:null, endedAt:null, actualDur:null, nudgeEndCount:0 },
      // Sin cerrar: empezó hace 3h una atención de 45 min -> "Por revisar".
      { id:'b-stuck', code:'SW-6', name:'Fran Lira', time:'09:00', dur:45,
        svcName:'Asesoría de imagen', price:25000, status:'in_service',
        arrivedAt:iso(190), startedAt:iso(185), endedAt:null, actualDur:null, nudgeEndCount:2 },
    ],
  };
  window.__CALLS = [];
  let authCb = null;
  window.SWAuth = {
    signIn: async () => { authCb && authCb({ uid:'uid-victoria' }); return { uid:'uid-victoria' }; },
    signOut: async () => { authCb && authCb(null); },
    onChange: (cb) => { authCb = cb; cb(null); return () => {}; },
  };
  // Un día distinto de hoy, para la navegación. Trae una cita EDITABLE por
  // estado (confirmed): si aun así no aparecen botones, es por el día y no
  // porque el estado no los tuviera.
  window.__OTRO_DIA = [
    { id:'b-ayer', code:'SW-9', name:'Gabi Nuñez', time:'16:00', dur:45,
      svcName:'Corte de cabello', price:14000, status:'confirmed',
      arrivedAt:null, startedAt:null, endedAt:null, actualDur:null, nudgeEndCount:0 },
  ];
  window.__FECHAS = [];
  window.SWData = {
    getMyDay: async (date) => {
      window.__FECHAS.push(date == null ? null : date);
      const d = JSON.parse(JSON.stringify(window.__DAY));
      if (date) { d.date = date; d.bookings = JSON.parse(JSON.stringify(window.__OTRO_DIA)); }
      return d;
    },
    markAttendance: async (bookingId, action) => {
      window.__CALLS.push({ bookingId, action });
      const b = window.__DAY.bookings.find(x => x.id === bookingId);
      if (action === 'snooze') return { ok:true, already:false, status:b.status, actualDur:null };
      const next = { arrive:'arrived', no_show:'no_show', start:'in_service', end:'completed', cancel:'cancelled' }[action];
      if (b) {
        b.status = next;
        if (action === 'start') b.startedAt = new Date().toISOString();
        if (action === 'end') { b.endedAt = new Date().toISOString(); b.actualDur = 41; }
      }
      return { ok:true, already:false, status:next, actualDur: action==='end' ? 41 : null };
    },
    saveMyPushToken: async () => {},
  };
});

let fails = 0;
const check = (name, cond, detail) => {
  if(!cond){ fails++; console.log(`✗ ${name}` + (detail!==undefined?` -> ${JSON.stringify(detail)}`:'')); }
  else console.log(`✓ ${name}`);
};

await page.goto(`http://localhost:${PORT}/barbero/`, { waitUntil:'load' });

// ── login ──
check('arranca en la pantalla de login', await page.isVisible('#b-login'));
check('la agenda no se ve sin sesión', !(await page.isVisible('#b-app')));

await page.fill('#b-email', 'victoria@scissorwhite.cl');
await page.fill('#b-pass', 'x');
await page.click('#b-signin');
await page.waitForSelector('#b-app', { state:'visible', timeout:4000 });
await page.waitForTimeout(200);

check('sin errores JS al cargar la agenda', errors.length === 0, errors.slice(0,4));
check('saluda al barbero por su nombre', (await page.textContent('#b-me')) === 'Victoria');

// ── secciones ──
const layout = await page.evaluate(() => ({
  revisarVisible: !document.getElementById('b-review-wrap').hidden,
  revisar: document.querySelectorAll('#b-review .b-card').length,
  agenda: document.querySelectorAll('#b-list .b-card').length,
  live: document.querySelectorAll('#b-list .b-card.live').length,
  done: document.querySelectorAll('#b-list .b-card.done').length,
  void: document.querySelectorAll('#b-list .b-card.void').length,
}));
check('"Por revisar" aparece con la atención sin cerrar', layout.revisarVisible && layout.revisar === 1, layout);
check('las otras 5 citas quedan en la agenda', layout.agenda === 5, layout);
check('la atención en curso se destaca', layout.live === 1, layout);
check('la completada se atenúa', layout.done === 1, layout);
check('el no-show se atenúa', layout.void === 1, layout);

// ── botones por estado ──
const acts = await page.evaluate(() => {
  const of = (id) => [...document.querySelectorAll(`[data-act][data-id="${id}"]`)].map(b => b.dataset.act);
  return { conf: of('b-conf'), arr: of('b-arr'), live: of('b-live'), done: of('b-done'), noshow: of('b-noshow') };
});
check('confirmada -> Llegó / No llegó / Iniciar', JSON.stringify(acts.conf) === JSON.stringify(['arrive','no_show','start']), acts.conf);
check('llegó -> Iniciar / No llegó', JSON.stringify(acts.arr) === JSON.stringify(['start','no_show']), acts.arr);
check('en atención -> Finalizar / Recuérdame', JSON.stringify(acts.live) === JSON.stringify(['end','snooze']), acts.live);
check('completada sin botones', acts.done.length === 0, acts.done);
check('no-show sin botones', acts.noshow.length === 0, acts.noshow);

// ── cronómetro ──
const t1 = await page.textContent('#b-list .b-card.live .b-timer b');
await page.waitForTimeout(1150);
const t2 = await page.textContent('#b-list .b-card.live .b-timer b');
check('el cronómetro corre solo, sin recargar la agenda', t1 !== t2, { t1, t2 });
const callsDuranteTicker = await page.evaluate(() => window.__CALLS.length);
check('el cronómetro no dispara llamadas al servidor', callsDuranteTicker === 0, callsDuranteTicker);

// La hora de inicio debe estar en la zona del negocio (no UTC) y el
// transcurrido debe leerse como duración hh:mm:ss, no como hora de reloj.
const reloj = await page.textContent('#b-list .b-card.live .b-timer');
const esperada = await page.evaluate(() => {
  const iso = window.__DAY.bookings.find(b => b.id === 'b-live').startedAt;
  return new Intl.DateTimeFormat('es-CL', { timeZone:'America/Santiago', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(iso));
});
check('la hora de inicio se muestra en la zona del negocio', reloj.includes(esperada), { reloj: reloj.trim(), esperada });
check('el transcurrido se lee como duración hh:mm:ss', /llevas\s*00:\d{2}:\d{2}/.test(reloj), reloj.trim());

// ── marcar Llegó ──
await page.click('[data-act="arrive"][data-id="b-conf"]');
await page.waitForTimeout(300);
const trasLlego = await page.evaluate(() => ({
  calls: window.__CALLS.slice(),
  acts: [...document.querySelectorAll('[data-act][data-id="b-conf"]')].map(b => b.dataset.act),
}));
check('Llegó llama a markAttendance con "arrive"',
  trasLlego.calls.length === 1 && trasLlego.calls[0].action === 'arrive' && trasLlego.calls[0].bookingId === 'b-conf',
  trasLlego.calls);
check('tras Llegó la tarjeta ofrece Iniciar', JSON.stringify(trasLlego.acts) === JSON.stringify(['start','no_show']), trasLlego.acts);

// ── finalizar ──
await page.click('[data-act="end"][data-id="b-live"]');
await page.waitForTimeout(300);
const trasFin = await page.evaluate(() => ({
  calls: window.__CALLS.length,
  ultima: window.__CALLS[window.__CALLS.length-1],
  toast: document.querySelector('.b-toast') && document.querySelector('.b-toast').textContent,
  resumen: [...document.querySelectorAll('#b-list .b-card')].map(c => c.textContent).join(' '),
}));
check('Finalizar llama a markAttendance con "end"', trasFin.ultima && trasFin.ultima.action === 'end', trasFin.ultima);
check('avisa la duración real registrada', /41 min/.test(trasFin.toast || ''), trasFin.toast);
check('la tarjeta pasa a mostrar el resumen de duración', /Duró 41 min/.test(trasFin.resumen), trasFin.resumen.slice(0,160));

// ── enlace profundo de la notificación ──
await page.goto(`http://localhost:${PORT}/barbero/?b=b-arr&a=start`, { waitUntil:'load' });
await page.waitForSelector('#b-login', { state:'visible' });
await page.fill('#b-email', 'victoria@scissorwhite.cl');
await page.fill('#b-pass', 'x');
await page.click('#b-signin');
await page.waitForSelector('#b-app', { state:'visible', timeout:4000 });
await page.waitForTimeout(400);
const deep = await page.evaluate(() => ({
  calls: window.__CALLS.filter(c => c.bookingId === 'b-arr'),
  url: location.search,
}));
check('el enlace profundo ejecuta la acción una sola vez',
  deep.calls.length === 1 && deep.calls[0].action === 'start', deep.calls);
check('el enlace profundo limpia la URL', deep.url === '', deep.url);

// ── agenda vacía ──
await page.evaluate(() => { window.__DAY.bookings = []; });
await page.click('#b-refresh');
await page.waitForTimeout(300);
check('agenda vacía muestra un mensaje, no una lista en blanco',
  /No tienes citas para hoy/.test(await page.textContent('#b-list')));

// ── navegación de días ──
// La agenda del día era todo lo que había; ahora se puede mirar otro día,
// pero SOLO mirar: markAttendance sella la hora del servidor y corregirla es
// admin-only, así que marcar una cita de ayer inventaría una duración.
const fechasAntes = (await page.evaluate(() => window.__FECHAS.slice())).length;
check('la primera carga pide "hoy" sin fecha, que la resuelve el servidor',
  (await page.evaluate(() => window.__FECHAS[0])) === null);

await page.click('#b-prev');
await page.waitForTimeout(300);
check('el día anterior se pide por su clave',
  (await page.evaluate(() => window.__FECHAS[window.__FECHAS.length-1])) === '2026-09-05',
  await page.evaluate(() => window.__FECHAS.slice()));
check('y se pidió una vez más', (await page.evaluate(() => window.__FECHAS.length)) === fechasAntes + 1);
check('la cabecera muestra el día, legible', /sáb 5 sep/.test(await page.textContent('#b-date')),
  await page.textContent('#b-date'));
check('avisa que es de solo lectura', await page.isVisible('#b-ro'));
check('fuera de hoy NO hay botones de asistencia, en ninguna sección',
  (await page.locator('[data-act]').count()) === 0);
check('pero sí se ve la cita', /Gabi Nuñez/.test(await page.textContent('#b-list')));
check('aparece el botón para volver a hoy', await page.isVisible('#b-hoy'));

// Cruce de mes: la aritmética es sobre la clave, no sobre un Date local.
await page.evaluate(() => { window.__FECHAS.length = 0; });
for (let i = 0; i < 5; i++) { await page.click('#b-prev'); await page.waitForTimeout(120); }
check('restar días cruza el cambio de mes',
  (await page.evaluate(() => window.__FECHAS[window.__FECHAS.length-1])) === '2026-08-31',
  await page.evaluate(() => window.__FECHAS.slice()));

// Los tests de más arriba dejaron el fixture exprimido: las citas quedaron
// en estados terminales y el caso de "agenda vacía" lo dejó SIN citas. Así
// que "hay botones" no se puede heredar de ahí -- esta aserción siembra su
// propia cita editable.
await page.evaluate(() => {
  window.__DAY.bookings = [{
    id:'b-hoy', code:'SW-10', name:'Hugo Paz', time:'17:00', dur:30,
    svcName:'Perfilado de barba', price:9000, status:'confirmed',
    arrivedAt:null, startedAt:null, endedAt:null, actualDur:null, nudgeEndCount:0,
  }];
});
await page.click('#b-hoy');
await page.waitForTimeout(300);
check('"Hoy" vuelve a pedir sin fecha',
  (await page.evaluate(() => window.__FECHAS[window.__FECHAS.length-1])) === null);
check('de vuelta en hoy vuelven los botones',
  (await page.locator('[data-act]').count()) > 0);
check('y desaparece el aviso de solo lectura', !(await page.isVisible('#b-ro')));

check('sin errores JS tras ejercitar todo', errors.length === 0, errors.slice(0,4));

// Captura con datos, para revisar el diseño a ojo. Se recarga la página en
// vez de restaurar el fixture mutado: addInitScript lo vuelve a sembrar
// entero en cada navegación.
await page.goto(`http://localhost:${PORT}/barbero/`, { waitUntil:'load' });
await page.fill('#b-email', 'victoria@scissorwhite.cl');
await page.fill('#b-pass', 'x');
await page.click('#b-signin');
await page.waitForSelector('#b-list .b-card', { timeout:4000 });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(OUT, 'barbero.png'), fullPage:true }).catch(()=>{});

console.log(fails === 0 ? '\n== TODO OK ==' : `\n== ${fails} FALLAS ==`);
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
