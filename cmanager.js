import { db } from './firebase-init.js';
import { HANDOFF_KEY, SIGNIN_ERROR_KEY } from './accounts.js';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  increment,
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';

const CM_USER = 'CM1';
const CM_PASS = 'CD1';
const SESSION_KEY = 'btbms-cmanager-auth';
const DHAKA_TIME_ZONE = 'Asia/Dhaka';
const DEFAULT_SEATS = 28;

const state = {
  trips: [],
  bookings: [],
  requests: [],
  ticketFilter: '',
  loggedInUserId: '',
};

const els = {
  loginView: document.getElementById('loginView'),
  appView: document.getElementById('appView'),
  loginForm: document.getElementById('cmLoginForm'),
  loginMessage: document.getElementById('loginMessage'),
  cmClock: document.getElementById('cmClock'),
  dashboardSection: document.getElementById('dashboardSection'),
  tripsSection: document.getElementById('tripsSection'),
  ticketsSection: document.getElementById('ticketsSection'),
  requestsSection: document.getElementById('requestsSection'),
  todayTripsTable: document.getElementById('todayTripsTable'),
  tripsTableContainer: document.getElementById('tripsTableContainer'),
  ticketsTableContainer: document.getElementById('ticketsTableContainer'),
  requestsTableContainer: document.getElementById('requestsTableContainer'),
  metricTodayTrips: document.getElementById('metricTodayTrips'),
  metricCompletedTrips: document.getElementById('metricCompletedTrips'),
  metricBookedSeats: document.getElementById('metricBookedSeats'),
  metricAvailableSeats: document.getElementById('metricAvailableSeats'),
  metricEarnings: document.getElementById('metricEarnings'),
  metricRequests: document.getElementById('metricRequests'),
  todayTripsLabel: document.getElementById('todayTripsLabel'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(value) {
  return `BDT ${Number(value || 0).toFixed(2)}`;
}

function getDhakaDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DHAKA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const lookup = {};
  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = part.value;
  }

  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    time: `${lookup.hour}:${lookup.minute}:${lookup.second}`,
  };
}

function setMessage(id, message, type = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message || '';
  el.className = `message ${type}`.trim();
}

function setLoginMessage(message) {
  els.loginMessage.textContent = message || '';
}

function showLogin(reason) {
  // Signing in happens on the landing page now; send the person there,
  // with the reason when there is one.
  try {
    if (reason) sessionStorage.setItem(SIGNIN_ERROR_KEY, reason);
  } catch (error) {
    /* nothing to pass on */
  }
  window.location.replace('index.html');
}

// The sign-in handed over by the landing page, read once and cleared.
function takeHandoff(role) {
  let handoff = null;
  try {
    handoff = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null');
    sessionStorage.removeItem(HANDOFF_KEY);
  } catch (error) {
    return null;
  }
  if (!handoff || handoff.role !== role) return null;
  // A stale hand-off (older than two minutes) is not trusted.
  if (!handoff.at || Date.now() - handoff.at > 120000) return null;
  return handoff;
}

function showApp() {
  els.loginView.classList.add('hidden');
  els.appView.classList.remove('hidden');
}

function setActiveSection(sectionName) {
  const sections = {
    dashboard: els.dashboardSection,
    trips: els.tripsSection,
    tickets: els.ticketsSection,
    requests: els.requestsSection,
  };

  Object.values(sections).forEach(section => section.classList.remove('active'));
  sections[sectionName].classList.add('active');

  document.querySelectorAll('.sidebar-link').forEach(button => {
    button.classList.toggle('active', button.dataset.section === sectionName);
  });
}

function renderClock() {
  if (!els.cmClock) return;
  const now = new Intl.DateTimeFormat('en-GB', {
    timeZone: DHAKA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
  els.cmClock.textContent = now;
}

function getFareMap() {
  const map = new Map();
  for (const trip of state.trips) map.set(trip.trip_id, Number(trip.fare || 0));
  return map;
}

// ---------------- Dashboard ----------------
function renderDashboard() {
  const now = getDhakaDateTime();
  const fareMap = getFareMap();

  const todayTrips = state.trips
    .filter(trip => trip.travel_date === now.date)
    .sort((a, b) => String(a.departure_time || '').localeCompare(String(b.departure_time || '')));

  const completedTrips = todayTrips.filter(trip => String(trip.departure_time || '') <= now.time);
  const totalBookedSeats = state.bookings.length;
  const totalAvailableSeats = state.trips.reduce((sum, trip) => sum + Number(trip.available_seats || 0), 0);
  const totalEarnings = state.bookings.reduce((sum, booking) => sum + (fareMap.get(booking.trip_id) || 0), 0);

  els.metricTodayTrips.textContent = String(todayTrips.length);
  els.metricCompletedTrips.textContent = String(completedTrips.length);
  els.metricBookedSeats.textContent = String(totalBookedSeats);
  els.metricAvailableSeats.textContent = String(totalAvailableSeats);
  els.metricEarnings.textContent = formatMoney(totalEarnings);
  els.metricRequests.textContent = String(state.requests.length);
  els.todayTripsLabel.textContent = `Showing ${todayTrips.length} trip(s) for ${now.date}. Completed count is based on the current Dhaka time ${now.time}.`;

  if (!todayTrips.length) {
    els.todayTripsTable.innerHTML = '<p class="section-note">No trips scheduled today.</p>';
    return;
  }

  const rows = todayTrips.map(trip => {
    const status = String(trip.departure_time || '') <= now.time ? 'Completed' : 'Upcoming';
    return `
      <tr>
        <td>${escapeHtml(trip.trip_id)}</td>
        <td>${escapeHtml(trip.origin)}</td>
        <td>${escapeHtml(trip.destination)}</td>
        <td>${escapeHtml(trip.departure_time)}</td>
        <td>${escapeHtml(trip.arrival_time)}</td>
        <td>${escapeHtml(trip.bus_id)}</td>
        <td>${escapeHtml(trip.travel_date)}</td>
        <td>${escapeHtml(status)}</td>
        <td>${escapeHtml(trip.available_seats ?? 0)}</td>
      </tr>`;
  }).join('');

  els.todayTripsTable.innerHTML = `
    <table class="styled-table">
      <thead>
        <tr>
          <th>Trip ID</th><th>From</th><th>To</th><th>Departure</th><th>Arrival</th><th>Bus</th><th>Date</th><th>Status</th><th>Available Seats</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---------------- View Trips (read-only) ----------------
function renderTripsTable() {
  if (!state.trips.length) {
    els.tripsTableContainer.innerHTML = '<p class="section-note">No trips found.</p>';
    return;
  }

  const bookedByTrip = new Map();
  for (const booking of state.bookings) {
    bookedByTrip.set(booking.trip_id, (bookedByTrip.get(booking.trip_id) || 0) + 1);
  }

  const rows = state.trips.map(trip => `
    <tr>
      <td>${escapeHtml(trip.trip_id)}</td>
      <td>${escapeHtml(trip.bus_id)}</td>
      <td>${escapeHtml(trip.origin)}</td>
      <td>${escapeHtml(trip.destination)}</td>
      <td>${escapeHtml(trip.departure_time)}</td>
      <td>${escapeHtml(trip.arrival_time)}</td>
      <td>${escapeHtml(trip.travel_date)}</td>
      <td>${escapeHtml(trip.fare)}</td>
      <td>${escapeHtml(bookedByTrip.get(trip.trip_id) || 0)}</td>
      <td>${escapeHtml(trip.available_seats ?? 0)}</td>
    </tr>
  `).join('');

  els.tripsTableContainer.innerHTML = `
    <table class="styled-table">
      <thead>
        <tr>
          <th>Trip ID</th><th>Bus</th><th>From</th><th>To</th><th>Departure</th><th>Arrival</th><th>Date</th><th>Fare</th><th>Booked</th><th>Available</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function handleTripSearch(event) {
  event.preventDefault();
  const tripId = String(new FormData(event.target).get('trip_id') || '').trim();
  const trip = state.trips.find(item => item.trip_id === tripId);
  const resultEl = document.getElementById('tripSearchResult');

  if (!trip) {
    resultEl.innerHTML = `<p class="section-note">No trip found with ID "${escapeHtml(tripId)}".</p>`;
    return;
  }

  const booked = state.bookings.filter(b => b.trip_id === tripId).length;
  const capacity = Number(trip.total_seats ?? DEFAULT_SEATS);
  const remaining = Number(trip.available_seats ?? (capacity - booked));

  resultEl.innerHTML = `
    <div class="summary-item"><span class="k">Trip ID</span><span class="v">${escapeHtml(trip.trip_id)}</span></div>
    <div class="summary-item"><span class="k">Route</span><span class="v">${escapeHtml(trip.origin)} &rarr; ${escapeHtml(trip.destination)}</span></div>
    <div class="summary-item"><span class="k">Departure / Arrival</span><span class="v">${escapeHtml(trip.departure_time)} - ${escapeHtml(trip.arrival_time)}</span></div>
    <div class="summary-item"><span class="k">Booked Seats</span><span class="v">${booked}</span></div>
    <div class="summary-item"><span class="k">Available Seats</span><span class="v">${remaining}</span></div>
    <div class="summary-item"><span class="k">Fare</span><span class="v">${formatMoney(trip.fare)}</span></div>
  `;
}

// ---------------- Manage Tickets (full CRUD) ----------------
function renderTicketsTable() {
  const filter = state.ticketFilter.trim();
  const rows = filter
    ? state.bookings.filter(t => t.trip_id === filter)
    : state.bookings;

  document.getElementById('ticketsFilterLabel').textContent = filter
    ? `Showing tickets for Trip ID "${filter}".`
    : 'Showing all tickets.';

  if (!rows.length) {
    els.ticketsTableContainer.innerHTML = '<p class="section-note">No tickets found.</p>';
    return;
  }

  const html = rows.map(ticket => `
    <tr>
      <td>${escapeHtml(ticket.ticket_id || ticket.id)}</td>
      <td>${escapeHtml(ticket.trip_id)}</td>
      <td>${escapeHtml(ticket.seat_label)}</td>
      <td>${escapeHtml(ticket.passenger_name)}</td>
      <td>${escapeHtml(ticket.phone || ticket.contact_number)}</td>
      <td>${escapeHtml(ticket.email)}</td>
      <td>${escapeHtml(ticket.boarding_point)}</td>
      <td>${escapeHtml(ticket.dropping_point)}</td>
      <td>${escapeHtml(ticket.payment_method)}</td>
      <td>
        <button class="mini-btn alt" type="button" onclick="loadTicketToForm('${escapeHtml(ticket.ticket_id || ticket.id)}')">Edit</button>
        <button class="mini-btn danger" type="button" onclick="loadTicketDelete('${escapeHtml(ticket.ticket_id || ticket.id)}')">Delete</button>
      </td>
    </tr>
  `).join('');

  els.ticketsTableContainer.innerHTML = `
    <table class="styled-table">
      <thead>
        <tr>
          <th>Ticket ID</th><th>Trip ID</th><th>Seat</th><th>Passenger</th><th>Phone</th><th>Email</th><th>Boarding</th><th>Dropping</th><th>Payment</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>${html}</tbody>
    </table>`;
}

function loadTicketToForm(ticketId) {
  const ticket = state.bookings.find(item => (item.ticket_id || item.id) === ticketId);
  if (!ticket) return;
  setActiveSection('tickets');
  document.getElementById('ticketUpdateId').value = ticket.ticket_id || ticket.id || '';
  document.getElementById('ticketUpdateTripId').value = ticket.trip_id || '';
  document.getElementById('ticketUpdateSeat').value = ticket.seat_label || '';
  document.getElementById('ticketUpdatePassenger').value = ticket.passenger_name || '';
  document.getElementById('ticketUpdatePhone').value = ticket.phone || ticket.contact_number || '';
  document.getElementById('ticketUpdateEmail').value = ticket.email || '';
  document.getElementById('ticketUpdateBoarding').value = ticket.boarding_point || '';
  document.getElementById('ticketUpdateDropping').value = ticket.dropping_point || '';
  document.getElementById('ticketUpdatePayment').value = ticket.payment_method || 'Cash';
}

function loadTicketDelete(ticketId) {
  setActiveSection('tickets');
  document.getElementById('ticketDeleteId').value = ticketId;
}

async function handleTicketFetch(event) {
  event.preventDefault();
  const ticketId = String(new FormData(event.target).get('ticket_id') || '').trim();
  if (!ticketId) return;
  const ticket = state.bookings.find(item => (item.ticket_id || item.id) === ticketId);
  if (!ticket) {
    setMessage('ticketUpdateMsg', `Ticket ${ticketId} not found.`, 'error');
    return;
  }
  loadTicketToForm(ticketId);
  setMessage('ticketUpdateMsg', '', '');
}

async function handleTicketCreate(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const tripId = String(form.get('trip_id') || '').trim();
  const seatLabel = String(form.get('seat_label') || '').trim().toUpperCase();
  const ticketId = `${tripId}_${seatLabel}`;

  try {
    await runTransaction(db, async transaction => {
      const tripRef = doc(db, 'trips', tripId);
      const ticketRef = doc(db, 'bookings', ticketId);
      const tripSnap = await transaction.get(tripRef);
      if (!tripSnap.exists()) throw new Error('Trip not found.');

      const bookingSnap = await transaction.get(ticketRef);
      if (bookingSnap.exists()) throw new Error('That seat is already booked.');

      const availableSeats = Number(tripSnap.data().available_seats ?? DEFAULT_SEATS);
      if (availableSeats <= 0) throw new Error('No available seats remain for this trip.');

      transaction.set(ticketRef, {
        ticket_id: ticketId,
        trip_id: tripId,
        seat_label: seatLabel,
        passenger_name: String(form.get('passenger_name') || '').trim(),
        phone: String(form.get('phone') || '').trim(),
        email: String(form.get('email') || '').trim(),
        boarding_point: String(form.get('boarding_point') || '').trim(),
        dropping_point: String(form.get('dropping_point') || '').trim(),
        payment_method: String(form.get('payment_method') || '').trim(),
        booked_by: state.loggedInUserId || CM_USER,
        booking_time: serverTimestamp(),
      });
      transaction.update(tripRef, {
        available_seats: increment(-1),
        updated_at: serverTimestamp(),
      });
    });
    setMessage('ticketCreateMsg', `Ticket ${ticketId} created.`, 'success');
    event.target.reset();
  } catch (error) {
    setMessage('ticketCreateMsg', error.message || 'Failed to create ticket.', 'error');
  }
}

async function handleTicketUpdate(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const ticketId = String(form.get('ticket_id') || '').trim();
  if (!ticketId) return;

  try {
    await updateDoc(doc(db, 'bookings', ticketId), {
      passenger_name: String(form.get('passenger_name') || '').trim(),
      phone: String(form.get('phone') || '').trim(),
      email: String(form.get('email') || '').trim(),
      boarding_point: String(form.get('boarding_point') || '').trim(),
      dropping_point: String(form.get('dropping_point') || '').trim(),
      payment_method: String(form.get('payment_method') || '').trim(),
      updated_at: serverTimestamp(),
    });
    setMessage('ticketUpdateMsg', `Ticket ${ticketId} updated.`, 'success');
  } catch (error) {
    setMessage('ticketUpdateMsg', error.message || 'Failed to update ticket.', 'error');
  }
}

async function handleTicketDelete(event) {
  event.preventDefault();
  const ticketId = String(new FormData(event.target).get('ticket_id') || '').trim();
  if (!ticketId) return;
  if (!confirm(`Delete ticket ${ticketId}?`)) return;

  try {
    const ticketRef = doc(db, 'bookings', ticketId);
    const ticketSnap = await getDoc(ticketRef);
    if (!ticketSnap.exists()) throw new Error('Ticket not found.');

    const ticketData = ticketSnap.data();
    await runTransaction(db, async transaction => {
      const tripRef = doc(db, 'trips', ticketData.trip_id);
      const tripSnap = await transaction.get(tripRef);
      if (tripSnap.exists()) {
        transaction.update(tripRef, {
          available_seats: increment(1),
          updated_at: serverTimestamp(),
        });
      }
      transaction.delete(ticketRef);
    });

    setMessage('ticketDeleteMsg', `Ticket ${ticketId} deleted.`, 'success');
    event.target.reset();
  } catch (error) {
    setMessage('ticketDeleteMsg', error.message || 'Failed to delete ticket.', 'error');
  }
}

// ---------------- Create Requests ----------------
function renderRequestsTable() {
  if (!state.requests.length) {
    els.requestsTableContainer.innerHTML = '<p class="section-note">No requests found.</p>';
    return;
  }

  const sorted = [...state.requests].sort((a, b) => {
    const aTime = a.created_at?.toMillis ? a.created_at.toMillis() : 0;
    const bTime = b.created_at?.toMillis ? b.created_at.toMillis() : 0;
    return aTime - bTime;
  });

  const rows = sorted.map((request, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(request.subject)}</td>
      <td>${escapeHtml(request.requested_by)}</td>
      <td>${escapeHtml(request.status)}</td>
      <td>${escapeHtml(request.details)}</td>
    </tr>
  `).join('');

  els.requestsTableContainer.innerHTML = `
    <table class="styled-table">
      <thead>
        <tr>
          <th>#</th><th>Subject</th><th>Requested By</th><th>Status</th><th>Details</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function handleRequestCreate(event) {
  event.preventDefault();
  const form = new FormData(event.target);

  try {
    const ref = doc(collection(db, 'requests'));
    await setDoc(ref, {
      subject: String(form.get('subject') || '').trim(),
      requested_by: state.loggedInUserId || CM_USER,
      details: String(form.get('details') || '').trim(),
      status: 'Pending',
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      source: 'Counter Manager',
    });
    setMessage('requestCreateMsg', 'Request sent to Admin!', 'success');
    event.target.reset();
    document.getElementById('requestCreateRequestedBy').value = state.loggedInUserId || CM_USER;
  } catch (error) {
    setMessage('requestCreateMsg', error.message || 'Failed to send request.', 'error');
  }
}

// ---------------- Bindings ----------------
function bindForms() {
  document.getElementById('tripSearchForm').addEventListener('submit', handleTripSearch);
  document.getElementById('tripSearchResetBtn').addEventListener('click', () => {
    document.getElementById('tripSearchForm').reset();
    document.getElementById('tripSearchResult').innerHTML = '';
  });

  document.getElementById('ticketCreateForm').addEventListener('submit', handleTicketCreate);
  document.getElementById('ticketFetchForm').addEventListener('submit', handleTicketFetch);
  document.getElementById('ticketUpdateForm').addEventListener('submit', handleTicketUpdate);
  document.getElementById('ticketDeleteForm').addEventListener('submit', handleTicketDelete);
  document.getElementById('ticketUpdateClearBtn').addEventListener('click', () => {
    document.getElementById('ticketUpdateForm').reset();
  });
  document.getElementById('ticketDeleteClearBtn').addEventListener('click', () => {
    document.getElementById('ticketDeleteForm').reset();
  });

  document.getElementById('ticketFilterForm').addEventListener('submit', event => {
    event.preventDefault();
    state.ticketFilter = document.getElementById('ticketFilterInput').value.trim();
    renderTicketsTable();
  });
  document.getElementById('ticketFilterClearBtn').addEventListener('click', () => {
    document.getElementById('ticketFilterInput').value = '';
    state.ticketFilter = '';
    renderTicketsTable();
  });

  document.getElementById('requestCreateForm').addEventListener('submit', handleRequestCreate);
}

function bindLogin() {
  els.loginForm.addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const userId = String(form.get('userid') || '').trim();
    const password = String(form.get('password') || '').trim();

    if (userId === CM_USER && password === CM_PASS) {
      state.loggedInUserId = userId;
      localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, loggedInAt: Date.now() }));
      setLoginMessage('');
      document.getElementById('requestCreateRequestedBy').value = userId;
      showApp();
      setActiveSection('dashboard');
      return;
    }

    setLoginMessage('Invalid credentials. Use CM1 / CD1.');
  });
}

function bindNav() {
  document.querySelectorAll('.sidebar-link').forEach(button => {
    button.addEventListener('click', () => setActiveSection(button.dataset.section));
  });

  document.getElementById('cmHomeBtn').addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  document.getElementById('cmLandingBtn').addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  document.getElementById('cmLogoutBtn').addEventListener('click', () => {
    localStorage.removeItem(SESSION_KEY);
    state.loggedInUserId = '';
    showLogin();
  });
}

function bindRealtime() {
  onSnapshot(collection(db, 'trips'), snapshot => {
    state.trips = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    renderAll();
  }, error => console.error('Trips snapshot error', error));

  onSnapshot(collection(db, 'bookings'), snapshot => {
    state.bookings = snapshot.docs.map(docSnap => ({ id: docSnap.id, ticket_id: docSnap.id, ...docSnap.data() }));
    renderAll();
  }, error => console.error('Bookings snapshot error', error));

  onSnapshot(collection(db, 'requests'), snapshot => {
    state.requests = snapshot.docs
      .map(docSnap => ({ id: docSnap.id, request_id: docSnap.id, ...docSnap.data() }))
      .filter(request => request.source === 'Counter Manager' || request.requested_by === state.loggedInUserId);
    renderAll();
  }, error => console.error('Requests snapshot error', error));
}

function renderAll() {
  renderClock();
  renderDashboard();
  renderTripsTable();
  renderTicketsTable();
  renderRequestsTable();
}

function bootstrap() {
  bindLogin();
  bindNav();
  bindForms();
  bindRealtime();
  renderClock();
  setInterval(renderClock, 1000);
  setInterval(() => {
    if (!els.appView.classList.contains('hidden')) renderDashboard();
  }, 1000);

  const handoff = takeHandoff('cmanager');
  if (handoff) {
    if (handoff.userId === CM_USER && handoff.password === CM_PASS) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: handoff.userId, loggedInAt: Date.now() }));
    } else {
      showLogin('Wrong User ID or password.');
      return;
    }
  }

  const session = localStorage.getItem(SESSION_KEY);
  if (session) {
    try {
      const parsed = JSON.parse(session);
      state.loggedInUserId = parsed.userId || CM_USER;
    } catch (e) {
      state.loggedInUserId = CM_USER;
    }
    document.getElementById('requestCreateRequestedBy').value = state.loggedInUserId;
    showApp();
    setActiveSection('dashboard');
  } else {
    showLogin();
  }
}

window.loadTicketToForm = loadTicketToForm;
window.loadTicketDelete = loadTicketDelete;
window.showSection = setActiveSection;

bootstrap();