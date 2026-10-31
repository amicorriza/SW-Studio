// Campos OPCIONALES de adminLogEvent (auditoría del borrado de servicios).
// Puro y sin firebase-admin para poder testearlo sin emulador. Los campos
// inválidos se descartan en silencio: auditar no debe tumbar la operación.
const OUTCOMES = ['attempt', 'ok', 'failed'];
const MAX_JSON = 2048;

function shortStr(v, max) {
  return typeof v === 'string' && v !== '' ? v.slice(0, max) : undefined;
}

function boundedJson(v) {
  if (v === undefined || v === null) return undefined;
  let s;
  try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { s = '[no serializable]'; }
  if (typeof s !== 'string' || s === '') return undefined;
  return s.slice(0, MAX_JSON);
}

function sanitizeLogExtras(data) {
  const d = data && typeof data === 'object' ? data : {};
  const out = {};
  const serviceId = shortStr(d.serviceId, 80);
  if (serviceId !== undefined) out.serviceId = serviceId;
  if (typeof d.price === 'number' && Number.isFinite(d.price)) out.price = d.price;
  if (OUTCOMES.indexOf(d.outcome) !== -1) out.outcome = d.outcome;
  const sessionId = shortStr(d.sessionId, 64);
  if (sessionId !== undefined) out.sessionId = sessionId;
  const before = boundedJson(d.before);
  if (before !== undefined) out.before = before;
  const after = boundedJson(d.after);
  if (after !== undefined) out.after = after;
  return out;
}

module.exports = { sanitizeLogExtras, OUTCOMES, MAX_JSON };
