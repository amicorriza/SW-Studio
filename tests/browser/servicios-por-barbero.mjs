// tests/browser/servicios-por-barbero.mjs
//
// Qué servicios presta cada profesional (staff.serviceIds). Acá se prueba lo
// que PINTAN el widget y el panel, con SWData stubbeado; el rechazo real lo
// prueban functions/test/createBooking.test.js y tests/e2e/callables.mjs.
//
// Script standalone: `node tests/browser/servicios-por-barbero.mjs`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const PORT = 4497;
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
const iguales = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// corte lo prestan los dos; barba solo Ariel; visagismo solo Victoria; huerfano
// nadie. 'viejo' está retirado y Ariel lo tiene en su lista.
const SERVICES = [
  { id:'corte', name:'Corte', cat:'c', price:18000, dur:60, status:'active', order:0 },
  { id:'barba', name:'Barba', cat:'c', price:13000, dur:30, status:'active', order:1 },
  { id:'visagismo', name:'Visagismo', cat:'a', price:55000, dur:120, status:'active', order:2 },
  { id:'huerfano', name:'Sin nadie', cat:'c', price:9000, dur:30, status:'active', order:3 },
  { id:'viejo', name:'Retirado', cat:'c', price:9000, dur:30, status:'inactive', order:4 },
];
const VICTORIA = { id:'victoria', name:'Victoria', role:'Senior', status:'active', photo:'', serviceIds:['corte','visagismo'] };
const ARIEL = { id:'ariel', name:'Ariel', role:'Barbero', status:'active', photo:'', serviceIds:['corte','barba','viejo'] };
const STAFF = [VICTORIA, ARIEL];

async function nuevaPagina(viewport){
  const ctx = await browser.newContext({ viewport, timezoneId:'America/Santiago' });
  await ctx.route('**gstatic.com/**', r=>r.abort());
  await ctx.route('**googleapis.com/**', r=>r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  return { ctx, page, errors };
}

// ═══════════════ WIDGET PÚBLICO ═══════════════
async function abrirWidget(catalogo){
  const { ctx, page, errors } = await nuevaPagina({ width:1100, height:900 });
  await page.addInitScript((cat) => {
    window.__CAT = cat;
    window.__BOOKINGS = [];
    window.__REJECT = false;
    window.SWData = {
      loadCatalog: async () => {
        if(window.__CAT === 'falla') throw new Error('offline');
        return { services: window.__CAT.services, staff: window.__CAT.staff, tz:'America/Santiago', bufferMin:0 };
      },
      readLicense: async () => ({ status:'active', message:'', suspendAt:'' }),
      getAvailability: async () => ({ barberBusy:{}, workHours:{} }),
      subscribeAvailability: (date, cb) => { setTimeout(() => cb({}), 0); return () => {}; },
      createBooking: async (b) => {
        if(window.__REJECT){
          const e = new Error('Ese profesional no presta este servicio.');
          e.code = 'functions/failed-precondition';
          e.details = { reason:'barber-not-qualified' };
          throw e;
        }
        window.__BOOKINGS.push(b);
        return { id:'x' };
      },
      getClubStatus: async () => ({ visitCount:1 }),
      loadSiteImages: async () => ({}), loadGoogleReviews: async () => null,
    };
  }, catalogo);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil:'load' });
  await page.waitForFunction(() => typeof window.openBK === 'function');
  await page.evaluate(() => window.openBK());
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}
const barberosVisibles = (page) => page.$$eval('#bk-barbers .bk-barber', els => els.map(e => e.dataset.bid));
const barberoElegido = (page) => page.$$eval('#bk-barbers .bk-barber.bk-sel', els => els.map(e => e.dataset.bid));
const serviciosVisibles = (page) => page.$$eval('#bk-svcs .bk-svc', els => els.map(e => e.dataset.sid));
async function elegirServicio(page, id){
  await page.evaluate((sid) => document.querySelector(`#bk-svcs .bk-svc[data-sid="${sid}"]`).click(), id);
  await page.waitForTimeout(40);
}
async function irAPaso(page, n){ await page.evaluate((k) => window.bkGoTo(k), n); }
async function elegirFechaYHora(page){
  await page.click('#bk-cnext');
  await page.click('.bk-day[data-day]');
  await page.waitForSelector('.bk-slot:not(.bk-taken)');
  await page.click('.bk-slot:not(.bk-taken)');
}

{
  const { ctx, page, errors } = await abrirWidget({ services:SERVICES, staff:STAFF });
  const svcs = await serviciosVisibles(page);
  check('widget: un servicio que nadie presta no se ofrece', !svcs.includes('huerfano'), svcs);
  check('widget: los demás servicios siguen', ['corte','barba','visagismo'].every(s => svcs.includes(s)), svcs);

  await elegirServicio(page, 'corte');
  await irAPaso(page, 2);
  check('widget: si los dos prestan el servicio, salen los dos',
    iguales(await barberosVisibles(page), ['victoria','ariel']), await barberosVisibles(page));
  check('widget: con dos opciones no elige por el cliente',
    (await barberoElegido(page)).length === 0 && await page.isDisabled('#bk-next2'));
  await page.click('.bk-barber[data-bid="ariel"]');

  await irAPaso(page, 1);
  await elegirServicio(page, 'visagismo');
  await irAPaso(page, 2);
  check('widget: al cambiar de servicio se filtra solo',
    iguales(await barberosVisibles(page), ['victoria']), await barberosVisibles(page));
  check('widget: quien ya no califica se suelta y, si queda uno, se preselecciona',
    iguales(await barberoElegido(page), ['victoria']) && !(await page.isDisabled('#bk-next2')), await barberoElegido(page));
  check('widget: el resumen muestra al que quedó', (await page.textContent('#ss-barber')).trim() === 'Victoria');

  await irAPaso(page, 1);
  await elegirServicio(page, 'corte');
  await irAPaso(page, 2);
  check('widget: una preselección automática se suelta al cambiar de servicio',
    (await barberoElegido(page)).length === 0 && await page.isDisabled('#bk-next2'), await barberoElegido(page));
  check('widget: y el resumen no se queda con ese nombre', (await page.textContent('#ss-barber')).trim() === '—');

  await page.click('.bk-barber[data-bid="ariel"]');
  await page.click('#bk-next2');
  await elegirFechaYHora(page);
  check('widget: con fecha y hora se habilita continuar', !(await page.isDisabled('#bk-next3')));

  await irAPaso(page, 1);
  await elegirServicio(page, 'barba');
  await irAPaso(page, 2);
  check('widget: quien sigue calificando conserva la elección del cliente',
    iguales(await barberoElegido(page), ['ariel']), await barberoElegido(page));
  check('widget: pero la hora se limpia, porque el servicio dura otra cosa',
    await page.isDisabled('#bk-next3') && (await page.textContent('#ss-time')).trim() === '—');
  check('widget: sin errores JS', errors.length === 0, errors);
  await ctx.close();
}

// El servidor rechaza: la lista cambió con el widget abierto.
{
  const { ctx, page, errors } = await abrirWidget({ services:SERVICES, staff:STAFF });
  await elegirServicio(page, 'corte');
  await irAPaso(page, 2);
  await page.click('.bk-barber[data-bid="ariel"]');
  await page.click('#bk-next2');
  await elegirFechaYHora(page);
  await page.click('#bk-next3');
  await page.fill('#bkf-name', 'Juana Pérez');
  await page.fill('#bkf-phone', '+56912345678');
  await page.fill('#bkf-email', 'juana@mail.com');
  await page.check('#bkf-consent', { force:true });
  await page.evaluate((staff) => {
    window.__REJECT = true;
    window.__CAT = { services: window.__CAT.services, staff };
  }, [VICTORIA, { ...ARIEL, serviceIds:['barba'] }]);
  await page.click('#bk-submit');
  await page.waitForSelector('#bks-2.active');
  await page.waitForFunction(() => document.querySelectorAll('#bk-barbers .bk-barber').length === 1);
  check('widget: un rechazo por servicio vuelve a elegir barbero, con la lista fresca',
    iguales(await barberosVisibles(page), ['victoria']), await barberosVisibles(page));
  check('widget: explica el motivo', await page.isVisible('#bk-barber-msg')
    && /ya no presta/i.test(await page.textContent('#bk-barber-msg')), await page.textContent('#bk-barber-msg'));
  check('widget: no lo trata como problema de conexión', !(await page.isVisible('#bk-submit-err')));
  check('widget: sin errores JS tras el rechazo', errors.length === 0, errors);
  await ctx.close();
}

// Falla abierto y compatibilidad.
{
  const sinLista = STAFF.map(({ serviceIds, ...s }) => s);
  const { ctx, page } = await abrirWidget({ services:SERVICES, staff:sinLista });
  check('widget: sin listas se ofrece todo el catálogo',
    (await serviciosVisibles(page)).includes('huerfano'), await serviciosVisibles(page));
  await elegirServicio(page, 'huerfano');
  await irAPaso(page, 2);
  check('widget: sin listas salen todos los barberos',
    iguales(await barberosVisibles(page), ['victoria','ariel']), await barberosVisibles(page));
  await ctx.close();
}
{
  const { ctx, page } = await abrirWidget('falla');
  const svcs = await serviciosVisibles(page);
  check('widget: si el catálogo no carga, falla abierto con el respaldo', svcs.length > 0, svcs);
  await page.evaluate(() => document.querySelector('#bk-svcs .bk-svc').click());
  await irAPaso(page, 2);
  check('widget: y hay barbero para elegir', (await barberosVisibles(page)).length > 0);
  await ctx.close();
}

// ═══════════════ PANEL ═══════════════
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone:'America/Santiago' }).format(new Date());
const ESTEBAN = { id:'esteban', name:'Esteban', role:'Barbero', status:'active', photo:'' };
function fechaFutura(){
  const d = new Date(); d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}
async function abrirPanel(bookings, staff){
  const { ctx, page, errors } = await nuevaPagina({ width:1300, height:1000 });
  await page.addInitScript(({ services, staff, bookings }) => {
    window.__SAVES = [];
    window.__ADMBK = [];
    window.__ADMBK_MODE = 'ok';
    window.SWAuth = { signIn: async () => ({uid:'a'}), signOut: async () => {}, onChange: (cb) => { cb({uid:'a'}); return () => {}; } };
    window.SWData = {
      loadAdmin: async () => ({
        services: JSON.parse(JSON.stringify(services)),
        staff: JSON.parse(JSON.stringify(staff)),
        staffAccounts:{}, info:{ tz:'America/Santiago', bufferMin:0 }, log:[], schedule:[],
      }),
      readLicense: async () => ({ status:'active', message:'', suspendAt:'' }),
      subscribeBookings: (cb) => { cb(bookings); return { unsubscribe(){}, ready: Promise.resolve() }; },
      getPatients: async () => [], getScheduleBlocks: async () => [],
      saveAdmin: async (D) => { window.__SAVES.push(JSON.parse(JSON.stringify(D.staff))); },
      adminSaveBooking: async (b) => {
        if(window.__ADMBK_MODE === 'rechazo'){
          const e = new Error('Ariel no tiene asignado ese servicio. Asígnaselo en Personal o elige a otra persona.');
          e.code = 'functions/failed-precondition';
          e.details = { reason:'barber-not-qualified' };
          throw e;
        }
        window.__ADMBK.push(b);
        return { ok:true, id:'x', created:true };
      },
      adminLogEvent: async () => ({ ok:true }), loadGoogleReviews: async () => null,
    };
  }, { services:SERVICES, staff: staff || [...STAFF, ESTEBAN], bookings });
  await page.goto(`http://localhost:${PORT}/admin/`, { waitUntil:'load' });
  await page.waitForSelector('#adm-app', { state:'visible' });
  return { ctx, page, errors };
}
const opcionesBarbero = (page) => page.$$eval('#a-bkm-barber option', os => os.filter(o => o.value).map(o => o.value));

{
  const VIEJA = { id:'V1', code:'V1', name:'Cliente', svcId:'visagismo', svcName:'Visagismo', barberId:'ariel',
    barberName:'Ariel', date:hoy(), time:'11:00', dur:120, price:55000, status:'pending' };
  const { ctx, page, errors } = await abrirPanel([VIEJA]);
  await page.click('.an-item[data-p="calendar"]');
  await page.click('#a-bk-new');

  check('panel: sin servicio elegido salen todos los activos',
    iguales(await opcionesBarbero(page), ['victoria','ariel','esteban']), await opcionesBarbero(page));
  await page.selectOption('#a-bkm-svc', 'barba');
  check('panel: al elegir servicio se filtra solo; quien no tiene lista sigue',
    iguales(await opcionesBarbero(page), ['ariel','esteban']), await opcionesBarbero(page));

  await page.selectOption('#a-bkm-barber', 'ariel');
  await page.selectOption('#a-bkm-svc', 'corte');
  check('panel: quien sigue calificando conserva su selección', (await page.inputValue('#a-bkm-barber')) === 'ariel');
  await page.selectOption('#a-bkm-svc', 'visagismo');
  check('panel: quien deja de calificar se suelta', (await page.inputValue('#a-bkm-barber')) === '');
  check('panel: y se dice por qué', /Ariel no presta/.test(await page.textContent('#a-bkm-barber-hint')),
    await page.textContent('#a-bkm-barber-hint'));
  await page.selectOption('#a-bkm-barber', 'victoria');
  check('panel: al elegir de nuevo, el aviso se apaga',
    !(await page.isVisible('#a-bkm-barber-hint')));
  await page.click('#a-bkm .a-mc');

  // Una cita ya agendada con alguien que perdió el servicio.
  await page.click('#a-bk-timeline .a-bk-card[data-code="V1"]');
  check('panel: una cita existente conserva a su profesional aunque ya no preste el servicio',
    (await page.inputValue('#a-bkm-barber')) === 'ariel', await opcionesBarbero(page));
  check('panel: y se avisa', /no tiene este servicio/i.test(await page.textContent('#a-bkm-barber-hint')));
  await page.fill('#a-bkm-name', 'Cliente Editada');
  await page.click('#a-bkm-save');
  await page.waitForTimeout(100);
  const editada = await page.evaluate(() => window.__ADMBK[window.__ADMBK.length - 1]);
  check('panel: esa cita se puede guardar', editada && editada.barberId === 'ariel' && editada.name === 'Cliente Editada', editada);

  // Un rechazo del servidor muestra el motivo, no un código.
  await page.click('#a-bk-new');
  await page.fill('#a-bkm-name', 'Otra Cliente');
  await page.selectOption('#a-bkm-svc', 'barba');
  await page.selectOption('#a-bkm-barber', 'ariel');
  await page.fill('#a-bkm-date', fechaFutura());
  await page.fill('#a-bkm-time', '15:00');
  await page.evaluate(() => { window.__ADMBK_MODE = 'rechazo'; });
  await page.click('#a-bkm-save');
  await page.waitForTimeout(100);
  const alerta = await page.textContent('#a-bk-alert');
  check('panel: el rechazo del servidor se lee en castellano', /no tiene asignado ese servicio/.test(alerta) && !/failed-precondition/.test(alerta), alerta);
  check('panel: sin errores JS en la agenda', errors.length === 0, errors);
  await ctx.close();
}

// Nadie presta el servicio: el panel lo dice en vez de dejar un select mudo.
{
  const { ctx, page, errors } = await abrirPanel([], STAFF);
  await page.click('.an-item[data-p="services"]');
  const fila = (id) => page.textContent(`tr[data-svc="${id}"]`);
  check('panel: un servicio que nadie presta se marca en la tabla', /Sin profesional/.test(await fila('huerfano')), await fila('huerfano'));
  check('panel: uno con profesional no se marca', !/Sin profesional/.test(await fila('corte')));
  check('panel: uno retirado tampoco', !/Sin profesional/.test(await fila('viejo')));
  await page.click('.an-item[data-p="calendar"]');
  await page.click('#a-bk-new');
  await page.selectOption('#a-bkm-svc', 'huerfano');
  check('panel: si nadie presta el servicio, no hay a quién elegir', (await opcionesBarbero(page)).length === 0);
  check('panel: y se indica dónde arreglarlo', /Personal/.test(await page.textContent('#a-bkm-barber-hint')));
  check('panel: sin errores JS sin profesional', errors.length === 0, errors);
  await ctx.close();
}

// Ficha de Personal.
{
  const CITA = { id:'F1', code:'F1', name:'Cliente', svcId:'barba', svcName:'Barba', barberId:'ariel',
    barberName:'Ariel', date:fechaFutura(), time:'11:00', dur:30, price:13000, status:'confirmed' };
  const { ctx, page, errors } = await abrirPanel([CITA]);
  await page.click('.an-item[data-p="services"]');
  check('panel: con alguien sin lista propia, el servicio sí tiene profesional',
    !/Sin profesional/.test(await page.textContent('tr[data-svc="huerfano"]')));

  await page.click('.an-item[data-p="staff"]');
  const tarjeta = (id) => page.$eval(`[data-edit-stf="${id}"]`, b => b.closest('.a-stc').textContent);
  check('panel: la tarjeta resume una lista propia (cuenta solo los activos)', /Presta 2 de 4 servicios/.test(await tarjeta('ariel')), await tarjeta('ariel'));
  check('panel: la tarjeta resume "todos"', /Todos los servicios/.test(await tarjeta('esteban')), await tarjeta('esteban'));

  const marcados = () => page.$$eval('#a-stf-svcs input:checked', is => is.map(i => i.dataset.stfsvc));
  const listados = () => page.$$eval('#a-stf-svcs input', is => is.map(i => i.dataset.stfsvc));

  // Esteban: sin lista. Guardar sin tocar no debe crearle una.
  await page.click('[data-edit-stf="esteban"]');
  check('ficha: sin lista arranca en "todos"', await page.isChecked('#a-stf-all'));
  check('ficha: con "todos" la lista va oculta', !(await page.isVisible('#a-stf-svcs')));
  await page.click('#a-stf-save');
  await page.waitForFunction(() => window.__SAVES.length >= 1);
  const est1 = await page.evaluate(() => window.__SAVES[window.__SAVES.length - 1].find(s => s.id === 'esteban'));
  check('ficha: guardar sin tocar no crea una lista', est1.serviceIds === null, est1.serviceIds);
  check('ficha: y conserva el horario', Array.isArray(est1.schedule) && est1.schedule.length === 7, est1.schedule);

  // Quitar "todos" arranca con todo marcado: lo normal es desmarcar pocos.
  await page.click('[data-edit-stf="esteban"]');
  await page.uncheck('#a-stf-all');
  check('ficha: al quitar "todos" aparece la lista', await page.isVisible('#a-stf-svcs'));
  check('ficha: solo lista servicios activos', iguales((await listados()).sort(), ['barba','corte','huerfano','visagismo']), await listados());
  check('ficha: arranca con todo marcado', (await marcados()).length === 4, await marcados());
  await page.uncheck('#a-stf-svcs input[data-stfsvc="visagismo"]');
  const n = (await page.$$eval('#a-stf-svcs input', is => is.length));
  for(const id of await marcados()) await page.uncheck(`#a-stf-svcs input[data-stfsvc="${id}"]`);
  check('ficha: sin nada marcado advierte que no aparecerá', await page.isVisible('#a-stf-svcs-hint')
    && /no aparecerá/i.test(await page.textContent('#a-stf-svcs-hint')), await page.textContent('#a-stf-svcs-hint'));
  check('ficha: la lista completa sigue ahí', n === 4, n);
  await page.check('#a-stf-svcs input[data-stfsvc="corte"]');
  check('ficha: al marcar uno se apaga la advertencia', !(await page.isVisible('#a-stf-svcs-hint')));
  await page.click('#a-stf-save');
  await page.waitForFunction(() => window.__SAVES.length >= 2);
  const est2 = await page.evaluate(() => window.__SAVES[window.__SAVES.length - 1].find(s => s.id === 'esteban'));
  check('ficha: guarda solo lo marcado', iguales(est2.serviceIds, ['corte']), est2.serviceIds);

  // Ariel: quitar barba, que tiene una cita futura. Conserva el retirado.
  await page.click('[data-edit-stf="ariel"]');
  check('ficha: con lista propia no arranca en "todos"', !(await page.isChecked('#a-stf-all')));
  check('ficha: marca lo que ya tenía', iguales((await marcados()).sort(), ['barba','corte']), await marcados());
  await page.uncheck('#a-stf-svcs input[data-stfsvc="barba"]');
  await page.check('#a-stf-svcs input[data-stfsvc="visagismo"]');
  await page.click('#a-stf-save');
  await page.waitForFunction(() => window.__SAVES.length >= 3);
  const ari = await page.evaluate(() => window.__SAVES[window.__SAVES.length - 1].find(s => s.id === 'ariel'));
  check('ficha: un servicio retirado no se pierde de la lista', iguales(ari.serviceIds.slice().sort(), ['corte','viejo','visagismo']), ari.serviceIds);
  await page.waitForTimeout(60);
  const aviso = await page.textContent('#a-stf-alert');
  check('ficha: avisa de las citas futuras de lo que ya no presta', /1 cita futura/.test(aviso), aviso);

  // De lista a "todos" se borra la lista.
  await page.click('[data-edit-stf="ariel"]');
  await page.check('#a-stf-all');
  await page.click('#a-stf-save');
  await page.waitForFunction(() => window.__SAVES.length >= 4);
  const ari2 = await page.evaluate(() => window.__SAVES[window.__SAVES.length - 1].find(s => s.id === 'ariel'));
  check('ficha: volver a "todos" quita la lista', ari2.serviceIds === null, ari2.serviceIds);

  // Servicio nuevo: no entra solo a las listas, y el panel lo dice.
  await page.click('.an-item[data-p="services"]');
  await page.click('#a-svc-new');
  await page.fill('#a-sf-n', 'Servicio nuevo');
  await page.fill('#a-sf-p', '10000');
  await page.fill('#a-sf-d', '30');
  await page.click('#a-svc-save');
  await page.waitForTimeout(120);
  const svcAlerta = await page.textContent('#a-svc-alert');
  check('servicios: al crear uno se nombra a quien tiene lista propia', /Victoria/.test(svcAlerta) && /Esteban/.test(svcAlerta), svcAlerta);
  check('servicios: y no a quien presta todos', !/Ariel/.test(svcAlerta), svcAlerta);
  check('panel: sin errores JS en la ficha', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
server.close();
console.log(fails ? `\n== ${fails} FALLAS ==` : '\n== TODO OK ==');
process.exit(fails ? 1 : 0);
