/* =============================================================
   Staff accounts, sign-in and the audit log

   Staff (Admins and Counter Managers) live in the Firestore
   collection `staff`, one document per User ID:

     { staff_id, name, role: 'admin' | 'cmanager', phone, email,
       active, password_salt, password_hash, password_iterations,
       created_at, updated_at, last_login_at }

   Passwords are never stored. A random salt and PBKDF2-SHA-256
   (150,000 rounds) turn each one into a hash; signing in repeats the
   sum and compares. PBKDF2 is deliberately slow, so a stolen hash
   takes far longer to guess than a plain SHA-256 one would.

   Only accounts stored in `staff` can sign in. (The original demo
   logins that once bootstrapped the first accounts are gone: their
   passwords were visible in the site's code.) New staff are created by
   an Admin under Users.

   Every change made in a console is written to `audit` with who made
   it, what it touched and when.
   ============================================================= */

import { db } from './firebase-init.js';
import {
  doc, getDoc, updateDoc, addDoc, collection, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';

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
