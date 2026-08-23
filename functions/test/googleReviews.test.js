const test = require('node:test');
const assert = require('node:assert');
const {
  MAX_REVIEWS_FROM_API,
  buildSearchQuery, pickPlaceId, normalizeReview, normalizePlaceDetails,
  writeReviewUri, isFresh, searchPlaceId, fetchPlaceDetails,
} = require('../googleReviews.js');

// Respuesta real de Place Details (New) recortada a los campos del
// fieldMask. Se conserva el anidamiento exacto de Google (displayName.text,
// text.text, authorAttribution.*) porque es precisamente lo que normaliza
// esta capa: si Google cambia el shape, estos tests son los que avisan.
function detailsFixture(overrides) {
  return Object.assign({
    id: 'ChIJfakePlaceId000',
    displayName: { text: 'Scissor White Studio', languageCode: 'es' },
    rating: 4.9,
    userRatingCount: 137,
    googleMapsUri: 'https://maps.google.com/?cid=123456789',
    reviews: [
      {
        name: 'places/ChIJfakePlaceId000/reviews/rev1',
        relativePublishTimeDescription: 'hace 2 semanas',
        rating: 5,
        text: { text: 'Victoria es una crack. El mejor corte que me han hecho.', languageCode: 'es' },
        originalText: { text: 'Victoria es una crack. El mejor corte que me han hecho.', languageCode: 'es' },
        authorAttribution: {
          displayName: 'Matías Fuentes',
          uri: 'https://www.google.com/maps/contrib/1111',
          photoUri: 'https://lh3.googleusercontent.com/a/matias',
        },
        publishTime: '2026-08-05T14:22:00Z',
      },
      {
        name: 'places/ChIJfakePlaceId000/reviews/rev2',
        relativePublishTimeDescription: 'hace un mes',
        rating: 5,
        text: { text: 'Great place, amazing attention to detail.', languageCode: 'en' },
        originalText: { text: 'Excelente lugar, atención impecable al detalle.', languageCode: 'es' },
        authorAttribution: {
          displayName: 'Camila Rojas',
          uri: 'https://www.google.com/maps/contrib/2222',
          photoUri: 'https://lh3.googleusercontent.com/a/camila',
        },
        publishTime: '2026-07-14T10:00:00Z',
      },
    ],
  }, overrides);
}

test('buildSearchQuery junta nombre + dirección de businessInfo', () => {
  assert.strictEqual(
    buildSearchQuery({ name: 'Scissor White', addr: 'Cochrane 635, Of. 303, Concepción' }),
    'Scissor White, Cochrane 635, Of. 303, Concepción'
  );
});

// businessInfo/main puede no existir (negocio recién configurado) o venir sin
// name/addr. Devolver '' deja que el llamador trate "no hay cómo buscar" como
// un estado normal (no sincroniza) en vez de mandar una query vacía a Google.
test('buildSearchQuery: businessInfo vacío/ausente -> string vacío, sin tirar', () => {
  assert.strictEqual(buildSearchQuery(null), '');
  assert.strictEqual(buildSearchQuery(undefined), '');
  assert.strictEqual(buildSearchQuery({}), '');
  assert.strictEqual(buildSearchQuery({ name: '   ' }), '');
});

test('buildSearchQuery tolera que falte solo la dirección', () => {
  assert.strictEqual(buildSearchQuery({ name: 'Scissor White' }), 'Scissor White');
});

test('pickPlaceId toma el primer resultado de searchText', () => {
  assert.strictEqual(
    pickPlaceId({ places: [{ id: 'ChIJuno' }, { id: 'ChIJdos' }] }),
    'ChIJuno'
  );
});

test('pickPlaceId: sin resultados -> null (no excepción)', () => {
  assert.strictEqual(pickPlaceId({ places: [] }), null);
  assert.strictEqual(pickPlaceId({}), null);
  assert.strictEqual(pickPlaceId(null), null);
});

test('pickPlaceId salta resultados sin id en vez de devolver undefined', () => {
  assert.strictEqual(pickPlaceId({ places: [{ displayName: { text: 'x' } }, { id: 'ChIJbueno' }] }), 'ChIJbueno');
});

test('normalizeReview aplana el shape anidado de Places', () => {
  const r = normalizeReview(detailsFixture().reviews[0]);
  assert.strictEqual(r.author, 'Matías Fuentes');
  assert.strictEqual(r.photo, 'https://lh3.googleusercontent.com/a/matias');
  assert.strictEqual(r.profileUri, 'https://www.google.com/maps/contrib/1111');
  assert.strictEqual(r.rating, 5);
  assert.strictEqual(r.text, 'Victoria es una crack. El mejor corte que me han hecho.');
  assert.strictEqual(r.relativeTime, 'hace 2 semanas');
  assert.strictEqual(r.translated, false);
  assert.strictEqual(r.originalText, '');
});

// Los términos de Places exigen mostrar la reseña sin alterarla. Cuando
// Google traduce, hay que poder ofrecer el original -- por eso se guardan los
// dos textos y se marca `translated`.
test('normalizeReview marca traducción y conserva el texto original', () => {
  const r = normalizeReview(detailsFixture().reviews[1]);
  assert.strictEqual(r.translated, true);
  assert.strictEqual(r.text, 'Great place, amazing attention to detail.');
  assert.strictEqual(r.originalText, 'Excelente lugar, atención impecable al detalle.');
});

// Una reseña de solo estrellas no tiene nada que dibujar en una tarjeta.
// Se descarta acá para que la longitud del array del doc sea la real que verá
// el visitante, y no obligue al front a filtrar de nuevo.
test('normalizeReview descarta reseñas sin texto', () => {
  assert.strictEqual(normalizeReview({ rating: 5, authorAttribution: { displayName: 'X' } }), null);
  assert.strictEqual(normalizeReview({ rating: 5, text: { text: '   ' } }), null);
  assert.strictEqual(normalizeReview(null), null);
});

test('normalizeReview cae a un autor genérico si Google no manda displayName', () => {
  const r = normalizeReview({ text: { text: 'Buen servicio' }, rating: 4 });
  assert.strictEqual(r.author, 'Cliente de Google');
  assert.strictEqual(r.photo, '');
  assert.strictEqual(r.rating, 4);
});

test('normalizePlaceDetails arma el documento completo de googleReviews/main', () => {
  const doc = normalizePlaceDetails(detailsFixture(), {
    placeId: 'ChIJfakePlaceId000', now: new Date('2026-08-23T12:00:00Z'),
  });
  assert.strictEqual(doc.placeId, 'ChIJfakePlaceId000');
  assert.strictEqual(doc.name, 'Scissor White Studio');
  assert.strictEqual(doc.rating, 4.9);
  assert.strictEqual(doc.userRatingCount, 137);
  assert.strictEqual(doc.googleMapsUri, 'https://maps.google.com/?cid=123456789');
  assert.strictEqual(doc.writeReviewUri, 'https://search.google.com/local/writereview?placeid=ChIJfakePlaceId000');
  assert.strictEqual(doc.source, 'places-api');
  assert.strictEqual(doc.fetchedAt, '2026-08-23T12:00:00.000Z');
  assert.strictEqual(doc.reviews.length, 2);
});

// `rating`/`userRatingCount` resumen TODO el perfil; `reviews` es la muestra
// de 5 que devuelve la API. Confundirlos haría que la sección dijera "5
// opiniones" cuando el perfil tiene 137 -- exactamente al revés de lo que
// busca la sección.
test('normalizePlaceDetails conserva el total del perfil aunque solo lleguen 5 reseñas', () => {
  const doc = normalizePlaceDetails(detailsFixture({ userRatingCount: 137 }), { placeId: 'ChIJx' });
  assert.strictEqual(doc.userRatingCount, 137);
  assert.ok(doc.reviews.length <= MAX_REVIEWS_FROM_API);
});

// La política de Places prohíbe reordenar o mostrar selectivamente las
// reseñas: el orden que devuelve Google es el que se guarda.
test('normalizePlaceDetails NO reordena ni filtra por puntaje', () => {
  const mixed = detailsFixture({
    reviews: [
      { name: 'r1', rating: 3, text: { text: 'Correcto, nada especial.' }, authorAttribution: { displayName: 'A' } },
      { name: 'r2', rating: 5, text: { text: 'Impecable.' }, authorAttribution: { displayName: 'B' } },
    ],
  });
  const doc = normalizePlaceDetails(mixed, { placeId: 'ChIJx' });
  assert.deepStrictEqual(doc.reviews.map(r => r.rating), [3, 5]);
});

test('normalizePlaceDetails: perfil sin reseñas todavía -> array vacío, sin tirar', () => {
  const doc = normalizePlaceDetails({ id: 'ChIJx', rating: 0, userRatingCount: 0 }, { placeId: 'ChIJx' });
  assert.deepStrictEqual(doc.reviews, []);
  assert.strictEqual(doc.rating, 0);
  assert.strictEqual(doc.name, '');
});

test('writeReviewUri escapa el placeId y devuelve vacío si no hay', () => {
  assert.strictEqual(writeReviewUri('ChIJ a/b'), 'https://search.google.com/local/writereview?placeid=ChIJ%20a%2Fb');
  assert.strictEqual(writeReviewUri(''), '');
  assert.strictEqual(writeReviewUri(null), '');
});

// Guard del callable manual del panel: apretar "Sincronizar" varias veces no
// debe disparar varias llamadas facturadas a Places.
test('isFresh: doc reciente dentro de la ventana -> true', () => {
  const now = new Date('2026-08-23T12:00:00Z');
  assert.strictEqual(isFresh({ fetchedAt: '2026-08-23T11:50:00Z' }, now, 60), true);
});

test('isFresh: doc más viejo que la ventana -> false', () => {
  const now = new Date('2026-08-23T12:00:00Z');
  assert.strictEqual(isFresh({ fetchedAt: '2026-08-23T10:00:00Z' }, now, 60), false);
});

test('isFresh: doc inexistente, sin fetchedAt o con fecha basura -> false (sincroniza igual)', () => {
  const now = new Date('2026-08-23T12:00:00Z');
  assert.strictEqual(isFresh(null, now, 60), false);
  assert.strictEqual(isFresh({}, now, 60), false);
  assert.strictEqual(isFresh({ fetchedAt: 'ayer' }, now, 60), false);
});

// Un fetchedAt en el futuro (reloj torcido, doc editado a mano) no debe
// bloquear la sincronización para siempre.
test('isFresh: fetchedAt en el futuro -> false', () => {
  const now = new Date('2026-08-23T12:00:00Z');
  assert.strictEqual(isFresh({ fetchedAt: '2026-09-01T00:00:00Z' }, now, 60), false);
});

// ── I/O con fetch inyectado ────────────────────────────────────────────────
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts);
  };
  fn.calls = calls;
  return fn;
}

function okResponse(json) {
  return { ok: true, status: 200, json: async () => json };
}

test('fetchPlaceDetails manda la API key por header, no por query string', async () => {
  const fetchImpl = fakeFetch(() => okResponse(detailsFixture()));
  await fetchPlaceDetails('ChIJfakePlaceId000', { apiKey: 'KEY123', fetchImpl });
  const { url, opts } = fetchImpl.calls[0];
  assert.strictEqual(opts.headers['X-Goog-Api-Key'], 'KEY123');
  assert.ok(!url.includes('KEY123'), 'la key nunca debe viajar en la URL (queda en logs y referers)');
  assert.ok(url.startsWith('https://places.googleapis.com/v1/places/ChIJfakePlaceId000'));
});

// Places (New) factura por campo pedido: un fieldMask de más sube el tier sin
// que la sección use el dato.
test('fetchPlaceDetails pide exactamente los campos que renderiza la sección', async () => {
  const fetchImpl = fakeFetch(() => okResponse(detailsFixture()));
  await fetchPlaceDetails('ChIJx', { apiKey: 'K', fetchImpl });
  assert.strictEqual(
    fetchImpl.calls[0].opts.headers['X-Goog-FieldMask'],
    'id,displayName,rating,userRatingCount,googleMapsUri,reviews'
  );
});

test('fetchPlaceDetails propaga el mensaje de error de Places, no solo el status', async () => {
  const fetchImpl = fakeFetch(() => ({
    ok: false, status: 403,
    json: async () => ({ error: { message: 'Places API has not been used in project 123 before' } }),
  }));
  await assert.rejects(
    () => fetchPlaceDetails('ChIJx', { apiKey: 'K', fetchImpl }),
    /Places API 403: Places API has not been used/
  );
});

test('fetchPlaceDetails no explota si el cuerpo del error no es JSON', async () => {
  const fetchImpl = fakeFetch(() => ({
    ok: false, status: 500, json: async () => { throw new Error('Unexpected token <'); },
  }));
  await assert.rejects(() => fetchPlaceDetails('ChIJx', { apiKey: 'K', fetchImpl }), /Places API 500/);
});

test('searchPlaceId manda POST con textQuery y devuelve el primer id', async () => {
  const fetchImpl = fakeFetch(() => okResponse({ places: [{ id: 'ChIJencontrado' }] }));
  const id = await searchPlaceId(
    { name: 'Scissor White', addr: 'Cochrane 635, Concepción' },
    { apiKey: 'K', fetchImpl }
  );
  assert.strictEqual(id, 'ChIJencontrado');
  const { url, opts } = fetchImpl.calls[0];
  assert.strictEqual(url, 'https://places.googleapis.com/v1/places:searchText');
  assert.strictEqual(opts.method, 'POST');
  assert.strictEqual(JSON.parse(opts.body).textQuery, 'Scissor White, Cochrane 635, Concepción');
  assert.strictEqual(JSON.parse(opts.body).regionCode, 'CL');
});

// Sin nombre ni dirección no hay nada que buscar: no se gasta una llamada.
test('searchPlaceId no llama a Places si no hay con qué armar la consulta', async () => {
  const fetchImpl = fakeFetch(() => okResponse({ places: [] }));
  const id = await searchPlaceId({}, { apiKey: 'K', fetchImpl });
  assert.strictEqual(id, null);
  assert.strictEqual(fetchImpl.calls.length, 0);
});

// Places (New) factura al SKU más caro que toque el fieldMask. La búsqueda
// solo necesita el id: pedir rating/userRatingCount ahí saltaría al SKU
// "Text Search Enterprise" sin usar el dato (Place Details ya lo trae).
test('searchPlaceId NO pide campos que empujan al SKU caro', async () => {
  const fetchImpl = fakeFetch(() => okResponse({ places: [{ id: 'ChIJx' }] }));
  await searchPlaceId({ name: 'X', addr: 'Y' }, { apiKey: 'K', fetchImpl });
  const mask = fetchImpl.calls[0].opts.headers['X-Goog-FieldMask'];
  assert.strictEqual(mask, 'places.id,places.displayName,places.formattedAddress');
  assert.ok(!mask.includes('rating'), 'rating/userRatingCount solo se piden en Place Details');
});
