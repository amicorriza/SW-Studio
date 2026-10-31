// Panel admin: borrado definitivo de un servicio retirado (bug "se duplica").
// Fija: espera del guardado, restauracion si falla, doble clic, auditoria
// enriquecida (intento + resultado) e id de alta con sufijo aleatorio.
//
// Script standalone: `node tests/browser/admin-servicio-borrado.mjs`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const PORT = 4483;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png',
  '.webmanifest':'application/manifest+json','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.svg':'image/svg+xml' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p==='/') p='/home.html'; if(p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{ if(e){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'}); res.end(b); });
});
await new Promise(r=>server.listen(PORT,r));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:1400,height:1100} });
await ctx.route('**gstatic.com/**', r=>r.abort());
await ctx.route('**googleapis.com/**', r=>r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.addInitScript(() => {
  window.__SAVES = [];       // ids de servicios en cada saveAdmin
  window.__AUDIT = [];       // payloads de adminLogEvent
  window.__SAVE_MODE = 'ok'; // 'ok' | 'fail' | 'slow'
  window.SWAuth = { signIn: async () => ({uid:'test'}), signOut: async () => {}, onChange: (cb) => { cb({uid:'test'}); return () => {}; } };
  window.SWData = {
    loadAdmin: async () => (window.__D = {
      services: [
        { id:'corte', name:'Corte de cabello', cat:'c', price:14000, dur:45, status:'active', order:0 },
        { id:'viejo', name:'Servicio viejo', cat:'c', price:9000, dur:30, status:'inactive', order:1 },
      ],
      staff: [{ id:'victoria', name:'Victoria', role:'Barbera', status:'active', photo:'', schedule:[null] }],
      staffAccounts: {},
      info: { name:'Scissor White', addr:'Cochrane 635', tz:'America/Santiago', bufferMin:0, nudgeLeadMin:15 },
      log: [], schedule: [],
    }),
    subscribeBookings: (cb) => { cb([]); return { unsubscribe(){}, ready: Promise.resolve() }; },
    getPatients: async () => [], getScheduleBlocks: async () => [],
    saveAdmin: async (D) => {
      window.__SAVES.push(D.services.map(s => s.id));
      if (window.__SAVE_MODE === 'fail') throw new Error('boom');
      if (window.__SAVE_MODE === 'slow') await new Promise(r => setTimeout(r, 300));
    },
    saveBooking: async () => {},
    adminSaveBooking: async () => ({ ok: true, id: 'x', created: true }),
    adminLogEvent: async (action, item, extra) => { window.__AUDIT.push({ action, item, extra: extra || null }); return { ok: true }; },
    loadGoogleReviews: async () => null,
  };
});

let fails = 0;
const check = (name, cond, detail) => {
  if(!cond){ fails++; console.log(`FALLA ${name}` + (detail!==undefined?` -> ${JSON.stringify(detail)}`:'')); }
  else console.log(`ok ${name}`);
};

await page.goto(`http://localhost:${PORT}/admin/`, { waitUntil:'load' });
await page.waitForSelector('#adm-app', { state:'visible' });
await page.click('.an-item[data-p="services"]');

// Recorre el camino real: abre el modal del servicio retirado, escribe el
// nombre, pulsa "Eliminar para siempre" y confirma en el modal.
async function borrar(clicks = 1) {
  await page.evaluate(() => { window.__SAVES.length = 0; window.__AUDIT.length = 0; });
  await page.click('[data-edit-svc="viejo"]');
  await page.evaluate(() => { document.getElementById('a-sf-dz').open = true; });
  await page.fill('#a-sf-dz-name', 'Servicio viejo');
  await page.click('#a-sf-dz-btn');
  for (let i = 0; i < clicks; i++) await page.evaluate(() => document.getElementById('a-dm-ok').click());
  await page.waitForTimeout(700);
}
const estado = () => page.evaluate(() => ({
  ids: window.__D.services.map(s => s.id),
  alerta: (document.getElementById('a-svc-alert') || {}).textContent || '',
  audit: window.__AUDIT.slice(), saves: window.__SAVES.slice(),
}));

// 1. Guardado con error: se restaura y se avisa, sin decir "eliminado".
await page.evaluate(() => { window.__SAVE_MODE = 'fail'; });
await borrar();
let e = await estado();
check('si el guardado falla, el servicio vuelve a D', e.ids.includes('viejo'), e.ids);
check('si falla, muestra error y NO dice "eliminado definitivamente"',
  /No se pudo/i.test(e.alerta) && !/eliminado definitivamente/.test(e.alerta), e.alerta);
check('auditoria: intento primero y "failed" despues',
  e.audit.length >= 2 && e.audit[0].extra && e.audit[0].extra.outcome === 'attempt'
  && e.audit[e.audit.length-1].extra && e.audit[e.audit.length-1].extra.outcome === 'failed',
  e.audit.map(a => a.extra && a.extra.outcome));

// 2. Guardado ok: el servicio desaparece y se avisa recien ahi.
await page.evaluate(() => { window.__SAVE_MODE = 'ok'; });
await borrar();
e = await estado();
check('borrado ok: el servicio ya no esta en D', !e.ids.includes('viejo'), e.ids);
check('borrado ok: lo que se guarda no lo contiene', e.saves.length === 1 && !e.saves[0].includes('viejo'), e.saves);
check('borrado ok: avisa "eliminado definitivamente"', /eliminado definitivamente/.test(e.alerta), e.alerta);
const ok = e.audit.find(a => a.extra && a.extra.outcome === 'ok');
check('auditoria ok trae serviceId, precio y sesion',
  ok && ok.extra.serviceId === 'viejo' && ok.extra.price === 9000 && /^ses_/.test(ok.extra.sessionId || ''), ok);
check('auditoria trae snapshot previo con status', ok && ok.extra.before && ok.extra.before.name === 'Servicio viejo'
  && ok.extra.before.status === 'inactive', ok && ok.extra.before);
check('el intento se registra antes del guardado', e.audit[0].extra.outcome === 'attempt', e.audit[0]);

// 3. Doble clic: un solo guardado.
await page.reload({ waitUntil:'load' });
await page.waitForSelector('#adm-app', { state:'visible' });
await page.click('.an-item[data-p="services"]');
await page.evaluate(() => { window.__SAVE_MODE = 'slow'; });
await borrar(2);
e = await estado();
check('doble clic en confirmar guarda una sola vez', e.saves.length === 1, e.saves);
check('doble clic: un solo intento auditado', e.audit.filter(a => a.extra && a.extra.outcome === 'attempt').length === 1, e.audit.length);

// 4. Alta: id con sufijo aleatorio.
await page.evaluate(() => { window.__SAVE_MODE = 'ok'; });
for (let i = 0; i < 2; i++) {
  await page.evaluate((i) => {
    document.getElementById('a-svc-new').click();
    document.getElementById('a-sf-n').value = 'Nuevo ' + i;
    document.getElementById('a-sf-p').value = '5000';
    document.getElementById('a-sf-d').value = '30';
    document.getElementById('a-svc-save').click();
  }, i);
  await page.waitForTimeout(200);
}
const nuevos = await page.evaluate(() => window.__D.services.filter(s => /^Nuevo/.test(s.name)).map(s => s.id));
check('altas no colisionan y llevan sufijo aleatorio',
  new Set(nuevos).size === 2 && nuevos.every(i => /^sv_[a-z0-9]+$/.test(i) && i.length > 12), nuevos);

// 5. Duplicar: doble disparo con el modal abierto crea una sola copia.
const antes = await page.evaluate(() => window.__D.services.length);
await page.evaluate(() => { const b = document.querySelector('[data-dup-svc="corte"]'); b.click(); b.click(); });
const despues = await page.evaluate(() => window.__D.services.length);
check('dupSvc ignora el segundo disparo con el modal abierto', despues === antes + 1, { antes, despues });

check('sin errores JS', errors.length === 0, errors.slice(0,3));
console.log(fails === 0 ? '\n== TODO OK ==' : `\n== ${fails} FALLAS ==`);
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
