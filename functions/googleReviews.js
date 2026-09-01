// functions/googleReviews.js — trae las reseñas del perfil de Google Business
// del negocio (Places API New) y las normaliza al documento
// `googleReviews/main` que lee el landing público.
//
// PRINCIPIO: nada de esto se consulta desde el navegador del visitante. La
// API key de Places es un secreto server-side (una key expuesta en el
// front se puede usar desde cualquier origen y la factura la paga el
// cliente), así que el camino es siempre el mismo que ya usa `availability`:
// una Cloud Function con Admin SDK escribe una vista pública sin datos
// sensibles, y el público solo LEE ese doc. Eso además desacopla la latencia
// (la web nunca espera a Google) y el costo (una llamada al día, no una por
// visita).
//
// Sin dependencia de firebase-admin ni de `fetch` global en el módulo: el
// I/O entra por parámetro (`fetchImpl`), igual que availability.js/patients.js
// reciben los datos ya leídos. Así todo esto se testea con `node --test` sin
// emulador ni red.
'use strict';

const PLACES_BASE = 'https://places.googleapis.com/v1';

// Places API (New) cobra por campo pedido: pedir de más sube el tier de
// facturación sin que lo usemos. Estos son exactamente los que renderiza la
// sección de reseñas del landing, ni uno más.
const DETAILS_FIELD_MASK = 'id,displayName,rating,userRatingCount,googleMapsUri,reviews';
// La búsqueda SOLO resuelve el placeId (ver pickPlaceId): pedir acá rating o
// userRatingCount no aporta nada -- los trae después Place Details -- y sí
// empuja la llamada al SKU "Text Search Enterprise", mucho más caro que el
// tramo básico. displayName/formattedAddress se quedan porque son lo único
// que hace legible el log cuando Google devuelve el local equivocado.
const SEARCH_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress';

// Place Details (New) devuelve como máximo 5 reseñas — no hay parámetro para
// pedir más, no es una limitación de esta implementación. La constante existe
// para que el front sepa que la lista es una muestra, no el total.
const MAX_REVIEWS_FROM_API = 5;

const DEFAULT_LANGUAGE = 'es';
const DEFAULT_REGION = 'CL';

// ── Consulta de búsqueda ────────────────────────────────────────────────────
// Si nadie configuró `googlePlaceId`, se resuelve una vez a partir de los
// datos que el negocio YA tiene cargados en businessInfo (nombre + dirección)
// y se persiste. Buscar por texto en cada sync sería frágil (Google puede
// devolver otro local homónimo) y caro: el placeId es estable y su cacheo es
// el único dato de Places que los términos permiten guardar indefinidamente.
function buildSearchQuery(businessInfo) {
  const info = businessInfo || {};
  const parts = [info.name, info.addr].filter(p => typeof p === 'string' && p.trim());
  return parts.join(', ').trim();
}

// De la respuesta de places:searchText toma el primer resultado — Google los
// devuelve por relevancia y la consulta lleva nombre + dirección exacta, así
// que el primero es el local. Devuelve null si no hubo ninguno: el llamador
// decide si eso es un error duro o un "todavía no configurado".
function pickPlaceId(searchJson) {
  const places = (searchJson && searchJson.places) || [];
  const first = places.find(p => p && typeof p.id === 'string' && p.id);
  return first ? first.id : null;
}

// ── Normalización ───────────────────────────────────────────────────────────
// Aplana una reseña de Places al shape mínimo que dibuja la tarjeta. Los
// nombres de la API son largos y anidados (`authorAttribution.displayName`,
// `text.text`); guardarlos crudos obligaría al front a conocer el contrato de
// Google, que es justo lo que esta capa existe para absorber.
//
// `text` vs `originalText`: cuando la reseña está en otro idioma, Places
// devuelve la traducción en `text` y el original en `originalText`. Se guardan
// ambos y se marca `translated` — los términos de Places exigen mostrar la
// reseña sin alterarla, y ofrecer el original es parte de eso.
function normalizeReview(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const author = raw.authorAttribution || {};
  const text = (raw.text && raw.text.text) || '';
  const originalText = (raw.originalText && raw.originalText.text) || '';
  const body = (text || originalText).trim();
  // Una reseña que es solo estrellas (sin comentario) no tiene nada que
  // mostrar en una tarjeta: se descarta acá, no en el front, para que el
  // conteo de tarjetas del doc sea el real.
  if (!body) return null;
  return {
    // `name` viene como 'places/X/reviews/Y' — sirve de key estable para el
    // render y para deduplicar si alguna vez se acumulan.
    id: typeof raw.name === 'string' ? raw.name : '',
    author: (author.displayName || 'Cliente de Google').trim(),
    photo: author.photoUri || '',
    profileUri: author.uri || '',
    rating: Number.isFinite(raw.rating) ? raw.rating : 0,
    text: body,
    originalText: originalText && originalText !== text ? originalText : '',
    translated: Boolean(originalText && text && originalText !== text),
    languageCode: (raw.text && raw.text.languageCode) || '',
    relativeTime: raw.relativePublishTimeDescription || '',
    publishTime: raw.publishTime || '',
  };
}

// Enlace oficial para dejar una reseña. No lo devuelve la API — se arma con
// el placeId y es el único formato que Google documenta para esto.
function writeReviewUri(placeId) {
  return placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : '';
}

// Respuesta de Place Details -> documento `googleReviews/main`.
//
// El ORDEN de `reviews` se conserva tal cual lo devuelve Google (las "más
// relevantes"). No se reordena ni se filtra por puntaje: la política de
// Places prohíbe alterar las reseñas o mostrarlas selectivamente, y aparte
// una barbería que solo muestra 5★ elegidas a dedo genera menos confianza,
// no más — que es todo el punto de esta sección.
function normalizePlaceDetails(detailsJson, opts) {
  const json = detailsJson || {};
  const placeId = (opts && opts.placeId) || json.id || '';
  const reviews = (Array.isArray(json.reviews) ? json.reviews : [])
    .map(normalizeReview)
    .filter(Boolean)
    .slice(0, MAX_REVIEWS_FROM_API);
  return {
    placeId,
    name: (json.displayName && json.displayName.text) || '',
    // `rating` y `userRatingCount` resumen TODAS las reseñas del perfil, no
    // solo las 5 que vienen en `reviews` — por eso la sección puede decir
    // "4,9 sobre 137 opiniones" aunque muestre cinco tarjetas.
    rating: Number.isFinite(json.rating) ? json.rating : 0,
    userRatingCount: Number.isFinite(json.userRatingCount) ? json.userRatingCount : 0,
    googleMapsUri: json.googleMapsUri || '',
    writeReviewUri: writeReviewUri(placeId),
    reviews,
    source: 'places-api',
    // ISO string y no serverTimestamp: este módulo es puro y testeable sin
    // firebase-admin. El llamador (index.js) agrega además `updatedAt` con
    // FieldValue.serverTimestamp() para el ordenamiento/ops del lado servidor.
    fetchedAt: (opts && opts.now ? opts.now : new Date()).toISOString(),
  };
}

// ── Frescura ────────────────────────────────────────────────────────────────
// Los términos de Places permiten cachear el contenido de un place hasta 30
// días (el placeId, indefinidamente). El schedule diario queda MUY dentro de
// eso; este guard existe para el callable manual del panel: evita que apretar
// "Sincronizar" diez veces seguidas dispare diez llamadas facturadas.
function isFresh(doc, now, maxAgeMinutes) {
  if (!doc || !doc.fetchedAt) return false;
  const then = Date.parse(doc.fetchedAt);
  if (!Number.isFinite(then)) return false;
  const ageMin = (now.getTime() - then) / 60000;
  return ageMin >= 0 && ageMin < maxAgeMinutes;
}

// ── I/O ─────────────────────────────────────────────────────────────────────
async function placesRequest(url, { apiKey, fieldMask, method = 'GET', body = null, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('fetch no disponible en este runtime');
  const res = await doFetch(url, {
    method,
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // El detalle de Places viene en json.error.message ('API key not valid',
    // 'PERMISSION_DENIED: Places API has not been used in project...'). Sin
    // esto el log solo diría "500" y diagnosticar la causa sería adivinar.
    const detail = (json && json.error && json.error.message) || '';
    const err = new Error(`Places API ${res.status}${detail ? ': ' + detail : ''}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function searchPlaceId(businessInfo, { apiKey, fetchImpl }) {
  const textQuery = buildSearchQuery(businessInfo);
  if (!textQuery) return null;
  const json = await placesRequest(`${PLACES_BASE}/places:searchText`, {
    apiKey, fetchImpl, method: 'POST', fieldMask: SEARCH_FIELD_MASK,
    body: { textQuery, languageCode: DEFAULT_LANGUAGE, regionCode: DEFAULT_REGION, maxResultCount: 5 },
  });
  return pickPlaceId(json);
}

async function fetchPlaceDetails(placeId, { apiKey, fetchImpl, now }) {
  const url = `${PLACES_BASE}/places/${encodeURIComponent(placeId)}`
    + `?languageCode=${DEFAULT_LANGUAGE}&regionCode=${DEFAULT_REGION}`;
  const json = await placesRequest(url, { apiKey, fetchImpl, fieldMask: DETAILS_FIELD_MASK });
  return normalizePlaceDetails(json, { placeId, now });
}

module.exports = {
  MAX_REVIEWS_FROM_API,
  buildSearchQuery,
  pickPlaceId,
  normalizeReview,
  normalizePlaceDetails,
  writeReviewUri,
  isFresh,
  searchPlaceId,
  fetchPlaceDetails,
};
