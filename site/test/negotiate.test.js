'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prefersMarkdown, planResponse, notFoundMarkdown } = require('../negotiate.js');

test('prefersMarkdown: un navegador real recibe HTML', () => {
  assert.equal(prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'), false);
  assert.equal(prefersMarkdown('*/*'), false);
  assert.equal(prefersMarkdown(''), false);
  assert.equal(prefersMarkdown(undefined), false);
});

test('prefersMarkdown: text/markdown explícito gana', () => {
  assert.equal(prefersMarkdown('text/markdown'), true);
  assert.equal(prefersMarkdown('text/markdown; charset=utf-8'), true);
  assert.equal(prefersMarkdown('TEXT/Markdown'), true);
  assert.equal(prefersMarkdown('text/markdown, text/html;q=0.9'), true);
  assert.equal(prefersMarkdown('text/plain, text/markdown, */*;q=0.1'), true);
});

test('prefersMarkdown: q decide, y el empate lo gana el que va primero', () => {
  assert.equal(prefersMarkdown('text/html, text/markdown;q=0.5'), false);
  assert.equal(prefersMarkdown('text/markdown;q=0.5, text/html'), false);
  assert.equal(prefersMarkdown('text/markdown, text/html'), true);
  assert.equal(prefersMarkdown('text/html, text/markdown'), false);
  assert.equal(prefersMarkdown('text/markdown;q=0'), false);
  // text/* y */* compiten como si fueran HTML, pero nunca activan Markdown solos.
  assert.equal(prefersMarkdown('text/*'), false);
  assert.equal(prefersMarkdown('text/markdown;q=0.4, text/*;q=0.8'), false);
});

test('planResponse: la portada negocia y siempre lleva Vary: Accept', () => {
  const md = planResponse({ method: 'GET', path: '/', accept: 'text/markdown' });
  assert.equal(md.status, 200);
  assert.equal(md.asset, '/index.md');
  assert.equal(md.assetStatus, 200);
  assert.equal(md.headers['Content-Type'], 'text/markdown; charset=utf-8');
  assert.equal(md.headers.Vary, 'Accept');

  const html = planResponse({ method: 'GET', path: '/', accept: 'text/html' });
  assert.equal(html.status, 200);
  assert.equal(html.asset, '/home.html');
  assert.equal(html.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(html.headers.Vary, 'Accept');
  assert.match(html.headers.Link, /<\/index\.md>; rel="alternate"; type="text\/markdown"/);
});

test('planResponse: Cache-Control igual que el index.html estático de antes', () => {
  for (const accept of ['text/markdown', 'text/html']) {
    assert.equal(planResponse({ method: 'GET', path: '/', accept }).headers['Cache-Control'], 'no-cache');
  }
});

test('planResponse: cualquier otra ruta es 404 real, en el formato pedido', () => {
  const md = planResponse({ method: 'GET', path: '/no-existe', accept: 'text/markdown' });
  assert.equal(md.status, 404);
  assert.equal(md.asset, null);
  assert.equal(md.headers['Content-Type'], 'text/markdown; charset=utf-8');
  assert.equal(md.headers.Vary, 'Accept');
  assert.ok(md.body.length >= 20);

  const html = planResponse({ method: 'GET', path: '/no-existe', accept: 'text/html' });
  assert.equal(html.status, 404);
  assert.equal(html.asset, '/404.html');
  // Hosting entrega 404.html con status 404: la función no debe tomarlo por falla.
  assert.equal(html.assetStatus, 404);
  assert.equal(html.headers['Content-Type'], 'text/html; charset=utf-8');
});

test('planResponse: HEAD igual que GET; otros métodos 405', () => {
  assert.equal(planResponse({ method: 'HEAD', path: '/', accept: 'text/markdown' }).status, 200);
  const post = planResponse({ method: 'POST', path: '/', accept: 'text/html' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, 'GET, HEAD');
});

test('notFoundMarkdown: explica, enlaza llms.txt/sitemap y no inyecta la ruta', () => {
  const body = notFoundMarkdown('/x](https://evil.example)\n# hola');
  assert.match(body, /^# /);
  assert.match(body, /https:\/\/scissorwhite\.cl\/llms\.txt/);
  assert.match(body, /https:\/\/scissorwhite\.cl\/sitemap\.xml/);
  assert.doesNotMatch(body, /\]\(https:\/\/evil/);
  assert.doesNotMatch(body, /\n# hola/);
});

test('originFor: solo hosts propios; el resto cae al dominio de producción', () => {
  const { originFor } = require('../negotiate.js');
  assert.equal(originFor('scissorwhite.cl'), 'https://scissorwhite.cl');
  assert.equal(originFor('www.scissorwhite.cl'), 'https://www.scissorwhite.cl');
  assert.equal(originFor('scissor-white.web.app'), 'https://scissor-white.web.app');
  assert.equal(originFor('scissor-white--medicion-ab12cd.web.app'), 'https://scissor-white--medicion-ab12cd.web.app');
  assert.equal(originFor('scissor-white.firebaseapp.com'), 'https://scissor-white.firebaseapp.com');
  // Nada de SSRF: un Host arbitrario nunca decide a quién le pide la función.
  for (const bad of ['evil.example', 'scissorwhite.cl.evil.example', 'otro-proyecto.web.app', 'scissorwhite.cl:8080', '', undefined, 'a, scissorwhite.cl']) {
    assert.equal(originFor(bad), 'https://scissorwhite.cl', String(bad));
  }
});
