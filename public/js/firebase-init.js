// public/js/firebase-init.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getStorage, connectStorageEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js';

// Config pública del proyecto (Console → Project settings → SDK setup). No es secreto.
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
const storage = getStorage(app);
const functions = getFunctions(app, 'southamerica-east1');

// Conectar a emuladores en local
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectStorageEmulator(storage, 'localhost', 9199);
  connectFunctionsEmulator(functions, 'localhost', 5001);
}

export { app, db, auth, storage, functions };
