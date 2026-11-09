/* =============================================================
   DTicket database: everything that talks to Firestore.

   1. Connection (Firebase app + Firestore with a local cache)
   2. Trip schedule: keeps 14 days of trips on sale
   3. Staff accounts, sign-in and the audit log

   It also re-exports config.js, so a page needs only this one import
   for data and rules.
   ============================================================= */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, runTransaction, serverTimestamp, getDoc, updateDoc, addDoc, collection,
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';
import { DAILY_TRIPS, bookingWindow, addDays, buildTrip } from './config.js';

export * from './config.js';

/* =============================================================
   1. Connection
   ============================================================= */
/* Firestore keeps a local copy of what it has read (IndexedDB, shared by
   every open tab). Pages paint straight from that copy and live updates
   then stream in, so a repeat visit shows data at once instead of
   waiting for the network. If the browser refuses storage (private
   windows, blocked site data), it falls back to an in-memory cache. */
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

/* =============================================================
   2. Trip schedule
   ============================================================= */
/* How the trips get created: a single marker document, schedule/window,
   records the last date already generated. Any page that calls
   ensureSchedule() reads it (one read when nothing is due); when the
   window has moved on, the missing days are created in one transaction
   and the marker is advanced. So each day is generated exactly once,
   two visitors at the same moment cannot double it, and a trip an admin
   deletes is not brought back. The nightly GitHub Action does the same. */
/* Creates whatever days of the booking window are still missing.
   Resolves to the number of trips created (0 almost always). Never
   throws: a page that cannot reach the database still works with
   whatever trips already exist. */
export async function ensureSchedule(db) {
  const { first, last } = bookingWindow();
  const markerRef = doc(db, 'schedule', 'window');

  try {
    return await runTransaction(db, async transaction => {
      const marker = await transaction.get(markerRef);
      const through = marker.exists() ? String(marker.data().generated_through || '') : '';
      if (through >= last) return 0;

      const start = through && through >= first ? addDays(through, 1) : first;
      const planned = [];
      for (let date = start; date <= last; date = addDays(date, 1)) {
        for (const slot of DAILY_TRIPS) {
          const trip = buildTrip(date, slot);
          planned.push({ ref: doc(db, 'trips', trip.trip_id), trip });
        }
      }

      // All reads before any write, as transactions require. A trip
      // that already exists (made by hand, say) is left alone.
      const snaps = await Promise.all(planned.map(p => transaction.get(p.ref)));
      let created = 0;
      snaps.forEach((snap, i) => {
        if (snap.exists()) return;
        transaction.set(planned[i].ref, { ...planned[i].trip, created_at: serverTimestamp(), updated_at: serverTimestamp() });
        created += 1;
      });

      transaction.set(markerRef, { generated_through: last, updated_at: serverTimestamp() });
      return created;
    });
  } catch (error) {
    console.warn('[DTicket] Trip schedule could not be checked.', error);
    return 0;
  }
}

/* =============================================================
   3. Staff accounts, sign-in and audit log
   ============================================================= */
/* Accounts live in the `staff` collection with salted PBKDF2-SHA256
   password hashes; only accounts stored there can sign in. */
export const STAFF = 'staff';
export const AUDIT = 'audit';
export const ROLE_LABELS = { admin: 'Admin', cmanager: 'Counter Manager', company: 'Company Manager' };

/* Where a Counter Manager's counter is. */
export const COUNTER_LOCATIONS = ['Dhaka', 'Chittagong', 'Sylhet'];
const ITERATIONS = 150000;

export const normaliseId = id => String(id || '').trim().toUpperCase();

/* ---- hashing ---- */
const toHex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = hex => new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));

export function newSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPassword(password, saltHex, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256);
  return toHex(bits);
}

/* The fields to store for a new password. */
export async function passwordFields(password) {
  const salt = newSalt();
  return {
    password_salt: salt,
    password_hash: await hashPassword(password, salt),
    password_iterations: ITERATIONS,
    password_changed_at: serverTimestamp(),
  };
}

export async function checkPassword(record, password) {
  if (!record?.password_hash || !record?.password_salt) return false;
  const hash = await hashPassword(password, record.password_salt, Number(record.password_iterations) || ITERATIONS);
  return hash === record.password_hash;
}

/* A readable random password for new accounts and resets. */
export function generatePassword(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('');
}

/* ---- lookups ---- */
export async function getStaff(id) {
  const snap = await getDoc(doc(db, STAFF, normaliseId(id)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* The consoles an ID may open: [] when unknown or switched off. */
export async function lookupRoles(id) {
  const key = normaliseId(id);
  if (!key) return [];
  const record = await getStaff(key);
  if (!record || record.active === false) return [];
  return [record.role];
}

/* Signs someone in to a console. Resolves to { ok, user } or
   { ok: false, reason }. */
export async function authenticate(id, password, role) {
  const key = normaliseId(id);
  const record = await getStaff(key);

  if (record) {
    if (record.active === false) return { ok: false, reason: 'This account is switched off. Ask an admin to turn it back on.' };
    if (record.role !== role) return { ok: false, reason: `This account cannot open the ${ROLE_LABELS[role] || role} console.` };
    if (!(await checkPassword(record, password))) return { ok: false, reason: 'Wrong User ID or password.' };
    updateDoc(doc(db, STAFF, key), { last_login_at: serverTimestamp() }).catch(() => {});
    return { ok: true, user: { id: key, name: record.name || key, role: record.role, counter: record.counter || '' } };
  }

  return { ok: false, reason: 'Wrong User ID or password.' };
}

/* ---- audit log ---- */
let actor = { id: '', name: '', role: '' };

export function setAuditActor(user) {
  actor = { id: user?.id || '', name: user?.name || '', role: user?.role || '' };
}

/* Never throws: a log line that cannot be written must not undo the
   change it describes. */
export async function audit(action, target, subject, summary = '') {
  try {
    await addDoc(collection(db, AUDIT), {
      action,
      target,
      subject: String(subject || '').slice(0, 120),
      summary: String(summary || '').slice(0, 300),
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
      at: serverTimestamp(),
    });
  } catch (error) {
    console.warn('[DTicket] Audit line not written.', error);
  }
}
