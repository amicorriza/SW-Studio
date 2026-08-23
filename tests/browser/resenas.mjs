// Casos borde de la sección de reseñas del landing (#resenas).
//
// Script standalone (no vitest): se corre con `node tests/browser/resenas.mjs`.
// Requiere Playwright, que NO es dependencia del repo todavía:
//   npm install --save-dev playwright && npx playwright install chromium
//
// Levanta un servidor estático sobre `public/` y stubbea `window.SWData`
// ANTES de que corra el script del sitio. Las rutas a gstatic/googleapis se
// abortan a propósito: si `public/js/data.js` real llegara a cargar, pisaría
// el stub con la capa de Firestore de verdad y el test dejaría de ser
// hermético (además de pegarle a la base real).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{ if(e){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'}); res.end(b); });
});
await new Promise(r=>server.listen(4478,r));
const browser = await chromium.launch();

const LONG = 'Fui por una asesoría de visagismo sin saber muy bien de qué se trataba. '.repeat(6);

const CASES = {
  'sin doc en Firestore': null,
  'doc vacío': {},
  'solo puntaje, sin reseñas con texto': { rating:5, userRatingCount:15, googleMapsUri:'https://maps.google.com/?cid=1' },
  'solo reseñas curadas a mano': { rating:5, userRatingCount:15,
    manualReviews:[
      {author:'Cliente A', rating:5, text:'Excelente atención.', publishTime:'2026-06-01T00:00:00Z'},
      {author:'Cliente B', rating:5, text:'Muy recomendable.', publishTime:'2026-07-01T00:00:00Z'},
      {author:'Cliente C', rating:4, text:'Buen corte.', publishTime:'2026-08-01T00:00:00Z'},
    ] },
  'respaldo sin puntaje (no debe decir "en Google")': {
    manualReviews:[
      {author:'Cliente A', rating:5, text:'Excelente atención.'},
      {author:'Cliente B', rating:5, text:'Muy recomendable.'},
      {author:'Cliente C', rating:4, text:'Buen corte.'},
    ] },
  'dos reseñas (marquesina estática)': { rating:4.5, userRatingCount:2,
    reviews:[{author:'A',rating:5,text:'Genial.',relativeTime:'hace un día'},
             {author:'B',rating:4,text:'Bien.',relativeTime:'hace 2 días'}] },
  'reseña larga (Leer más)': { rating:5, userRatingCount:9,
    reviews:[{author:'Largo', rating:5, text:LONG, relativeTime:'hace un mes'},
             {author:'B',rating:5,text:'Corto.',relativeTime:'hoy'},
             {author:'C',rating:5,text:'Corto.',relativeTime:'hoy'}] },
  'XSS en el nombre y el texto': { rating:5, userRatingCount:3,
    reviews:[{author:'<img src=x onerror=window.__pwned=1>', rating:5,
              text:'<script>window.__pwned=1<\/script> Todo bien.', relativeTime:'hoy'}] },
};

let fails = 0;
function check(name, cond, detail){
  if(!cond){ fails++; console.log(`   ✗ ${name}` + (detail!==undefined?` -> ${detail}`:'')); }
  else console.log(`   ✓ ${name}`);
}

for (const [label, fixture] of Object.entries(CASES)) {
  const ctx = await browser.newContext({ viewport:{width:1440,height:1000} });
  await ctx.route('**gstatic.com/**', r=>r.abort());
  await ctx.route('**googleapis.com/**', r=>r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(f => {
    try { sessionStorage.setItem('sw-intro-seen','1'); } catch(e){}
    window.__FIXTURE__ = f;
    window.SWData = { loadGoogleReviews: async () => window.__FIXTURE__, loadSiteImages: async () => ({}) };
  }, fixture);
  await page.goto('http://localhost:4478/', { waitUntil:'load' });
  await page.waitForTimeout(700);

  const st = await page.evaluate(() => {
    const s = document.getElementById('resenas');
    const rail = document.getElementById('gr-rail');
    return {
      visible: !s.hidden,
      navShown: !document.querySelector('.nav-links .gr-nav').hidden,
      cards: document.querySelectorAll('.gr-half:not(.gr-dup) .gr-card').length,
      railHidden: rail.hidden,
      static: rail.classList.contains('gr-static'),
      googleMarks: document.querySelectorAll('.gr-half:not(.gr-dup) .gr-src').length,
      moreBtns: document.querySelectorAll('.gr-half:not(.gr-dup) .gr-more').length,
      label: (document.querySelector('.gr-score-lbl')||{}).textContent || '',
      writeHidden: document.getElementById('gr-write').hidden,
      pwned: !!window.__pwned,
      firstName: (document.querySelector('.gr-half:not(.gr-dup) .gr-name')||{}).textContent || '',
      scoreMainHidden: document.querySelector('.gr-score-main').hidden,
      divHidden: document.querySelector('.gr-score-div').hidden,
      note: document.querySelector('.gr-note').textContent.replace(/\s+/g,' ').trim(),
    };
  });

  console.log(`\n▸ ${label}`);
  check('sin errores JS', errors.length === 0, errors[0]);
  check('no hay XSS ejecutado', st.pwned === false);

  if (label === 'sin doc en Firestore' || label === 'doc vacío') {
    check('sección oculta', st.visible === false);
    check('enlace de menú oculto', st.navShown === false);
  } else {
    check('sección visible', st.visible === true);
    check('enlace de menú visible', st.navShown === true);
  }
  if (label === 'solo puntaje, sin reseñas con texto') {
    check('riel oculto (no hay tarjetas)', st.railHidden === true);
  }
  if (label === 'solo reseñas curadas a mano') {
    check('3 tarjetas', st.cards === 3, st.cards);
    check('sin marca de Google en tarjetas no verificadas', st.googleMarks === 0, st.googleMarks);
  }
  if (label === 'respaldo sin puntaje (no debe decir "en Google")') {
    check('esconde el bloque de puntaje', st.scoreMainHidden === true);
    check('esconde el separador suelto', st.divHidden === true);
    check('el pie NO promete actualización diaria desde Google', !/Se actualizan solas/.test(st.note), st.note);
    check('el pie no atribuye las reseñas a Google', !/publicadas por clientes reales en el perfil de Google/.test(st.note), st.note);
    check('3 tarjetas', st.cards === 3, st.cards);
    check('sin marca de Google en las tarjetas', st.googleMarks === 0, st.googleMarks);
  }
  if (label === 'solo reseñas curadas a mano') {
    check('con puntaje cargado, el bloque de puntaje SÍ se muestra', st.scoreMainHidden === false);
  }
  if (label === 'dos reseñas (marquesina estática)') {
    check('riel estático', st.static === true);
    check('2 tarjetas', st.cards === 2, st.cards);
  }
  if (label === 'reseña larga (Leer más)') {
    check('un solo botón Leer más', st.moreBtns === 1, st.moreBtns);
    // Como un usuario real: primero el mouse entra al riel (lo que congela la
    // marquesina vía :hover) y recién ahí se puede apuntar al botón.
    await page.locator('#gr-rail').hover();
    await page.waitForTimeout(200);
    const animPaused = await page.locator('#gr-track').evaluate(e=>getComputedStyle(e).animationPlayState);
    check('el hover congela la marquesina', animPaused === 'paused', animPaused);
    const before = await page.locator('.gr-half:not(.gr-dup) .gr-card').first().evaluate(e=>e.getBoundingClientRect().height);
    await page.locator('.gr-half:not(.gr-dup) .gr-more').first().click();
    await page.waitForTimeout(120);
    const after = await page.locator('.gr-half:not(.gr-dup) .gr-card').first().evaluate(e=>e.getBoundingClientRect().height);
    const paused = await page.locator('#gr-rail').evaluate(e=>e.classList.contains('is-paused'));
    const txt = await page.locator('.gr-half:not(.gr-dup) .gr-more').first().textContent();
    check('la tarjeta crece al expandir', after > before, `${before} -> ${after}`);
    check('el riel se congela mientras se lee', paused === true);
    check('el botón cambia a "Leer menos"', txt.trim() === 'Leer menos', txt);
  }
  if (label === 'XSS en el nombre y el texto') {
    check('el nombre se muestra como texto plano', st.firstName.includes('<img'), st.firstName);
  }
  await ctx.close();
}

console.log(fails === 0 ? '\n== TODO OK ==' : `\n== ${fails} FALLAS ==`);
await browser.close(); server.close();
process.exit(fails === 0 ? 0 : 1);
