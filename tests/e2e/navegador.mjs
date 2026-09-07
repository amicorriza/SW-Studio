// Recorrido clic a clic en un navegador REAL contra el emulador, sin ningún
// stub: Firebase Auth de verdad, callables de verdad, Firestore de verdad.
//
// Es la prueba que faltaba. tests/browser/* stubbea window.SWData y por eso
// verifica la interfaz pero no la integración; acá se ejercita todo el
// camino, incluida la sesión que sobrevive a una recarga en frío.
//
// Requiere el emulador corriendo y sembrado:
//   firebase emulators:start --project scissor-white
//   cd seed && FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=scissor-white npm run seed
//   cd functions && node scripts/seedEmulatorE2E.mjs
//
// Uso: node tests/e2e/navegador.mjs
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { makeChecker } from './emulator.mjs';

const OUT = path.resolve(import.meta.dirname, '../../.tmp-screenshots');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5000';   // hosting del emulador
const check = makeChecker();

const browser = await chromium.launch();

// ══════════════════ PWA del barbero ══════════════════
// Viewport de teléfono: la app se usa de pie.
const movil = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
const bp = await movil.newPage();
const errB = [];
bp.on('pageerror', (e) => errB.push(String(e)));
bp.on('console', (m) => { if (m.type() === 'error') errB.push(m.text()); });

await bp.goto(BASE + '/barbero/', { waitUntil: 'load' });
await bp.waitForTimeout(1200);
check('la PWA carga y muestra el login', await bp.isVisible('#b-login'));
check('la agenda está oculta sin sesión', !(await bp.isVisible('#b-app')));

await bp.fill('#b-email', 'victoria@scissorwhite.cl');
await bp.fill('#b-pass', 'barbero123');
await bp.click('#b-signin');
await bp.waitForSelector('#b-app', { state: 'visible', timeout: 15000 });
await bp.waitForSelector('#b-list .b-card', { timeout: 15000 });
await bp.waitForTimeout(500);

check('entra con Firebase Auth real', await bp.isVisible('#b-app'));
check('saluda a la barbera por su nombre', (await bp.textContent('#b-me')).trim() === 'Victoria',
  await bp.textContent('#b-me'));
const citas = await bp.evaluate(() => [...document.querySelectorAll('#b-list .b-card, #b-review .b-card')]
  .map((c) => ({ id: c.dataset.id, txt: c.querySelector('.b-name').textContent })));
check('getMyDay real trae las 3 citas de hoy', citas.length === 3, citas);
check('trae solo las citas de Victoria',
  citas.every((c) => ['E2E-PROX', 'E2E-AHORA', 'E2E-LIBRE'].includes(c.id)), citas.map((c) => c.id));
check('sin errores JS con el SDK real cargado', errB.length === 0, errB.slice(0, 4));

// ── el ciclo completo, tocando botones ──
const botones = (id) => bp.evaluate((i) =>
  [...document.querySelectorAll(`[data-act][data-id="${i}"]`)].map((b) => b.dataset.act), id);

check('la cita confirmada ofrece Llegó / No llegó / Iniciar',
  JSON.stringify(await botones('E2E-PROX')) === JSON.stringify(['arrive', 'no_show', 'start']),
  await botones('E2E-PROX'));

await bp.click('[data-act="arrive"][data-id="E2E-PROX"]');
await bp.waitForTimeout(2500);
check('tocar Llegó llama al callable y repinta con Iniciar',
  JSON.stringify(await botones('E2E-PROX')) === JSON.stringify(['start', 'no_show']),
  await botones('E2E-PROX'));

await bp.click('[data-act="start"][data-id="E2E-PROX"]');
await bp.waitForTimeout(2500);
const enCurso = await bp.evaluate(() => {
  const c = document.querySelector('.b-card.live');
  return c ? { acts: [...c.querySelectorAll('[data-act]')].map((b) => b.dataset.act),
               timer: (c.querySelector('.b-timer') || {}).textContent || '' } : null;
});
check('iniciar deja la tarjeta en atención con Finalizar y posponer',
  enCurso && JSON.stringify(enCurso.acts) === JSON.stringify(['end', 'snooze']), enCurso);
check('el cronómetro muestra la hora de inicio y el transcurrido',
  enCurso && /Empezó \d{2}:\d{2} · llevas 00:00:\d{2}/.test(enCurso.timer), enCurso && enCurso.timer.trim());

// El cronómetro corre solo, sin volver a pedir la agenda.
const t1 = await bp.textContent('.b-card.live .b-timer b');
await bp.waitForTimeout(1300);
const t2 = await bp.textContent('.b-card.live .b-timer b');
check('el cronómetro avanza sin recargar', t1 !== t2, { t1, t2 });

await bp.click('[data-act="snooze"][data-id="E2E-PROX"]');
await bp.waitForTimeout(2500);
check('posponer avisa y no cambia el estado',
  (await bp.evaluate(() => !!document.querySelector('.b-card.live'))), 'sigue en atención');

await bp.click('[data-act="end"][data-id="E2E-PROX"]');
await bp.waitForTimeout(2500);
const cerrada = await bp.evaluate(() => {
  const c = document.querySelector('[data-id="E2E-PROX"]');
  return c ? { cls: c.className, txt: c.textContent } : null;
});
check('finalizar deja la tarjeta como atendida', cerrada && /b-card done/.test(cerrada.cls), cerrada && cerrada.cls);
// El recorrido cierra la atención segundos después de abrirla, así que
// actualDur redondea a 0. La tarjeta NO debe decir "Duró 0 min · 60 min menos
// de lo planificado", que suena a error del sistema: debe decir que duró
// menos de un minuto y que no entra en el promedio (metrics.js la excluye).
check('una atención de menos de un minuto se explica, no se muestra como 0 min',
  cerrada && /menos de un minuto, no entra en el promedio/.test(cerrada.txt)
    && !/Duró 0 min/.test(cerrada.txt),
  cerrada && cerrada.txt.replace(/\s+/g, ' ').slice(0, 160));
check('ya no ofrece acciones sobre una atención cerrada',
  (await botones('E2E-PROX')).length === 0, await botones('E2E-PROX'));

await bp.click('[data-act="no_show"][data-id="E2E-AHORA"]');
await bp.waitForTimeout(2500);
check('marcar No llegó atenúa la tarjeta',
  await bp.evaluate(() => /void/.test((document.querySelector('[data-id="E2E-AHORA"]') || {}).className || '')));

// ── la prueba que motivó usar onAuthStateChanged: arranque en frío ──
await bp.reload({ waitUntil: 'load' });
await bp.waitForTimeout(2500);
check('tras recargar en frío la sesión sigue viva y NO pide contraseña',
  (await bp.isVisible('#b-app')) && !(await bp.isVisible('#b-login')),
  { app: await bp.isVisible('#b-app'), login: await bp.isVisible('#b-login') });

// El enlace profundo de la notificación, con sesión real.
await bp.goto(BASE + '/barbero/?b=E2E-LIBRE&a=arrive', { waitUntil: 'load' });
await bp.waitForTimeout(3000);
const deep = await bp.evaluate(() => ({
  url: location.search,
  cls: ((document.querySelector('[data-id="E2E-LIBRE"]') || {}).className || ''),
}));
check('el enlace profundo aplica la acción y limpia la URL', deep.url === '', deep.url);
check('el enlace profundo marcó la cita', /b-card(?! )/.test(deep.cls) && !/void/.test(deep.cls), deep.cls);

await bp.screenshot({ path: path.join(OUT, 'e2e-barbero.png'), fullPage: true }).catch(() => {});
check('sin errores JS en todo el recorrido de la PWA', errB.length === 0, errB.slice(0, 4));

// ══════════════════ Dashboard del admin ══════════════════
const desktop = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const ap = await desktop.newPage();
const errA = [];
ap.on('pageerror', (e) => errA.push(String(e)));
ap.on('console', (m) => { if (m.type() === 'error') errA.push(m.text()); });

await ap.goto(BASE + '/admin/', { waitUntil: 'load' });
await ap.waitForTimeout(1200);
await ap.fill('#adm-email', 'admin@scissorwhite.cl');
await ap.fill('#adm-pass', 'admin123');
await ap.click('#adm-login-btn');
await ap.waitForSelector('#adm-app', { state: 'visible', timeout: 15000 });
await ap.waitForSelector('#a-dash .a-dash-kpis .a-sc', { timeout: 15000 });
await ap.waitForTimeout(1500);

check('el admin entra con Auth real', await ap.isVisible('#adm-app'));
check('sin errores JS en el panel', errA.length === 0, errA.slice(0, 4));

const kpis = await ap.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll('#a-dash .a-dash-kpis .a-sc')]
    .map((c) => [c.querySelector('.a-scl').textContent.trim(), c.querySelector('.a-scv').textContent.trim()])));
check('la vista simple arranca con los 5 KPI', Object.keys(kpis).length === 5, kpis);
check('la asistencia real se calculó con datos reales',
  /^\d+%$/.test(kpis['Asistencia real'] || ''), kpis['Asistencia real']);
check('el no-show se calculó con datos reales', /^\d+%$/.test(kpis['No-show'] || ''), kpis['No-show']);
check('las ventas del período no son cero', /\$[1-9]/.test(kpis['Ventas del período'] || ''), kpis['Ventas del período']);

const reco = await ap.evaluate(() => [...document.querySelectorAll('#a-dash .a-ins')]
  .map((c) => ({ k: (c.querySelector('.a-ins-k') || {}).textContent, t: (c.querySelector('.a-ins-t') || {}).textContent })));
check('con 33 atenciones medidas reales aparecen recomendaciones', reco.length >= 1, reco);
check('no aparecen más de 3 recomendaciones', reco.length <= 3, reco.length);

const nota = await ap.textContent('#a-dash .a-dash-note');
check('el pie declara la cobertura real de asistencia', /asistencia registrada/.test(nota), nota.slice(0, 160));

await ap.screenshot({ path: path.join(OUT, 'e2e-dash-simple.png') }).catch(() => {});

await ap.click('#a-dash-view-d');
await ap.waitForTimeout(800);
const det = await ap.evaluate(() => ({
  tvr: [...document.querySelectorAll('#a-dash .a-tvr')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
  heat: document.querySelectorAll('#a-dash .a-heat td').length,
  ocup: [...document.querySelectorAll('#a-dash .a-dash-kpis .a-sc')]
    .filter((c) => /Ocupación/.test(c.querySelector('.a-scl').textContent))
    .map((c) => c.querySelector('.a-scv').textContent.trim())[0],
}));
check('el detalle muestra el tiempo real medido por servicio', det.tvr.length >= 1, det.tvr);
// Se verifica el CÁLCULO, no el signo: con el catálogo real el corte tiene
// 60 min planificados y la mediana medida es 53, así que la desviación sale
// negativa (capacidad escondida). Asumir que siempre es positiva sería
// hardcodear el fixture.
const tvrCalc = det.tvr.map((t) => {
  // El texto sin espacios queda como "...60plan53real-12%12medidas..."
  const m = /(\d+)plan(\d+)real([+-]?\d+)%/.exec(t.replace(/\s+/g, ''));
  if (!m) return { t, ok: false, motivo: 'no parsea' };
  const plan = +m[1], real = +m[2], pct = +m[3];
  const esperado = Math.round(((real - plan) / plan) * 100);
  return { t, plan, real, pct, esperado, ok: Math.abs(pct - esperado) <= 1 };
});
check('la desviación mostrada coincide con (real - plan) / plan',
  tvrCalc.length >= 1 && tvrCalc.every((x) => x.ok), tvrCalc);
check('el mapa de ocupación se pintó con horarios reales', det.heat > 0, det.heat);
check('la ocupación efectiva tiene un valor', /%|—/.test(det.ocup || ''), det.ocup);

// La Agenda: badges de los estados que acabamos de producir desde la PWA.
await ap.click('.an-item[data-p="calendar"]');
await ap.waitForTimeout(1200);
const agenda = await ap.evaluate(() => {
  const out = {};
  document.querySelectorAll('#a-bk-timeline .a-bk-card').forEach((c) => {
    const t = c.querySelector('.a-bk-card-status-tag');
    out[c.dataset.code] = t ? t.textContent.trim() : null;
  });
  return out;
});
check('la Agenda refleja la atención cerrada desde la PWA',
  /Atendida/.test(agenda['E2E-PROX'] || ''), agenda);
check('la Agenda refleja el no-show marcado desde la PWA',
  /No llegó/.test(agenda['E2E-AHORA'] || ''), agenda);

await ap.screenshot({ path: path.join(OUT, 'e2e-agenda.png') }).catch(() => {});
check('sin errores JS tras recorrer todo el panel', errA.length === 0, errA.slice(0, 4));

await browser.close();
check.done();
