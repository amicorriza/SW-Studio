// Dashboard de métricas de negocio del panel admin.
//
// Script standalone (no vitest): se corre con `node tests/browser/dashboard.mjs`.
// Requiere Playwright, que NO es dependencia del repo todavía:
//   npm install --save-dev playwright && npx playwright install chromium
//
// Levanta un servidor estático sobre `public/` y stubbea window.SWAuth +
// window.SWData ANTES de que corra el script del sitio. js/metrics.js (script
// clásico local) SÍ carga de verdad -> se ejercita el módulo real. Las rutas a
// gstatic/googleapis se abortan para que el data.js real no pise el stub.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const OUT = path.resolve(import.meta.dirname, '../../.tmp-screenshots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.svg':'image/svg+xml' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p==='/') p='/index.html'; if(p==='/admin/') p='/admin/index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{ if(e){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'}); res.end(b); });
});
await new Promise(r=>server.listen(4480,r));
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:1400,height:1200}, acceptDownloads:true });
await ctx.route('**gstatic.com/**', r=>r.abort());
await ctx.route('**googleapis.com/**', r=>r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => {
  if(m.type()==='error' && !/ERR_FAILED|Failed to load resource|dynamically imported module|gstatic|firebasejs/.test(m.text()))
    errors.push('console: '+m.text());
});

await page.addInitScript(() => {
  // ── fixture BK: varios meses (este año y el pasado), pasadas/futuras/hoy,
  //    sin email, dur 0, price 0, fechas basura, declined/confirmed/pending ──
  const pad = n => (n<10?'0':'')+n;
  const ymd = d => d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate());
  const today = new Date();
  const at = (deltaDays) => { const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()+deltaDays, 12)); return ymd(d); };
  const monthBack = (m, day) => { const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth()-m, day, 12)); return ymd(d); };

  const SVCS = [
    { svcId:'corte', svcName:'Corte de cabello', svcCat:'c', price:14000, dur:45 },
    { svcId:'barba', svcName:'Perfilado de barba', svcCat:'b', price:9000, dur:30 },
    { svcId:'aseso', svcName:'Asesoría de imagen', svcCat:'a', price:25000, dur:60 },
  ];
  const BARB = [ {id:'victoria',name:'Victoria'}, {id:'esteban',name:'Esteban'} ];
  const EMAILS = ['ana@x.cl','ben@x.cl','ana@x.cl','cata@x.cl','ben@x.cl','deb@x.cl'];

  const BK = [];
  let i = 0;
  for(let m = 13; m >= 0; m--){
    for(let k = 0; k < 3; k++){
      const s = SVCS[(m+k) % 3];
      const b = BARB[(m+k) % 2];
      BK.push({
        code:'SW-'+(1000+i), name:'Cliente '+i,
        email: EMAILS[i % EMAILS.length],
        svcId:s.svcId, svcName:s.svcName, svcCat:s.svcCat, price:s.price, dur:s.dur,
        barberId:b.id, barberName:b.name,
        date: monthBack(m, 5 + k*7), time:'11:00',
        status: (i % 9 === 0 ? 'confirmed' : 'pending'), club:'guest',
      });
      i++;
    }
  }
  // futuras
  BK.push({ code:'SW-F1', name:'Futuro 1', email:'ana@x.cl', svcId:'corte', svcName:'Corte de cabello', svcCat:'c', price:14000, dur:45, barberId:'victoria', barberName:'Victoria', date: at(3), time:'12:00', status:'confirmed', club:'guest' });
  BK.push({ code:'SW-F2', name:'Futuro 2', email:'zoe@x.cl', svcId:'aseso', svcName:'Asesoría de imagen', svcCat:'a', price:25000, dur:60, barberId:'esteban', barberName:'Esteban', date: at(20), time:'16:00', status:'pending', club:'guest' });
  // hoy y ayer
  BK.push({ code:'SW-T0', name:'Hoy', email:'ben@x.cl', svcId:'barba', svcName:'Perfilado de barba', svcCat:'b', price:9000, dur:30, barberId:'victoria', barberName:'Victoria', date: at(0), time:'10:00', status:'pending', club:'guest' });
  BK.push({ code:'SW-Y1', name:'Ayer', email:'cata@x.cl', svcId:'corte', svcName:'Corte de cabello', svcCat:'c', price:14000, dur:45, barberId:'esteban', barberName:'Esteban', date: at(-1), time:'17:00', status:'pending', club:'guest' });
  // sin email
  BK.push({ code:'SW-NE1', name:'Sin Email 1', email:'', svcId:'corte', svcName:'Corte de cabello', svcCat:'c', price:14000, dur:45, barberId:'victoria', barberName:'Victoria', date: monthBack(1, 9), time:'11:00', status:'pending', club:'guest' });
  BK.push({ code:'SW-NE2', name:'Sin Email 2', svcId:'barba', svcName:'Perfilado de barba', svcCat:'b', price:9000, dur:30, barberId:'esteban', barberName:'Esteban', date: monthBack(0, 4), time:'11:00', status:'pending', club:'guest' });
  // dur 0 y price 0
  BK.push({ code:'SW-D0', name:'Dur Cero', email:'deb@x.cl', svcId:'raro', svcName:'Servicio sin duración', svcCat:'', price:8000, dur:0, barberId:'victoria', barberName:'Victoria', date: monthBack(0, 6), time:'11:00', status:'pending', club:'guest' });
  BK.push({ code:'SW-P0', name:'Precio Cero', email:'deb@x.cl', svcId:'corte', svcName:'Corte de cabello', svcCat:'c', price:0, dur:45, barberId:'esteban', barberName:'Esteban', date: monthBack(0, 7), time:'11:00', status:'pending', club:'guest' });
  // fechas basura
  BK.push({ code:'SW-B1', name:'Basura 1', email:'ana@x.cl', svcId:'corte', svcName:'Corte de cabello', svcCat:'c', price:14000, dur:45, barberId:'victoria', barberName:'Victoria', date:'2026-13-99', time:'11:00', status:'pending', club:'guest' });
  BK.push({ code:'SW-B2', name:'Basura 2', email:'ana@x.cl', svcId:'corte', svcName:'Corte de cabello', svcCat:'c', price:14000, dur:45, barberId:'victoria', barberName:'Victoria', date:'', time:'11:00', status:'pending', club:'guest' });
  // declined en el mes actual: no debe aportar a nada
  BK.push({ code:'SW-DEC', name:'Declinada', email:'ben@x.cl', svcId:'aseso', svcName:'Asesoría de imagen', svcCat:'a', price:25000, dur:60, barberId:'victoria', barberName:'Victoria', date: monthBack(0, 3), time:'11:00', status:'declined', club:'guest' });

  window.__BK = BK;
  window.SWAuth = { signIn: async () => ({uid:'test'}), signOut: async () => {}, onChange: () => () => {} };
  window.SWData = {
    loadAdmin: async () => ({
      services: SVCS.map(s => ({ ...s, id:s.svcId, name:s.svcName, cat:s.svcCat, status:'active' })),
      staff: BARB.map(b => ({ ...b, status:'active', photo:'', schedule:[null] })),
      info: { name:'Scissor White', addr:'Cochrane 635', tz:'America/Santiago' },
      log: [], schedule: [],
    }),
    subscribeBookings: (cb) => { cb(window.__BK); return { unsubscribe(){}, ready: Promise.resolve() }; },
    getPatients: async () => [], getScheduleBlocks: async () => [],
    saveAdmin: async () => {}, saveBooking: async () => {}, deleteBooking: async () => {},
    loadGoogleReviews: async () => null,
  };
});

let fails = 0;
const check = (name, cond, detail) => {
  if(!cond){ fails++; console.log(`✗ ${name}` + (detail!==undefined?` -> ${JSON.stringify(detail)}`:'')); }
  else console.log(`✓ ${name}`);
};

await page.goto('http://localhost:4480/admin/', { waitUntil:'load' });
await page.fill('#adm-pass', 'x');
await page.click('#adm-login-btn');
await page.waitForSelector('#adm-app', { state:'visible' });
await page.waitForSelector('#a-dash .a-dash-kpis', { timeout:4000 });
await page.waitForTimeout(200);

check('sin errores JS al cargar el Dashboard', errors.length === 0, errors.slice(0,4));

const layout = await page.evaluate(() => ({
  kpis: document.querySelectorAll('#a-dash .a-dash-kpis .a-sc').length,
  svgs: document.querySelectorAll('#a-dash .a-dash-svgwrap svg').length,
  retRows: document.querySelectorAll('#a-dash .a-dash-stack').length,
  periodOpts: document.querySelectorAll('#a-dash-period option').length,
  hasCsv: !!document.getElementById('a-dash-csv'),
}));
check('5 tarjetas de KPI', layout.kpis === 5, layout.kpis);
check('2 gráficos SVG (12 meses + 12 semanas)', layout.svgs === 2, layout.svgs);
check('retención con 6 barras apiladas', layout.retRows === 6, layout.retRows);
check('selector de período con 5 presets', layout.periodOpts === 5, layout.periodOpts);
check('botón Exportar CSV presente', layout.hasCsv, layout.hasCsv);

// KPI Ingresos == recomputo independiente con el propio window.SWMetrics
const recompute = await page.evaluate(() => {
  const X = window.SWMetrics, BK = window.__BK, tz = 'America/Santiago';
  const today = X.bizToday(tz);
  const mb = X.monthBounds(today.slice(0,7));
  const fs = X.firstBookingByEmail(BK, { tz });
  const pb = X.mFilterPeriod(BK, { from:mb.from, to:mb.to, mode:'realizado', today });
  const k = X.mKpis(pb, [], { firstSeen:fs, periodFrom:mb.from, prevFrom:'' });
  const cards = [...document.querySelectorAll('#a-dash .a-dash-kpis .a-sc .a-scv')].map(e => e.textContent.trim());
  return {
    ingresosExp: '$'+Number(k.ingresos).toLocaleString('es-CL'), ingresosGot: cards[0],
    citasExp: String(k.citas), citasGot: cards[1],
  };
});
check('KPI Ingresos coincide con recomputo (mes / realizado)', recompute.ingresosExp === recompute.ingresosGot, recompute);
check('KPI Citas coincide con recomputo (mes / realizado)', recompute.citasExp === recompute.citasGot, recompute);

// Toggle Realizado -> Agendado re-renderiza y mueve la marca .a-on
await page.click('#a-dash-mode-agen');
await page.waitForTimeout(120);
const modeState = await page.evaluate(() => ({
  agenOn: document.getElementById('a-dash-mode-agen').classList.contains('a-on'),
  realOn: document.getElementById('a-dash-mode-real').classList.contains('a-on'),
}));
check('el toggle Agendado queda activo', modeState.agenOn && !modeState.realOn, modeState);

// "Agendado" >= "Realizado" en citas del período (agendado incluye hoy+futuro)
const modeCounts = await page.evaluate(() => {
  const X = window.SWMetrics, BK = window.__BK, tz = 'America/Santiago';
  const today = X.bizToday(tz);
  const mb = X.monthBounds(today.slice(0,7));
  const real = X.mFilterPeriod(BK, { from:mb.from, to:mb.to, mode:'realizado', today }).length;
  const agen = X.mFilterPeriod(BK, { from:mb.from, to:mb.to, mode:'agendado', today }).length;
  return { real, agen };
});
check('Agendado ≥ Realizado en el mes', modeCounts.agen >= modeCounts.real, modeCounts);

// Recorrer todos los presets de período sin errores
for(const preset of ['lastMonth','last3','year','custom','month']){
  await page.selectOption('#a-dash-period', preset);
  await page.waitForTimeout(120);
  const ok = await page.evaluate(() => !!document.querySelector('#a-dash .a-dash-kpis .a-sc'));
  check(`período "${preset}" re-renderiza`, ok);
}
// "Rango libre" revela los inputs de fecha; un preset los oculta
await page.selectOption('#a-dash-period', 'custom');
await page.waitForTimeout(120);
const rangeShown = await page.evaluate(() => getComputedStyle(document.getElementById('a-dash-range')).display !== 'none');
await page.selectOption('#a-dash-period', 'month');
await page.waitForTimeout(120);
const rangeHidden = await page.evaluate(() => getComputedStyle(document.getElementById('a-dash-range')).display === 'none');
check('el rango libre muestra/oculta sus inputs date según el preset', rangeShown && rangeHidden, { rangeShown, rangeHidden });

// Comparar vs período anterior: aparecen indicadores Δ
await page.check('#a-dash-cmp');
await page.waitForTimeout(120);
const deltas = await page.evaluate(() => document.querySelectorAll('#a-dash .a-dash-delta').length);
check('con "comparar" aparecen indicadores Δ', deltas >= 5, deltas);

// Toggle de la tendencia y del desglose
await page.click('#a-dash-tm-cit');
await page.waitForTimeout(100);
await page.click('#a-dash-sg-cat');
await page.waitForTimeout(100);
const toggles = await page.evaluate(() => ({
  trendCit: document.getElementById('a-dash-tm-cit').classList.contains('a-on'),
  svcCat: document.getElementById('a-dash-sg-cat').classList.contains('a-on'),
  svcTitle: (document.querySelector('#a-dash .a-st') && [...document.querySelectorAll('#a-dash .a-st')].some(e=>/categoría/i.test(e.textContent))),
}));
check('toggle tendencia -> Citas activo', toggles.trendCit, toggles);
check('toggle desglose -> Categoría activo y titulado', toggles.svcCat && toggles.svcTitle, toggles);

check('sin errores JS tras ejercitar todos los controles', errors.length === 0, errors.slice(0,4));

// Exportar CSV: 13 líneas (header + 12) y BOM
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('#a-dash-csv'),
]);
const dlPath = await download.path();
const csv = fs.readFileSync(dlPath, 'utf8');
const lines = csv.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
check('el CSV arranca con BOM', csv.charCodeAt(0) === 0xFEFF, csv.charCodeAt(0));
check('el CSV tiene header + 12 meses', lines.length === 13, lines.length);
check('el header del CSV es el esperado', lines[0].replace(/^﻿/, '').startsWith('Mes,Citas,Ingresos CLP'), lines[0]);

await page.locator('#adm-p-dashboard').screenshot({ path: path.join(OUT, 'admin-dashboard.png') }).catch(()=>{});

console.log(fails === 0 ? '\n== TODO OK ==' : `\n== ${fails} FALLAS ==`);
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
