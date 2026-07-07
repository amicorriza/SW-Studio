// public/js/auth.js — login del panel admin. Expone window.SWAuth.
import { auth } from './firebase-init.js';
import {
  signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}
async function signOut() { await fbSignOut(auth); }
function onChange(cb) { return onAuthStateChanged(auth, cb); }

window.SWAuth = { signIn, signOut, onChange };
export { signIn, signOut, onChange };
