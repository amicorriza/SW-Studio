// public/js/firebase-init.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getStorage, connectStorageEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js';

// Config pública del proyecto real "scissor-white" (Console → Project settings
// → SDK setup). No es secreto — es pública por diseño, la seguridad la dan las
// reglas de Firestore/Storage y Firebase Auth, no ocultar esta config.
// Se usa el mismo proyecto real tanto en local (redirigido a los emuladores
// más abajo) como en producción — evita el desajuste que hubo antes con un
// project id "demo" inerte que no coincidía con el que corrían los emuladores.
const firebaseConfig = {
  apiKey: 'AIzaSyCIRapdq3FmO4hZgnH4uQjK-CEtm4GKtOg',
  authDomain: 'scissor-white.firebaseapp.com',
  projectId: 'scissor-white',
  storageBucket: 'scissor-white.firebasestorage.app',
  messagingSenderId: '801854192115',
  appId: '1:801854192115:web:45c4bab322ee6154583a86',
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
