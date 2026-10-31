// public/js/data.js real, con Firestore y Functions falsos: guarda
// anti-resurreccion de saveAdmin y payload extendido de adminLogEvent.
//
// Script standalone: `node tests/browser/data-saveadmin-guard.mjs`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const PORT = 4484;
const MIME = { '.html':'text/html', '.js':'text/javascript' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><body></body></html>'); }
  fs.readFile(path.join(ROOT, p), (e, b) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(b);
  });
});
await new Promise(r => server.listen(PORT, r));

// Firestore falso en memoria. window.__FS = { services: {id: data}, staff: {} }
const FAKE_FIRESTORE = `
export const collection = (db, name) => ({ __col: name });
export const doc = (db, col, id) => ({ __col: col, id, ref: true });
export const getDocs = async (c) => {
  const store = (window.__FS[c.__col] || {});
  return { docs: Object.keys(store).map(id => ({ id, data: () => ({ ...store[id] }), ref: { __col: c.__col, id } })) };
};
export const getDoc = async () => ({ exists: () => false });
export const setDoc = async () => {};
export const deleteDoc = async () => {};
export const deleteField = () => null;
export const arrayUnion = (...a) => a;
export const onSnapshot = () => () => {};
export const query = (c) => c; export const orderBy = () => null; export const limit = () => null;
export const writeBatch = () => {
  const ops = [];
  return {
    set: (d, v) => ops.push(['set', d, v]),
    delete: (r) => ops.push(['delete', r]),
    commit: async () => {
      window.__COMMITS.push(ops.map(o => o[0] + ':' + (o[1].id || o[1].__col)));
      for (const o of ops) {
        const store = (window.__FS[o[1].__col] = window.__FS[o[1].__col] || {});
        if (o[0] === 'set') store[o[1].id] = o[2]; else delete store[o[1].id];
      }
    },
  };
};`;
const FAKE_INIT = `export const db = {}, storage = {}, functions = {}, auth = {}, app = {};`;
const FAKE_STORAGE = `export const ref = () => ({}), uploadBytes = async () => ({}), getDownloadURL = async () => '', deleteObject = async () => {};`;
const FAKE_FUNCTIONS = `export const httpsCallable = (fn, name) => async (data) => { window.__CALLS.push({ name, data }); return { data: { ok: true } }; };`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.route('**/js/firebase-init.js', r => r.fulfill({ contentType: 'text/javascript', body: FAKE_INIT }));
await ctx.route('**gstatic.com/**firebase-firestore.js', r => r.fulfill({ contentType: 'text/javascript', body: FAKE_FIRESTORE }));
await ctx.route('**gstatic.com/**firebase-storage.js', r => r.fulfill({ contentType: 'text/javascript', body: FAKE_STORAGE }));
await ctx.route('**gstatic.com/**firebase-functions.js', r => r.fulfill({ contentType: 'text/javascript', body: FAKE_FUNCTIONS }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => { window.__FS = {}; window.__COMMITS = []; window.__CALLS = []; });
await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => import('/js/data.js'));

let fails = 0;
const check = (name, cond, detail) => {
  if (!cond) { fails++; console.log(`FALLA ${name}` + (detail !== undefined ? ` -> ${JSON.stringify(detail)}` : '')); }
  else console.log(`ok ${name}`);
};

const svc = (id, name) => ({ name, cat: 'c', price: 1000, dur: 30, status: 'inactive' });
await page.evaluate((mk) => {
  window.__FS = { services: { a: { name: 'A', status: 'active' }, b: { name: 'B', status: 'inactive' } }, staff: {}, staffAccounts: {}, businessInfo: {} };
}, null);

// Sesion 1 carga {a, b}. Otra sesion borra b. Sesion 1 guarda con b aun en D.
const r1 = await page.evaluate(async () => {
  const D = await window.SWData.loadAdmin();
  delete window.__FS.services.b;           // "otro dispositivo" borra b
  D.services.find(s => s.id === 'a').name = 'A editado';
  const res = await window.SWData.saveAdmin(D);
  return { res, ids: D.services.map(s => s.id), fs: Object.keys(window.__FS.services) };
});
check('no re-escribe un servicio borrado por otra sesion', !r1.fs.includes('b'), r1.fs);
check('lo saca de D', !r1.ids.includes('b'), r1.ids);
check('sigue guardando el resto', r1.fs.includes('a'), r1.fs);
check('devuelve la senal removedElsewhere con id y nombre',
  r1.res && r1.res.removedElsewhere && r1.res.removedElsewhere.length === 1
  && r1.res.removedElsewhere[0].id === 'b' && r1.res.removedElsewhere[0].name === 'B', r1.res);

// Servicio creado en esta sesion: no existe en Firestore pero SI se escribe.
const r2 = await page.evaluate(async () => {
  window.__FS = { services: { a: { name: 'A' } }, staff: {}, staffAccounts: {}, businessInfo: {} };
  const D = await window.SWData.loadAdmin();
  D.services.push({ id: 'sv_nuevo', name: 'Nuevo', status: 'active', price: 1, dur: 5 });
  const res = await window.SWData.saveAdmin(D);
  const first = Object.keys(window.__FS.services);
  // Segundo guardado: ahora existe en Firestore; si otra sesion lo borra, NO se resucita.
  delete window.__FS.services.sv_nuevo;
  const res2 = await window.SWData.saveAdmin(D);
  return { res, first, res2, fs: Object.keys(window.__FS.services) };
});
check('escribe un servicio creado en esta sesion', r2.first.includes('sv_nuevo'), r2.first);
check('sin falsos positivos: removedElsewhere vacio', !r2.res.removedElsewhere || r2.res.removedElsewhere.length === 0, r2.res);
check('tras guardarse, si otra sesion lo borra ya no se resucita',
  !r2.fs.includes('sv_nuevo') && r2.res2.removedElsewhere.length === 1, r2);

// Borrado propio: sigue borrando de Firestore.
const r3 = await page.evaluate(async () => {
  window.__FS = { services: { a: { name: 'A' }, b: { name: 'B' } }, staff: {}, staffAccounts: {}, businessInfo: {} };
  const D = await window.SWData.loadAdmin();
  D.services = D.services.filter(s => s.id !== 'b');
  const res = await window.SWData.saveAdmin(D);
  return { fs: Object.keys(window.__FS.services), res };
});
check('el borrado propio sigue borrando en Firestore', r3.fs.length === 1 && r3.fs[0] === 'a', r3.fs);
check('borrado propio no dispara la senal', !r3.res.removedElsewhere || r3.res.removedElsewhere.length === 0, r3.res);

// adminLogEvent: payload extendido y compatibilidad.
const r4 = await page.evaluate(async () => {
  window.__CALLS.length = 0;
  await window.SWData.adminLogEvent('Solo accion', 'item');
  await window.SWData.adminLogEvent('Con extra', 'x', { serviceId: 'sv', outcome: 'ok', price: 5, action: 'pisar' });
  return window.__CALLS.map(c => c.data);
});
check('adminLogEvent sin extra manda solo action+item', JSON.stringify(r4[0]) === JSON.stringify({ action: 'Solo accion', item: 'item' }), r4[0]);
check('adminLogEvent pasa los campos extra sin dejar pisar action',
  r4[1].serviceId === 'sv' && r4[1].outcome === 'ok' && r4[1].price === 5 && r4[1].action === 'Con extra', r4[1]);

check('sin errores JS', errors.length === 0, errors.slice(0, 3));
console.log(fails === 0 ? '\n== TODO OK ==' : `\n== ${fails} FALLAS ==`);
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
