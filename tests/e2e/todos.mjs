// Corre las tres pruebas end-to-end contra el emulador, resembrando antes de
// cada una.
//
// El resembrado NO es opcional: las tres mutan las mismas reservas (cerrar
// una atención, marcar un no-show, cancelar), así que corridas en cadena sin
// limpiar se pisan entre ellas y fallan por contaminación, no por un bug.
//
// Requiere el emulador corriendo:
//   firebase emulators:start --project scissor-white
//
// Uso: node tests/e2e/todos.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');

function run(cmd, args, cwd, env) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      cwd, shell: true, stdio: 'pipe',
      env: Object.assign({}, process.env, env || {}),
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

async function sembrar() {
  const a = await run('npm', ['run', 'seed'], path.join(ROOT, 'seed'),
    { FIRESTORE_EMULATOR_HOST: 'localhost:8080', GCLOUD_PROJECT: 'scissor-white' });
  if (a.code !== 0) throw new Error('falló el seed base:\n' + a.out.slice(-800));
  const b = await run('node', ['scripts/seedEmulatorE2E.mjs'], path.join(ROOT, 'functions'));
  if (b.code !== 0) throw new Error('falló el seed e2e:\n' + b.out.slice(-800));
}

const SUITES = ['callables', 'nudges', 'navegador'];
let fallidas = 0;

for (const suite of SUITES) {
  process.stdout.write(`\n══════════ ${suite} ══════════\n`);
  await sembrar();
  const r = await run('node', [`tests/e2e/${suite}.mjs`], ROOT);
  process.stdout.write(r.out);
  if (r.code !== 0) fallidas++;
}

console.log(fallidas === 0
  ? `\n══════════ ${SUITES.length}/${SUITES.length} SUITES E2E OK ══════════`
  : `\n══════════ ${fallidas} de ${SUITES.length} SUITES E2E FALLARON ══════════`);
process.exit(fallidas ? 1 : 0);
