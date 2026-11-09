import { db } from './firebase-init.js';
import { HANDOFF_KEY, SIGNIN_ERROR_KEY } from './accounts.js';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  writeBatch,
  increment,
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';

const ADMIN_USER = 'AD1';
const ADMIN_PASS = '141';
const SESSION_KEY = 'btbms-admin-auth';
const DUBAI_TIME_ZONE = 'Asia/Dhaka';
const DEFAULT_SEATS = 28;

const state = {
  trips: [],
  bookings: [],
  requests: [],
};

const els = {
  loginView: document.getElementById('loginView'),
  appView: document.getElementById('appView'),
  loginForm: document.getElementById('adminLoginForm'),
  loginMessage: document.getElementById('loginMessage'),
  adminClock: document.getElementById('adminClock'),
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
    timeZone: DUBAI_TIME_ZONE,
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
    if (part.type !== 'literal') {
      lookup[part.type] = part.value;
    }
  }

  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    time: `${lookup.hour}:${lookup.minute}:${lookup.second}`,
  };
}

function selectOptionValue(selectElement, value) {
  if (!selectElement) return;
  const normalized = String(value || '').trim().toLowerCase();
  let matched = false;
  Array.from(selectElement.options).forEach(option => {
    if (String(option.value || '').trim().toLowerCase() === normalized && normalized !== '') {
      option.selected = true;
      matched = true;
    }
  });
  if (!matched) {
    selectElement.value = '';
  }
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
  if (!els.adminClock) return;
  const now = new Intl.DateTimeFormat('en-GB', {
    timeZone: DUBAI_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
  els.adminClock.textContent = now;
}

function getFareMap() {
  const map = new Map();
  for (const trip of state.trips) {
    map.set(trip.trip_id, Number(trip.fare || 0));
  }
  return map;
}

function getSeatCountByTrip() {
  const map = new Map();
  for (const booking of state.bookings) {
    const count = map.get(booking.trip_id) || 0;
    map.set(booking.trip_id, count + 1);
  }
  return map;
}

function renderDashboard() {
  const now = getDhakaDateTime();
  const fareMap = getFareMap();
  const bookedCountByTrip = getSeatCountByTrip();

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
          <th>Trip ID</th>
          <th>From</th>
          <th>To</th>
          <th>Departure</th>
          <th>Arrival</th>
          <th>Bus</th>
          <th>Date</th>
          <th>Status</th>
          <th>Available Seats</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderTripsTable() {
  if (!state.trips.length) {
    els.tripsTableContainer.innerHTML = '<p class="section-note">No trips found.</p>';
    return;
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
      <td>${escapeHtml(trip.available_seats ?? 0)}</td>
      <td>
        <button class="mini-btn alt" type="button" onclick="loadTripToForm('${escapeHtml(trip.trip_id)}')">Edit</button>
        <button class="mini-btn danger" type="button" onclick="loadTripDelete('${escapeHtml(trip.trip_id)}')">Delete</button>
      </td>
    </tr>
  `).join('');

  els.tripsTableContainer.innerHTML = `
    <table class="styled-table">
      <thead>
        <tr>
          <th>Trip ID</th><th>Bus</th><th>From</th><th>To</th><th>Departure</th><th>Arrival</th><th>Date</th><th>Fare</th><th>Available Seats</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderTicketsTable() {
  if (!state.bookings.length) {
    els.ticketsTableContainer.innerHTML = '<p class="section-note">No tickets found.</p>';
    return;
  }

  const rows = state.bookings.map(ticket => `
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
      <tbody>${rows}</tbody>
    </table>`;
}

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

  const rows = sorted.map((request, index) => {
    const statusClass = String(request.status || 'Pending').toLowerCase();
    return `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(request.subject)}</td>
      <td>${escapeHtml(request.requested_by)}</td>
      <td><span class="status-pill ${statusClass}">${escapeHtml(request.status)}</span></td>
      <td>${escapeHtml(request.details)}</td>
      <td>
        <button class="mini-btn alt table-action" type="button" data-action="edit" data-entity="request" data-id="${escapeHtml(request.request_id || request.id)}">Edit</button>
        <button class="mini-btn danger table-action" type="button" data-action="delete" data-entity="request" data-id="${escapeHtml(request.request_id || request.id)}">Delete</button>
      </td>
    </tr>`;
  }).join('');

  els.requestsTableContainer.innerHTML = `
    <table class="styled-table">
      <thead>
        <tr>
          <th>#</th><th>Subject</th><th>Requested By</th><th>Status</th><th>Details</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function loadTripToForm(tripId) {
  const trip = state.trips.find(item => item.trip_id === tripId);
  if (!trip) return;
  setActiveSection('trips');
  document.getElementById('tripUpdateId').value = trip.trip_id;
  document.getElementById('tripUpdateBus').value = trip.bus_id || '';
  document.getElementById('tripUpdateOrigin').value = trip.origin || '';
  document.getElementById('tripUpdateDestination').value = trip.destination || '';
  document.getElementById('tripUpdateDeparture').value = trip.departure_time || '';
  document.getElementById('tripUpdateArrival').value = trip.arrival_time || '';
  document.getElementById('tripUpdateFare').value = trip.fare ?? '';
  document.getElementById('tripUpdateDate').value = trip.travel_date || '';
  document.getElementById('tripUpdateSeats').value = trip.available_seats ?? DEFAULT_SEATS;
}

function loadTripDelete(tripId) {
  setActiveSection('trips');
  document.getElementById('tripDeleteId').value = tripId;
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
  selectOptionValue(document.getElementById('ticketUpdateBoarding'), ticket.boarding_point);
  selectOptionValue(document.getElementById('ticketUpdateDropping'), ticket.dropping_point);
  selectOptionValue(document.getElementById('ticketUpdatePayment'), ticket.payment_method);
}

function loadTicketDelete(ticketId) {
  setActiveSection('tickets');
  document.getElementById('ticketDeleteId').value = ticketId;
}

function loadRequestToForm(requestId) {
  const request = state.requests.find(item => (item.request_id || item.id) === requestId);
  if (!request) return;
  setActiveSection('requests');
  document.getElementById('requestUpdateId').value = request.request_id || request.id || '';
  document.getElementById('requestUpdateSubject').value = request.subject || '';
  document.getElementById('requestUpdateRequestedBy').value = request.requested_by || '';
  document.getElementById('requestUpdateDetails').value = request.details || '';
  document.getElementById('requestUpdateStatus').value = request.status || 'Pending';
}

function loadRequestDelete(requestId) {
  setActiveSection('requests');
  document.getElementById('requestDeleteId').value = requestId;
}

async function handleTripCreate(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const tripId = String(form.get('trip_id') || '').trim();
  if (!tripId) return;

  try {
    await setDoc(doc(db, 'trips', tripId), {
      trip_id: tripId,
      bus_id: String(form.get('bus_id') || '').trim(),
      origin: String(form.get('origin') || '').trim(),
      destination: String(form.get('destination') || '').trim(),
      departure_time: String(form.get('departure_time') || '').trim(),
      arrival_time: String(form.get('arrival_time') || '').trim(),
      fare: Number(form.get('fare') || 0),
      travel_date: String(form.get('travel_date') || '').trim(),
      available_seats: Number(form.get('available_seats') || DEFAULT_SEATS),
      total_seats: Number(form.get('available_seats') || DEFAULT_SEATS),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    setMessage('tripCreateMsg', `Trip ${tripId} created.`, 'success');
    event.target.reset();
    document.getElementById('tripCreateSeats').value = DEFAULT_SEATS;
  } catch (error) {
    setMessage('tripCreateMsg', error.message || 'Failed to create trip.', 'error');
  }
}

async function handleTripUpdate(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const tripId = String(form.get('trip_id') || '').trim();
  if (!tripId) return;

  try {
    await updateDoc(doc(db, 'trips', tripId), {
      bus_id: String(form.get('bus_id') || '').trim(),
      origin: String(form.get('origin') || '').trim(),
      destination: String(form.get('destination') || '').trim(),
      departure_time: String(form.get('departure_time') || '').trim(),
      arrival_time: String(form.get('arrival_time') || '').trim(),
      fare: Number(form.get('fare') || 0),
      travel_date: String(form.get('travel_date') || '').trim(),
      updated_at: serverTimestamp(),
    });
    setMessage('tripUpdateMsg', `Trip ${tripId} updated.`, 'success');
  } catch (error) {
    setMessage('tripUpdateMsg', error.message || 'Failed to update trip.', 'error');
  }
}

async function handleTripDelete(event) {
  event.preventDefault();
  const tripId = String(new FormData(event.target).get('trip_id') || '').trim();
  if (!tripId) return;
  if (!confirm(`Delete trip ${tripId} and all related bookings?`)) return;

  try {
    const ticketSnapshot = await getDocs(query(collection(db, 'bookings'), where('trip_id', '==', tripId)));
    const batch = writeBatch(db);
    ticketSnapshot.forEach(ticketDoc => batch.delete(ticketDoc.ref));
    batch.delete(doc(db, 'trips', tripId));
    await batch.commit();
    setMessage('tripDeleteMsg', `Trip ${tripId} and related bookings deleted.`, 'success');
    event.target.reset();
  } catch (error) {
    setMessage('tripDeleteMsg', error.message || 'Failed to delete trip.', 'error');
  }
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
      if (!tripSnap.exists()) {
        throw new Error('Trip not found.');
      }
      const bookingSnap = await transaction.get(ticketRef);
      if (bookingSnap.exists()) {
        throw new Error('That seat is already booked.');
      }
      const availableSeats = Number(tripSnap.data().available_seats ?? DEFAULT_SEATS);
      if (availableSeats <= 0) {
        throw new Error('No available seats remain for this trip.');
      }

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
    if (!ticketSnap.exists()) {
      throw new Error('Ticket not found.');
    }

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

async function handleRequestCreate(event) {
  event.preventDefault();
  const form = new FormData(event.target);

  try {
    const ref = doc(collection(db, 'requests'));
    await setDoc(ref, {
      subject: String(form.get('subject') || '').trim(),
      requested_by: String(form.get('requested_by') || '').trim(),
      details: String(form.get('details') || '').trim(),
      status: String(form.get('status') || 'Pending').trim(),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      source: 'Admin',
    });
    setMessage('requestCreateMsg', `Request created.`, 'success');
    event.target.reset();
  } catch (error) {
    setMessage('requestCreateMsg', error.message || 'Failed to create request.', 'error');
  }
}

async function handleRequestUpdate(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const requestId = String(form.get('request_id') || '').trim();
  if (!requestId) return;

  try {
    await updateDoc(doc(db, 'requests', requestId), {
      subject: String(form.get('subject') || '').trim(),
      requested_by: String(form.get('requested_by') || '').trim(),
      details: String(form.get('details') || '').trim(),
      status: String(form.get('status') || 'Pending').trim(),
      updated_at: serverTimestamp(),
    });
    setMessage('requestUpdateMsg', `Request ${requestId} updated.`, 'success');
  } catch (error) {
    setMessage('requestUpdateMsg', error.message || 'Failed to update request.', 'error');
  }
}

async function handleRequestDelete(event) {
  event.preventDefault();
  const requestId = String(new FormData(event.target).get('request_id') || '').trim();
  if (!requestId) return;
  if (!confirm(`Delete request ${requestId}?`)) return;

  try {
    await deleteDoc(doc(db, 'requests', requestId));
    setMessage('requestDeleteMsg', `Request ${requestId} deleted.`, 'success');
    event.target.reset();
  } catch (error) {
    setMessage('requestDeleteMsg', error.message || 'Failed to delete request.', 'error');
  }
}

function bindForms() {
  document.getElementById('tripCreateForm').addEventListener('submit', handleTripCreate);
  document.getElementById('tripUpdateForm').addEventListener('submit', handleTripUpdate);
  document.getElementById('tripDeleteForm').addEventListener('submit', handleTripDelete);
  document.getElementById('tripUpdateClearBtn').addEventListener('click', () => {
    document.getElementById('tripUpdateForm').reset();
    document.getElementById('tripUpdateSeats').value = '';
  });
  document.getElementById('tripDeleteClearBtn').addEventListener('click', () => {
    document.getElementById('tripDeleteForm').reset();
  });

  document.getElementById('ticketCreateForm').addEventListener('submit', handleTicketCreate);
  document.getElementById('ticketUpdateForm').addEventListener('submit', handleTicketUpdate);
  document.getElementById('ticketDeleteForm').addEventListener('submit', handleTicketDelete);
  document.getElementById('ticketUpdateClearBtn').addEventListener('click', () => {
    document.getElementById('ticketUpdateForm').reset();
  });
  document.getElementById('ticketDeleteClearBtn').addEventListener('click', () => {
    document.getElementById('ticketDeleteForm').reset();
  });

  bindTableActions();

  document.getElementById('requestCreateForm').addEventListener('submit', handleRequestCreate);
  document.getElementById('requestUpdateForm').addEventListener('submit', handleRequestUpdate);
  document.getElementById('requestDeleteForm').addEventListener('submit', handleRequestDelete);
  document.getElementById('requestUpdateClearBtn').addEventListener('click', () => {
    document.getElementById('requestUpdateForm').reset();
  });
  document.getElementById('requestDeleteClearBtn').addEventListener('click', () => {
    document.getElementById('requestDeleteForm').reset();
  });
}

function bindTableActions() {
  const allTables = [
    els.tripsTableContainer,
    els.ticketsTableContainer,
    els.requestsTableContainer,
  ];

  allTables.forEach(container => {
    container.addEventListener('click', event => {
      const button = event.target.closest('button.table-action');
      if (!button) return;
      const action = button.dataset.action;
      const entity = button.dataset.entity;
      const id = button.dataset.id;
      if (!action || !entity || !id) return;

      if (action === 'edit') {
        if (entity === 'trip') loadTripToForm(id);
        if (entity === 'ticket') loadTicketToForm(id);
        if (entity === 'request') loadRequestToForm(id);
      }

      if (action === 'delete') {
        if (entity === 'trip') loadTripDelete(id);
        if (entity === 'ticket') loadTicketDelete(id);
        if (entity === 'request') loadRequestDelete(id);
      }
    });
  });
}

function bindLogin() {
  els.loginForm.addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const userId = String(form.get('userid') || '').trim();
    const password = String(form.get('password') || '').trim();

    if (userId === ADMIN_USER && password === ADMIN_PASS) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, loggedInAt: Date.now() }));
      setLoginMessage('');
      showApp();
      setActiveSection('dashboard');
      return;
    }

    setLoginMessage('Invalid credentials. Use AD1 / 141.');
  });
}

function bindNav() {
  document.querySelectorAll('.sidebar-link').forEach(button => {
    button.addEventListener('click', () => setActiveSection(button.dataset.section));
  });

  document.getElementById('adminHomeBtn').addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  document.getElementById('adminLandingBtn').addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  document.getElementById('adminLogoutBtn').addEventListener('click', () => {
    localStorage.removeItem(SESSION_KEY);
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
    state.requests = snapshot.docs.map(docSnap => ({ id: docSnap.id, request_id: docSnap.id, ...docSnap.data() }));
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
    if (!els.appView.classList.contains('hidden')) {
      renderDashboard();
    }
  }, 1000);

  const handoff = takeHandoff('admin');
  if (handoff) {
    if (handoff.userId === ADMIN_USER && handoff.password === ADMIN_PASS) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: handoff.userId, loggedInAt: Date.now() }));
    } else {
      showLogin('Wrong User ID or password.');
      return;
    }
  }

  const session = localStorage.getItem(SESSION_KEY);
  if (session) {
    showApp();
    setActiveSection('dashboard');
  } else {
    showLogin();
  }
}

window.loadTripToForm = loadTripToForm;
window.loadTripDelete = loadTripDelete;
window.loadTicketToForm = loadTicketToForm;
window.loadTicketDelete = loadTicketDelete;
window.loadRequestToForm = loadRequestToForm;
window.loadRequestDelete = loadRequestDelete;
window.showSection = setActiveSection;

bootstrap();
