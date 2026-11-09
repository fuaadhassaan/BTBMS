/* =============================================================
   Console effects (Admin and Counter Manager)

   Everything here only watches what admin.js / cmanager.js already
   write and dresses it up. None of it changes data, and if this file
   failed to load, the consoles would still work exactly as before.
   ============================================================= */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = selector => document.querySelector(selector);

/* ---- greeting, in Dhaka time ---- */
function renderGreeting() {
  const el = $('#greeting');
  if (!el) return;
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', hour12: false }).format(now));
  const part = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  el.textContent = `${part}, ${document.body.dataset.roleName || 'there'} · ${day}`;
}

renderGreeting();
setInterval(renderGreeting, 60000);

/* =============================================================
   Numbers that count up to their new value

   The console writes the final value straight into each metric. This
   notices the change and animates from the old number to the new one.
   It remembers the text it wrote itself, so it never reacts to its
   own frames.
   ============================================================= */
const counters = new Map();

function parseValue(text) {
  const match = String(text).match(/-?[\d,]*\.?\d+/);
  if (!match) return null;
  const raw = match[0];
  return {
    pre: text.slice(0, match.index),
    post: text.slice(match.index + raw.length),
    num: parseFloat(raw.replace(/,/g, '')),
    decimals: (raw.split('.')[1] || '').length,
  };
}

const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

function animateCounter(el) {
  const state = counters.get(el);
  const text = el.textContent;
  if (text === state.written) return;

  const parsed = parseValue(text);
  if (!parsed) return;
  if (state.running && parsed.num === state.target) return;

  Object.assign(state, { pre: parsed.pre, post: parsed.post, decimals: parsed.decimals });
  const from = state.current;
  const to = parsed.num;
  state.target = to;
  onMetricChange();

  if (reduceMotion || from === to) {
    write(el, state, to);
    return;
  }

  const duration = 1100;
  const start = performance.now();
  state.running = true;
  cancelAnimationFrame(state.raf);

  const step = time => {
    const t = Math.min(1, (time - start) / duration);
    write(el, state, from + (to - from) * easeOutCubic(t));
    if (t < 1) {
      state.raf = requestAnimationFrame(step);
    } else {
      state.running = false;
      el.closest('.metric-card')?.classList.remove('is-updating');
      void el.offsetWidth;
      el.closest('.metric-card')?.classList.add('is-updating');
    }
  };
  state.raf = requestAnimationFrame(step);
}

function write(el, state, value) {
  state.current = value;
  // Keeps thousands separators (BDT 100,800.00) while counting.
  state.written = state.pre + value.toLocaleString('en-US', { minimumFractionDigits: state.decimals, maximumFractionDigits: state.decimals }) + state.post;
  el.textContent = state.written;
}

document.querySelectorAll('.metric-card .value').forEach(el => {
  counters.set(el, { current: 0, target: 0, written: null, running: false, raf: 0, pre: '', post: '', decimals: 0 });
  new MutationObserver(() => animateCounter(el)).observe(el, { childList: true, characterData: true, subtree: true });
  animateCounter(el);
});

/* =============================================================
   Seat occupancy ring
   ============================================================= */
function targetOf(id) {
  const el = document.getElementById(id);
  return el && counters.has(el) ? counters.get(el).target : 0;
}

function onMetricChange() {
  const ring = $('#occupancyRing');
  if (!ring) return;
  const booked = targetOf('metricBookedSeats');
  const free = targetOf('metricAvailableSeats');
  const total = booked + free;
  const pct = total ? Math.round((booked / total) * 100) : 0;

  ring.style.strokeDasharray = `${pct} 100`;
  /* A round line cap draws a dot even at zero length, so hide it at 0%. */
  ring.style.opacity = pct ? '1' : '0';
  $('#occupancyPct').textContent = `${pct}%`;
  $('#occBooked').textContent = booked.toLocaleString('en-US');
  $('#occFree').textContent = free.toLocaleString('en-US');
}

onMetricChange();

/* =============================================================
   Trip status pills in Today's Trips

   The table is rebuilt every second, so this runs on every rebuild
   and only touches cells it has not already dressed.
   ============================================================= */
const todayTable = $('#todayTripsTable');

function dressStatuses() {
  todayTable.querySelectorAll('td').forEach(cell => {
    if (cell.firstElementChild) return;
    const text = cell.textContent.trim();
    if (text === 'Completed' || text === 'Upcoming') {
      cell.innerHTML = `<span class="trip-status ${text.toLowerCase()}">${text}</span>`;
    }
  });
}

if (todayTable) {
  new MutationObserver(dressStatuses).observe(todayTable, { childList: true });
  dressStatuses();
}

/* ---- quick actions jump to a section ---- */
document.addEventListener('click', event => {
  const action = event.target.closest('[data-go]');
  if (!action || typeof window.showSection !== 'function') return;
  window.showSection(action.dataset.go);
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
});

/* ---- the light that follows the pointer across cards ---- */
if (!reduceMotion) {
  document.addEventListener('pointermove', event => {
    const card = event.target.closest?.('.card, .metric-card');
    if (!card) return;
    const box = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${event.clientX - box.left}px`);
    card.style.setProperty('--my', `${event.clientY - box.top}px`);
  }, { passive: true });
}
