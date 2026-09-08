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

  const DIA = { open:true, start:'10:00', end:'20:00', break:{ start:'13:00', end:'14:00' } };

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

  // ── P2: citas con asistencia REAL registrada, en el mes en curso ──
  // 'Corte de cabello' se pasa del plan (45 -> mediana 53) para que dispare
  // la regla de sobretiempo; 'Perfilado de barba' queda dentro del plan.
  const REALES = [53, 50, 53, 58, 53, 45, 53, 56, 53, 50, 53, 60, 53, 48, 53,
                  55, 53, 47, 53, 52, 53, 49, 53, 51, 53, 46, 53, 54, 53, 50];
  REALES.forEach((real, k) => {
    BK.push({
      code:'SW-R'+k, name:'Atendido '+k, email:'r'+(k%7)+'@x.cl',
      svcId:'corte', svcName:'Corte de cabello', svcCat:'c', price:14000, dur:45,
      barberId: BARB[k%2].id, barberName: BARB[k%2].name,
      date: monthBack(0, 1 + (k % 20)), time: (10 + (k % 8)) + ':00',
      status:'completed', actualDur: real, durSource: k === 3 ? 'manual' : 'timer',
      startedAt:'2026-09-01T13:00:00.000Z', endedAt:'2026-09-01T13:53:00.000Z',
      club:'guest',
    });
  });
  // Tres inasistencias: 3/33 medidas = 9%, sobre el umbral de 8%.
  for(let k = 0; k < 3; k++){
    BK.push({ code:'SW-NS'+k, name:'No vino '+k, email:'ns'+k+'@x.cl',
      svcId:'corte', svcName:'Corte de cabello', svcCat:'c', price:14000, dur:45,
      barberId:'victoria', barberName:'Victoria', date: monthBack(0, 2 + k), time:'12:00',
      status:'no_show', noShowAt:'2026-09-01T15:00:00.000Z', club:'guest' });
  }
  // Cancelada: no debe contar como ingreso ni como demanda.
  BK.push({ code:'SW-CAN', name:'Canceló', email:'can@x.cl',
    svcId:'corte', svcName:'Corte de cabello', svcCat:'c', price:14000, dur:45,
    barberId:'victoria', barberName:'Victoria', date: monthBack(0, 8), time:'12:00',
    status:'cancelled', cancelledAt:'2026-09-01T15:00:00.000Z', club:'guest' });

  // Inicio real de cada atención, para que mLateStarts tenga qué medir.
  // Un tercio arranca con 15 min de atraso: suficiente para pasar el 20%.
  BK.forEach((b) => {
    if (b.status !== 'completed' || !b.time) return;
    const [hh, mm] = b.time.split(':').map(Number);
    const tarde = /[0369]$/.test(b.code) ? 15 : 1;
    // Hora de pared del negocio -> instante UTC (Chile GMT-3 en septiembre).
    b.startedAt = `${b.date}T${String(hh + 3).padStart(2, '0')}:${String(mm + tarde).padStart(2, '0')}:00.000Z`;
    b.endedAt = new Date(new Date(b.startedAt).getTime() + (b.actualDur || 45) * 60000).toISOString();
  });

  window.__BK = BK;
  window.SWAuth = { signIn: async () => ({uid:'test'}), signOut: async () => {}, onChange: (cb) => { cb({uid:'test'}); return () => {}; } };
  window.SWData = {
    loadAdmin: async () => ({
      services: SVCS.map(s => ({ ...s, id:s.svcId, name:s.svcName, cat:s.svcCat, status:'active' })),
      // Horario real de lunes a sábado: sin esto mOccupancy no tiene
      // disponibilidad y el heatmap sale vacío.
      staff: BARB.map(b => ({ ...b, status:'active', photo:'',
        schedule: [null, DIA, DIA, DIA, DIA, DIA, DIA] })),
      info: { name:'Scissor White', addr:'Cochrane 635', tz:'America/Santiago' },
      log: [], schedule: [],
    }),
    subscribeBookings: (cb) => { cb(window.__BK); return { unsubscribe(){}, ready: Promise.resolve() }; },
    getPatients: async () => [], getScheduleBlocks: async () => [],
    saveAdmin: async () => {}, saveBooking: async () => {}, deleteBooking: async () => {},
    adminSaveBooking: async () => ({ ok: true, id: "x", created: true }),
    loadGoogleReviews: async () => null,
  };
});

let fails = 0;
const check = (name, cond, detail) => {
  if(!cond){ fails++; console.log(`✗ ${name}` + (detail!==undefined?` -> ${JSON.stringify(detail)}`:'')); }
  else console.log(`✓ ${name}`);
};

await page.goto('http://localhost:4480/admin/', { waitUntil:'load' });
// Sin formulario: el panel abre solo cuando onChange entrega una sesión.
await page.waitForSelector('#adm-app', { state:'visible' });
await page.waitForSelector('#a-dash .a-dash-kpis', { timeout:4000 });
await page.waitForTimeout(200);

check('sin errores JS al cargar el Dashboard', errors.length === 0, errors.slice(0,4));

// ══════════ VISTA SIMPLE (el default) ══════════
const simple = await page.evaluate(() => ({
  viewSOn: document.getElementById('a-dash-view-s').classList.contains('a-on'),
  kpis: [...document.querySelectorAll('#a-dash .a-dash-kpis .a-scl')].map(e => e.textContent.trim()),
  svgs: document.querySelectorAll('#a-dash .a-dash-svgwrap svg').length,
  insights: document.querySelectorAll('#a-dash .a-ins').length,
  // Lo que el PDF manda al detalle NO debe estar acá.
  csv: !!document.getElementById('a-dash-csv'),
  retencion: document.querySelectorAll('#a-dash .a-dash-stack').length,
  heat: document.querySelectorAll('#a-dash .a-heat').length,
  nota: (document.querySelector('#a-dash .a-dash-note') || {}).textContent || '',
}));
check('arranca en la vista simple', simple.viewSOn, simple.viewSOn);
check('la vista simple tiene exactamente 5 KPI', simple.kpis.length === 5, simple.kpis);
check('son los 5 KPI que pide el reporte',
  JSON.stringify(simple.kpis) === JSON.stringify(['Ventas del período','Reservas','Asistencia real','No-show','Ticket promedio']),
  simple.kpis);
check('un solo gráfico en la vista simple', simple.svgs === 1, simple.svgs);
check('la vista simple no trae retención, CSV ni heatmap',
  !simple.csv && simple.retencion === 0 && simple.heat === 0, simple);
check('con 33 atenciones medidas aparecen recomendaciones', simple.insights >= 1, simple.insights);
check('el pie declara la cobertura de asistencia', /asistencia registrada/.test(simple.nota), simple.nota.slice(0,140));

// Los KPI de asistencia se calculan sobre las citas MEDIDAS, no sobre el
// total. Se comparan contra un recomputo independiente con el propio
// SWMetrics en vez de un valor fijo: el modo por defecto es "Realizado", así
// que qué citas entran depende de la fecha en que corra el test.
const asis = await page.evaluate(() => {
  const X = window.SWMetrics, BK = window.__BK, tz = 'America/Santiago';
  const today = X.bizToday(tz);
  const mb = X.monthBounds(today.slice(0,7));
  const opts = { from:mb.from, to:mb.to, mode:'realizado', today };
  const att = X.mAttendance(X.mFilterPeriodAll(BK, opts));
  const cov = X.mAttendanceCoverage(X.mFilterPeriod(BK, opts));
  const pintado = Object.fromEntries([...document.querySelectorAll('#a-dash .a-dash-kpis .a-sc')]
    .map(c => [c.querySelector('.a-scl').textContent.trim(), c.querySelector('.a-scv').textContent.trim()]));
  const p = v => v == null ? '—' : Math.round(v*100)+'%';
  return {
    pintado, medidas: att.atendidas + att.noShow, noShow: att.noShow,
    esperadoAsis: p(att.asistenciaPct), esperadoNs: p(att.noShowPct),
    esperadoVentas: '$' + X.mRevenue(X.mFilterPeriod(BK, opts)).toLocaleString('es-CL'),
    coverage: cov.pct,
  };
});
check('hay asistencia medida en el fixture', asis.medidas >= 10, asis.medidas);
check('Asistencia real coincide con el recomputo', asis.pintado['Asistencia real'] === asis.esperadoAsis, asis);

// Los puntos son el recurso visual del no-show: uno por cita medida, los que
// faltaron encendidos. Se comprueba el conteo, no solo que existan.
const puntos = await page.evaluate(() => {
  const card = [...document.querySelectorAll('#a-dash .a-dash-kpis .a-sc')]
    .find(c => /No-show/i.test(c.querySelector('.a-scl').textContent));
  if (!card) return null;
  const d = card.querySelectorAll('.a-kdots i');
  return { total: d.length, on: card.querySelectorAll('.a-kdots i.on').length };
});
check('el no-show muestra un punto por cita medida',
  puntos && puntos.total === asis.medidas, { puntos, medidas: asis.medidas });
check('los puntos encendidos son las inasistencias',
  puntos && puntos.on === asis.noShow, { puntos, noShow: asis.noShow });

// Solo el no-show los lleva: si los tuvieran los cinco KPI volvería el
// problema de que cuando todo destaca, nada destaca.
const conPuntos = await page.evaluate(() =>
  [...document.querySelectorAll('#a-dash .a-dash-kpis .a-sc')]
    .filter(c => c.querySelector('.a-kdots'))
    .map(c => c.querySelector('.a-scl').textContent.trim()));
check('los puntos solo aparecen en el no-show',
  conPuntos.length === 1 && /No-show/i.test(conPuntos[0]), conPuntos);
check('No-show coincide con el recomputo', asis.pintado['No-show'] === asis.esperadoNs, asis);
check('Ventas del período excluye los no-show', asis.pintado['Ventas del período'] === asis.esperadoVentas, asis);
check('la cobertura de asistencia es parcial en el fixture', asis.coverage > 0 && asis.coverage < 1, asis.coverage);

const insCards = await page.evaluate(() => [...document.querySelectorAll('#a-dash .a-ins')].map(c => ({
  tipo: [...c.classList].find(x => x.startsWith('a-ins-') && x !== 'a-ins-wrap'),
  t: (c.querySelector('.a-ins-t')||{}).textContent || '',
  f: (c.querySelector('.a-ins-f')||{}).textContent || '',
})));
check('toda recomendación aclara que no modifica la configuración',
  insCards.length > 0 && insCards.every(c => /no modifica la configuración/.test(c.f)), insCards);
check('no hay más de 3 recomendaciones', insCards.length <= 3, insCards.length);
check('nunca hay dos recomendaciones del mismo tipo',
  new Set(insCards.map(c => c.tipo)).size === insCards.length, insCards.map(c => c.tipo));

// El motor completo corre con el mismo contexto que arma el panel: si a
// renderDash le faltara un insumo, acá se vería como una regla que nunca
// dispara pese a tener los datos.
const motor = await page.evaluate(() => {
  const X = window.SWMetrics, I = window.SWInsights, BK = window.__BK, tz = 'America/Santiago';
  const today = X.bizToday(tz);
  const mb = X.monthBounds(today.slice(0, 7));
  const o = { from: mb.from, to: mb.to, mode: 'realizado', today };
  const period = X.mFilterPeriod(BK, o);
  const att = X.mAttendance(X.mFilterPeriodAll(BK, o));
  const late = X.mLateStarts(period, { tz });
  return {
    reglas: I.REGLA_ORDEN.length,
    late,
    // Se fuerza la regla comparativa con un contexto mínimo para confirmar que
    // está cableada y no solo declarada. La asistencia va SANA a propósito:
    // no_show_alto también es prioridad y, si disparara, ganaría el único
    // cupo de ese tipo y este check no probaría nada.
    conPrev: I.evaluateInsights({
      medidas: 40,
      attendance: { total: 40, atendidas: 38, noShow: 2, noShowConfirmados: 0,
                    canceladas: 0, asistenciaPct: 0.95, noShowPct: 0.05 },
      realTime: [], occupancy: { pct: 0.6 }, heatmap: [],
      byService: [], lateStarts: { medidas: 0, tarde: 0, pct: null, medianaAtrasoMin: null },
      weeklyOccupancy: [],
      kpis: { ingresos: 100, ticket: 10, citas: 40 },
      prev: { medidas: 40,
              attendance: { total: 40, atendidas: 38, noShow: 2, canceladas: 0,
                            asistenciaPct: 0.95, noShowPct: 0.05 },
              realTime: [], occupancy: { pct: 0.6 }, kpis: { ingresos: 1000, ticket: 20 } },
    }).map(c => c.regla),
  };
});
check('el motor declara las 13 reglas', motor.reglas === 13, motor.reglas);
check('mLateStarts midió los inicios del fixture', motor.late.medidas > 0, motor.late);
check('la regla de ventas que caen está cableada',
  motor.conPrev.includes('ventas_bajan'), motor.conPrev);

// ══════════ VISTA EN DETALLE ══════════
await page.click('#a-dash-view-d');
await page.waitForTimeout(200);

const detalle = await page.evaluate(() => ({
  viewDOn: document.getElementById('a-dash-view-d').classList.contains('a-on'),
  tvr: document.querySelectorAll('#a-dash .a-tvr').length,
  heatCells: document.querySelectorAll('#a-dash .a-heat td').length,
  heatRows: document.querySelectorAll('#a-dash .a-heat tbody tr').length,
  kpiRows: document.querySelectorAll('#a-dash .a-dash-kpis').length,
  dev: (document.querySelector('#a-dash .a-tvr-dev') || {}).textContent || '',
  ocupacion: [...document.querySelectorAll('#a-dash .a-dash-kpis .a-scl')].some(e => /Ocupación/.test(e.textContent)),
  dias: [...document.querySelectorAll('#a-dash .a-heat tbody th')].map(e => e.textContent.trim()),
  horas: [...document.querySelectorAll('#a-dash .a-heat thead th')].map(e => e.textContent.trim()).filter(Boolean),
}));
check('el toggle deja activa la vista en detalle', detalle.viewDOn, detalle);
check('aparece tiempo planificado vs real', detalle.tvr >= 1, detalle.tvr);
check('la desviación del corte es +18% (45 plan, 53 mediana)', /\+18%/.test(detalle.dev), detalle.dev);
// El fixture cierra los domingos (schedule[0] es null), así que el mapa no
// debe tener nunca una fila de domingo -- eso es invariante, a diferencia de
// cuántos días de semana caen en el rango, que depende de la fecha de hoy.
check('el mapa tiene entre 1 y 6 filas', detalle.heatRows >= 1 && detalle.heatRows <= 6, detalle.heatRows);
check('el mapa no muestra el domingo, que está cerrado', !detalle.dias.includes('Dom'), detalle.dias);
check('las columnas del mapa son las horas de atención (10-19)',
  detalle.horas[0] === '10' && detalle.horas[detalle.horas.length-1] === '19', detalle.horas);
check('el mapa tiene celdas', detalle.heatCells > 0, detalle.heatCells);
check('aparece el KPI de ocupación efectiva', detalle.ocupacion, detalle);

const layout = await page.evaluate(() => ({
  kpis: document.querySelectorAll('#a-dash .a-dash-kpis')[0].querySelectorAll('.a-sc').length,
  svgs: document.querySelectorAll('#a-dash .a-dash-svgwrap svg').length,
  retRows: document.querySelectorAll('#a-dash .a-dash-stack').length,
  periodOpts: document.querySelectorAll('#a-dash-period option').length,
  hasCsv: !!document.getElementById('a-dash-csv'),
}));
check('la fila principal del detalle mantiene sus 5 KPI', layout.kpis === 5, layout.kpis);
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

// Las dos tendencias lado a lado, arriba del detalle.
await page.evaluate(() => {
  const sh = [...document.querySelectorAll('#a-dash .a-sh')].find(e => /Tendencias/.test(e.textContent));
  if (sh) sh.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(OUT, 'admin-dashboard-tendencias.png') }).catch(() => {});

// Captura acotada de las secciones nuevas del detalle: un screenshot del
// panel completo mide varios miles de píxeles y no sirve para revisar nada.
await page.evaluate(() => {
  const sh = [...document.querySelectorAll('#a-dash .a-sh')].find(e => /Tiempo planificado/.test(e.textContent));
  if(sh) sh.scrollIntoView({ block:'start' });
});
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(OUT, 'admin-dashboard-detalle.png') }).catch(()=>{});
// La vista simple es la pantalla principal del panel: se captura aparte para
// poder revisarla a ojo.
await page.click('#a-dash-view-s');
await page.waitForTimeout(200);
await page.locator('#adm-p-dashboard').screenshot({ path: path.join(OUT, 'admin-dashboard-simple.png') }).catch(()=>{});

console.log(fails === 0 ? '\n== TODO OK ==' : `\n== ${fails} FALLAS ==`);
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
