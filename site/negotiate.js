// site/negotiate.js — decide QUÉ responder en "/" y en las rutas inexistentes,
// según el header Accept. Puro: sin red, sin Firebase, testeable con node --test.
//
// Por qué existe: Firebase Hosting sirve archivos estáticos sin mirar Accept,
// y un agente que pide `Accept: text/markdown` debe recibir Markdown en la
// MISMA URL (acceptmarkdown.com). Por eso "/" ya no es un index.html estático:
// la landing vive en public/home.html y la función `site` la entrega (o
// entrega public/index.md) según esta decisión.
'use strict';

const SITE = 'https://scissorwhite.cl';

// Parsea Accept a [{type, q, pos}]. Ignora entradas malformadas.
function parseAccept(header) {
  if (!header || typeof header !== 'string') return [];
  return header.split(',').map((raw, pos) => {
    const [type, ...params] = raw.trim().toLowerCase().split(';').map(s => s.trim());
    let q = 1;
    for (const p of params) {
      const m = /^q=([0-9.]+)$/.exec(p);
      if (m) q = Math.min(1, Math.max(0, Number(m[1]) || 0));
    }
    return { type, q, pos };
  }).filter(e => /^[a-z0-9.+*-]+\/[a-z0-9.+*-]+$/.test(e.type));
}

// Markdown SOLO si el cliente nombra text/markdown explícitamente y lo prefiere
// sobre HTML (text/html, text/* o */*). Empate de q: gana el listado primero.
// Un navegador nunca nombra text/markdown, así que siempre recibe HTML.
function prefersMarkdown(header) {
  const entries = parseAccept(header);
  const md = entries.find(e => e.type === 'text/markdown');
  if (!md || md.q <= 0) return false;
  const html = entries
    .filter(e => e.type === 'text/html' || e.type === 'text/*' || e.type === '*/*')
    .sort((a, b) => b.q - a.q || a.pos - b.pos)[0];
  if (!html) return true;
  return md.q > html.q || (md.q === html.q && md.pos < html.pos);
}

function notFoundMarkdown() {
  // La ruta pedida NO se incluye: es input del cliente y podría inyectar
  // enlaces o encabezados en el Markdown.
  return [
    '# Página no encontrada (404)',
    '',
    'La dirección solicitada no existe en scissorwhite.cl, el sitio de Scissor White — SW Studio, barbería en Concepción, Chile.',
    '',
    `- Inicio: ${SITE}/`,
    `- Guía para agentes (llms.txt): ${SITE}/llms.txt`,
    `- Mapa del sitio: ${SITE}/sitemap.xml`,
    `- Reservar hora: ${SITE}/#agenda`,
    '',
  ].join('\n');
}

// Origen del que la función trae las páginas: el mismo host por el que entró
// la petición (así un canal de preview sirve SU home.html, no el de
// producción), pero solo si es un host propio. Cualquier otro valor del header
// cae al dominio de producción: el Host lo controla el cliente.
const OWN_HOST = /^(?:(?:www\.)?scissorwhite\.cl|scissor-white(?:--[a-z0-9-]+)?\.(?:web\.app|firebaseapp\.com))$/;
function originFor(host) {
  const h = typeof host === 'string' ? host.trim().toLowerCase() : '';
  return OWN_HOST.test(h) ? `https://${h}` : SITE;
}

const MD = 'text/markdown; charset=utf-8';
const HTML = 'text/html; charset=utf-8';

// Devuelve {status, asset, assetStatus, body, headers}. `asset` es la ruta en
// Hosting que la función debe traer y reenviar, y `assetStatus` el código con
// que Hosting la entrega (404.html llega con 404, no con 200). Si `asset` es
// null, `body` ya es la respuesta.
function planResponse({ method, path, accept }) {
  const base = { Vary: 'Accept', 'Cache-Control': 'no-cache' };
  if (method !== 'GET' && method !== 'HEAD') {
    return { status: 405, asset: null, body: 'Method Not Allowed\n',
      headers: { ...base, Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' } };
  }
  const md = prefersMarkdown(accept);
  if (path === '/') {
    return md
      ? { status: 200, asset: '/index.md', assetStatus: 200, body: null, headers: { ...base, 'Content-Type': MD } }
      : { status: 200, asset: '/home.html', assetStatus: 200, body: null,
          headers: { ...base, 'Content-Type': HTML, Link: '</index.md>; rel="alternate"; type="text/markdown"' } };
  }
  return md
    ? { status: 404, asset: null, body: notFoundMarkdown(), headers: { ...base, 'Content-Type': MD } }
    : { status: 404, asset: '/404.html', assetStatus: 404, body: null, headers: { ...base, 'Content-Type': HTML } };
}

module.exports = { parseAccept, prefersMarkdown, planResponse, notFoundMarkdown, originFor, SITE };
