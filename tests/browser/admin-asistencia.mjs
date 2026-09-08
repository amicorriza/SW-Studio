// Panel admin: registro de asistencia, cancelar-sin-borrar, banner de
// atenciones sin cerrar y vinculación de cuentas del equipo.
//
// Script standalone: `node tests/browser/admin-asistencia.mjs`.
// Mismo arnés que tests/browser/dashboard.mjs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const OUT = path.resolve(import.meta.dirname, '../../.tmp-screenshots');
const PORT = 4482;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png',
  '.webmanifest':'application/manifest+json','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.svg':'image/svg+xml' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p==='/') p='/index.html'; if(p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{ if(e){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'}); res.end(b); });
});
await new Promise(r=>server.listen(PORT,r));
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:1400,height:1100} });
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
  const pad = n => (n<10?'0':'')+n;
  const d = new Date();
  const HOY = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const iso = (minsAgo) => new Date(Date.now() - minsAgo*60000).toISOString();
  const base = { svcId:'corte', svcName:'Corte de cabello', svcCat:'c', price:14000, dur:45,
                 barberId:'victoria', barberName:'Victoria', club:'guest', email:'x@x.cl' };

  window.__BK = [
    { ...base, id:'d1', code:'SW-CONF', name:'Ana Torres',  date:HOY, time:'10:00', status:'confirmed' },
    { ...base, id:'d2', code:'SW-ARR',  name:'Ben Rojas',   date:HOY, time:'11:00', status:'arrived', arrivedAt: iso(5) },
    { ...base, id:'d3', code:'SW-LIVE', name:'Cata Díaz',   date:HOY, time:'12:00', status:'in_service', arrivedAt: iso(20), startedAt: iso(12) },
    { ...base, id:'d4', code:'SW-DONE', name:'Deb Soto',    date:HOY, time:'13:00', status:'completed', startedAt: iso(200), endedAt: iso(147), actualDur:53, durSource:'timer' },
    { ...base, id:'d5', code:'SW-NS',   name:'Eze Pérez',   date:HOY, time:'14:00', status:'no_show', noShowAt: iso(60) },
    { ...base, id:'d6', code:'SW-CANC', name:'Fer Muñoz',   date:HOY, time:'15:00', status:'cancelled', cancelledAt: iso(90) },
    // Sin cerrar: empezó hace 3h una atención de 45 min.
    { ...base, id:'d7', code:'SW-STUCK', name:'Gabi Lira',  date:HOY, time:'09:00', status:'in_service', arrivedAt: iso(190), startedAt: iso(185) },
  ];

  window.__CALLS = { markAttendance: [], deleteBooking: [], linkStaffAccount: [] };
  window.SWAuth = { signIn: async () => ({uid:'test'}), signOut: async () => {}, onChange: (cb) => { cb({uid:'test'}); return () => {}; } };
  window.__LOG = [];
  window.SWData = {
    loadAdmin: async () => ({
      services: [{ id:'corte', name:'Corte de cabello', cat:'c', price:14000, dur:45, status:'active', order:0 }],
      staff: [
        { id:'victoria', name:'Victoria', role:'Barbera', status:'active', photo:'', schedule:[null] },
        { id:'esteban',  name:'Esteban',  role:'Barbero', status:'active', photo:'', schedule:[null] },
      ],
      // El vínculo con Auth va en un mapa aparte, no en el doc de staff:
      // staff tiene lectura pública y ahí quedarían expuestos uid y correo.
      staffAccounts: { victoria: { uid:'uid-v', authEmail:'victoria@sw.cl' } },
      info: { name:'Scissor White', addr:'Cochrane 635', tz:'America/Santiago', bufferMin:0, nudgeLeadMin:15 },
      log: [], schedule: [],
    }),
    subscribeBookings: (cb) => { cb(window.__BK); return { unsubscribe(){}, ready: Promise.resolve() }; },
    getPatients: async () => [], getScheduleBlocks: async () => [],
    saveAdmin: async () => {}, saveBooking: async () => {},
    adminSaveBooking: async () => ({ ok: true, id: "x", created: true }),
    adminLogEvent: async (action, item) => { window.__LOG.push({ action, item }); return { ok: true }; },
    deleteBooking: async (id) => { window.__CALLS.deleteBooking.push(id); },
    markAttendance: async (bookingId, action) => {
      window.__CALLS.markAttendance.push({ bookingId, action });
      const b = window.__BK.find(x => (x.id||x.code) === bookingId);
      const next = { arrive:'arrived', no_show:'no_show', start:'in_service', end:'completed', cancel:'cancelled' }[action];
      if (b) { b.status = next; if (action==='end') { b.endedAt = new Date().toISOString(); b.actualDur = 41; } }
      return { ok:true, already:false, status:next, actualDur: action==='end' ? 41 : null };
    },
    linkStaffAccount: async (staffId, email) => {
      window.__CALLS.linkStaffAccount.push({ staffId, email });
      return { ok:true, uid:'uid-nuevo' };
    },
    loadGoogleReviews: async () => null,
  };
});

let fails = 0;
const check = (name, cond, detail) => {
  if(!cond){ fails++; console.log(`✗ ${name}` + (detail!==undefined?` -> ${JSON.stringify(detail)}`:'')); }
  else console.log(`✓ ${name}`);
};

await page.goto(`http://localhost:${PORT}/admin/`, { waitUntil:'load' });
// Sin formulario: el panel abre solo cuando onChange entrega una sesión.
await page.waitForSelector('#adm-app', { state:'visible' });
await page.click('.an-item[data-p="calendar"]');
await page.waitForTimeout(400);

check('sin errores JS al cargar la Agenda', errors.length === 0, errors.slice(0,4));

// ── badges de los estados nuevos ──
const badges = await page.evaluate(() => {
  const out = {};
  document.querySelectorAll('#a-bk-timeline .a-bk-card').forEach(c => {
    const tag = c.querySelector('.a-bk-card-status-tag');
    out[c.dataset.code] = tag ? tag.className.replace('a-bk-card-status-tag ','') + '|' + tag.textContent : null;
  });
  return out;
});
check('confirmada muestra su badge', /confirmed/.test(badges['SW-CONF']||''), badges['SW-CONF']);
check('llegó muestra su badge', /arrived/.test(badges['SW-ARR']||''), badges['SW-ARR']);
check('en atención muestra su badge', /inservice/.test(badges['SW-LIVE']||''), badges['SW-LIVE']);
check('atendida muestra su badge', /completed/.test(badges['SW-DONE']||''), badges['SW-DONE']);
check('no llegó muestra su badge', /noshow/.test(badges['SW-NS']||''), badges['SW-NS']);
check('cancelada muestra su badge', /cancelled/.test(badges['SW-CANC']||''), badges['SW-CANC']);
check('la que quedó sin cerrar se marca "Sin cerrar"', /review\|Sin cerrar/.test(badges['SW-STUCK']||''), badges['SW-STUCK']);

const atenuadas = await page.evaluate(() => ({
  voided: [...document.querySelectorAll('#a-bk-timeline .a-bk-card.voided')].map(c => c.dataset.code).sort(),
  live: [...document.querySelectorAll('#a-bk-timeline .a-bk-card.inservice')].map(c => c.dataset.code).sort(),
}));
check('no-show y cancelada se atenúan', JSON.stringify(atenuadas.voided) === JSON.stringify(['SW-CANC','SW-NS']), atenuadas.voided);
check('las dos en atención se destacan', JSON.stringify(atenuadas.live) === JSON.stringify(['SW-LIVE','SW-STUCK']), atenuadas.live);

// ── banner de atenciones sin cerrar ──
const review = await page.evaluate(() => ({
  visible: getComputedStyle(document.getElementById('a-review')).display !== 'none',
  texto: document.querySelector('#a-review .a-review-t')?.textContent || '',
  filas: document.querySelectorAll('#a-review .a-review-row').length,
}));
check('el banner "sin cerrar" aparece', review.visible, review);
check('cuenta solo la que superó la holgura', /^1 atención/.test(review.texto), review.texto);
check('lista esa atención', review.filas === 1, review.filas);

// ── botones de asistencia en el modal ──
await page.click('#a-bk-timeline .a-bk-card[data-code="SW-CONF"]');
await page.waitForSelector('#a-bkm.a-on, #a-bkm[style*="flex"]', { timeout:3000 }).catch(()=>{});
await page.waitForTimeout(300);
const modal = await page.evaluate(() => ({
  attVisible: getComputedStyle(document.getElementById('a-bkm-att')).display !== 'none',
  acciones: [...document.querySelectorAll('#a-bkm-att-btns [data-att]')].map(b => b.dataset.att),
  estado: document.getElementById('a-bkm-att-st').textContent,
  delLabel: document.getElementById('a-bkm-del').textContent,
}));
check('el bloque de atención se ve al abrir una cita', modal.attVisible, modal);
check('confirmada ofrece Llegó / Iniciar / No llegó',
  JSON.stringify(modal.acciones) === JSON.stringify(['arrive','start','no_show']), modal.acciones);
check('el botón de borrar ahora dice "Cancelar cita"', modal.delLabel.trim() === 'Cancelar cita', modal.delLabel);

await page.click('#a-bkm-att-btns [data-att="arrive"]');
await page.waitForTimeout(400);
const trasArrive = await page.evaluate(() => ({
  calls: window.__CALLS.markAttendance.slice(),
  acciones: [...document.querySelectorAll('#a-bkm-att-btns [data-att]')].map(b => b.dataset.att),
}));
check('marcar Llegó llama a markAttendance("arrive")',
  trasArrive.calls.length === 1 && trasArrive.calls[0].action === 'arrive' && trasArrive.calls[0].bookingId === 'd1',
  trasArrive.calls);
check('el bloque se repinta con las acciones del estado nuevo',
  JSON.stringify(trasArrive.acciones) === JSON.stringify(['start','no_show']), trasArrive.acciones);

// ── cancelar ARCHIVA, no borra ──
await page.click('#a-bkm-del');
await page.waitForTimeout(200);
const dialogo = await page.evaluate(() => document.getElementById('a-dm-msg')?.textContent || '');
check('el diálogo habla de cancelar, no de eliminar',
  /Cancelar esta cita/i.test(dialogo) && !/no se puede deshacer/i.test(dialogo), dialogo.slice(0,120));

await page.click('#a-dm-ok');
await page.waitForTimeout(400);
const trasCancel = await page.evaluate(() => ({
  mark: window.__CALLS.markAttendance.slice(-1)[0],
  borrados: window.__CALLS.deleteBooking.slice(),
}));
check('cancelar llama a markAttendance("cancel")', trasCancel.mark && trasCancel.mark.action === 'cancel', trasCancel.mark);
check('cancelar NO borra el documento', trasCancel.borrados.length === 0, trasCancel.borrados);

// ── Info: anticipación del aviso ──
await page.click('.an-item[data-p="info"]');
await page.waitForTimeout(300);
const info = await page.evaluate(() => ({
  valor: document.getElementById('ai-nudgeLeadMin').value,
  buffer: document.getElementById('ai-bufferMin').value,
}));
check('el panel Info carga la anticipación guardada', info.valor === '15', info);
check('el buffer sigue cargando bien', info.buffer === '0', info);

// ── Personal: vincular cuenta ──
await page.click('.an-item[data-p="staff"]');
await page.waitForTimeout(300);
const personal = await page.evaluate(() => ({
  vinculadas: [...document.querySelectorAll('.a-stlink')].map(el => el.textContent.trim()),
  botones: document.querySelectorAll('[data-link-stf]').length,
}));
check('muestra el estado de acceso de cada profesional', personal.botones === 2, personal);
check('Victoria aparece vinculada y Esteban no',
  /Cuenta vinculada/.test(personal.vinculadas[0]) && /Sin acceso/.test(personal.vinculadas[1]), personal.vinculadas);

// staff/{id} tiene lectura pública: si el uid o el correo terminaran ahí,
// quedarían legibles por cualquiera que abra el sitio.
const fuga = await page.evaluate(() => {
  const D = window.__D_SNAPSHOT || null;
  const st = [...document.querySelectorAll('.a-stc')].length;
  return { tarjetas: st };
});
check('el panel pinta las fichas de personal', fuga.tarjetas === 2, fuga);

page.once('dialog', d => d.accept('esteban@sw.cl'));
await page.click('[data-link-stf="esteban"]');
await page.waitForTimeout(400);
const link = await page.evaluate(() => window.__CALLS.linkStaffAccount.slice());
check('vincular llama a linkStaffAccount con el correo escrito',
  link.length === 1 && link[0].staffId === 'esteban' && link[0].email === 'esteban@sw.cl', link);

check('sin errores JS tras ejercitar todo', errors.length === 0, errors.slice(0,4));

await page.click('.an-item[data-p="calendar"]');
await page.waitForTimeout(300);
await page.locator('#adm-p-calendar').screenshot({ path: path.join(OUT, 'admin-asistencia.png') }).catch(()=>{});

// ── Actividad ──
// Hasta el 2026-09-07 log() empujaba a un array en memoria que nadie
// persistía ni mostraba: 23 llamadas anotando operaciones reales -- borrar un
// servicio, ajustar precios en masa, vincular una cuenta -- que se perdían al
// recargar. Ahora van a adminLog por callable y se ven en su propia sección.
await page.click('.an-item[data-p="activity"]');
await page.waitForTimeout(300);
check('existe la sección Actividad', await page.isVisible('#adm-p-activity'));
check('y el título del panel la nombra',
  (await page.textContent('#adm-top-title')).trim() === 'Actividad',
  await page.textContent('#adm-top-title'));
// Las acciones que los tests de más arriba ya ejecutaron sobre el panel tienen
// que estar acá. Es más fuerte que comprobar el estado vacío: prueba que el
// camino real -- una operación del usuario -> log() -> la lista -- funciona.
const previas = await page.textContent('#a-act-list');
check('las acciones ya hechas en esta sesión aparecen registradas',
  /Marcó asistencia/.test(previas) && /Canceló cita/.test(previas), previas.slice(0, 160));

// El script del panel es un IIFE, así que log() no es global y no se puede
// invocar desde el test. Mejor así: lo que se comprueba es el camino REAL,
// las acciones que los casos de más arriba ejecutaron por la interfaz.
const enviadas = await page.evaluate(() => window.__LOG.slice());
check('cada acción del panel se manda al servidor para quedar registrada',
  enviadas.length >= 2, enviadas);
check('con la acción y el detalle, no solo un texto suelto',
  enviadas.every(e => typeof e.action === 'string' && e.action !== '' && 'item' in e),
  enviadas.slice(0, 3));
check('y lo enviado coincide con lo que se ve en la lista',
  enviadas.some(e => previas.includes(e.action)), enviadas.map(e => e.action));

// La fecha la pinta el panel; la que vale es la del servidor, pero la entrada
// recién creada se muestra con la local hasta la próxima carga.
check('cada fila muestra su fecha',
  /[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}/.test(previas), previas.slice(0, 120));

console.log(fails === 0 ? '\n== TODO OK ==' : `\n== ${fails} FALLAS ==`);
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
