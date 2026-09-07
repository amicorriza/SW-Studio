// Plomería compartida por las pruebas end-to-end contra el emulador.
//
// Habla con los emuladores por HTTP/REST y no importa firebase-admin a
// propósito: así estos tests corren desde la raíz del repo (donde no está
// instalado) y no dependen del directorio desde el que se los invoque.
//
// La lectura y escritura de Firestore pasan por firestore.rules igual que
// cualquier cliente, así que se hacen con el ID token del admin. Que sin
// token devuelvan 403 es parte de lo que se verifica.
const PROJECT = 'scissor-white';
const REGION = 'southamerica-east1';

export const FN = `http://127.0.0.1:5001/${PROJECT}/${REGION}`;
export const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
export const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

export function makeChecker() {
  const state = { fails: 0 };
  const check = (name, cond, detail) => {
    if (!cond) {
      state.fails++;
      console.log(`✗ ${name}` + (detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''));
    } else {
      console.log(`✓ ${name}`);
    }
  };
  check.done = (nota) => {
    console.log(state.fails === 0 ? '\n== TODO OK ==' : `\n== ${state.fails} FALLAS ==`);
    if (nota) console.log('\n' + nota);
    process.exit(state.fails ? 1 : 0);
  };
  return check;
}

export async function token(email, password) {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('no se pudo autenticar ' + email + ': ' + JSON.stringify(j));
  return j.idToken;
}

// Invoca un onCall como lo haría el SDK del cliente: { data: ... } + Bearer.
export async function call(name, data, idToken) {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' },
      idToken ? { Authorization: 'Bearer ' + idToken } : {}),
    body: JSON.stringify({ data: data || {} }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j, result: j.result, error: j.error };
}

// Dispara una función programada. El emulador les agrega el sufijo -0.
export function triggerSchedule(name) {
  return fetch(`${FN}/${name}-0`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
}

// ── Firestore REST ──

function plain(fields) {
  const out = {};
  Object.entries(fields || {}).forEach(([k, v]) => {
    out[k] = v.stringValue !== undefined ? v.stringValue
      : v.integerValue !== undefined ? Number(v.integerValue)
      : v.doubleValue !== undefined ? v.doubleValue
      : v.booleanValue !== undefined ? v.booleanValue
      : v.nullValue !== undefined ? null
      : v.arrayValue !== undefined ? (v.arrayValue.values || []).map((x) => x.stringValue ?? x)
      : v.mapValue !== undefined ? plain(v.mapValue.fields)
      : v;
  });
  return out;
}

function typed(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(typed) } };
  if (typeof value === 'object') {
    const fields = {};
    Object.entries(value).forEach(([k, v]) => { fields[k] = typed(v); });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

export async function getDoc(path, idToken) {
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: 'Bearer ' + idToken } });
  if (!r.ok) return null;
  return plain((await r.json()).fields);
}

export async function listDocs(collection, idToken) {
  const r = await fetch(`${FS}/${collection}?pageSize=300`, { headers: { Authorization: 'Bearer ' + idToken } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.documents || []).map((d) => ({ _docId: d.name.split('/').pop(), ...plain(d.fields) }));
}

// Merge parcial: solo toca los campos indicados (updateMask), como set({merge:true}).
export async function patchDoc(path, data, idToken) {
  const fields = {};
  Object.entries(data).forEach(([k, v]) => { fields[k] = typed(v); });
  const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const r = await fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error('patchDoc ' + path + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
