// tests/browser/suspension.mjs
//
// Suspensión del servicio (spec 2026-10-05-suspension-servicio-design.md):
// lo que PINTA cada frontend según license/main. El corte real lo prueban
// tests/rules/license.test.js y tests/e2e/suspension.mjs; acá SWAuth/SWData
// van stubbeados con addInitScript, igual que en admin-redirect-barbero.mjs.
//
// Script standalone: `node tests/browser/suspension.mjs`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const PORT = 4491;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif',
  '.ico':'image/x-icon','.webmanifest':'application/manifest+json','.svg':'image/svg+xml' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p==='/') p='/index.html';
  if(p.endsWith('/')) p += 'index.html';
  if(!path.extname(p)) p += '/index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{ if(e){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'}); res.end(b); });
});
await new Promise(r=>server.listen(PORT,r));
const browser = await chromium.launch();

let fails = 0;
const check = (name, cond, detail) => {
  if(!cond){ fails++; console.log(`✗ ${name}` + (detail!==undefined?` -> ${JSON.stringify(detail)}`:'')); }
  else console.log(`✓ ${name}`);
};

async function nuevaPagina(viewport){
  const ctx = await browser.newContext({ viewport });
  await ctx.route('**gstatic.com/**', r=>r.abort());
  await ctx.route('**googleapis.com/**', r=>r.abort());
  return { ctx, page: await ctx.newPage() };
}

// ═══════════════ PANEL ADMIN ═══════════════
async function abrirAdmin(lic){
  const { ctx, page } = await nuevaPagina({ width:1200, height:900 });
  await page.addInitScript((lic) => {
    window.SWAuth = { signIn: async () => ({uid:'a'}), signOut: async () => {}, onChange: (cb) => { cb({uid:'a'}); return () => {}; } };
    window.SWData = {
      loadAdmin: async () => ({ services:[], staff:[], staffAccounts:{}, info:{}, log:[], schedule:[] }),
      readLicense: async () => lic,
      getMyDay: async () => { const e = new Error('x'); e.code = 'functions/permission-denied'; throw e; },
      subscribeBookings: (cb) => { cb([]); return { unsubscribe(){}, ready: Promise.resolve() }; },
      getPatients: async () => [], getScheduleBlocks: async () => [],
      saveAdmin: async () => {}, loadGoogleReviews: async () => null,
    };
  }, lic);
  await page.goto(`http://localhost:${PORT}/admin/`, { waitUntil:'load' });
  await page.waitForTimeout(900);
  return { ctx, page };
}

{
  const { ctx, page } = await abrirAdmin({ status:'active', message:'', suspendAt:'' });
  check('admin activo: panel visible', await page.isVisible('#adm-app'));
  check('admin activo: sin overlay', !(await page.isVisible('#adm-susp')));
  check('admin activo: sin banner', !(await page.isVisible('#adm-license-banner')));
  // Review Focus #3: suspensión con el panel ya abierto.
  await page.evaluate(() => {
    window.SWData.readLicense = async () => ({ status:'suspended', message:'Escribe a soporte', suspendAt:'' });
    window.dispatchEvent(new CustomEvent('sw:license-suspended'));
  });
  await page.waitForTimeout(300);
  check('admin: sw:license-suspended con el panel abierto muestra el overlay', await page.isVisible('#adm-susp'));
  check('y trae el mensaje de license/main', ((await page.textContent('#adm-susp-msg')) || '').includes('Escribe a soporte'));
  await ctx.close();
}

{
  const { ctx, page } = await abrirAdmin({ status:'warning', message:'', suspendAt:'2026-10-15' });
  check('admin warning: banner visible', await page.isVisible('#adm-license-banner'));
  check('admin warning: banner con la fecha', ((await page.textContent('#adm-license-banner-t')) || '').includes('15-10-2026'));
  check('admin warning: sin overlay', !(await page.isVisible('#adm-susp')));
  await ctx.close();
}

{
  const { ctx, page } = await abrirAdmin({ status:'suspended', message:'', suspendAt:'' });
  check('admin suspendido: overlay visible', await page.isVisible('#adm-susp'));
  check('admin suspendido: mensaje por defecto si no hay message',
    ((await page.textContent('#adm-susp-msg')) || '').trim().length > 10);
  check('admin suspendido: botón cerrar sesión', await page.isVisible('#adm-susp-out'));
  await ctx.close();
}

// Un barbero que cae en el panel estando suspendido: loadAdmin falla y getMyDay
// dice "suspendido". Debe ir a /barbero/ (ahí ve la pantalla de suspensión), no
// quedarse en el panel con el banner de error.
{
  const { ctx, page } = await nuevaPagina({ width:1200, height:900 });
  await page.addInitScript(() => {
    window.SWAuth = { signIn: async () => ({uid:'b'}), signOut: async () => {}, onChange: (cb) => { cb({uid:'b'}); return () => {}; } };
    window.SWData = {
      loadAdmin: async () => { const e = new Error('perm'); e.code = 'permission-denied'; throw e; },
      getMyDay: async () => { const e = new Error('Servicio suspendido.'); e.code = 'functions/failed-precondition'; e.details = { license:'suspended' }; throw e; },
      subscribeBookings: (cb) => { cb([]); return { unsubscribe(){}, ready: Promise.resolve() }; },
      getPatients: async () => [], getScheduleBlocks: async () => [],
    };
  });
  await page.goto(`http://localhost:${PORT}/admin/`, { waitUntil:'load' });
  await page.waitForTimeout(900);
  check('barbero en el panel con licencia suspendida termina en /barbero/', /\/barbero\/$/.test(page.url()), page.url());
  await ctx.close();
}

// ═══════════════ PWA BARBERO ═══════════════
{
  const { ctx, page } = await nuevaPagina({ width:420, height:840 });
  await page.addInitScript(() => {
    const u = { uid:'b', getIdTokenResult: async () => ({ claims:{} }) };
    window.__SALIDAS = 0;
    window.SWAuth = { signIn: async () => u, signOut: async () => { window.__SALIDAS++; }, onChange: (f) => { f(u); return () => {}; } };
    window.SWData = {
      getMyDay: async () => { const e = new Error('Servicio suspendido.'); e.code = 'functions/failed-precondition'; e.details = { license:'suspended' }; throw e; },
      saveMyPushToken: async () => {},
    };
  });
  await page.goto(`http://localhost:${PORT}/barbero/`, { waitUntil:'load' });
  await page.waitForTimeout(900);
  check('PWA suspendida: pantalla de suspensión', /suspendido/i.test((await page.textContent('#b-login-err')) || ''));
  check('PWA suspendida: la agenda NO se ve', !(await page.isVisible('#b-app')));
  check('PWA suspendida: botón Salir visible', await page.isVisible('#b-susp-out'));
  if (await page.isVisible('#b-susp-out')) await page.click('#b-susp-out');
  check('PWA suspendida: Salir cierra la sesión', (await page.evaluate(() => window.__SALIDAS)) === 1);
  await ctx.close();
}

// ═══════════════ /login ═══════════════
// Un barbero con licencia suspendida debe ir a /barbero/ (ve la explicación),
// no recibir "tu cuenta no tiene acceso" y quedar deslogueado.
{
  const { ctx, page } = await nuevaPagina({ width:420, height:820 });
  await page.addInitScript(() => {
    const u = { uid:'b', getIdTokenResult: async () => ({ claims:{} }) };
    window.SWAuth = { signIn: async () => u, signOut: async () => {}, onChange: () => () => {} };
    window.SWData = {
      getMyDay: async () => { const e = new Error('Servicio suspendido.'); e.code = 'functions/failed-precondition'; e.details = { license:'suspended' }; throw e; },
    };
  });
  await page.goto(`http://localhost:${PORT}/login/`, { waitUntil:'load' });
  await page.fill('#email', 'victoria@scissorwhite.cl');
  await page.fill('#pass', 'buena');
  await page.click('#btn');
  await page.waitForTimeout(900);
  check('login con licencia suspendida manda al barbero a /barbero/', /\/barbero\/$/.test(page.url()), page.url());
  await ctx.close();
}

// ═══════════════ WIDGET ═══════════════
async function abrirWidget(licFn){
  const { ctx, page } = await nuevaPagina({ width:1200, height:900 });
  await page.addInitScript((licFn) => {
    window.__LIC = licFn;
    window.SWAuth = { onChange: () => () => {} };
    window.SWData = {
      loadCatalog: async () => ({ services:[], staff:[], tz:'America/Santiago', bufferMin:0 }),
      readLicense: async () => {
        if (window.__LIC === 'falla') throw new Error('offline');
        return { status: window.__LIC, message:'motivo interno', suspendAt:'' };
      },
      subscribeAvailability: () => () => {},
      loadGoogleReviews: async () => null, loadSiteImages: async () => ({}),
    };
  }, licFn);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil:'load' });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.openBK());
  await page.waitForTimeout(400);
  return { ctx, page };
}

{
  const { ctx, page } = await abrirWidget('suspended');
  check('widget suspendido: aviso visible', await page.isVisible('#bk-suspended'));
  check('widget suspendido: wizard oculto', !(await page.isVisible('#bk-body')));
  const txt = (await page.textContent('#bk-suspended').catch(() => '')) || '';
  check('widget suspendido: NO muestra el motivo interno', !txt.includes('motivo interno'), txt);
  check('widget suspendido: ofrece WhatsApp', await page.isVisible('#bk-suspended a[href*="wa.me/56982514114"]'));
  // Review Focus #4: reactivar sin recargar.
  await page.evaluate(() => { window.closeBK(); window.__LIC = 'active'; window.openBK(); });
  await page.waitForTimeout(400);
  check('widget: reabrir con licencia activa vuelve a mostrar el wizard', await page.isVisible('#bk-body'));
  check('widget: y esconde el aviso', !(await page.isVisible('#bk-suspended')));
  await ctx.close();
}

// Review Focus #5: si no se puede leer la licencia, el widget falla abierto.
{
  const { ctx, page } = await abrirWidget('falla');
  check('widget con lectura fallida: wizard visible', await page.isVisible('#bk-body'));
  check('widget con lectura fallida: sin aviso', !(await page.isVisible('#bk-suspended')));
  await ctx.close();
}

// ── fin ──
await browser.close();
server.close();
console.log(fails === 0 ? '\n== TODO OK ==' : `\n== ${fails} FALLAS ==`);
process.exit(fails ? 1 : 0);
