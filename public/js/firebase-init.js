// public/js/firebase-init.js — inicializa el SDK de Firebase en el cliente.
// CONFIG PLACEHOLDER: reemplaza los valores REEMPLAZAR con los de tu proyecto
// (Console → Project settings → "Your apps" → Web app → SDK config). No es secreto.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'REEMPLAZAR',
  authDomain: 'REEMPLAZAR-project-id.firebaseapp.com',
  projectId: 'REEMPLAZAR-project-id',
  storageBucket: 'REEMPLAZAR-project-id.appspot.com',
  messagingSenderId: 'REEMPLAZAR',
  appId: 'REEMPLAZAR',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// En local, conectar a los emuladores.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}

export { app, db, auth };
