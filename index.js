/* The landing page: clock, theme switch, and one sign-in for staff.

   The User ID decides which console buttons appear. The password is not
   checked here; it is handed to the console, which checks it and sends
   the person back here with a reason if it is wrong. */

import { ACCOUNTS, ROLES, HANDOFF_KEY, SIGNIN_ERROR_KEY } from './accounts.js';

const $ = selector => document.querySelector(selector);

/* ---- the clock, in Bangladesh time ---- */
const clock = $('#landing-clock');
const clockFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});

function updateClock() {
  clock.textContent = clockFormat.format(new Date());
}

if (clock) {
  updateClock();
  setInterval(updateClock, 1000);
}

/* ---- the theme switch ---- */
const THEME_KEY = 'btbms-theme';

function applyTheme(name) {
  const theme = name === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);

  const label = theme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme';
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.setAttribute('title', label);
    button.setAttribute('aria-label', label);
  });

  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    /* a private window cannot remember it; it still applies here */
  }
}

document.addEventListener('click', event => {
  if (!event.target.closest('[data-theme-toggle]')) return;
  applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
});

applyTheme(document.documentElement.getAttribute('data-theme'));

/* ---- which consoles an ID can open ---- */
const idField = $('#landing-user');
const passwordField = $('#landing-password');
const rolesBox = $('#landing-roles');
const roleButtons = $('#landing-role-buttons');
const statusLine = $('#landing-status');
const submitButton = $('#landing-submit');
const form = $('#landing-login');

let chosenRole = '';
let offered = [];

function setStatus(message, tone = 'muted') {
  statusLine.textContent = message;
  statusLine.dataset.tone = tone;
}

function normalisedId() {
  return String(idField.value || '').trim().toUpperCase();
}

function markChosen() {
  roleButtons.querySelectorAll('.role-button').forEach(button => {
    button.classList.toggle('is-chosen', button.dataset.role === chosenRole);
  });
}

function renderRoles(list) {
  offered = list;

  if (!list.length) {
    rolesBox.hidden = true;
    roleButtons.innerHTML = '';
    chosenRole = '';
    return;
  }

  roleButtons.innerHTML = list
    .map(role => {
      const look = ROLES[role];
      return `
        <button type="button" class="role-button" data-role="${role}"
                style="--role-accent: ${look.accent}; --role-text: ${look.text};">
          ${look.label}
        </button>`;
    })
    .join('');

  rolesBox.hidden = false;

  /* One console to open is not a choice, so it is simply chosen. */
  chosenRole = list.length === 1 ? list[0] : '';
  if (chosenRole) markChosen();
}

function lookUp() {
  const id = normalisedId();

  if (!id) {
    renderRoles([]);
    setStatus('');
    return;
  }

  const account = ACCOUNTS[id];
  if (!account) {
    renderRoles([]);
    setStatus('That User ID is not registered.', 'error');
    return;
  }

  renderRoles(account.roles);
  setStatus('');
}

/* A refused sign-in comes back here with the reason. Read once, cleared. */
(() => {
  let reason = '';
  try {
    reason = sessionStorage.getItem(SIGNIN_ERROR_KEY) || '';
    sessionStorage.removeItem(SIGNIN_ERROR_KEY);
  } catch (error) {
    /* nothing to show */
  }
  if (reason) {
    setStatus(reason, 'error');
    document.getElementById('access').scrollIntoView();
    idField.focus();
  }
})();

let lookUpTimer = null;
idField.addEventListener('input', () => {
  window.clearTimeout(lookUpTimer);
  lookUpTimer = window.setTimeout(lookUp, 200);
});

roleButtons.addEventListener('click', event => {
  const button = event.target.closest('.role-button');
  if (!button) return;
  chosenRole = button.dataset.role;
  markChosen();
  setStatus('');
  if (!passwordField.value) passwordField.focus();
});

/* ---- showing the password ---- */
const toggle = $('#landing-password-toggle');
toggle.addEventListener('click', () => {
  const shown = passwordField.type === 'text';
  passwordField.type = shown ? 'password' : 'text';
  toggle.setAttribute('aria-pressed', String(!shown));
  toggle.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
  toggle.setAttribute('title', shown ? 'Show password' : 'Hide password');
  passwordField.focus();
});

/* ---- handing the attempt over to the console ---- */
form.addEventListener('submit', event => {
  event.preventDefault();

  const id = normalisedId();
  const password = String(passwordField.value || '');

  if (!id) {
    setStatus('Enter your User ID.', 'error');
    idField.focus();
    return;
  }

  /* Typed and submitted in one motion, before the lookup ran. */
  window.clearTimeout(lookUpTimer);
  lookUp();

  if (!offered.length) return;

  if (!chosenRole) {
    setStatus('Choose which console to open.', 'error');
    return;
  }

  if (!password) {
    setStatus('Enter your password.', 'error');
    passwordField.focus();
    return;
  }

  try {
    sessionStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({ userId: id, password, role: chosenRole, at: Date.now() })
    );
  } catch (error) {
    setStatus('This browser is blocking site data, so sign-in cannot continue. Allow site data and try again.', 'error');
    return;
  }

  submitButton.disabled = true;
  setStatus(`Opening the ${ROLES[chosenRole].label} console…`, 'good');
  window.location.href = ROLES[chosenRole].page;
});

/* Warm up the Firebase connection so the consoles open faster. */
import('./firebase-init.js').catch(error => {
  console.warn('[BTBMS] firebase-init.js could not be preloaded.', error);
});
