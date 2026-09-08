// Un barbero que entra por el login del panel admin termina en /barbero/.
//
// Script standalone (no vitest): `node tests/browser/admin-redirect-barbero.mjs`.
//
// Lo que se prueba no es la redirección por sí sola, sino CÓMO se decide.
// El panel no lleva una copia del predicado isAdmin() (ya vive repetido en
// cuatro archivos); le pregunta al servidor. De ahí los tres casos: el que
// redirige, el admin que NO debe ser expulsado de su propio panel, y la caída
// de red, que se parece a "no sos admin" y no debe redirigir a nadie.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif',
  '.ico':'image/x-icon','.webmanifest':'application/manifest+json' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p==='/') p='/index.html';
  if(p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{ if(e){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'}); res.end(b); });
});
await new Promise(r=>server.listen(4482,r));
const browser = await chromium.launch();

let fails = 0;
function check(name, cond, detail){
  if(!cond){ fails++; console.log(`✗ ${name}` + (detail!==undefined?` -> ${JSON.stringify(detail)}`:'')); }
  else console.log(`✓ ${name}`);
}

// `modo` decide qué hacen los dos stubs que importan: loadAdmin (la lectura
// admin-only) y getMyDay (el callable que solo responde a un barbero vinculado).
async function entrar(modo){
  const ctx = await browser.newContext({ viewport:{width:1200,height:900} });
  await ctx.route('**gstatic.com/**', r=>r.abort());
  await ctx.route('**googleapis.com/**', r=>r.abort());
  const page = await ctx.newPage();
  await page.addInitScript((modo) => {
    const denegado = () => { const e = new Error('Missing or insufficient permissions.');
      e.code = 'permission-denied'; throw e; };
    window.SWAuth = { signIn: async () => ({uid:'test'}), signOut: async () => {}, onChange: (cb) => { cb({uid:'test'}); return () => {}; } };
    window.SWData = {
      loadAdmin: async () => {
        if (modo !== 'admin') denegado();
        return { services:[], staff:[], staffAccounts:{}, info:{}, log:[], schedule:[] };
      },
      getMyDay: async () => {
        if (modo !== 'barbero') denegado();
        return { staffId:'victoria', name:'Victoria', date:'2026-09-07', tz:'America/Santiago', bookings:[] };
      },
      subscribeBookings: (cb) => { cb([]); return { unsubscribe(){}, ready: Promise.resolve() }; },
      getPatients: async () => [], getScheduleBlocks: async () => [],
      saveAdmin: async () => {}, loadGoogleReviews: async () => null,
    };
  }, modo);
  await page.goto('http://localhost:4482/admin/', { waitUntil:'load' });
  // Sin formulario: el panel abre solo cuando onChange entrega una sesión.
  await page.waitForTimeout(900);
  return { page, ctx };
}

// 1. El caso que motivó todo esto.
{
  const { page, ctx } = await entrar('barbero');
  check('un barbero vinculado termina en /barbero/', /\/barbero\/$/.test(page.url()), page.url());
  await ctx.close();
}

// 2. El riesgo del arreglo: equivocarse hacia el otro lado deja al admin
//    fuera de su propio panel, y eso es peor que el bug original.
{
  const { page, ctx } = await entrar('admin');
  check('el admin se queda en /admin/', /\/admin\/$/.test(page.url()), page.url());
  check('y el panel se muestra', await page.isVisible('#adm-app'));
  check('sin el banner de error', !(await page.isVisible('#adm-load-err-banner')));
  await ctx.close();
}

// 3. Una caída de red hace fallar loadAdmin igual que la falta de permisos.
//    Si eso bastara para redirigir, un admin sin conexión aterrizaría en una
//    app que no es la suya.
{
  const { page, ctx } = await entrar('caido');
  check('con todo caído NO redirige a nadie', /\/admin\/$/.test(page.url()), page.url());
  check('y avisa con el banner', await page.isVisible('#adm-load-err-banner'));
  await ctx.close();
}


// ── el caso simétrico: un admin que abre la app del barbero ──
// No tiene ficha de profesional, así que getMyDay lo rechaza y se queda
// mirando "tu cuenta no está vinculada": cierto, y también inútil.
//
// Acá la PWA SÍ lee el custom claim en el navegador, y no contradice al panel:
// desde la Fase 3 el claim es el ÚNICO criterio de admin, así que no hay un
// predicado de dos partes que copiar. Y decide una navegación, no un permiso.
async function entrarBarbero(modo) {
  const ctx = await browser.newContext({ viewport:{width:420,height:840} });
  await ctx.route('**gstatic.com/**', r=>r.abort());
  await ctx.route('**googleapis.com/**', r=>r.abort());
  const page = await ctx.newPage();
  await page.addInitScript((modo) => {
    const usuario = {
      uid: modo === 'admin' ? 'uid-admin' : 'uid-nadie',
      getIdTokenResult: async () => ({ claims: modo === 'admin' ? { admin: true } : {} }),
    };
    window.SWAuth = {
      signIn: async () => usuario,
      signOut: async () => {},
      onChange: (f) => { f(usuario); return () => {}; },
    };
    window.SWData = {
      getMyDay: async () => {
        // Ni el admin ni una cuenta suelta tienen ficha: los dos reciben lo
        // mismo del servidor. Lo que los separa es el claim, no el error.
        const e = new Error('Esta cuenta no está vinculada a ningún profesional.');
        e.code = 'functions/permission-denied';
        throw e;
      },
      saveMyPushToken: async () => {},
    };
  }, modo);
  await page.goto('http://localhost:4482/barbero/', { waitUntil:'load' });
  // La PWA tampoco pide clave: onChange ya entregó la sesión.
  await page.waitForTimeout(900);
  return { page, ctx };
}

{
  const { page, ctx } = await entrarBarbero('admin');
  check('un admin que entra por la app del barbero termina en /admin/',
    /\/admin\/$/.test(page.url()), page.url());
  await ctx.close();
}

// El que NO debe moverse: una cuenta sin ficha y sin claim. Mandarla al panel
// sería mandarla a otra pantalla que tampoco puede usar.
{
  const { page, ctx } = await entrarBarbero('nadie');
  check('una cuenta sin ficha y sin claim NO se redirige a ninguna parte',
    /\/barbero\/$/.test(page.url()), page.url());
  check('y se le dice qué le falta',
    /no está vinculada/.test(await page.textContent('body')),
    (await page.textContent('body')).slice(0, 120));
  await ctx.close();
}

console.log(fails === 0 ? '\n== TODO OK ==' : `\n== ${fails} FALLAS ==`);
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
