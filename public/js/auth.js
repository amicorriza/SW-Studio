// public/js/auth.js — login del panel admin. Expone window.SWAuth.
//
// STUB / PENDIENTE DE IMPLEMENTAR — ver el plan, Task 4.3:
//   docs/superpowers/plans/2026-06-02-scissor-white-firebase-migration.md
import { auth } from './firebase-init.js';

async function signIn(email, password) { throw new Error('SWAuth.signIn no implementado (Task 4.3)'); }
async function signOut()               { throw new Error('SWAuth.signOut no implementado (Task 4.3)'); }
function onChange(cb)                  { throw new Error('SWAuth.onChange no implementado (Task 4.3)'); }

window.SWAuth = { signIn, signOut, onChange };
export { signIn, signOut, onChange };
