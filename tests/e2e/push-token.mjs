// Verifica que la clave VAPID configurada sirve de verdad: registra el
// service worker, pide el token a FCM y lo guarda en staffDevices/{uid}.
//
// OJO: esta prueba NO es puramente local. No existe emulador de FCM, así que
// getToken() contacta los servidores de Google y registra una suscripción
// push real contra el proyecto. Es inofensivo (una suscripción de navegador
// que se descarta), pero requiere red y una VAPID key válida del proyecto
// REAL -- por eso no forma parte de `npm run test:e2e`.
//
// Lo que esta prueba NO puede verificar: que la notificación se ENTREGUE.
// Eso exige un teléfono contra staging.
//
// Uso (emulador corriendo y sembrado): node tests/e2e/push-token.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeChecker, token, getDoc, patchDoc } from './emulator.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BASE = 'http://localhost:5000';
const check = makeChecker();

const vapid = (fs.readFileSync(path.join(ROOT, 'public/barbero/index.html'), 'utf8')
  .match(/const VAPID_KEY = '([^']*)'/) || [])[1] || '';
check('hay una clave VAPID configurada', vapid.length > 0, vapid.length);
if (!vapid) check.done('Sin clave VAPID no hay nada que probar.');

// Forma de una clave VAPID: punto P-256 sin comprimir en base64url.
const raw = Buffer.from(vapid.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
check('la clave tiene la forma de un punto P-256 sin comprimir',
  raw.length === 65 && raw[0] === 4, { largo: vapid.length, bytes: raw.length, primerByte: raw[0] });

// Dos restricciones del navegador que hacen que esta prueba NO pueda correr
// como las de tests/browser/:
//
//  1. Chromium HEADLESS deshabilita la API de notificaciones:
//     Notification.requestPermission() devuelve 'denied' pase lo que pase.
//  2. Los contextos normales de Playwright son INCÓGNITO, y Chrome no
//     soporta la Push API en incógnito ("Subscription failed - no active
//     Service Worker" / "Registration failed - permission denied").
//
// Por eso: ventana visible y perfil persistente. El perfil se descarta al
// terminar; solo existe para que el navegador no esté en incógnito.
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-push-'));
const ctx = await chromium.launchPersistentContext(perfil, {
  headless: false,
  viewport: { width: 412, height: 915 },
});
// El permiso se concede POR ORIGEN: el diálogo real del navegador Playwright
// no lo puede tocar.
await ctx.grantPermissions(['notifications'], { origin: BASE });
const page = ctx.pages()[0] || await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });

// Se limpia el token de corridas anteriores: si no, el check final pasaría
// por arrastre aunque esta corrida no registre nada.
const tVicPre = await token('victoria@scissorwhite.cl', 'barbero123');
const admPre = await token('admin@scissorwhite.cl', 'admin123');
const staffPre = await getDoc('staff/victoria', admPre);
await patchDoc('staffDevices/' + staffPre.uid, { tokens: [] }, tVicPre);

await page.goto(BASE + '/barbero/', { waitUntil: 'load' });
await page.fill('#b-email', 'victoria@scissorwhite.cl');
await page.fill('#b-pass', 'barbero123');
await page.click('#b-signin');
await page.waitForSelector('#b-app', { state: 'visible', timeout: 20000 });
await page.waitForTimeout(800);

// El refresco silencioso del arranque puede ganarle al click. Cualquiera de
// los dos caminos sirve: se espera al estado final en vez de a un tiempo
// fijo, y solo se toca el botón si el silencioso no lo resolvió.
const activo = () => page.evaluate(() =>
  /Avisos activos/i.test(document.getElementById('b-push').textContent));

if (!(await activo())) await page.click('#b-push');

const limite = Date.now() + 45000;
while (!(await activo()) && Date.now() < limite) await page.waitForTimeout(1000);
check('el botón terminó en "Avisos activos"', await activo(),
  await page.textContent('#b-push'));

const estado = await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  const sub = regs.length ? await regs[0].pushManager.getSubscription() : null;
  return {
    sws: regs.map((r) => r.scope),
    activo: regs.some((r) => !!r.active),
    suscrito: !!sub,
    endpoint: sub ? sub.endpoint.slice(0, 60) : null,
    permiso: Notification.permission,
    toast: (document.querySelector('.b-toast') || {}).textContent || '',
    boton: (document.getElementById('b-push') || {}).textContent || '',
  };
});

check('el permiso de notificaciones quedó concedido', estado.permiso === 'granted', estado.permiso);
check('el service worker de /barbero/ quedó registrado y activo',
  estado.activo && estado.sws.some((s) => /\/barbero\/$/.test(s)), estado.sws);
check('el navegador quedó suscrito a push', estado.suscrito, estado);
// FCM reparte los endpoints entre varios hosts de Google (fcm.googleapis.com,
// jmt17.google.com, android.googleapis.com...). Lo que importa es que sea de
// Google y traiga una ruta de FCM, no el host puntual.
check('el endpoint es de un servicio de push real de Google',
  /^https:\/\/[\w.-]*\.google(apis)?\.com\/fcm\//.test(estado.endpoint || ''), estado.endpoint);

// El toast NO se chequea: se autodestruye a los pocos segundos, así que a
// esta altura siempre está vacío y el check pasaría siempre. Lo que de
// verdad prueba que la VAPID key sirve es que haya token en staffDevices.

// Y que el token haya llegado a Firestore, por el camino real (regla
// staffDevices/{uid}, escrito por el propio dispositivo).
const tVic = await token('victoria@scissorwhite.cl', 'barbero123');
const staff = await getDoc('staff/victoria', await token('admin@scissorwhite.cl', 'admin123'));
const dev = await getDoc('staffDevices/' + staff.uid, tVic);
check('el token quedó guardado en staffDevices del barbero',
  dev && Array.isArray(dev.tokens) && dev.tokens.length > 0 && String(dev.tokens[0]).length > 20,
  dev && dev.tokens && dev.tokens.map((t) => String(t).slice(0, 24) + '…'));

check('sin errores JS durante la activación', errores.length === 0, errores.slice(0, 4));

await ctx.close();
fs.rmSync(perfil, { recursive: true, force: true });
check.done(
  'La ENTREGA de la notificación no se prueba acá: eso exige un teléfono\n' +
  'real contra staging (y en iPhone, iOS 16.4+ con la app agregada a inicio).'
);
