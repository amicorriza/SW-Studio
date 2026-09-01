// Tarjeta "Reseñas de Google" del panel admin.
//
// Script standalone (no vitest): se corre con `node tests/browser/admin-resenas.mjs`.
// Requiere Playwright, que NO es dependencia del repo todavía:
//   npm install --save-dev playwright && npx playwright install chromium
//
// Levanta un servidor estático sobre `public/` y stubbea `window.SWData`
// ANTES de que corra el script del sitio. Las rutas a gstatic/googleapis se
// abortan a propósito: si `public/js/data.js` real llegara a cargar, pisaría
// el stub con la capa de Firestore de verdad y el test dejaría de ser
// hermético (además de pegarle a la base real).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const OUT = path.resolve(import.meta.dirname, '../../.tmp-screenshots');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p==='/') p='/index.html'; if(p==='/admin/') p='/admin/index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{ if(e){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'}); res.end(b); });
});
await new Promise(r=>server.listen(4479,r));
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:1400,height:1000} });
await ctx.route('**gstatic.com/**', r=>r.abort());
await ctx.route('**googleapis.com/**', r=>r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if(m.type()==='error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push('console: '+m.text()); });

await page.addInitScript(() => {
  window.__saved = null;
  window.__syncCalls = 0;
  window.SWAuth = { signIn: async () => ({uid:'test'}), signOut: async () => {}, onChange: () => () => {} };
  window.SWData = {
    loadAdmin: async () => ({ services:[], staff:[], info:{name:'Scissor White', addr:'Cochrane 635', googlePlaceId:'ChIJguardado'}, log:[], schedule:[] }),
    subscribeBookings: (cb) => { cb([]); return { unsubscribe(){}, ready: Promise.resolve() }; },
    getPatients: async () => [], getScheduleBlocks: async () => [],
    saveAdmin: async () => {},
    loadGoogleReviews: async () => ({
      name:'Scissor White Studio', rating:4.9, userRatingCount:137, placeId:'ChIJguardado',
      fetchedAt:'2026-08-23T09:00:00Z',
      reviews:[{author:'A',rating:5,text:'x'},{author:'B',rating:5,text:'y'}],
      manualReviews:[{author:'Respaldo Uno', rating:5, text:'Reseña de respaldo existente.'}],
    }),
    saveManualReviews: async (arr) => { window.__saved = arr; },
    syncGoogleReviews: async (force) => { window.__syncCalls++; window.__lastForce = force;
      if (window.__nextFresh) return { ok:true, skipped:'fresh', fetchedAt:'2026-08-23T09:00:00Z' };
      return { ok:true, reviews:5, placeId:'ChIJguardado' }; },
  };
});

let fails = 0;
function check(name, cond, detail){
  if(!cond){ fails++; console.log(`✗ ${name}` + (detail!==undefined?` -> ${JSON.stringify(detail)}`:'')); }
  else console.log(`✓ ${name}`);
}

await page.goto('http://localhost:4479/admin/', { waitUntil:'load' });
await page.fill('#adm-pass', 'x');
await page.click('#adm-login-btn');
await page.waitForSelector('#adm-app', { state:'visible' });
await page.waitForTimeout(400);

// Abrir la pestaña Info & Contacto
await page.click('[data-tab="info"]').catch(async () => {
  await page.evaluate(() => { document.getElementById('adm-p-info').classList.add('a-on'); });
});
await page.waitForTimeout(300);

check('sin errores JS al cargar el panel', errors.length === 0, errors.slice(0,3));

const state = await page.evaluate(() => ({
  placeIdInput: document.getElementById('ai-googlePlaceId').value,
  stateTxt: document.getElementById('a-gr-state').textContent.replace(/\s+/g,' ').trim(),
  manualRows: document.querySelectorAll('#a-gr-manual [data-gr-k="author"]').length,
}));
check('el Place ID guardado aparece en el campo', state.placeIdInput === 'ChIJguardado', state.placeIdInput);
check('el estado muestra puntaje y total', /4,9 ★ sobre 137 opiniones/.test(state.stateTxt), state.stateTxt);
check('el estado muestra la última sincronización', /Última sincronización: \d/.test(state.stateTxt), state.stateTxt);
check('carga la reseña de respaldo existente', state.manualRows === 1, state.manualRows);

// Agregar una reseña de respaldo, completarla y guardar
await page.click('#a-gr-add');
await page.waitForTimeout(120);
const rows = await page.locator('#a-gr-manual [data-gr-k="author"]').count();
check('el botón Agregar suma una fila', rows === 2, rows);

await page.locator('#a-gr-manual [data-gr-k="author"]').nth(1).fill('Cliente Nuevo');
await page.locator('#a-gr-manual [data-gr-k="text"]').nth(1).fill('Excelente atención de principio a fin.');
await page.locator('#a-gr-manual [data-gr-k="rating"]').nth(1).selectOption('4');
await page.click('#a-gr-save');
await page.waitForTimeout(300);

const saved = await page.evaluate(() => window.__saved);
check('guarda las dos reseñas', Array.isArray(saved) && saved.length === 2, saved);
check('guarda el texto escrito', saved && saved[1].text === 'Excelente atención de principio a fin.', saved && saved[1]);
check('guarda el puntaje elegido', saved && saved[1].rating === 4, saved && saved[1].rating);
check('agrega publishTime a la reseña nueva', saved && !!Date.parse(saved[1].publishTime), saved && saved[1].publishTime);

// Una fila vacía no debe guardarse
await page.click('#a-gr-add');
await page.click('#a-gr-save');
await page.waitForTimeout(250);
const saved2 = await page.evaluate(() => window.__saved);
check('descarta las filas sin texto', saved2.length === 2, saved2.length);

// Eliminar
await page.locator('#a-gr-manual [data-gr-del]').first().click();
await page.waitForTimeout(120);
const afterDel = await page.locator('#a-gr-manual [data-gr-k="author"]').count();
check('Eliminar quita la fila', afterDel === 1, afterDel);

// Sincronizar ahora
await page.click('#a-gr-sync');
await page.waitForTimeout(400);
const sync = await page.evaluate(() => ({ calls: window.__syncCalls, alert: document.getElementById('a-gr-alert').textContent, btn: document.getElementById('a-gr-sync').textContent, disabled: document.getElementById('a-gr-sync').disabled }));
check('Sincronizar llama al callable', sync.calls === 1, sync.calls);
check('muestra el resultado', /5 reseñas traídas desde Google/.test(sync.alert), sync.alert);
check('el botón vuelve a su estado normal', sync.btn.trim() === 'Sincronizar ahora' && !sync.disabled, sync);
// El botón NO debe forzar: cada llamada a Places se factura y el cron diario ya cubre la actualización.
const lastForce = await page.evaluate(() => window.__lastForce);
check('Sincronizar respeta el guard de frescura (no manda force)', lastForce === false, lastForce);

// Caso "ya estaba al día": mensaje claro, no un fallo silencioso
await page.evaluate(() => { window.__nextFresh = true; });
await page.click('#a-gr-sync');
await page.waitForTimeout(400);
const fresh = await page.evaluate(() => document.getElementById('a-gr-alert').textContent);
check('avisa cuando ya estaba al día, con la fecha', /Ya estaba al día/.test(fresh) && /\d/.test(fresh), fresh);

check('sin errores JS al final', errors.length === 0, errors.slice(0,3));
await page.locator('#adm-p-info').screenshot({ path: path.join(OUT, 'admin-resenas.png') }).catch(()=>{});

console.log(fails === 0 ? '\n== TODO OK ==' : `\n== ${fails} FALLAS ==`);
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
