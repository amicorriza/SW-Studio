// El gate de sesión del panel (GATE DE SESIÓN, al final de public/admin/index.html)
// no puede decidir nada antes de que los <script type="module"> (firebase-init.js,
// data.js, auth.js) terminen de cargar: son diferidos, así que el navegador los
// ejecuta DESPUÉS del <script> clásico que contiene el gate, sin importar el orden
// en el que aparezcan las etiquetas. Si el gate lee window.SWAuth/SWData sin
// esperar a DOMContentLoaded, siempre los encuentra undefined y manda a cualquiera
// -- admin incluido -- a /login. Y como /login SÍ espera a DOMContentLoaded, ve la
// sesión real, decide "admin" y manda de vuelta a /admin/: login y admin se turnan
// reemplazándose sin parar. Así se reportó: "itera entre admin y login sin
// realmente ingresar", sin nada en la consola porque cada vuelta es una recarga
// completa, no una excepción.
//
// A diferencia de los demás tests/browser/*, acá NO se usa page.addInitScript para
// plantar window.SWAuth: eso corre antes que CUALQUIER script de la página --
// incluido el <script> clásico -- y esconde justo la ventana de tiempo que este
// test necesita observar. En su lugar se interceptan los tres <script
// type="module"> reales y se retrasa su respuesta, para que "el clásico ya corrió,
// los módulos todavía no" deje de ser una carrera de milisegundos en localhost y
// se vuelva determinista.
//
// Script standalone (no vitest): `node tests/browser/admin-gate-timing.mjs`.
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
await new Promise(r=>server.listen(4483,r));
const browser = await chromium.launch();

let fails = 0;
function check(name, cond, detail){
  if(!cond){ fails++; console.log(`✗ ${name}` + (detail!==undefined?` -> ${JSON.stringify(detail)}`:'')); }
  else console.log(`✓ ${name}`);
}

// Un admin válido de verdad: loadAdmin resuelve, no hace falta ficha de barbero.
const FAKE = {
  '/js/firebase-init.js': `export {};`,
  '/js/data.js': `
    window.SWData = {
      loadAdmin: async () => ({ services:[], staff:[], staffAccounts:{}, info:{}, log:[], schedule:[] }),
      getMyDay: async () => { const e = new Error('no'); e.code='permission-denied'; throw e; },
      subscribeBookings: (cb) => { cb([]); return { unsubscribe(){}, ready: Promise.resolve() }; },
      getPatients: async () => [], getScheduleBlocks: async () => [],
      saveAdmin: async () => {}, loadGoogleReviews: async () => null,
    };
    export {};
  `,
  '/js/auth.js': `
    window.SWAuth = {
      signIn: async () => ({ uid:'test' }),
      signOut: async () => {},
      onChange: (cb) => { cb({ uid:'test' }); return () => {}; },
    };
    export {};
  `,
};

async function abrirConModulosLentos(delayMs){
  const ctx = await browser.newContext({ viewport:{width:1200,height:900} });
  await ctx.route('**gstatic.com/**', r=>r.abort());
  await ctx.route('**googleapis.com/**', r=>r.abort());
  for (const [p, body] of Object.entries(FAKE)){
    await ctx.route('**' + p, async (route) => {
      if (delayMs) await new Promise(r=>setTimeout(r, delayMs));
      await route.fulfill({ contentType:'text/javascript', body });
    });
  }
  const page = await ctx.newPage();
  const urls = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) urls.push(f.url()); });
  await page.goto('http://localhost:4483/admin/', { waitUntil:'commit' });
  await page.waitForTimeout(delayMs + 400);
  return { page, ctx, urls };
}

{
  const { page, ctx, urls } = await abrirConModulosLentos(400);
  check('un admin válido no rebota a /login mientras cargan los módulos',
    !urls.some((u) => /\/login\/?$/.test(u)), urls);
  check('termina en /admin/ con el panel visible',
    /\/admin\/$/.test(page.url()) && await page.isVisible('#adm-app'), page.url());
  await ctx.close();
}

console.log(fails === 0 ? '\n== TODO OK ==' : `\n== ${fails} FALLAS ==`);
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
