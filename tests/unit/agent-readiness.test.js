// Fija lo que leen los agentes de IA en public/: JSON-LD válido, páginas de
// confianza con contenido real, llms.txt con su formato y la versión Markdown
// de la portada. La negociación Accept en sí se prueba en site/test/.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', '..', 'public');
const read = (p) => fs.readFileSync(path.join(PUB, p), 'utf8');

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(m => JSON.parse(m[1]));
}
function visibleText(html) {
  const main = (/<main>([\s\S]*?)<\/main>/.exec(html) || [])[1] || '';
  return main.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

test('home.html: todo el JSON-LD parsea y cada Person tiene url', () => {
  const blocks = jsonLdBlocks(read('home.html'));
  assert.ok(blocks.length >= 3);
  const salon = blocks.find(b => b['@type'] === 'HairSalon');
  assert.ok(salon.employee.length > 0);
  for (const p of salon.employee) {
    assert.equal(p['@type'], 'Person');
    assert.match(p.url, /^https:\/\/scissorwhite\.cl\//);
  }
});

test('home.html anuncia la versión Markdown y enlaza las páginas de confianza', () => {
  const html = read('home.html');
  assert.match(html, /<link rel="alternate" type="text\/markdown" href="\/index\.md">/);
  for (const p of ['/about/', '/contact/', '/privacy/']) assert.ok(html.includes(`href="${p}"`), p);
});

test('ya no hay public/index.html: "/" la sirve la función site', () => {
  assert.equal(fs.existsSync(path.join(PUB, 'index.html')), false);
});

for (const page of ['about', 'contact', 'privacy']) {
  test(`/${page}/ tiene contenido real (>= 500 caracteres), canonical y JSON-LD válido`, () => {
    const html = read(`${page}/index.html`);
    assert.ok(visibleText(html).length >= 500, `${page}: ${visibleText(html).length}`);
    assert.ok(html.includes(`<link rel="canonical" href="https://scissorwhite.cl/${page}/">`));
    assert.ok(jsonLdBlocks(html).length >= 1);
  });
}

test('el ancla de la Person del JSON-LD existe en /about/', () => {
  assert.match(read('about/index.html'), /id="victoria"/);
});

test('llms.txt sigue el formato llmstxt.org e incluye "When to use"', () => {
  const txt = read('llms.txt');
  const lines = txt.split('\n');
  assert.match(lines[0], /^# \S/);                    // H1 obligatorio, primero
  assert.ok(lines.some(l => l.startsWith('> ')));     // resumen en blockquote
  assert.match(txt, /^## When to use$/m);
  assert.match(txt, /^## Optional$/m);
  // Las listas de enlaces de las secciones H2 usan "- [nombre](url)".
  assert.ok(/^- \[[^\]]+\]\(https:\/\/scissorwhite\.cl\/[^)]*\)/m.test(txt));
});

test('index.md: Markdown no vacío con H1 y datos de contacto', () => {
  const md = read('index.md');
  assert.match(md, /^# Scissor White/);
  assert.match(md, /\+56 9 8251 4114/);
  assert.match(md, /https:\/\/scissorwhite\.cl\/#agenda/);
});

test('404.html existe, es noindex y enlaza sitemap y llms.txt', () => {
  const html = read('404.html');
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(html, /href="\/sitemap\.xml"/);
  assert.match(html, /href="\/llms\.txt"/);
});

test('sitemap.xml lista la portada y las páginas de confianza', () => {
  const xml = read('sitemap.xml');
  for (const u of ['/', '/about/', '/contact/', '/privacy/']) {
    assert.ok(xml.includes(`<loc>https://scissorwhite.cl${u}</loc>`), u);
  }
});

test('firebase.json: "/" y los 404 van a la función site', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(PUB, '..', 'firebase.json'), 'utf8'));
  assert.deepEqual(cfg.hosting.rewrites, [
    { source: '**', function: { functionId: 'site', region: 'southamerica-east1' } },
  ]);
  assert.ok(cfg.functions.some(f => f.source === 'site' && f.codebase === 'site'));
});

test('privacidad: plazo de 6 meses, consentimiento de fotos y correo de contacto', () => {
  const html = read('privacy/index.html');
  assert.match(html, /6 meses desde tu última reserva o atención/);
  assert.match(html, /solo con tu consentimiento, fotografías/);
  assert.match(html, /mailto:contacto@scissorwhite\.cl/);
  assert.match(read('contact/index.html'), /mailto:contacto@scissorwhite\.cl/);
  const salon = jsonLdBlocks(read('home.html')).find(b => b['@type'] === 'HairSalon');
  assert.equal(salon.email, 'contacto@scissorwhite.cl');
});
