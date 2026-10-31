// public/js/auth.js — login del panel admin. Expone window.SWAuth.
import { auth } from './firebase-init.js';
import {
  signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}
async function signOut() { await fbSignOut(auth); }
function onChange(cb) { return onAuthStateChanged(auth, cb); }

// Pide el correo de restablecimiento. Nunca revela si el correo existe: el que
// llama muestra siempre el mismo mensaje, haya o no cuenta.
async function resetPassword(email) {
  try { await sendPasswordResetEmail(auth, email); } catch (e) { /* silencioso a propósito */ }
}

window.SWAuth = { signIn, signOut, onChange, resetPassword };
export { signIn, signOut, onChange, resetPassword };
