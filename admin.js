/* =============================================================
   DTicket Admin Console

   Sections: Dashboard, Stats, Trips, Tickets, Buses, Users,
   Passengers, Requests, Notices, Audit log, My account.

   Data arrives live from Firestore (one listener per collection) into
   `state`; whichever section is on screen is redrawn when its data
   changes. Every change made here is written to the audit log.
   ============================================================= */

import { db } from './firebase-init.js';
import { HANDOFF_KEY, SIGNIN_ERROR_KEY } from './accounts.js';
import {
  ensureSchedule, dhakaNow, addDays, bookingWindow, hasDeparted, shortTime,
  DAILY_TRIPS, SEATS_PER_BUS, BOOKING_WINDOW_DAYS,
} from './schedule.js';
import {
  authenticate, getStaff, setAuditActor, audit, passwordFields, checkPassword,
  generatePassword, normaliseId, ROLE_LABELS, STAFF,
} from './staff.js';
import {
  collection, doc, setDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, where,
  orderBy, limit, runTransaction, serverTimestamp, writeBatch, increment,
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';

const SESSION_KEY = 'btbms-admin-auth';
const IDLE_MINUTES = 30;
const CITIES = ['Dhaka', 'Chittagong', 'Sylhet'];
const SEAT_LABELS = [
  ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].flatMap(r => [`${r}1`, `${r}2`, `${r}3`]),
  'I1', 'I2', 'I3', 'I4',
];

/* =============================================================
   Small helpers
   ============================================================= */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
));
const money = n => `BDT ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sum = (list, fn) => list.reduce((total, item) => total + (Number(fn(item)) || 0), 0);

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dhakaDay = date => (date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(date) : '');
const fmtDate = ymd => (ymd ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`)) : '—');
const fmtDayShort = ymd => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
const fmtStamp = value => {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) : '—';
};
function timeAgo(value) {
  const d = toDate(value);
  if (!d) return 'just now';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const routeOf = t => `${t?.origin || '?'} → ${t?.destination || '?'}`;
const fullTime = t => (String(t || '').length === 5 ? `${t}:00` : String(t || ''));

/* =============================================================
   State and live data
   ============================================================= */
const state = {
  user: null,
  section: 'dashboard',
  trips: [],
  tripMap: new Map(),
  bookings: [],
  soldByTrip: new Map(),
  requests: [],
  buses: [],
  staff: [],
  notices: [],
  audit: [],
  marker: null,
  statsRange: '14',
  tripsLimit: 60,
  ticketsLimit: 60,
  firstChart: true,
};

const fareOf = booking => Number(state.tripMap.get(booking.trip_id)?.fare || 0);
const contactOf = b => b.contact_number || b.phone || '';
const capacityOf = t => Number(t?.total_seats || SEATS_PER_BUS);
const soldOf = t => state.soldByTrip.get(t.trip_id || t.id) || 0;
const bookingDay = b => dhakaDay(toDate(b.created_at || b.booking_time));

function indexData() {
  state.tripMap = new Map(state.trips.map(t => [t.trip_id || t.id, t]));
  state.soldByTrip = new Map();
  for (const b of state.bookings) state.soldByTrip.set(b.trip_id, (state.soldByTrip.get(b.trip_id) || 0) + 1);
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    indexData();
    renderBadges();
    renderSection(state.section);
  });
}

function listen(label, ref, assign) {
  onSnapshot(ref, snapshot => {
    assign(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    scheduleRender();
  }, error => {
    console.error(label, error);
    toast(`${label} could not be loaded.`, 'error');
  });
}

function startListeners() {
  listen('Trips', collection(db, 'trips'), rows => { state.trips = rows; });
  listen('Tickets', collection(db, 'bookings'), rows => { state.bookings = rows; });
  listen('Requests', collection(db, 'requests'), rows => { state.requests = rows; });
  listen('Buses', collection(db, 'buses'), rows => { state.buses = rows; });
  listen('Users', collection(db, STAFF), rows => { state.staff = rows; });
  listen('Notices', collection(db, 'notices'), rows => { state.notices = rows; });
  listen('Audit log', query(collection(db, 'audit'), orderBy('at', 'desc'), limit(300)), rows => { state.audit = rows; });
  listen('Schedule', collection(db, 'schedule'), rows => { state.marker = rows.find(r => r.id === 'window') || null; });
}

/* =============================================================
   Toasts, the form window and the confirm window
   ============================================================= */
function toast(message, tone = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('leaving'), 3600);
  setTimeout(() => el.remove(), 4000);
}

const modal = $('#modal');
const modalForm = $('#modalForm');
let modalSubmit = null;

/* Opens the form window. onSubmit(form, data) does the work; throwing
   shows the message inside the window and keeps it open. */
function openModal({ title, body, submitLabel = 'Save', danger = false, wide = false, onSubmit = null, onOpen = null }) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  $('#modalError').hidden = true;
  const submit = $('#modalSubmit');
  submit.textContent = submitLabel;
  submit.hidden = !onSubmit;
  submit.disabled = false;
  submit.classList.toggle('danger-btn', danger);
  modal.classList.toggle('modal-wide', wide);
  modalSubmit = onSubmit;
  modal.showModal();
  onOpen?.(modalForm);
  const first = $('input:not([readonly]):not([type=hidden]), select, textarea', $('#modalBody'));
  first?.focus();
}

function closeModal() {
  modal.close();
  modalSubmit = null;
}

modalForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!modalSubmit) return;
  if (!modalForm.reportValidity()) return;
  const submit = $('#modalSubmit');
  submit.disabled = true;
  $('#modalError').hidden = true;
  try {
    await modalSubmit(modalForm, Object.fromEntries(new FormData(modalForm)));
    closeModal();
  } catch (error) {
    $('#modalError').textContent = error.message || 'Something went wrong.';
    $('#modalError').hidden = false;
  } finally {
    submit.disabled = false;
  }
});

modal.addEventListener('click', event => {
  if (event.target.closest('[data-close]') || event.target === modal) closeModal();
});

function confirmAction(text, { title = 'Are you sure?', yes = 'Yes', danger = true } = {}) {
  const dialog = $('#confirm');
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  $('#confirmYes').textContent = yes;
  $('#confirmYes').classList.toggle('danger-btn', danger);
  dialog.showModal();
  return new Promise(resolve => {
    const done = answer => {
      dialog.close();
      $('#confirmYes').onclick = null;
      $('#confirmNo').onclick = null;
      resolve(answer);
    };
    $('#confirmYes').onclick = () => done(true);
    $('#confirmNo').onclick = () => done(false);
    dialog.oncancel = () => done(false);
  });
}

/* Form field builders for the window. */
const field = (label, input, cls = '') => `<div class="${cls}"><label>${esc(label)}${input}</label></div>`;
const inputHtml = (name, value = '', attrs = '') => `<input name="${name}" value="${esc(value)}" ${attrs} />`;
const selectHtml = (name, options, selected = '', attrs = '') => `<select name="${name}" ${attrs}>${options.map(o => {
  const [value, label] = Array.isArray(o) ? o : [o, o];
  return `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`;
}).join('')}</select>`;

/* =============================================================
   Navigation
   ============================================================= */
const SECTIONS = ['dashboard', 'stats', 'trips', 'tickets', 'buses', 'users', 'passengers', 'requests', 'notices', 'audit', 'account'];

function setActiveSection(name) {
  if (!SECTIONS.includes(name)) name = 'dashboard';
  state.section = name;
  SECTIONS.forEach(s => $(`#${s}Section`)?.classList.toggle('active', s === name));
  $$('.sidebar-link').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  renderSection(name);
}
window.showSection = setActiveSection;

function renderSection(name) {
  if (!state.user) return;
  const renderers = {
    dashboard: renderDashboard, stats: renderStats, trips: renderTrips, tickets: renderTickets,
    buses: renderBuses, users: renderUsers, passengers: renderPassengers, requests: renderRequests,
    notices: renderNotices, audit: renderAudit, account: renderAccount,
  };
  try {
    renderers[name]?.();
  } catch (error) {
    console.error(`Render ${name} failed`, error);
  }
}

function renderBadges() {
  const pending = state.requests.filter(r => (r.status || 'Pending') === 'Pending').length;
  const badge = $('#badgeRequests');
  badge.hidden = !pending;
  badge.textContent = pending;
}

/* =============================================================
   Charts (plain SVG, no library)
   ============================================================= */
function barChart(container, points, { format = v => v, animate = false } = {}) {
  const width = 640;
  const height = 220;
  const pad = { top: 18, right: 8, bottom: 30, left: 8 };
  const max = Math.max(1, ...points.map(p => p.value));
  const slot = (width - pad.left - pad.right) / Math.max(1, points.length);
  const barW = Math.max(6, slot * 0.62);
  const gradId = `grad-${container.id}`;
  const bars = points.map((p, i) => {
    const h = ((height - pad.top - pad.bottom) * p.value) / max;
    const x = pad.left + i * slot + (slot - barW) / 2;
    const y = height - pad.bottom - h;
    return `<g class="bar-group">
      <rect class="bar${animate ? ' grow' : ''}" fill="url(#${gradId})" style="--i:${i}" x="${x}" y="${y}" width="${barW}" height="${Math.max(h, p.value ? 2 : 0)}" rx="5"><title>${esc(p.label)}: ${esc(format(p.value))}</title></rect>
      ${p.value ? `<text class="bar-value" x="${x + barW / 2}" y="${y - 5}">${esc(p.short ?? p.value)}</text>` : ''}
      <text class="bar-label" x="${x + barW / 2}" y="${height - 10}">${esc(p.label)}</text>
    </g>`;
  }).join('');
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" class="bar-chart" role="img" aria-label="Bar chart">
    <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a4c"/><stop offset="1" stop-color="#e11d48"/></linearGradient></defs>
    <line x1="${pad.left}" x2="${width - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}" class="axis"/>
    ${bars}
  </svg>`;
}

function hBars(container, rows, { format = v => v, max = null } = {}) {
  if (!rows.length) {
    container.innerHTML = '<p class="section-note">No data for this period.</p>';
    return;
  }
  const top = max ?? Math.max(1, ...rows.map(r => r.value));
  container.innerHTML = rows.map((r, i) => `
    <div class="hbar" style="--i:${i}">
      <div class="hbar-head"><span>${esc(r.label)}</span><b>${esc(format(r.value))}</b></div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.min(100, (100 * r.value) / top)}%"></div></div>
    </div>`).join('');
}

function donut(container, rows) {
  const total = sum(rows, r => r.value);
  if (!total) {
    container.innerHTML = '<p class="section-note">No tickets in this period.</p>';
    return;
  }
  const colors = ['#ff5a5a', '#fbbf24', '#60a5fa', '#a78bfa', '#34d399'];
  let offset = 0;
  const arcs = rows.map((r, i) => {
    const pct = (100 * r.value) / total;
    const arc = `<circle cx="60" cy="60" r="46" pathLength="100" stroke="${colors[i % colors.length]}" stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="${-offset}"><title>${esc(r.label)}: ${r.value}</title></circle>`;
    offset += pct;
    return arc;
  }).join('');
  container.innerHTML = `
    <svg viewBox="0 0 120 120" class="donut" aria-hidden="true">${arcs}</svg>
    <ul class="legend-list">${rows.map((r, i) => `<li><i style="background:${colors[i % colors.length]}"></i>${esc(r.label)}<b>${r.value} · ${Math.round((100 * r.value) / total)}%</b></li>`).join('')}</ul>`;
}

const pill = (text, tone) => `<span class="pill pill-${tone}">${esc(text)}</span>`;

function tripStatus(t, now = dhakaNow()) {
  if (hasDeparted(t, now)) return ['Departed', 'muted'];
  if (Number(t.available_seats || 0) <= 0) return ['Sold out', 'bad'];
  if (Number(t.available_seats || 0) <= 3) return ['Almost full', 'warn'];
  if (t.travel_date === now.date) return ['Today', 'info'];
  return ['On sale', 'good'];
}

function seatsBar(t) {
  const cap = capacityOf(t);
  const sold = soldOf(t);
  const pct = Math.min(100, Math.round((100 * sold) / cap));
  return `<div class="seat-meter" title="${sold} of ${cap} seats sold"><div style="width:${pct}%"></div></div><small>${sold}/${cap}</small>`;
}

/* =============================================================
   DASHBOARD
   ============================================================= */
function renderDashboard() {
  const now = dhakaNow();
  const today = now.date;
  const win = bookingWindow(now);

  const tripsToday = state.trips.filter(t => t.travel_date === today);
  const soldToday = state.bookings.filter(b => bookingDay(b) === today);
  const windowTrips = state.trips.filter(t => t.travel_date >= win.first && t.travel_date <= win.last);
  const cap = sum(windowTrips, capacityOf);
  const sold = sum(windowTrips, soldOf);
  const pending = state.requests.filter(r => (r.status || 'Pending') === 'Pending');

  $('#mTripsToday').textContent = String(tripsToday.length);
  $('#mSoldToday').textContent = String(soldToday.length);
  $('#mRevenueToday').textContent = money(sum(soldToday, fareOf));
  $('#mOccupancy').textContent = `${cap ? Math.round((100 * sold) / cap) : 0}%`;
  $('#mPending').textContent = String(pending.length);
  $('#mRevenueTotal').textContent = money(sum(state.bookings, fareOf));

  // Sales for the last 14 days, by the day the ticket was bought.
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const byDay = new Map(days.map(d => [d, 0]));
  const revenueByDay = new Map(days.map(d => [d, 0]));
  for (const b of state.bookings) {
    const d = bookingDay(b);
    if (byDay.has(d)) {
      byDay.set(d, byDay.get(d) + 1);
      revenueByDay.set(d, revenueByDay.get(d) + fareOf(b));
    }
  }
  barChart($('#revChart'), days.map(d => ({ label: fmtDayShort(d), value: byDay.get(d), short: byDay.get(d) })), {
    format: v => plural(v, 'ticket'), animate: state.firstChart,
  });
  state.firstChart = false;
  $('#revChartTotal').textContent = `${plural(sum(days, d => byDay.get(d)), 'ticket')} · ${money(sum(days, d => revenueByDay.get(d)))}`;

  // Needs attention
  const items = [];
  if (pending.length) items.push(['warn', `${plural(pending.length, 'request')} waiting for review`, 'requests']);
  const upcoming = state.trips.filter(t => !hasDeparted(t, now) && t.travel_date <= win.last);
  const soon = upcoming.filter(t => t.travel_date === today && fullTime(t.departure_time) <= addMinutes(now.time, 180));
  soon.forEach(t => items.push(['info', `${shortTime(t.departure_time)} ${routeOf(t)} leaves soon · ${soldOf(t)}/${capacityOf(t)} sold`, 'trips']));
  const almostFull = upcoming.filter(t => Number(t.available_seats) > 0 && Number(t.available_seats) <= 3);
  if (almostFull.length) items.push(['warn', `${plural(almostFull.length, 'trip')} almost full`, 'trips']);
  const soldOut = upcoming.filter(t => Number(t.available_seats) <= 0);
  if (soldOut.length) items.push(['bad', `${plural(soldOut.length, 'trip')} sold out`, 'trips']);
  const resting = state.buses.filter(b => b.status && b.status !== 'active');
  resting.forEach(bus => {
    const n = upcoming.filter(t => t.bus_id === bus.id).length;
    if (n) items.push(['bad', `${bus.id} is ${bus.status} but has ${plural(n, 'upcoming trip')}`, 'buses']);
  });
  const usedBuses = new Set(upcoming.map(t => t.bus_id).filter(Boolean));
  const missing = [...usedBuses].filter(id => !state.buses.some(b => b.id === id));
  if (missing.length) items.push(['warn', `${missing.join(', ')} not in the bus list`, 'buses']);
  if ((state.marker?.generated_through || '') < win.last) items.push(['warn', 'Schedule is not filled for the full two weeks', 'trips']);

  $('#attention').innerHTML = items.length
    ? items.map(([tone, text, go]) => `<li class="att att-${tone}"><span>${esc(text)}</span><button type="button" class="link-btn" data-go="${go}">Open &rarr;</button></li>`).join('')
    : '<li class="att att-good"><span>All clear. Nothing needs you right now.</span></li>';

  // Departures today
  const deps = tripsToday.slice().sort((a, b) => fullTime(a.departure_time).localeCompare(fullTime(b.departure_time)));
  $('#departures').innerHTML = deps.length ? `<table class="styled-table compact"><thead><tr><th>Time</th><th>Route</th><th>Bus</th><th>Seats</th><th>Status</th></tr></thead><tbody>
    ${deps.map(t => { const [s, tone] = tripStatus(t, now); return `<tr><td>${esc(shortTime(t.departure_time))}</td><td>${esc(routeOf(t))}</td><td>${esc(t.bus_id)}</td><td class="seats-cell">${seatsBar(t)}</td><td>${pill(s, tone)}</td></tr>`; }).join('')}
  </tbody></table>` : '<p class="section-note">No trips today.</p>';

  // Recent activity
  $('#recentActivity').innerHTML = state.audit.length
    ? state.audit.slice(0, 8).map(activityLine).join('')
    : '<li class="section-note">Nothing yet. Changes made in the consoles appear here.</li>';
}

function addMinutes(hhmmss, minutes) {
  const [h, m, s] = hhmmss.split(':').map(Number);
  const total = Math.min(24 * 60 - 1, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:${String(s || 0).padStart(2, '0')}`;
}

const ACTION_WORDS = { create: 'created', update: 'updated', delete: 'deleted', 'sign-in': 'signed in' };
const TARGET_WORDS = { trips: 'trip', bookings: 'ticket', buses: 'bus', staff: 'user', requests: 'request', notices: 'notice', schedule: 'schedule' };

function activityLine(a) {
  const who = esc(a.actor_name || a.actor_id || 'Someone');
  const what = a.action === 'sign-in' ? '' : ` ${TARGET_WORDS[a.target] || a.target} <b>${esc(a.subject)}</b>`;
  return `<li><span class="act-dot act-${esc(a.action)}"></span><div><p>${who} ${ACTION_WORDS[a.action] || esc(a.action)}${what}</p><small>${esc(a.summary || '')}${a.summary ? ' · ' : ''}${timeAgo(a.at)}</small></div></li>`;
}

/* =============================================================
   STATS
   ============================================================= */
function renderStats() {
  const now = dhakaNow();
  const range = state.statsRange;
  const [first, last] = range === 'next'
    ? [now.date, addDays(now.date, BOOKING_WINDOW_DAYS - 1)]
    : [addDays(now.date, -(Number(range) - 1)), now.date];
  $$('#statsRange button').forEach(b => b.classList.toggle('active', b.dataset.range === range));

  const trips = state.trips.filter(t => t.travel_date >= first && t.travel_date <= last);
  const tripIds = new Set(trips.map(t => t.trip_id || t.id));
  const tickets = state.bookings.filter(b => tripIds.has(b.trip_id));
  const revenue = sum(tickets, fareOf);
  const cap = sum(trips, capacityOf);

  $('#statsCards').innerHTML = [
    ['Trips', trips.length, ''],
    ['Tickets', tickets.length, 'orange'],
    ['Revenue', money(revenue), 'warn'],
    ['Seats filled', `${cap ? Math.round((100 * tickets.length) / cap) : 0}%`, 'info'],
    ['Average fare', money(tickets.length ? revenue / tickets.length : 0), 'violet'],
    ['Passengers', new Set(tickets.map(b => (b.email || contactOf(b) || b.id).toLowerCase())).size, 'good'],
  ].map(([label, value, tone]) => `<div class="metric-card"${tone ? ` data-tone="${tone}"` : ''}><span class="label">${label}</span><span class="value">${esc(value)}</span></div>`).join('');

  // Revenue per travel day
  const days = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  const revDay = new Map(days.map(d => [d, 0]));
  for (const b of tickets) {
    const d = state.tripMap.get(b.trip_id)?.travel_date;
    if (revDay.has(d)) revDay.set(d, revDay.get(d) + fareOf(b));
  }
  barChart($('#statsDaily'), days.map(d => ({ label: fmtDayShort(d), value: revDay.get(d), short: revDay.get(d) ? `${Math.round(revDay.get(d) / 1000)}k` : '' })), { format: money, animate: true });

  // Payment mix
  const pay = new Map();
  for (const b of tickets) {
    const key = String(b.payment_method || 'unknown').toLowerCase();
    pay.set(key, (pay.get(key) || 0) + 1);
  }
  const payLabel = { cash: 'Cash', bkash: 'bKash', card: 'Card', unknown: 'Not recorded' };
  donut($('#statsPayments'), [...pay].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: payLabel[k] || k, value: v })));

  // By route
  const routes = new Map();
  for (const t of trips) {
    const r = routeOf(t);
    const entry = routes.get(r) || { revenue: 0, sold: 0, cap: 0 };
    entry.cap += capacityOf(t);
    entry.sold += soldOf(t);
    entry.revenue += soldOf(t) * Number(t.fare || 0);
    routes.set(r, entry);
  }
  const routeRows = [...routes].sort((a, b) => b[1].revenue - a[1].revenue);
  hBars($('#statsRoutes'), routeRows.map(([label, e]) => ({ label, value: e.revenue })), { format: money });
  hBars($('#statsOccupancy'), routeRows.map(([label, e]) => ({ label, value: e.cap ? Math.round((100 * e.sold) / e.cap) : 0 })), { format: v => `${v}%`, max: 100 });

  // Morning vs night
  const slot = t => (fullTime(t.departure_time) < '12:00:00' ? 'Morning departures' : fullTime(t.departure_time) < '18:00:00' ? 'Afternoon departures' : 'Night departures');
  const slots = new Map();
  for (const t of trips) slots.set(slot(t), (slots.get(slot(t)) || 0) + soldOf(t));
  hBars($('#statsSlots'), [...slots].map(([label, value]) => ({ label, value })), { format: v => plural(v, 'ticket') });

  // Busiest trips
  const top = trips.slice().sort((a, b) => soldOf(b) - soldOf(a)).filter(t => soldOf(t) > 0).slice(0, 6);
  $('#statsTop').innerHTML = top.length ? `<table class="styled-table compact"><thead><tr><th>Trip</th><th>Route</th><th>Date</th><th>Sold</th></tr></thead><tbody>
    ${top.map(t => `<tr><td>${esc(t.trip_id)}</td><td>${esc(routeOf(t))}</td><td>${esc(fmtDayShort(t.travel_date))} ${esc(shortTime(t.departure_time))}</td><td class="seats-cell">${seatsBar(t)}</td></tr>`).join('')}
  </tbody></table>` : '<p class="section-note">No tickets sold in this period.</p>';
}

/* =============================================================
   TRIPS
   ============================================================= */
function filteredTrips() {
  const now = dhakaNow();
  const win = bookingWindow(now);
  const when = $('#tripWhen').value;
  const date = $('#tripDate').value;
  const route = $('#tripRoute').value;
  const q = $('#tripSearch').value.trim().toLowerCase();
  return state.trips.filter(t => {
    if (when === 'upcoming' && !(t.travel_date >= win.first && t.travel_date <= win.last)) return false;
    if (when === 'today' && t.travel_date !== now.date) return false;
    if (when === 'past' && !(t.travel_date < now.date)) return false;
    if (when === 'date' && date && t.travel_date !== date) return false;
    if (route && routeOf(t) !== route) return false;
    if (q && !`${t.trip_id} ${t.bus_id} ${routeOf(t)}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (when === 'past'
    ? String(b.travel_date).localeCompare(String(a.travel_date)) || fullTime(b.departure_time).localeCompare(fullTime(a.departure_time))
    : String(a.travel_date).localeCompare(String(b.travel_date)) || fullTime(a.departure_time).localeCompare(fullTime(b.departure_time))));
}

function renderTrips() {
  const now = dhakaNow();
  const routes = [...new Set(state.trips.map(routeOf))].sort();
  const routeSelect = $('#tripRoute');
  const current = routeSelect.value;
  routeSelect.innerHTML = `<option value="">All routes</option>${routes.map(r => `<option${r === current ? ' selected' : ''}>${esc(r)}</option>`).join('')}`;
  $('#tripDate').hidden = $('#tripWhen').value !== 'date';

  const marker = state.marker?.generated_through;
  $('#scheduleNote').textContent = `${DAILY_TRIPS.length} trips run every day. Filled through ${marker ? fmtDate(marker) : '—'}; tickets are on sale for ${BOOKING_WINDOW_DAYS} days ahead.`;

  const rows = filteredTrips();
  $('#tripCount').textContent = plural(rows.length, 'trip');
  const shown = rows.slice(0, state.tripsLimit);
  $('#tripsTable').innerHTML = rows.length ? `<table class="styled-table"><thead><tr>
      <th>Trip</th><th>Route</th><th>When</th><th>Bus</th><th>Fare</th><th>Seats</th><th>Status</th><th class="actions-col">Actions</th>
    </tr></thead><tbody>${shown.map(t => {
      const [s, tone] = tripStatus(t, now);
      const id = esc(t.trip_id || t.id);
      return `<tr>
        <td><b>${id}</b></td>
        <td>${esc(routeOf(t))}</td>
        <td>${esc(fmtDayShort(t.travel_date))}<br><small>${esc(shortTime(t.departure_time))} – ${esc(shortTime(t.arrival_time))}</small></td>
        <td>${esc(t.bus_id)}</td>
        <td>${esc(money(t.fare))}</td>
        <td class="seats-cell">${seatsBar(t)}</td>
        <td>${pill(s, tone)}</td>
        <td class="actions-col">
          <button type="button" class="mini-btn alt" data-action="trip-seats" data-id="${id}">Seats</button>
          <button type="button" class="mini-btn alt" data-action="trip-edit" data-id="${id}">Edit</button>
          <button type="button" class="mini-btn danger" data-action="trip-delete" data-id="${id}">Delete</button>
        </td></tr>`;
    }).join('')}</tbody></table>${moreButton(rows.length, state.tripsLimit, 'trips')}`
    : '<p class="empty-note">No trips match these filters.</p>';
}

function moreButton(total, shown, kind) {
  return total > shown ? `<div class="more-row"><button type="button" class="secondary-btn" data-more="${kind}">Show ${Math.min(60, total - shown)} more (${total - shown} left)</button></div>` : '';
}

function busOptions(selected) {
  const ids = [...new Set([...state.buses.map(b => b.id), ...DAILY_TRIPS.map(s => s.bus_id), selected].filter(Boolean))].sort();
  return ids.map(id => {
    const bus = state.buses.find(b => b.id === id);
    return [id, bus ? `${id}${bus.name ? ` · ${bus.name}` : ''}${bus.status && bus.status !== 'active' ? ` (${bus.status})` : ''}` : `${id} (not in bus list)`];
  });
}

function tripForm(t = null) {
  const editing = Boolean(t);
  const now = dhakaNow();
  const suggestion = `TR-${now.date.replaceAll('-', '').slice(2)}-X${String(state.trips.length + 1).padStart(3, '0')}`;
  return `<div class="form-grid">
    ${field('Trip ID', inputHtml('trip_id', t?.trip_id || suggestion, `required maxlength="40" pattern="[A-Za-z0-9_\\-]+" ${editing ? 'readonly' : ''}`))}
    ${field('Bus', selectHtml('bus_id', busOptions(t?.bus_id), t?.bus_id || 'BUS1', 'required'))}
    ${field('From', selectHtml('origin', CITIES, t?.origin || 'Dhaka', 'required'))}
    ${field('To', selectHtml('destination', CITIES, t?.destination || 'Chittagong', 'required'))}
    ${field('Travel date', inputHtml('travel_date', t?.travel_date || now.date, 'type="date" required'))}
    ${field('Fare (BDT)', inputHtml('fare', t?.fare ?? 1200, 'type="number" min="0" max="100000" step="1" required'))}
    ${field('Departure', inputHtml('departure_time', shortTime(t?.departure_time) || '08:00', 'type="time" required'))}
    ${field('Arrival', inputHtml('arrival_time', shortTime(t?.arrival_time) || '14:00', 'type="time" required'))}
    ${field('Total seats', inputHtml('total_seats', capacityOf(t), `type="number" min="1" max="60" required`))}
    ${editing ? `<div><label>Sold so far<input value="${soldOf(t)} seats" readonly /></label></div>` : ''}
  </div>`;
}

function readTrip(data) {
  if (data.origin === data.destination) throw new Error('From and To must be different cities.');
  const fare = Number(data.fare);
  const total = Number(data.total_seats);
  if (!Number.isFinite(fare) || fare < 0) throw new Error('Enter a valid fare.');
  if (!Number.isInteger(total) || total < 1 || total > 60) throw new Error('Total seats must be between 1 and 60.');
  return {
    bus_id: data.bus_id,
    origin: data.origin,
    destination: data.destination,
    travel_date: data.travel_date,
    departure_time: fullTime(data.departure_time),
    arrival_time: fullTime(data.arrival_time),
    fare,
    total_seats: total,
  };
}

function openTripCreate() {
  openModal({
    title: 'New trip',
    body: tripForm(),
    submitLabel: 'Create trip',
    onSubmit: async (form, data) => {
      const id = normaliseId(data.trip_id).replace(/\s+/g, '');
      if (state.tripMap.has(id)) throw new Error(`Trip ${id} already exists.`);
      const trip = readTrip(data);
      await setDoc(doc(db, 'trips', id), {
        trip_id: id, ...trip, available_seats: trip.total_seats,
        created_at: serverTimestamp(), updated_at: serverTimestamp(),
      });
      audit('create', 'trips', id, `${trip.origin} → ${trip.destination}, ${trip.travel_date} ${shortTime(trip.departure_time)}`);
      toast(`Trip ${id} created.`);
    },
  });
}

function openTripEdit(id) {
  const t = state.tripMap.get(id);
  if (!t) return;
  openModal({
    title: `Edit trip ${id}`,
    body: tripForm(t),
    onSubmit: async (form, data) => {
      const trip = readTrip(data);
      const sold = soldOf(t);
      if (trip.total_seats < sold) throw new Error(`${sold} seats are already sold; total seats cannot be lower.`);
      await updateDoc(doc(db, 'trips', id), { ...trip, available_seats: trip.total_seats - sold, updated_at: serverTimestamp() });
      audit('update', 'trips', id, `${trip.origin} → ${trip.destination}, ${trip.travel_date} ${shortTime(trip.departure_time)}, ${money(trip.fare)}`);
      toast(`Trip ${id} saved.`);
    },
  });
}

async function deleteTrip(id) {
  const tickets = state.bookings.filter(b => b.trip_id === id);
  const ok = await confirmAction(
    tickets.length
      ? `Delete trip ${id}? Its ${plural(tickets.length, 'ticket')} will be cancelled too. This cannot be undone.`
      : `Delete trip ${id}? This cannot be undone.`,
    { yes: 'Delete trip' }
  );
  if (!ok) return;
  try {
    const snap = await getDocs(query(collection(db, 'bookings'), where('trip_id', '==', id)));
    const batch = writeBatch(db);
    snap.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, 'trips', id));
    await batch.commit();
    audit('delete', 'trips', id, tickets.length ? `with ${plural(tickets.length, 'ticket')}` : '');
    toast(`Trip ${id} deleted.`);
  } catch (error) {
    toast(error.message || 'Delete failed.', 'error');
  }
}

/* The bus layout, with each booked seat named. */
function openTripSeats(id) {
  const t = state.tripMap.get(id);
  if (!t) return;
  const bySeat = new Map(state.bookings.filter(b => b.trip_id === id).map(b => [b.seat_label, b]));
  const seat = label => {
    const b = bySeat.get(label);
    return b
      ? `<button type="button" class="aseat booked" data-action="ticket-view" data-id="${esc(b.id)}" title="${esc(b.passenger_name)} · ${esc(contactOf(b))}">${label}<small>${esc(String(b.passenger_name || '').split(' ')[0])}</small></button>`
      : `<span class="aseat free">${label}</span>`;
  };
  const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(r => `<div class="aseat-row">${seat(`${r}1`)}<span class="aseat gap"></span>${seat(`${r}2`)}${seat(`${r}3`)}</div>`).join('');
  const back = `<div class="aseat-row">${['I1', 'I2', 'I3', 'I4'].map(seat).join('')}</div>`;
  const [s, tone] = tripStatus(t);
  openModal({
    title: `Seats · ${id}`,
    wide: true,
    body: `<div class="trip-summary">
        <p><b>${esc(routeOf(t))}</b> · ${esc(fmtDate(t.travel_date))} · ${esc(shortTime(t.departure_time))}–${esc(shortTime(t.arrival_time))} · ${esc(t.bus_id)} · ${esc(money(t.fare))} ${pill(s, tone)}</p>
        <p class="section-note">${soldOf(t)} of ${capacityOf(t)} seats sold · ${esc(money(soldOf(t) * Number(t.fare || 0)))} taken. Click a booked seat to open its ticket.</p>
      </div>
      <div class="aseat-map"><div class="aseat-front">FRONT</div>${rows}${back}</div>
      ${hasDeparted(t) ? '' : `<div class="form-actions"><button type="button" class="primary-btn" data-action="ticket-new" data-id="${esc(id)}">+ Issue ticket on this trip</button></div>`}`,
  });
}

async function fillSchedule() {
  const created = await ensureSchedule(db);
  if (created) audit('create', 'schedule', 'window', `${created} trips added to the timetable`);
  toast(created ? `${plural(created, 'trip')} added to the schedule.` : 'Schedule is already full for the next two weeks.');
}

/* =============================================================
   TICKETS
   ============================================================= */
function filteredTickets() {
  const now = dhakaNow();
  const when = $('#ticketWhen').value;
  const pay = $('#ticketPay').value;
  const q = $('#ticketSearch').value.trim().toLowerCase();
  return state.bookings.filter(b => {
    const t = state.tripMap.get(b.trip_id);
    const date = t?.travel_date || '';
    if (when === 'upcoming' && !(date >= now.date)) return false;
    if (when === 'today' && date !== now.date) return false;
    if (when === 'past' && !(date && date < now.date)) return false;
    if (pay && String(b.payment_method || '').toLowerCase() !== pay) return false;
    if (q && !`${b.id} ${b.trip_id} ${b.passenger_name} ${contactOf(b)} ${b.email} ${b.seat_label}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (toDate(b.created_at || b.booking_time)?.getTime() || 0) - (toDate(a.created_at || a.booking_time)?.getTime() || 0));
}

const payText = b => {
  const m = String(b.payment_method || '').toLowerCase();
  const label = { cash: 'Cash', bkash: 'bKash', card: 'Card' }[m] || b.payment_method || '—';
  return b.payment_info && !String(b.payment_info).match(/^\d+$/) ? b.payment_info : label;
};
const sourceOf = b => (b.source ? b.source : b.booked_by ? 'Counter' : 'Online');

function renderTickets() {
  const rows = filteredTickets();
  $('#ticketCount').textContent = plural(rows.length, 'ticket');
  const shown = rows.slice(0, state.ticketsLimit);
  $('#ticketsTable').innerHTML = rows.length ? `<table class="styled-table"><thead><tr>
      <th>Ticket</th><th>Passenger</th><th>Trip</th><th>Seat</th><th>Payment</th><th>Booked</th><th>By</th><th class="actions-col">Actions</th>
    </tr></thead><tbody>${shown.map(b => {
      const t = state.tripMap.get(b.trip_id);
      const id = esc(b.id);
      return `<tr>
        <td><b>${id}</b></td>
        <td>${esc(b.passenger_name)}<br><small>${esc(contactOf(b))}${b.email ? ` · ${esc(b.email)}` : ''}</small></td>
        <td>${t ? `${esc(routeOf(t))}<br><small>${esc(fmtDate(t.travel_date))} ${esc(shortTime(t.departure_time))}</small>` : `<small>${esc(b.trip_id)} (trip removed)</small>`}</td>
        <td><span class="seat-chip">${esc(b.seat_label)}</span></td>
        <td>${esc(payText(b))}</td>
        <td><small>${esc(fmtStamp(b.created_at || b.booking_time))}</small></td>
        <td><small>${esc(sourceOf(b))}${b.booked_by ? ` · ${esc(b.booked_by)}` : ''}</small></td>
        <td class="actions-col">
          <button type="button" class="mini-btn alt" data-action="ticket-view" data-id="${id}">View</button>
          <button type="button" class="mini-btn alt" data-action="ticket-edit" data-id="${id}">Edit</button>
          <button type="button" class="mini-btn danger" data-action="ticket-delete" data-id="${id}">Cancel</button>
        </td></tr>`;
    }).join('')}</tbody></table>${moreButton(rows.length, state.ticketsLimit, 'tickets')}`
    : '<p class="empty-note">No tickets match these filters.</p>';
}

function bookableTrips() {
  const now = dhakaNow();
  const win = bookingWindow(now);
  return state.trips
    .filter(t => !hasDeparted(t, now) && t.travel_date <= win.last && Number(t.available_seats) > 0)
    .sort((a, b) => String(a.travel_date).localeCompare(String(b.travel_date)) || fullTime(a.departure_time).localeCompare(fullTime(b.departure_time)));
}

function freeSeats(tripId) {
  const taken = new Set(state.bookings.filter(b => b.trip_id === tripId).map(b => b.seat_label));
  return SEAT_LABELS.filter(s => !taken.has(s));
}

function openTicketCreate(tripId = '') {
  const trips = bookableTrips();
  if (!trips.length) {
    toast('No trips with free seats in the next two weeks.', 'error');
    return;
  }
  const chosen = trips.some(t => t.trip_id === tripId) ? tripId : trips[0].trip_id;
  const tripOpts = trips.map(t => [t.trip_id, `${fmtDayShort(t.travel_date)} ${shortTime(t.departure_time)} · ${routeOf(t)} · ${t.available_seats} left · ${money(t.fare)}`]);
  openModal({
    title: 'Issue ticket',
    wide: true,
    body: `<div class="form-grid">
      ${field('Trip', selectHtml('trip_id', tripOpts, chosen, 'required id="ticketTrip"'), 'full')}
      ${field('Seat', selectHtml('seat_label', freeSeats(chosen), '', 'required id="ticketSeat"'))}
      ${field('Payment', selectHtml('payment_method', [['cash', 'Cash'], ['bkash', 'bKash'], ['card', 'Card']], 'cash', 'required'))}
      ${field('Passenger name', inputHtml('passenger_name', '', 'required maxlength="60"'))}
      ${field('Phone', inputHtml('contact_number', '', 'required inputmode="tel" pattern="01[3-9][0-9]{8}" title="11-digit mobile number, 01XXXXXXXXX"'))}
      ${field('Email (optional)', inputHtml('email', '', 'type="email" maxlength="80"'))}
      ${field('Payment reference (optional)', inputHtml('payment_info', '', 'maxlength="60" placeholder="e.g. bKash TrxID or last 4 card digits"'))}
    </div>`,
    submitLabel: 'Issue ticket',
    onOpen: form => {
      $('#ticketTrip', form).addEventListener('change', event => {
        $('#ticketSeat', form).innerHTML = freeSeats(event.target.value).map(s => `<option>${s}</option>`).join('');
      });
    },
    onSubmit: async (form, data) => {
      const ticketId = `${data.trip_id}_${data.seat_label}`;
      await runTransaction(db, async tx => {
        const tripRef = doc(db, 'trips', data.trip_id);
        const ticketRef = doc(db, 'bookings', ticketId);
        const tripSnap = await tx.get(tripRef);
        if (!tripSnap.exists()) throw new Error('That trip no longer exists.');
        if (hasDeparted(tripSnap.data())) throw new Error('That bus has already departed.');
        if ((await tx.get(ticketRef)).exists()) throw new Error(`Seat ${data.seat_label} was just booked. Pick another seat.`);
        if (Number(tripSnap.data().available_seats ?? 0) <= 0) throw new Error('No seats left on this trip.');
        tx.set(ticketRef, {
          ticket_id: ticketId,
          trip_id: data.trip_id,
          seat_label: data.seat_label,
          passenger_name: data.passenger_name.trim(),
          contact_number: data.contact_number.trim(),
          email: data.email.trim(),
          payment_method: data.payment_method,
          ...(data.payment_info.trim() ? { payment_info: data.payment_info.trim() } : {}),
          booked_by: state.user.id,
          source: 'Admin',
          created_at: serverTimestamp(),
        });
        tx.update(tripRef, { available_seats: increment(-1), updated_at: serverTimestamp() });
      });
      audit('create', 'bookings', ticketId, `${data.passenger_name.trim()}, seat ${data.seat_label}`);
      toast(`Ticket ${ticketId} issued.`);
    },
  });
}

function openTicketEdit(id) {
  const b = state.bookings.find(x => x.id === id);
  if (!b) return;
  openModal({
    title: `Edit ticket ${id}`,
    body: `<div class="form-grid">
      ${field('Passenger name', inputHtml('passenger_name', b.passenger_name, 'required maxlength="60"'), 'full')}
      ${field('Phone', inputHtml('contact_number', contactOf(b), 'required inputmode="tel" maxlength="20"'))}
      ${field('Email', inputHtml('email', b.email, 'type="email" maxlength="80"'))}
      ${field('Payment', selectHtml('payment_method', [['cash', 'Cash'], ['bkash', 'bKash'], ['card', 'Card']], String(b.payment_method || 'cash').toLowerCase()))}
      ${field('Payment reference', inputHtml('payment_info', b.payment_info || '', 'maxlength="60"'))}
    </div><p class="section-note">To move a passenger to another seat or trip, cancel this ticket and issue a new one.</p>`,
    onSubmit: async (form, data) => {
      await updateDoc(doc(db, 'bookings', id), {
        passenger_name: data.passenger_name.trim(),
        contact_number: data.contact_number.trim(),
        email: data.email.trim(),
        payment_method: data.payment_method,
        payment_info: data.payment_info.trim(),
        updated_at: serverTimestamp(),
      });
      audit('update', 'bookings', id, data.passenger_name.trim());
      toast(`Ticket ${id} saved.`);
    },
  });
}

async function cancelTicket(id) {
  const b = state.bookings.find(x => x.id === id);
  if (!b) return;
  const ok = await confirmAction(`Cancel ticket ${id} for ${b.passenger_name || 'this passenger'}? Seat ${b.seat_label} goes back on sale.`, { yes: 'Cancel ticket' });
  if (!ok) return;
  try {
    await runTransaction(db, async tx => {
      const ticketRef = doc(db, 'bookings', id);
      const tripRef = doc(db, 'trips', b.trip_id);
      const tripSnap = await tx.get(tripRef);
      tx.delete(ticketRef);
      if (tripSnap.exists()) tx.update(tripRef, { available_seats: increment(1), updated_at: serverTimestamp() });
    });
    audit('delete', 'bookings', id, `${b.passenger_name || ''}, seat ${b.seat_label} released`);
    toast(`Ticket ${id} cancelled.`);
  } catch (error) {
    toast(error.message || 'Cancel failed.', 'error');
  }
}

function ticketCardHtml(b) {
  const t = state.tripMap.get(b.trip_id);
  const rows = [
    ['Ticket', b.id], ['Passenger', b.passenger_name], ['Phone', contactOf(b)], ['Email', b.email || '—'],
    ['Route', t ? routeOf(t) : b.trip_id], ['Date', t ? fmtDate(t.travel_date) : '—'],
    ['Departure', t ? `${shortTime(t.departure_time)} (arrives ${shortTime(t.arrival_time)})` : '—'],
    ['Bus', t?.bus_id || '—'], ['Seat', b.seat_label], ['Fare', money(fareOf(b))], ['Payment', payText(b)],
    ['Booked', `${fmtStamp(b.created_at || b.booking_time)} · ${sourceOf(b)}`],
  ];
  return `<div class="ticket">
    <div class="ticket-head"><img src="logo.svg" width="40" height="40" alt="" /><div><strong>DTicket</strong><small>The all-in-one Ticketing Website</small></div><span>E-Ticket</span></div>
    <dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
  </div>`;
}

function openTicketView(id) {
  const b = state.bookings.find(x => x.id === id);
  if (!b) return;
  openModal({
    title: `Ticket ${id}`,
    body: `${ticketCardHtml(b)}<div class="form-actions"><button type="button" class="primary-btn" data-action="ticket-print" data-id="${esc(id)}">Print / PDF</button></div>`,
  });
}

/* Prints just the ticket, in its own window. */
function printTicket(id) {
  const b = state.bookings.find(x => x.id === id);
  if (!b) return;
  const win = window.open('', '_blank', 'width=520,height=760');
  if (!win) {
    toast('Allow pop-ups to print the ticket.', 'error');
    return;
  }
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${esc(id)}</title><base href="${location.href}">
    <style>body{font:14px/1.45 Segoe UI,Arial,sans-serif;margin:24px;color:#111}.ticket{border:1px solid #111;border-radius:14px;overflow:hidden}
    .ticket-head{display:flex;align-items:center;gap:12px;padding:14px 16px;background:linear-gradient(135deg,#1d3fa8,#2f55d4 55%,#5a8cff);color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .ticket-head img{border-radius:10px}.ticket-head div{display:grid}.ticket-head small{opacity:.85;font-size:11px}.ticket-head span{margin-left:auto;border:1px solid #fff;border-radius:999px;padding:4px 10px;font-size:11px;letter-spacing:.14em;font-weight:700}
    dl{margin:0;padding:6px 16px 14px}dl div{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed #bbb}dl div:last-child{border:0}dt{color:#555;font-weight:600}dd{margin:0;text-align:right}</style></head>
    <body>${ticketCardHtml(b)}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
  win.document.close();
}

/* =============================================================
   BUSES
   ============================================================= */
function renderBuses() {
  const now = dhakaNow();
  const upcoming = state.trips.filter(t => !hasDeparted(t, now));
  const used = [...new Set(state.trips.filter(t => t.travel_date >= now.date).map(t => t.bus_id).filter(Boolean))];
  const missing = used.filter(id => !state.buses.some(b => b.id === id)).sort();
  $('#busMissing').innerHTML = missing.length
    ? `<div class="card banner-warn"><p>${missing.map(esc).join(', ')} ${missing.length === 1 ? 'runs trips but is' : 'run trips but are'} not in the bus list.</p>
       <div>${missing.map(id => `<button type="button" class="mini-btn" data-action="bus-add-missing" data-id="${esc(id)}">Add ${esc(id)}</button>`).join('')}</div></div>`
    : '';

  const statusTone = { active: 'good', maintenance: 'warn', retired: 'muted' };
  $('#busGrid').innerHTML = state.buses.length ? state.buses.slice().sort((a, b) => a.id.localeCompare(b.id)).map((bus, i) => {
    const trips = upcoming.filter(t => t.bus_id === bus.id).sort((a, b) => String(a.travel_date).localeCompare(String(b.travel_date)) || fullTime(a.departure_time).localeCompare(fullTime(b.departure_time)));
    const next = trips[0];
    const status = bus.status || 'active';
    return `<article class="card bus-card" style="--i:${i}">
      <div class="bus-card-head"><div><h3>${esc(bus.id)}</h3><p>${esc(bus.name || 'Unnamed bus')}</p></div>${pill(status[0].toUpperCase() + status.slice(1), statusTone[status] || 'muted')}</div>
      <dl class="bus-facts">
        <div><dt>Seats</dt><dd>${esc(bus.total_seats || SEATS_PER_BUS)}</dd></div>
        <div><dt>Type</dt><dd>${esc(bus.type || '—')}</dd></div>
        <div><dt>Plate</dt><dd>${esc(bus.plate || '—')}</dd></div>
        <div><dt>Upcoming trips</dt><dd>${trips.length}</dd></div>
      </dl>
      <p class="section-note">${next ? `Next: ${esc(fmtDayShort(next.travel_date))} ${esc(shortTime(next.departure_time))} · ${esc(routeOf(next))}` : 'No upcoming trips.'}</p>
      ${bus.notes ? `<p class="bus-notes">${esc(bus.notes)}</p>` : ''}
      <div class="form-actions">
        <button type="button" class="mini-btn alt" data-action="bus-edit" data-id="${esc(bus.id)}">Edit</button>
        <button type="button" class="mini-btn danger" data-action="bus-delete" data-id="${esc(bus.id)}">Delete</button>
      </div>
    </article>`;
  }).join('') : '<p class="empty-note">No buses yet. Add the fleet with “New bus”.</p>';
}

function busForm(bus = null, presetId = '') {
  return `<div class="form-grid">
    ${field('Bus ID', inputHtml('bus_id', bus?.id || presetId, `required maxlength="20" pattern="[A-Za-z0-9_\\-]+" ${bus ? 'readonly' : ''}`))}
    ${field('Name / model', inputHtml('name', bus?.name || '', 'maxlength="60" placeholder="e.g. Volvo B9R"'))}
    ${field('Number plate', inputHtml('plate', bus?.plate || '', 'maxlength="30" placeholder="e.g. DHAKA METRO-BA 11-2233"'))}
    ${field('Type', selectHtml('type', ['AC', 'Non-AC', 'Sleeper'], bus?.type || 'AC'))}
    ${field('Seats', inputHtml('total_seats', bus?.total_seats || SEATS_PER_BUS, 'type="number" min="1" max="60" required'))}
    ${field('Status', selectHtml('status', [['active', 'Active'], ['maintenance', 'Maintenance'], ['retired', 'Retired']], bus?.status || 'active'))}
    ${field('Notes', `<textarea name="notes" maxlength="300">${esc(bus?.notes || '')}</textarea>`, 'full')}
  </div>`;
}

function openBusForm(id = '', presetId = '') {
  const bus = id ? state.buses.find(b => b.id === id) : null;
  openModal({
    title: bus ? `Edit ${bus.id}` : 'New bus',
    body: busForm(bus, presetId),
    submitLabel: bus ? 'Save' : 'Add bus',
    onSubmit: async (form, data) => {
      const busId = normaliseId(data.bus_id);
      if (!bus && state.buses.some(b => b.id === busId)) throw new Error(`${busId} already exists.`);
      const seats = Number(data.total_seats);
      if (!Number.isInteger(seats) || seats < 1 || seats > 60) throw new Error('Seats must be between 1 and 60.');
      await setDoc(doc(db, 'buses', busId), {
        bus_id: busId, name: data.name.trim(), plate: data.plate.trim(), type: data.type,
        total_seats: seats, status: data.status, notes: data.notes.trim(),
        updated_at: serverTimestamp(), ...(bus ? {} : { created_at: serverTimestamp() }),
      }, { merge: true });
      audit(bus ? 'update' : 'create', 'buses', busId, `${data.status}${data.name ? `, ${data.name.trim()}` : ''}`);
      toast(`${busId} saved.`);
    },
  });
}

async function deleteBus(id) {
  const n = state.trips.filter(t => t.bus_id === id && !hasDeparted(t)).length;
  const ok = await confirmAction(n
    ? `${id} still has ${plural(n, 'upcoming trip')}. Delete it from the bus list anyway? The trips stay.`
    : `Delete ${id} from the bus list?`, { yes: 'Delete bus' });
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'buses', id));
    audit('delete', 'buses', id);
    toast(`${id} deleted.`);
  } catch (error) {
    toast(error.message || 'Delete failed.', 'error');
  }
}

/* =============================================================
   USERS (staff)
   ============================================================= */
function renderUsers() {
  const q = $('#userSearch').value.trim().toLowerCase();
  const role = $('#userRole').value;
  const rows = state.staff
    .filter(u => (!role || u.role === role) && (!q || `${u.id} ${u.name} ${u.phone} ${u.email}`.toLowerCase().includes(q)))
    .sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id));
  $('#userCount').textContent = plural(rows.length, 'user');
  $('#usersTable').innerHTML = rows.length ? `<table class="styled-table"><thead><tr>
      <th>User ID</th><th>Name</th><th>Role</th><th>Contact</th><th>Status</th><th>Last sign-in</th><th class="actions-col">Actions</th>
    </tr></thead><tbody>${rows.map(u => {
      const me = u.id === state.user.id;
      return `<tr>
        <td><b>${esc(u.id)}</b>${me ? ' <span class="pill pill-info">You</span>' : ''}</td>
        <td>${esc(u.name)}</td>
        <td>${pill(ROLE_LABELS[u.role] || u.role, u.role === 'admin' ? 'bad' : 'violet')}</td>
        <td><small>${esc(u.phone || '—')}<br>${esc(u.email || '')}</small></td>
        <td>${u.active === false ? pill('Off', 'muted') : pill('Active', 'good')}</td>
        <td><small>${esc(fmtStamp(u.last_login_at))}</small></td>
        <td class="actions-col">
          <button type="button" class="mini-btn alt" data-action="user-edit" data-id="${esc(u.id)}">Edit</button>
          <button type="button" class="mini-btn alt" data-action="user-reset" data-id="${esc(u.id)}">Reset password</button>
          ${me ? '' : `<button type="button" class="mini-btn alt" data-action="user-toggle" data-id="${esc(u.id)}">${u.active === false ? 'Turn on' : 'Turn off'}</button>
          <button type="button" class="mini-btn danger" data-action="user-delete" data-id="${esc(u.id)}">Delete</button>`}
        </td></tr>`;
    }).join('')}</tbody></table>`
    : '<p class="empty-note">No users match.</p>';
}

function openUserForm(id = '') {
  const u = id ? state.staff.find(x => x.id === id) : null;
  const me = u?.id === state.user.id;
  const suggested = generatePassword();
  openModal({
    title: u ? `Edit ${u.id}` : 'New user',
    body: `<div class="form-grid">
      ${field('User ID', inputHtml('staff_id', u?.id || '', `required maxlength="12" pattern="[A-Za-z0-9]{2,12}" title="2–12 letters or digits" ${u ? 'readonly' : ''}`))}
      ${field('Role', selectHtml('role', [['cmanager', 'Counter Manager'], ['admin', 'Admin']], u?.role || 'cmanager', me ? 'disabled' : ''))}
      ${field('Full name', inputHtml('name', u?.name || '', 'required maxlength="60"'), 'full')}
      ${field('Phone', inputHtml('phone', u?.phone || '', 'inputmode="tel" maxlength="20"'))}
      ${field('Email', inputHtml('email', u?.email || '', 'type="email" maxlength="80"'))}
      ${u ? '' : field('Starting password', inputHtml('password', suggested, 'required minlength="6" maxlength="64"'), 'full')}
    </div>${u ? '' : '<p class="section-note">Give this password to the person; they can change it under My account.</p>'}`,
    submitLabel: u ? 'Save' : 'Create user',
    onSubmit: async (form, data) => {
      const sid = normaliseId(data.staff_id);
      if (!u && state.staff.some(x => x.id === sid)) throw new Error(`${sid} is already taken.`);
      const role = me ? u.role : data.role;
      const record = {
        staff_id: sid, name: data.name.trim(), role, phone: data.phone.trim(), email: data.email.trim(),
        updated_at: serverTimestamp(),
      };
      if (u) {
        await updateDoc(doc(db, STAFF, sid), record);
        audit('update', 'staff', sid, `${record.name}, ${ROLE_LABELS[role]}`);
        toast(`${sid} saved.`);
      } else {
        await setDoc(doc(db, STAFF, sid), { ...record, active: true, ...(await passwordFields(data.password)), created_at: serverTimestamp() });
        audit('create', 'staff', sid, `${record.name}, ${ROLE_LABELS[role]}`);
        toast(`${sid} created. Password: ${data.password}`);
      }
    },
  });
}

function openUserReset(id) {
  const u = state.staff.find(x => x.id === id);
  if (!u) return;
  openModal({
    title: `New password for ${u.id}`,
    body: `<div class="form-grid">${field('New password', inputHtml('password', generatePassword(), 'required minlength="6" maxlength="64"'), 'full')}</div>
      <p class="section-note">The old password stops working straight away. Pass the new one to ${esc(u.name || u.id)}.</p>`,
    submitLabel: 'Set password',
    onSubmit: async (form, data) => {
      await updateDoc(doc(db, STAFF, id), { ...(await passwordFields(data.password)), updated_at: serverTimestamp() });
      audit('update', 'staff', id, 'Password reset');
      toast(`Password for ${id} changed to: ${data.password}`);
    },
  });
}

async function toggleUser(id) {
  const u = state.staff.find(x => x.id === id);
  if (!u || id === state.user.id) return;
  const turningOff = u.active !== false;
  if (turningOff && u.role === 'admin' && state.staff.filter(x => x.role === 'admin' && x.active !== false).length <= 1) {
    toast('There must always be at least one active admin.', 'error');
    return;
  }
  if (turningOff && !(await confirmAction(`Turn off ${id}? They will be signed out and cannot sign in until turned back on.`, { yes: 'Turn off' }))) return;
  await updateDoc(doc(db, STAFF, id), { active: !turningOff, updated_at: serverTimestamp() });
  audit('update', 'staff', id, turningOff ? 'Account turned off' : 'Account turned on');
  toast(`${id} turned ${turningOff ? 'off' : 'on'}.`);
}

async function deleteUser(id) {
  const u = state.staff.find(x => x.id === id);
  if (!u || id === state.user.id) return;
  if (u.role === 'admin' && state.staff.filter(x => x.role === 'admin' && x.active !== false).length <= 1) {
    toast('There must always be at least one active admin.', 'error');
    return;
  }
  if (!(await confirmAction(`Delete user ${id} (${u.name})? This cannot be undone. Turning the account off keeps its history instead.`, { yes: 'Delete user' }))) return;
  await deleteDoc(doc(db, STAFF, id));
  audit('delete', 'staff', id, u.name);
  toast(`${id} deleted.`);
}

/* =============================================================
   PASSENGERS (people who booked)
   ============================================================= */
function passengerGroups() {
  const groups = new Map();
  for (const b of state.bookings) {
    const key = (b.email || contactOf(b) || b.passenger_name || b.id).trim().toLowerCase();
    const g = groups.get(key) || { key, names: new Set(), email: b.email || '', phone: contactOf(b), tickets: [], spent: 0, last: '' };
    if (b.passenger_name) g.names.add(b.passenger_name);
    if (!g.phone) g.phone = contactOf(b);
    g.tickets.push(b);
    g.spent += fareOf(b);
    const date = state.tripMap.get(b.trip_id)?.travel_date || '';
    if (date > g.last) g.last = date;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.tickets.length - a.tickets.length || b.spent - a.spent);
}

function renderPassengers() {
  const q = $('#paxSearch').value.trim().toLowerCase();
  const rows = passengerGroups().filter(g => !q || `${[...g.names].join(' ')} ${g.email} ${g.phone}`.toLowerCase().includes(q));
  $('#paxCount').textContent = plural(rows.length, 'passenger');
  $('#paxTable').innerHTML = rows.length ? `<table class="styled-table"><thead><tr>
      <th>Name</th><th>Email</th><th>Phone</th><th>Tickets</th><th>Spent</th><th>Last trip</th><th class="actions-col"></th>
    </tr></thead><tbody>${rows.slice(0, 200).map(g => `<tr>
      <td><b>${esc([...g.names].slice(0, 2).join(', ') || '—')}</b>${g.names.size > 2 ? ` <small>+${g.names.size - 2}</small>` : ''}</td>
      <td>${esc(g.email || '—')}</td>
      <td>${esc(g.phone || '—')}</td>
      <td>${g.tickets.length}</td>
      <td>${esc(money(g.spent))}</td>
      <td>${esc(g.last ? fmtDate(g.last) : '—')}</td>
      <td class="actions-col"><button type="button" class="mini-btn alt" data-action="pax-view" data-id="${esc(g.key)}">Tickets</button></td>
    </tr>`).join('')}</tbody></table>`
    : '<p class="empty-note">No passengers yet.</p>';
}

function openPassenger(key) {
  const g = passengerGroups().find(x => x.key === key);
  if (!g) return;
  openModal({
    title: [...g.names][0] || 'Passenger',
    wide: true,
    body: `<p class="section-note">${esc(g.email || 'No email')} · ${esc(g.phone || 'No phone')} · ${plural(g.tickets.length, 'ticket')} · ${esc(money(g.spent))}</p>
      <table class="styled-table compact"><thead><tr><th>Ticket</th><th>Name</th><th>Trip</th><th>Seat</th><th></th></tr></thead><tbody>
      ${g.tickets.map(b => { const t = state.tripMap.get(b.trip_id); return `<tr><td>${esc(b.id)}</td><td>${esc(b.passenger_name)}</td><td>${t ? `${esc(routeOf(t))} · ${esc(fmtDayShort(t.travel_date))} ${esc(shortTime(t.departure_time))}` : esc(b.trip_id)}</td><td>${esc(b.seat_label)}</td><td><button type="button" class="mini-btn alt" data-action="ticket-view" data-id="${esc(b.id)}">View</button></td></tr>`; }).join('')}
      </tbody></table>`,
  });
}

/* =============================================================
   REQUESTS
   ============================================================= */
const reqTone = { Pending: 'warn', Approved: 'good', Rejected: 'bad', Closed: 'muted' };

function renderRequests() {
  const q = $('#reqSearch').value.trim().toLowerCase();
  const status = $('#reqStatus').value;
  const rows = state.requests
    .filter(r => (!status || (r.status || 'Pending') === status) && (!q || `${r.subject} ${r.details} ${r.requested_by}`.toLowerCase().includes(q)))
    .sort((a, b) => (toDate(b.created_at)?.getTime() || 0) - (toDate(a.created_at)?.getTime() || 0));
  $('#reqCount').textContent = plural(rows.length, 'request');
  $('#requestsTable').innerHTML = rows.length ? `<table class="styled-table"><thead><tr>
      <th>Subject</th><th>From</th><th>Sent</th><th>Status</th><th class="actions-col">Actions</th>
    </tr></thead><tbody>${rows.map(r => {
      const s = r.status || 'Pending';
      return `<tr>
        <td><b>${esc(r.subject)}</b><br><small class="clamp">${esc(r.details)}</small></td>
        <td>${esc(r.requested_by || '—')}<br><small>${esc(r.source || '')}</small></td>
        <td><small>${esc(fmtStamp(r.created_at))}</small></td>
        <td>${pill(s, reqTone[s] || 'muted')}</td>
        <td class="actions-col">
          ${s === 'Pending' ? `<button type="button" class="mini-btn ok" data-action="req-status" data-status="Approved" data-id="${esc(r.id)}">Approve</button>
          <button type="button" class="mini-btn danger" data-action="req-status" data-status="Rejected" data-id="${esc(r.id)}">Reject</button>` : ''}
          ${s !== 'Closed' ? `<button type="button" class="mini-btn alt" data-action="req-status" data-status="Closed" data-id="${esc(r.id)}">Close</button>` : ''}
          <button type="button" class="mini-btn alt" data-action="req-edit" data-id="${esc(r.id)}">Edit</button>
          <button type="button" class="mini-btn danger" data-action="req-delete" data-id="${esc(r.id)}">Delete</button>
        </td></tr>`;
    }).join('')}</tbody></table>`
    : '<p class="empty-note">No requests match.</p>';
}

function openRequestForm(id = '') {
  const r = id ? state.requests.find(x => x.id === id) : null;
  openModal({
    title: r ? 'Edit request' : 'New request',
    body: `<div class="form-grid">
      ${field('Subject', inputHtml('subject', r?.subject || '', 'required maxlength="200"'), 'full')}
      ${field('Details', `<textarea name="details" required maxlength="4000">${esc(r?.details || '')}</textarea>`, 'full')}
      ${field('Requested by', inputHtml('requested_by', r?.requested_by || state.user.id, 'required maxlength="40"'))}
      ${field('Status', selectHtml('status', ['Pending', 'Approved', 'Rejected', 'Closed'], r?.status || 'Pending'))}
    </div>`,
    onSubmit: async (form, data) => {
      const payload = { subject: data.subject.trim(), details: data.details.trim(), requested_by: data.requested_by.trim(), status: data.status, updated_at: serverTimestamp() };
      if (r) {
        await updateDoc(doc(db, 'requests', id), payload);
        audit('update', 'requests', payload.subject, data.status);
      } else {
        await setDoc(doc(collection(db, 'requests')), { ...payload, source: 'Admin', created_at: serverTimestamp() });
        audit('create', 'requests', payload.subject, data.status);
      }
      toast('Request saved.');
    },
  });
}

async function setRequestStatus(id, status) {
  const r = state.requests.find(x => x.id === id);
  if (!r) return;
  await updateDoc(doc(db, 'requests', id), { status, updated_at: serverTimestamp(), reviewed_by: state.user.id });
  audit('update', 'requests', r.subject, status);
  toast(`Request ${status.toLowerCase()}.`);
}

async function deleteRequest(id) {
  const r = state.requests.find(x => x.id === id);
  if (!r || !(await confirmAction(`Delete the request “${r.subject}”?`, { yes: 'Delete' }))) return;
  await deleteDoc(doc(db, 'requests', id));
  audit('delete', 'requests', r.subject);
  toast('Request deleted.');
}

/* =============================================================
   NOTICES
   ============================================================= */
function renderNotices() {
  const today = dhakaNow().date;
  const rows = state.notices.slice().sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.posted_on || '').localeCompare(String(a.posted_on || '')));
  const audience = { all: 'All staff', cmanager: 'Counter managers', admin: 'Admins only' };
  $('#noticeList').innerHTML = rows.length ? rows.map((n, i) => {
    const expired = n.expires_on && n.expires_on < today;
    return `<article class="card notice-card${n.pinned ? ' is-pinned' : ''}${expired ? ' is-expired' : ''}" style="--i:${i}">
      <div class="notice-meta">${n.pinned ? pill('Pinned', 'warn') : ''}${pill(audience[n.audience] || 'All staff', 'info')}${expired ? pill('Expired', 'muted') : ''}</div>
      <h3>${esc(n.title)}</h3>
      <p>${esc(n.body)}</p>
      <small>${esc(n.posted_by_name || n.posted_by || 'Admin')} · ${esc(fmtDate(n.posted_on))}${n.expires_on ? ` · until ${esc(fmtDate(n.expires_on))}` : ''}</small>
      <div class="form-actions">
        <button type="button" class="mini-btn alt" data-action="notice-edit" data-id="${esc(n.id)}">Edit</button>
        <button type="button" class="mini-btn danger" data-action="notice-delete" data-id="${esc(n.id)}">Delete</button>
      </div>
    </article>`;
  }).join('') : '<p class="empty-note">No notices yet. Post one to tell the counters something.</p>';
}

function openNoticeForm(id = '') {
  const n = id ? state.notices.find(x => x.id === id) : null;
  openModal({
    title: n ? 'Edit notice' : 'Post a notice',
    body: `<div class="form-grid">
      ${field('Title', inputHtml('title', n?.title || '', 'required maxlength="120"'), 'full')}
      ${field('Message', `<textarea name="body" required maxlength="2000">${esc(n?.body || '')}</textarea>`, 'full')}
      ${field('Who sees it', selectHtml('audience', [['all', 'All staff'], ['cmanager', 'Counter managers'], ['admin', 'Admins only']], n?.audience || 'all'))}
      ${field('Show until (optional)', inputHtml('expires_on', n?.expires_on || '', 'type="date"'))}
      <div class="full"><label class="check"><input type="checkbox" name="pinned"${n?.pinned ? ' checked' : ''} /> Pin to the top</label></div>
    </div>`,
    submitLabel: n ? 'Save' : 'Post notice',
    onSubmit: async (form, data) => {
      const payload = {
        title: data.title.trim(), body: data.body.trim(), audience: data.audience,
        expires_on: data.expires_on || '', pinned: Boolean(data.pinned), updated_at: serverTimestamp(),
      };
      if (n) {
        await updateDoc(doc(db, 'notices', id), payload);
        audit('update', 'notices', payload.title);
      } else {
        await setDoc(doc(collection(db, 'notices')), {
          ...payload, posted_by: state.user.id, posted_by_name: state.user.name, posted_on: dhakaNow().date, created_at: serverTimestamp(),
        });
        audit('create', 'notices', payload.title);
      }
      toast(n ? 'Notice saved.' : 'Notice posted.');
    },
  });
}

async function deleteNotice(id) {
  const n = state.notices.find(x => x.id === id);
  if (!n || !(await confirmAction(`Delete the notice “${n.title}”?`, { yes: 'Delete' }))) return;
  await deleteDoc(doc(db, 'notices', id));
  audit('delete', 'notices', n.title);
  toast('Notice deleted.');
}

/* =============================================================
   AUDIT LOG
   ============================================================= */
function renderAudit() {
  const q = $('#auditSearch').value.trim().toLowerCase();
  const action = $('#auditAction').value;
  const target = $('#auditTarget').value;
  const rows = state.audit.filter(a => (!action || a.action === action) && (!target || a.target === target)
    && (!q || `${a.actor_id} ${a.actor_name} ${a.subject} ${a.summary}`.toLowerCase().includes(q)));
  $('#auditCount').textContent = plural(rows.length, 'entry');
  const tone = { create: 'good', update: 'info', delete: 'bad', 'sign-in': 'violet' };
  $('#auditTable').innerHTML = rows.length ? `<table class="styled-table"><thead><tr>
      <th>When</th><th>Who</th><th>Action</th><th>What</th><th>Details</th>
    </tr></thead><tbody>${rows.map(a => `<tr>
      <td><small>${esc(fmtStamp(a.at))}</small></td>
      <td>${esc(a.actor_name || a.actor_id)}<br><small>${esc(a.actor_id)} · ${esc(ROLE_LABELS[a.actor_role] || a.actor_role || '')}</small></td>
      <td>${pill(ACTION_WORDS[a.action] || a.action, tone[a.action] || 'muted')}</td>
      <td>${esc(TARGET_WORDS[a.target] || a.target)} <b>${esc(a.subject)}</b></td>
      <td><small>${esc(a.summary || '')}</small></td>
    </tr>`).join('')}</tbody></table>`
    : '<p class="empty-note">No entries match.</p>';
}

/* =============================================================
   MY ACCOUNT
   ============================================================= */
function renderAccount() {
  const me = state.staff.find(u => u.id === state.user.id);
  $('#accId').value = state.user.id;
  $('#accRole').value = ROLE_LABELS[state.user.role];
  const form = $('#accountForm');
  if (!form.dataset.filled && me) {
    $('#accName').value = me.name || '';
    $('#accPhone').value = me.phone || '';
    $('#accEmail').value = me.email || '';
    form.dataset.filled = '1';
  }
  $('#accMeta').textContent = me ? `Account created ${fmtStamp(me.created_at)} · last sign-in ${fmtStamp(me.last_login_at)} · password changed ${fmtStamp(me.password_changed_at)}` : '';
}

function bindAccount() {
  $('#accountForm').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('#accName').value.trim();
    if (!name) return;
    try {
      await updateDoc(doc(db, STAFF, state.user.id), { name, phone: $('#accPhone').value.trim(), email: $('#accEmail').value.trim(), updated_at: serverTimestamp() });
      state.user.name = name;
      setAuditActor(state.user);
      saveSession();
      renderWho();
      audit('update', 'staff', state.user.id, 'Own details updated');
      toast('Your details are saved.');
    } catch (error) {
      toast(error.message || 'Could not save.', 'error');
    }
  });

  $('#passwordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const current = $('#pwCurrent').value;
    const next = $('#pwNew').value;
    if (next !== $('#pwConfirm').value) {
      toast('The two new passwords do not match.', 'error');
      return;
    }
    if (next.length < 6) {
      toast('Use at least 6 characters.', 'error');
      return;
    }
    try {
      const me = await getStaff(state.user.id);
      if (!(await checkPassword(me, current))) {
        toast('Your current password is not right.', 'error');
        return;
      }
      await updateDoc(doc(db, STAFF, state.user.id), { ...(await passwordFields(next)), updated_at: serverTimestamp() });
      audit('update', 'staff', state.user.id, 'Own password changed');
      event.target.reset();
      toast('Password changed.');
    } catch (error) {
      toast(error.message || 'Could not change the password.', 'error');
    }
  });
}

/* =============================================================
   Session, idle sign-out, clock
   ============================================================= */
function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: state.user.id, name: state.user.name, role: 'admin', loggedInAt: Date.now() }));
}

function goToLanding(reason = '') {
  try {
    if (reason) sessionStorage.setItem(SIGNIN_ERROR_KEY, reason);
  } catch (error) { /* nothing to pass on */ }
  window.location.replace('index.html');
}

function takeHandoff() {
  try {
    const handoff = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null');
    sessionStorage.removeItem(HANDOFF_KEY);
    if (!handoff || handoff.role !== 'admin' || !handoff.at || Date.now() - handoff.at > 120000) return null;
    return handoff;
  } catch (error) {
    return null;
  }
}

async function startSession() {
  const handoff = takeHandoff();
  if (handoff) {
    let result;
    try {
      result = await authenticate(handoff.userId, handoff.password, 'admin');
    } catch (error) {
      goToLanding('Could not reach the server to check your password. Try again.');
      return;
    }
    if (!result.ok) {
      goToLanding(result.reason);
      return;
    }
    state.user = result.user;
    saveSession();
    setAuditActor(state.user);
    audit('sign-in', 'staff', state.user.id, result.firstRun ? 'First sign-in; account moved into the user list' : '');
  } else {
    let session = null;
    try {
      session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch (error) {
      session = null;
    }
    if (!session?.userId) {
      goToLanding();
      return;
    }
    try {
      const record = await getStaff(session.userId);
      if (!record || record.active === false || record.role !== 'admin') {
        localStorage.removeItem(SESSION_KEY);
        goToLanding('Your admin access has ended. Sign in again.');
        return;
      }
      session.name = record.name || session.name;
    } catch (error) {
      /* offline: keep going with the stored session */
    }
    state.user = { id: session.userId, name: session.name || session.userId, role: 'admin' };
    setAuditActor(state.user);
  }

  document.body.dataset.roleName = state.user.name;
  renderWho();
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  startListeners();
  ensureSchedule(db);
  setActiveSection(location.hash.slice(1) || 'dashboard');
  watchIdle();
}

function renderWho() {
  $('#whoAmI').innerHTML = `<span class="who-avatar">${esc(state.user.name.slice(0, 1).toUpperCase())}</span><span><b>${esc(state.user.name)}</b><small>${esc(state.user.id)} · Admin</small></span>`;
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  window.location.replace('index.html');
}

/* After 30 quiet minutes: "Are you still there?", then sign out. */
function watchIdle() {
  let last = Date.now();
  let asking = false;
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(type => window.addEventListener(type, () => { last = Date.now(); }, { passive: true }));
  setInterval(async () => {
    if (asking || Date.now() - last < IDLE_MINUTES * 60000) return;
    asking = true;
    const timer = setTimeout(logout, 60000);
    const stay = await confirmAction('You have been away for a while. Stay signed in? You will be signed out in a minute.', { title: 'Are you still there?', yes: 'Stay signed in', danger: false });
    clearTimeout(timer);
    if (!stay) logout();
    last = Date.now();
    asking = false;
  }, 30000);
}

function tickClock() {
  $('#adminClock').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
}

/* =============================================================
   Wiring
   ============================================================= */
function bind() {
  $$('.sidebar-link').forEach(b => b.addEventListener('click', () => setActiveSection(b.dataset.section)));
  $('#adminLandingBtn').addEventListener('click', () => { window.location.href = 'index.html'; });
  $('#adminLogoutBtn').addEventListener('click', logout);

  // Filters redraw their own section.
  const redraw = section => () => { if (state.section === section) renderSection(section); };
  [['#tripSearch', 'trips'], ['#tripWhen', 'trips'], ['#tripDate', 'trips'], ['#tripRoute', 'trips'],
    ['#ticketSearch', 'tickets'], ['#ticketWhen', 'tickets'], ['#ticketPay', 'tickets'],
    ['#userSearch', 'users'], ['#userRole', 'users'], ['#paxSearch', 'passengers'],
    ['#reqSearch', 'requests'], ['#reqStatus', 'requests'],
    ['#auditSearch', 'audit'], ['#auditAction', 'audit'], ['#auditTarget', 'audit'],
  ].forEach(([sel, section]) => {
    const el = $(sel);
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', () => {
      state.tripsLimit = 60;
      state.ticketsLimit = 60;
      redraw(section)();
    });
  });

  $('#statsRange').addEventListener('click', event => {
    const b = event.target.closest('[data-range]');
    if (!b) return;
    state.statsRange = b.dataset.range;
    renderStats();
  });

  $('#newTripBtn').addEventListener('click', openTripCreate);
  $('#fillScheduleBtn').addEventListener('click', fillSchedule);
  $('#newTicketBtn').addEventListener('click', () => openTicketCreate());
  $('#newBusBtn').addEventListener('click', () => openBusForm());
  $('#newUserBtn').addEventListener('click', () => openUserForm());
  $('#newRequestBtn').addEventListener('click', () => openRequestForm());
  $('#newNoticeBtn').addEventListener('click', () => openNoticeForm());

  // One listener for every row button, anywhere (including inside the window).
  document.addEventListener('click', event => {
    const more = event.target.closest('[data-more]');
    if (more) {
      if (more.dataset.more === 'trips') state.tripsLimit += 60;
      if (more.dataset.more === 'tickets') state.ticketsLimit += 60;
      renderSection(state.section);
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    const run = {
      'trip-seats': () => openTripSeats(id),
      'trip-edit': () => openTripEdit(id),
      'trip-delete': () => deleteTrip(id),
      'ticket-new': () => { closeModal(); openTicketCreate(id); },
      'ticket-view': () => { if (modal.open) closeModal(); openTicketView(id); },
      'ticket-edit': () => openTicketEdit(id),
      'ticket-delete': () => cancelTicket(id),
      'ticket-print': () => printTicket(id),
      'bus-edit': () => openBusForm(id),
      'bus-delete': () => deleteBus(id),
      'bus-add-missing': () => openBusForm('', id),
      'user-edit': () => openUserForm(id),
      'user-reset': () => openUserReset(id),
      'user-toggle': () => toggleUser(id).catch(e => toast(e.message, 'error')),
      'user-delete': () => deleteUser(id).catch(e => toast(e.message, 'error')),
      'pax-view': () => openPassenger(id),
      'req-status': () => setRequestStatus(id, button.dataset.status).catch(e => toast(e.message, 'error')),
      'req-edit': () => openRequestForm(id),
      'req-delete': () => deleteRequest(id).catch(e => toast(e.message, 'error')),
      'notice-edit': () => openNoticeForm(id),
      'notice-delete': () => deleteNotice(id).catch(e => toast(e.message, 'error')),
    }[action];
    run?.();
  });

  window.addEventListener('hashchange', () => setActiveSection(location.hash.slice(1)));
  bindAccount();
  tickClock();
  setInterval(tickClock, 1000);
  // Times move on (departures, "Needs attention") even when data does not.
  setInterval(() => { if (state.section === 'dashboard') renderDashboard(); }, 60000);
}

bind();
startSession();
