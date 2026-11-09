// firebase-init.js
// Exports the initialized Firebase app and Firestore `db`.
//
// Firestore keeps a local copy of what it has read (IndexedDB, shared by
// every open tab). Pages paint straight from that copy and live updates
// then stream in, so a repeat visit shows data at once instead of
// waiting for the network. If the browser refuses storage (private
// windows, blocked site data), it falls back to an in-memory cache.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDF2L2QCs9g0KGzyLGp03aQTaZ6A20zdPk",
  authDomain: "btbms-b79f0.firebaseapp.com",
  projectId: "btbms-b79f0",
  storageBucket: "btbms-b79f0.firebasestorage.app",
  messagingSenderId: "1070711151652",
  appId: "1:1070711151652:web:93bab4d9f4b49f42184cb1",
  measurementId: "G-718G445C6N"
};

const app = initializeApp(firebaseConfig);

let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (error) {
  console.warn('[DTicket] Local cache unavailable; using memory only.', error);
  db = getFirestore(app);
}

export { app, db };
