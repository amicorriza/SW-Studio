// La puerta única del equipo: /login.
//
// Script standalone (no vitest): `node tests/browser/login.mjs`.
//
// Antes cada app tenía su formulario y el que se equivocaba de puerta quedaba
// mirando un mensaje que no podía resolver: el admin veía "tu cuenta no está
// vinculada" en /barbero/, y un barbero veía el panel roto en /admin/. Acá el
// destino se decide UNA vez, así que lo que se prueba son los tres desenlaces
// y, sobre todo, el que no es ninguno de los dos.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const PORT = 4487;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png',
  '.jpg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon',
  '.webmanifest':'application/manifest+json' };
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

// `modo` decide las dos cosas que el ruteo consulta: el claim de admin y si
// getMyDay responde. Nada más entra en la decisión.
async function abrir(modo){
  const ctx = await browser.newContext({ viewport:{width:420,height:820} });
  await ctx.route('**gstatic.com/**', r=>r.abort());
  await ctx.route('**googleapis.com/**', r=>r.abort());
  const page = await ctx.newPage();
  await page.addInitScript((modo) => {
    const usuario = {
      uid: 'uid-' + modo,
      getIdTokenResult: async () => ({ claims: modo === 'admin' ? { admin: true } : {} }),
    };
    window.__SALIDAS = 0;
    window.SWAuth = {
      signIn: async (email, pass) => {
        if (pass === 'mala') { const e = new Error('bad'); e.code = 'auth/wrong-password'; throw e; }
        return usuario;
      },
      signOut: async () => { window.__SALIDAS++; },
      onChange: () => () => {},
    };
    window.SWData = {
      getMyDay: async () => {
        if (modo === 'barbero') return { staffId:'victoria', name:'Victoria', date:'2026-09-08', tz:'America/Santiago', bookings:[] };
        const e = new Error('no vinculada'); e.code = 'functions/permission-denied'; throw e;
      },
    };
  }, modo);
  await page.goto(`http://localhost:${PORT}/login/`, { waitUntil:'load' });
  return { page, ctx };
}

async function entrar(page, pass){
  await page.fill('#email', 'quien@scissorwhite.cl');
  await page.fill('#pass', pass || 'buena');
  await page.click('#btn');
  await page.waitForTimeout(700);
}

// 1. El admin va al panel.
{
  const { page, ctx } = await abrir('admin');
  check('la página no pide nada más que correo y contraseña',
    (await page.locator('input').count()) === 2);
  await entrar(page);
  check('un admin termina en /admin/', /\/admin\/$/.test(page.url()), page.url());
  await ctx.close();
}

// 2. El barbero va a su app.
{
  const { page, ctx } = await abrir('barbero');
  await entrar(page);
  check('un barbero vinculado termina en /barbero/', /\/barbero\/$/.test(page.url()), page.url());
  await ctx.close();
}

// 3. El caso que antes no tenía salida: la cuenta existe en Auth pero nadie la
//    vinculó. Antes rebotaba entre dos pantallas sin explicación.
{
  const { page, ctx } = await abrir('nadie');
  await entrar(page);
  check('sin acceso asignado NO se va a ninguna de las dos apps',
    /\/login\/$/.test(page.url()), page.url());
  const msg = await page.textContent('#msg');
  check('se le dice qué falta y quién puede resolverlo',
    /no tiene acceso asignado/.test(msg) && /salón/.test(msg), msg);
  // Dejar la sesión viva sería dejar a alguien autenticado sin ningún lugar
  // adonde ir, y con la sesión abierta en el dispositivo.
  check('y se cierra la sesión en vez de dejarla colgando',
    (await page.evaluate(() => window.__SALIDAS)) === 1);
  await ctx.close();
}

// 4. Credenciales malas: un mensaje que no revela qué correos existen.
{
  const { page, ctx } = await abrir('admin');
  await entrar(page, 'mala');
  check('con la clave mala se queda en /login/', /\/login\/$/.test(page.url()), page.url());
  const msg = await page.textContent('#msg');
  check('el error no distingue "no existe" de "clave incorrecta"',
    /Correo o contraseña incorrectos/.test(msg), msg);
  check('y el botón vuelve a quedar usable',
    !(await page.locator('#btn').isDisabled()));
  await ctx.close();
}

// 5. Campos vacíos: se avisa sin pegarle al servidor.
{
  const { page, ctx } = await abrir('admin');
  await page.click('#btn');
  await page.waitForTimeout(200);
  check('no intenta entrar con los campos vacíos',
    /Escribe tu correo/.test(await page.textContent('#msg')),
    await page.textContent('#msg'));
  await ctx.close();
}

console.log(fails === 0 ? '\n== TODO OK ==' : `\n== ${fails} FALLAS ==`);
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
