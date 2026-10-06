// site/index.js — función `site`: sirve "/" y las rutas inexistentes con
// negociación de contenido (HTML para navegadores, Markdown para agentes que
// piden Accept: text/markdown). Codebase aparte de functions/ a propósito: no
// carga firebase-admin ni los secretos, así el arranque en frío de la portada
// es lo más corto posible.
//
// Las páginas NO se copian acá: se traen de Hosting (public/home.html,
// public/index.md, public/404.html), así un `deploy --only hosting` que edita
// la landing se ve sin redeplegar la función. Caché por instancia de 60 s y,
// si Hosting no responde, se sirve la última copia buena.
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { planResponse, originFor } = require('./negotiate.js');

// En el emulador SITE_ORIGIN apunta al Hosting local (site/.env.local) y manda
// sobre el host de la petición.
const FIXED_ORIGIN = (process.env.SITE_ORIGIN || '').replace(/\/$/, '');
const TTL_MS = 60 * 1000;
const cache = new Map(); // origen + asset -> { body, at }

async function loadAsset(origin, asset, expectedStatus) {
  const key = origin + asset;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.body;
  try {
    const res = await fetch(key, { headers: { 'Accept-Encoding': 'identity' } });
    // 404.html llega con 404 en Hosting; se acepta también un 2xx por si cambia.
    if (!res.ok && res.status !== expectedStatus) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    cache.set(key, { body, at: Date.now() });
    return body;
  } catch (err) {
    logger.error('site: no se pudo traer el asset', { url: key, error: String(err) });
    if (hit) return hit.body;
    return null;
  }
}

exports.site = onRequest(
  { region: 'southamerica-east1', memory: '256MiB', concurrency: 80 },
  async (req, res) => {
    const plan = planResponse({ method: req.method, path: req.path, accept: req.get('accept') });
    let body = plan.body;
    if (plan.asset) {
      const origin = FIXED_ORIGIN || originFor(req.get('x-forwarded-host'));
      body = await loadAsset(origin, plan.asset, plan.assetStatus);
      if (body === null) {
        res.set({ 'Cache-Control': 'no-store', 'Retry-After': '30', Vary: 'Accept' });
        res.status(503).type('text/plain').send('Servicio no disponible temporalmente.\n');
        return;
      }
    }
    res.set(plan.headers);
    res.status(plan.status);
    if (req.method === 'HEAD') res.end();
    else res.send(body);
  }
);
