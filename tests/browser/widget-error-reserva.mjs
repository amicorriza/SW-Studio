// tests/browser/widget-error-reserva.mjs
//
// Qué le pasa al cliente cuando reservar falla. Antes TODO lo que no estaba
// mapeado caía en "No pudimos confirmar tu reserva por un problema de
// conexión... lo coordinamos al toque": también los rechazos del servidor.
// Desde el 19-oct-2026 producción devolvió HTTP 400 a clientes reales (horas
// de sábado después de las 16:00, fuera del horario de Victoria) y el widget lo
// presentó como falla de red; la gente reintentaba la misma hora dos y tres
// veces. Además hubo 400 instantáneos y 500 por payloads sin servicio o sin
// fecha: al reabrir el widget, los "Siguiente" seguían habilitados.
//
// SWData stubbeado, como en servicios-por-barbero.mjs. Dos casos esperan
// timeouts reales (8 s y 15 s), así que el script tarda ~35 s.
//
// Script standalone: `node tests/browser/widget-error-reserva.mjs`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const PORT = 4499;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif',
  '.ico':'image/x-icon','.webmanifest':'application/manifest+json','.svg':'image/svg+xml' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p==='/') p='/home.html';
  if(p.endsWith('/')) p += 'index.html';
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

const SERVICES = [{ id:'adulto', name:'Corte de cabello', cat:'c', price:18000, dur:60, status:'active', order:0 }];
const STAFF = [{ id:'victoria', name:'Victoria', role:'Barbera', status:'active', photo:'' }];
// Teléfono con las barras del navegador de Instagram: el alto útil es menor
// que la pantalla.
const TELEFONO = { width:390, height:664 };
const ESCRITORIO = { width:1100, height:900 };

// crear: cómo responde createBooking
//   'fuera-de-horario' -> failed-precondition sin details (isWithinOpenHours)
//   'licencia'         -> failed-precondition con details.license (assertActive)
//   'interno'          -> functions/internal (500 del servidor, o fetch caído)
//   'colgado'          -> nunca responde (lo corta el timeout de 15 s)
// avail: cómo responde getAvailability ('ok' | 'falla' | 'colgado')
async function abrir({ crear = 'interno', avail = 'ok', viewport = ESCRITORIO } = {}){
  const ctx = await browser.newContext({ viewport, timezoneId:'America/Santiago' });
  await ctx.route('**gstatic.com/**', r=>r.abort());
  await ctx.route('**googleapis.com/**', r=>r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(({ services, staff, crear, avail }) => {
    window.__CREATE_CALLS = 0;
    window.__DAY_CALLS = 0;
    window.__AVAIL = avail;
    window.SWData = {
      loadCatalog: async () => ({ services, staff, tz:'America/Santiago', bufferMin:0 }),
      readLicense: async () => ({ status:'active', message:'', suspendAt:'' }),
      getAvailability: () => {
        window.__DAY_CALLS++;
        if(window.__AVAIL === 'falla') return Promise.reject(Object.assign(new Error('internal'), { code:'functions/internal' }));
        if(window.__AVAIL === 'colgado') return new Promise(() => {});
        return Promise.resolve({ barberBusy:{}, workHours:{} });
      },
      subscribeAvailability: (date, cb) => { setTimeout(() => cb({}), 0); return () => {}; },
      createBooking: (b) => {
        window.__CREATE_CALLS++;
        window.__LAST_PAYLOAD = b;
        if(crear === 'colgado') return new Promise(() => {});
        const e = crear === 'fuera-de-horario'
          ? Object.assign(new Error('Ese horario está fuera de la disponibilidad del barbero.'), { code:'functions/failed-precondition' })
          : crear === 'licencia'
          ? Object.assign(new Error('Servicio suspendido.'), { code:'functions/failed-precondition', details:{ license:'suspended' } })
          : Object.assign(new Error('internal'), { code:'functions/internal' });
        return Promise.reject(e);
      },
      getClubStatus: async () => ({ visitCount:1 }),
      loadSiteImages: async () => ({}), loadGoogleReviews: async () => null,
    };
  }, { services:SERVICES, staff:STAFF, crear, avail });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil:'load' });
  await page.waitForFunction(() => typeof window.openBK === 'function');
  await page.evaluate(() => window.openBK());
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}

async function hastaElPaso3(page){
  await page.evaluate(() => document.querySelector('#bk-svcs .bk-svc[data-sid="adulto"]').click());
  await page.click('#bk-next1');
  await page.click('#bk-next2');
  await page.click('#bk-cnext');
  await page.click('.bk-day[data-day]');
}
async function llenarDatos(page){
  await page.fill('#bkf-name', 'Juana Pérez');
  await page.fill('#bkf-phone', '+56912345678');
  await page.fill('#bkf-email', 'juana@mail.com');
  await page.check('#bkf-consent', { force:true });
}
async function hastaElPaso4(page){
  await hastaElPaso3(page);
  await page.waitForSelector('.bk-slot:not(.bk-taken)', { timeout:3000 });
  await page.click('.bk-slot:not(.bk-taken)');
  await page.click('#bk-next3');
  await llenarDatos(page);
}

const errorVisible = async (page) => (await page.isVisible('#bk-submit-err')) ? (await page.textContent('#bk-submit-err')).trim() : '';
const informal = (t) => /al toque/i.test(t) || /--/.test(t);
const aLaVista = (page, sel) => page.$eval(sel, el => {
  const r = el.getBoundingClientRect();
  return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
});

// 1. El caso de la captura, en un teléfono: el servidor rechaza la hora.
{
  const { ctx, page, errors } = await abrir({ crear:'fuera-de-horario', viewport:TELEFONO });
  await hastaElPaso4(page);
  const consultasAntes = await page.evaluate(() => window.__DAY_CALLS);
  await page.click('#bk-submit');
  await page.waitForSelector('#bks-3.active', { timeout:5000 }).catch(()=>{});
  await page.waitForSelector('.bk-slot', { timeout:3000 }).catch(()=>{});
  await page.waitForTimeout(100);
  check('fuera de horario: vuelve al paso 3 a elegir otra hora', await page.isVisible('#bks-3.active'));
  const aviso = (await page.isVisible('#bk-slot-taken-msg')) ? (await page.textContent('#bk-slot-taken-msg')).trim() : '';
  check('fuera de horario: dice que ese horario no está disponible', /no está disponible/i.test(aviso), aviso);
  check('fuera de horario: no lo atribuye a la conexión', !/conexi/i.test(aviso), aviso);
  check('fuera de horario: el aviso se ve en el teléfono sin hacer scroll', await aLaVista(page, '#bk-slot-taken-msg'));
  check('fuera de horario: la hora rechazada se suelta', await page.isDisabled('#bk-next3')
    && (await page.textContent('#ss-time')).trim() === '—' && (await page.$$('.bk-slot.bk-selslot')).length === 0);
  check('fuera de horario: vuelve a pedir el horario real del día',
    (await page.evaluate(() => window.__DAY_CALLS)) > consultasAntes);
  check('fuera de horario: sin errores JS', errors.length === 0, errors);
  await ctx.close();
}

// 2. Licencia suspendida: también es failed-precondition, pero NO es "horario".
{
  const { ctx, page, errors } = await abrir({ crear:'licencia' });
  await hastaElPaso4(page);
  await page.click('#bk-submit');
  await page.waitForSelector('#bk-suspended', { state:'visible', timeout:5000 }).catch(()=>{});
  check('licencia: muestra el aviso de servicio suspendido', await page.isVisible('#bk-suspended'));
  check('licencia: no lo confunde con un horario no disponible', !(await page.isVisible('#bk-slot-taken-msg')));
  check('licencia: sin errores JS', errors.length === 0, errors);
  await ctx.close();
}

// 3. Un error que el widget no sabe explicar: texto formal y sin inventar la causa.
{
  const { ctx, page, errors } = await abrir({ crear:'interno' });
  await hastaElPaso4(page);
  await page.click('#bk-submit');
  await page.waitForSelector('#bk-submit-err', { state:'visible', timeout:5000 }).catch(()=>{});
  const t = await errorVisible(page);
  check('error genérico: se muestra en el paso 4', t !== '' && await page.isVisible('#bks-4.active'), t);
  check('error genérico: deja claro que no quedó agendado', /no fue posible confirmar tu reserva/i.test(t) && /no quedó ninguna hora agendada/i.test(t), t);
  check('error genérico: no culpa a la conexión', !/conexi/i.test(t), t);
  check('error genérico: sin coloquialismos ni guiones dobles', !informal(t), t);
  check('error genérico: ofrece WhatsApp', await page.isVisible('#bk-submit-err a[href^="https://wa.me/"]'));
  check('error genérico: el botón vuelve a quedar disponible', !(await page.isDisabled('#bk-submit')));
  check('error genérico: sin errores JS', errors.length === 0, errors);
  await ctx.close();
}

// 4. Sin red: ahí sí corresponde hablar de conexión.
{
  const { ctx, page, errors } = await abrir({ crear:'interno' });
  await hastaElPaso4(page);
  await ctx.setOffline(true);
  await page.click('#bk-submit');
  await page.waitForSelector('#bk-submit-err', { state:'visible', timeout:5000 }).catch(()=>{});
  const t = await errorVisible(page);
  check('sin red: lo atribuye a la conexión', /problema de conexión/i.test(t) && /verifica que tengas internet/i.test(t), t);
  check('sin red: formal', !informal(t), t);
  check('sin red: sin errores JS', errors.length === 0, errors);
  await ctx.close();
}

// 5. Reabrir el widget: lo elegido antes ya no existe y no se puede avanzar sin elegir.
{
  const { ctx, page, errors } = await abrir({ crear:'interno' });
  await hastaElPaso4(page);
  await page.evaluate(() => { window.closeBK(); window.openBK(); });
  await page.waitForTimeout(250);
  check('reabrir: "Siguiente" del paso 1 parte deshabilitado', await page.isDisabled('#bk-next1'));
  check('reabrir: "Continuar" del paso 3 parte deshabilitado', await page.isDisabled('#bk-next3'));
  // Red de seguridad: aunque algo lleve al paso 4 sin elegir, no se manda nada.
  await page.evaluate(() => window.bkGoTo(4));
  await llenarDatos(page);
  await page.click('#bk-submit');
  await page.waitForTimeout(1200);
  check('reabrir: sin servicio no se llama a createBooking', (await page.evaluate(() => window.__CREATE_CALLS)) === 0);
  check('reabrir: y se vuelve a elegir servicio', await page.isVisible('#bks-1.active'));
  check('reabrir: sin errores JS', errors.length === 0, errors);
  await ctx.close();
}

// 5b. Club SW: se envía lo que la pantalla muestra. "Miembro" viene marcado de
// fábrica, pero openBK() borraba S.club y la reserva salía como 'guest': el
// cliente veía "Bienvenido al Club SW" y su visita no sumaba.
{
  const { ctx, page, errors } = await abrir({ crear:'interno' });
  const marcado = () => page.$eval('.bk-club-opt.bk-club-selected', el => el.dataset.club).catch(() => null);
  await hastaElPaso4(page);
  check('club: "Miembro" viene marcado', (await marcado()) === 'member', await marcado());
  await page.click('#bk-submit');
  await page.waitForSelector('#bk-submit-err', { state:'visible', timeout:5000 }).catch(()=>{});
  const p1 = await page.evaluate(() => window.__LAST_PAYLOAD);
  check('club: sin tocar la opción se envía como miembro', p1 && p1.club === 'member', p1 && p1.club);

  // Elige "Invitado", cierra y reabre: es la misma persona, se respeta su elección.
  await page.click('.bk-club-opt[data-club="guest"]');
  await page.evaluate(() => { window.closeBK(); window.openBK(); });
  await page.waitForTimeout(250);
  await hastaElPaso4(page);
  check('club: al reabrir sigue marcada la opción elegida', (await marcado()) === 'guest', await marcado());
  await page.click('#bk-submit');
  await page.waitForFunction(() => window.__CREATE_CALLS >= 2, null, { timeout:5000 }).catch(()=>{});
  const p2 = await page.evaluate(() => window.__LAST_PAYLOAD);
  check('club: y se envía esa opción', p2 && p2.club === 'guest', p2 && p2.club);
  check('club: sin errores JS', errors.length === 0, errors);
  await ctx.close();
}

// 6. getAvailability falla: el widget falla abierto con el horario general.
{
  const { ctx, page, errors } = await abrir({ crear:'fuera-de-horario', avail:'falla' });
  await hastaElPaso3(page);
  await page.waitForSelector('.bk-slot', { timeout:3000 }).catch(()=>{});
  check('falla del horario: igual muestra horas (no queda "Buscando…")', (await page.$$('.bk-slot:not(.bk-taken)')).length > 0,
    (await page.textContent('#bk-slots')).trim().slice(0, 60));
  check('falla del horario: sin errores JS', errors.length === 0, errors);
  await ctx.close();
}

// 7. getAvailability no responde: a los 8 s también falla abierto.
{
  const { ctx, page, errors } = await abrir({ avail:'colgado' });
  await hastaElPaso3(page);
  await page.waitForSelector('.bk-slot', { timeout:12000 }).catch(()=>{});
  check('horario sin respuesta: a los 8 s muestra horas', (await page.$$('.bk-slot:not(.bk-taken)')).length > 0,
    (await page.textContent('#bk-slots')).trim().slice(0, 60));
  check('horario sin respuesta: sin errores JS', errors.length === 0, errors);
  await ctx.close();
}

// 8. createBooking no responde en 15 s: no se sabe si quedó, y el texto no lo niega.
{
  const { ctx, page, errors } = await abrir({ crear:'colgado' });
  await hastaElPaso4(page);
  await page.click('#bk-submit');
  await page.waitForSelector('#bk-submit-err', { state:'visible', timeout:20000 }).catch(()=>{});
  const t = await errorVisible(page);
  check('sin respuesta: advierte que pudo haber quedado agendada', /es posible que haya quedado agendada/i.test(t) && /correo/i.test(t), t);
  check('sin respuesta: no afirma que no quedó nada', !/no quedó ninguna hora agendada/i.test(t), t);
  check('sin respuesta: formal y con WhatsApp', !informal(t) && await page.isVisible('#bk-submit-err a[href^="https://wa.me/"]'), t);
  check('sin respuesta: sin errores JS', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
server.close();
console.log(fails ? `\n== ${fails} FALLAS ==` : '\n== TODO OK ==');
process.exit(fails ? 1 : 0);
