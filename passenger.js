/* =============================================================
   DTicket passenger pages (no sign-in)

   Shared: the Dhaka clock, the dark/light switch, the top bar's glass
   and the refresh button. Then one block per page; each page says
   which it is with <body data-page="...">:
     search  - ticket-booking.html
     results - trip-results.html
     seats   - seat-selection.html
     policy  - policy.html
   Styles: passenger.css.
   ============================================================= */

import {
  db, bookingWindow, ensureSchedule, BOOKING_WINDOW_DAYS, inWindow, hasDeparted, dhakaNow,
  shortTime, CANCELLATION_TIERS, POLICY_SHORT, POLICY_POINTS, formatBdt,
} from './database.js';
import {
  collection, onSnapshot, query, where, doc, getDoc, getDocs, setDoc, updateDoc, increment,
  runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';

/* =============================================================
   Shared by every passenger page
   ============================================================= */
(() => {
  const THEME_KEY = 'btbms-theme';

  /* ---- clock ---- */
  const clock = document.getElementById('clock');
  if (clock) {
    const format = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const tick = () => { clock.textContent = format.format(new Date()); };
    tick();
    setInterval(tick, 1000);
  }

  /* ---- theme (the same key as the landing page) ---- */
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
      /* private window: applies here, just not remembered */
    }
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });

  applyTheme(document.documentElement.getAttribute('data-theme'));

  /* ---- top bar turns to glass once the page moves ---- */
  const topbar = document.querySelector('.topbar');
  if (topbar) {
    const mark = () => topbar.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', mark, { passive: true });
    mark();
  }
})();

/* The refresh button (left of the clock): spin, then reload. The local
   database cache makes the reload near-instant. */
document.addEventListener('click', event => {
  const button = event.target.closest('[data-refresh]');
  if (!button) return;
  button.classList.add('spinning');
  button.disabled = true;
  setTimeout(() => window.location.reload(), 250);
});

const PAGES = {
  /* ---------------- Search (ticket-booking.html) ---------------- */
  search: async () => {
    const fromEl = document.getElementById('from');
    const toEl = document.getElementById('to');
    const dateEl = document.getElementById('travel_date');

    // Tickets are on sale from today to 13 days ahead, in Dhaka time.
    // The limits follow the clock: at midnight today drops off and a
    // new day opens, even if the page was left open.
    function applyWindow() {
      const { first, last } = bookingWindow();
      dateEl.min = first;
      dateEl.max = last;
      if (!dateEl.value || dateEl.value < first || dateEl.value > last) dateEl.value = first;
      dateEl.title = `Tickets are on sale for the next ${BOOKING_WINDOW_DAYS} days`;
    }
    applyWindow();
    setInterval(applyWindow, 30000);

    // Make sure the next two weeks of trips exist (usually one read).
    ensureSchedule(db);

    // Results are filtered on the next page (Vercel cannot run the old PHP search).
    document.getElementById('searchForm').addEventListener('submit', event => {
      event.preventDefault();
      if (fromEl.value && fromEl.value === toEl.value) {
        toEl.setCustomValidity('Pick a destination different from the origin.');
        toEl.reportValidity();
        return;
      }
      const params = new URLSearchParams({ from: fromEl.value, to: toEl.value, date: dateEl.value });
      window.location.href = 'trip-results.html?' + params.toString();
    });

    toEl.addEventListener('change', () => toEl.setCustomValidity(''));
    fromEl.addEventListener('change', () => toEl.setCustomValidity(''));

    const swapBtn = document.getElementById('swapBtn');
    swapBtn.addEventListener('click', () => {
      [fromEl.value, toEl.value] = [toEl.value, fromEl.value];
      swapBtn.classList.toggle('spin');
    });

    // Popular routes fill both ends at once.
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        fromEl.value = chip.dataset.from;
        toEl.value = chip.dataset.to;
        toEl.setCustomValidity('');
        dateEl.focus();
      });
    });
  },

  /* ---------------- Results (trip-results.html) ---------------- */
  results: async () => {
    const params = new URLSearchParams(window.location.search);
    const from = (params.get('from') || '').toLowerCase();
    const to = (params.get('to') || '').toLowerCase();
    const date = params.get('date') || '';
    const container = document.getElementById('resultsContainer');

    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));

    const busIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM18 11H6V6h12z"/></svg>';
    const arrowIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>';

    // Heading: "Dhaka → Sylhet", with the date in its own chip.
    const fromLabel = params.get('from') || 'Anywhere';
    const toLabel = params.get('to') || 'Anywhere';
    document.getElementById('resultsHeading').innerHTML =
      `${escapeHtml(fromLabel)} ${arrowIcon} ${escapeHtml(toLabel)}`;
    if (date) {
      const chip = document.getElementById('resultsDate');
      const pretty = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(date + 'T00:00:00Z'));
      chip.querySelector('span').textContent = pretty;
      chip.hidden = false;
    }

    // Only the booking window is on sale; anything else is filtered out.
    function matchesSearch(trip) {
      const okFrom = !from || (trip.origin || '').toLowerCase() === from;
      const okTo = !to || (trip.destination || '').toLowerCase() === to;
      const okDate = !date || (trip.travel_date || '') === date;
      return okFrom && okTo && okDate && inWindow(trip.travel_date, bookingWindow());
    }

    function emptyState(title, text) {
      container.innerHTML = `
        <div class="glass empty">
          ${busIcon}
          <h3>${title}</h3>
          <p>${text}</p>
          <a class="btn" href="ticket-booking.html">Change search</a>
        </div>`;
    }

    function renderTrips(trips) {
      if (!trips.length) {
        emptyState('No trips on this date', 'Try another date or route &mdash; new trips are added regularly.');
        return;
      }

      const now = dhakaNow();
      container.innerHTML = trips.map((t, i) => {
        const seats = Number(t.available_seats || 0);
        const departed = hasDeparted(t, now);
        const closed = departed || seats === 0;
        const seatClass = departed || seats === 0 ? 'seats-none' : seats <= 5 ? 'seats-low' : 'seats-ok';
        const seatText = departed ? 'Departed' : seats === 0 ? 'Sold out' : `${seats} seat${seats === 1 ? '' : 's'} left`;
        return `
          <article class="glass trip-card${closed ? ' is-closed' : ''}" style="--i: ${i}">
            <div class="trip-times">
              <div><strong>${escapeHtml(shortTime(t.departure_time))}</strong><span>${escapeHtml(t.origin)}</span></div>
              <div class="trip-line">${busIcon}</div>
              <div class="end"><strong>${escapeHtml(shortTime(t.arrival_time))}</strong><span>${escapeHtml(t.destination)}</span></div>
            </div>
            <div class="trip-meta">
              <span class="tag">Trip ${escapeHtml(t.trip_id)}</span>
              <span class="tag">Bus ${escapeHtml(t.bus_id)}</span>
              <span class="tag">${escapeHtml(t.travel_date)}</span>
              <span class="tag ${seatClass}">${seatText}</span>
            </div>
            <div class="trip-buy">
              <div class="fare"><small>Fare</small><strong>BDT ${Number(t.fare || 0).toFixed(2)}</strong></div>
              <button class="btn" type="button" ${closed ? 'disabled' : ''} data-trip="${escapeHtml(t.trip_id)}">Select seats ${arrowIcon}</button>
            </div>
          </article>`;
      }).join('');
    }

    window.selectTrip = function selectTrip(tripId) {
      window.location.href = `seat-selection.html?trip_id=${encodeURIComponent(tripId)}`;
    };

    container.addEventListener('click', event => {
      const button = event.target.closest('[data-trip]');
      if (button && !button.disabled) window.selectTrip(button.dataset.trip);
    });

    const windowNow = bookingWindow();
    if (date && !inWindow(date, windowNow)) {
      // A date before today, or more than two weeks out.
      emptyState(
        date < windowNow.first ? 'That date has passed' : 'Not on sale yet',
        `Tickets are sold for today and the next ${BOOKING_WINDOW_DAYS - 1} days only.`
      );
    } else {
      // Make sure the window's trips exist, then listen to just the
      // searched date (or the whole window when no date was given).
      ensureSchedule(db);
      const tripsQuery = date
        ? query(collection(db, 'trips'), where('travel_date', '==', date))
        : query(collection(db, 'trips'), where('travel_date', '>=', windowNow.first), where('travel_date', '<=', windowNow.last));

      let latest = null;
      onSnapshot(tripsQuery, snapshot => {
        const trips = [];
        snapshot.forEach(docSnap => {
          const trip = docSnap.data();
          if (matchesSearch(trip)) trips.push(trip);
        });
        trips.sort((a, b) => String(a.travel_date).localeCompare(String(b.travel_date))
          || String(a.departure_time).localeCompare(String(b.departure_time))
          || String(a.trip_id).localeCompare(String(b.trip_id)));
        latest = trips;
        renderTrips(trips);
      }, error => {
        console.error(error);
        emptyState('Trips could not be loaded', 'Please check your connection and try again in a moment.');
      });

      // A bus that leaves while the page is open turns to "Departed".
      setInterval(() => { if (latest) renderTrips(latest.filter(matchesSearch)); }, 60000);
    }
  },

  /* ---------------- Seats, payment and ticket (seat-selection.html) ---------------- */
  seats: async () => {
    // The policy box lists the refund tiers straight from config.js.
    document.getElementById('policyTierList').innerHTML = CANCELLATION_TIERS
      .map(t => `<li><b>${t.refundPercent ? `${t.refundPercent}% refund` : 'No refund'}</b>: ${t.label.charAt(0).toLowerCase()}${t.label.slice(1)}</li>`)
      .join('');

    // Without a trip there is nothing to book: back to the search.
    const tripId = new URLSearchParams(window.location.search).get('trip_id') || '';
    if (!tripId) {
      window.location.replace('ticket-booking.html');
      await new Promise(() => {}); // stop here; the page is leaving
    }
    const seatsContainer = document.getElementById('seats');
    const passengerList = document.getElementById('passengerList');
    const selCount = document.getElementById('selCount');
    const submitBtn = document.getElementById('submitBtn');
    const statusEl = document.getElementById('status');
    const tripMeta = document.getElementById('tripMeta');
    const receiptCard = document.getElementById('receiptCard');
    const receiptBody = document.getElementById('receiptBody');
    const printBtn = document.getElementById('printBtn');
    const totalCostEl = document.getElementById('totalCost');
    const maxSeats = 4;
    const selectedSeats = [];
    const seatButtons = new Map();
    let bookedSeats = new Set();
    let totalAvailableSeats = null;
    let tripDocData = null;
    let bookingsUnsub = null;
    let lastBookingReceipt = null;
    // Why this trip cannot be booked ('' while it can): it has left,
    // it is outside the two-week window, or it does not exist.
    let tripClosed = '';
    const totalSeats = 28;

    tripMeta.textContent = `Trip ${tripId}`;

    function buildSeats() {
      seatsContainer.innerHTML = '';
      const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

      for (const row of rows) {
        const rowEl = document.createElement('div');
        rowEl.className = 'seat-row';
        rowEl.appendChild(createSeat(row + '1'));
        const gap = document.createElement('div');
        gap.className = 'seat gap';
        rowEl.appendChild(gap);
        rowEl.appendChild(createSeat(row + '2'));
        rowEl.appendChild(createSeat(row + '3'));
        seatsContainer.appendChild(rowEl);
      }

      const rowI = document.createElement('div');
      rowI.className = 'seat-row';
      rowI.appendChild(createSeat('I1'));
      rowI.appendChild(createSeat('I2'));
      rowI.appendChild(createSeat('I3'));
      rowI.appendChild(createSeat('I4'));
      seatsContainer.appendChild(rowI);
    }

    function createSeat(label) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'seat';
      button.textContent = label;
      button.dataset.label = label;
      button.addEventListener('click', () => toggleSeat(label));
      seatButtons.set(label, button);
      return button;
    }

    function getTicketPrice() {
      return Number(tripDocData?.fare ?? 0);
    }

    function updateTotalCostDisplay() {
      if (!totalCostEl) return;
      const total = getTicketPrice() * selectedSeats.length;
      totalCostEl.textContent = `BDT ${total.toFixed(2)}`;
    }

    function syncSeatStyles() {
      for (const [label, button] of seatButtons.entries()) {
        button.classList.toggle('selected', selectedSeats.includes(label));
        button.classList.toggle('booked', bookedSeats.has(label));
        const unselectable = bookedSeats.has(label) || (selectedSeats.length >= maxSeats && !selectedSeats.includes(label));
        button.disabled = bookedSeats.has(label) || unselectable || Boolean(tripClosed);
      }
      selCount.textContent = String(selectedSeats.length);
      submitBtn.disabled = selectedSeats.length === 0 || Boolean(tripClosed);
      updateTotalCostDisplay();
    }

    function toggleSeat(label) {
      if (bookedSeats.has(label)) return;
      const index = selectedSeats.indexOf(label);
      if (index >= 0) {
        selectedSeats.splice(index, 1);
      } else {
        if (selectedSeats.length >= maxSeats) {
          setStatus(`You can select up to ${maxSeats} seats at a time.`, true);
          return;
        }
        selectedSeats.push(label);
      }
      renderPassengerFields();
      syncSeatStyles();
    }

    function renderPassengerFields() {
      passengerList.innerHTML = '';
      selectedSeats.forEach((seatLabel, index) => {
        const card = document.createElement('div');
        card.className = 'passenger-card';
        card.innerHTML = `
          <h3>Passenger ${index + 1} - Seat ${seatLabel}</h3>
          <div class="field">
            <label for="passengerName${index}">Passenger ${index + 1} Name</label>
            <input id="passengerName${index}" name="passengerName${index}" type="text" placeholder="Passenger ${index + 1}" required />
          </div>
        `;
        passengerList.appendChild(card);
      });
    }

    function setStatus(message, isError = false) {
      statusEl.textContent = message;
      statusEl.classList.toggle('error', isError);
    }

    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));

    function renderReceipt(receipt) {
      if (!receipt) {
        receiptCard.style.display = 'none';
        receiptBody.innerHTML = '';
        printBtn.style.display = 'none';
        return;
      }

      receiptBody.innerHTML = `
        <div class="receipt-row"><strong>Trip ID</strong><span>${escapeHtml(receipt.tripId)}</span></div>
        <div class="receipt-row"><strong>Route</strong><span>${escapeHtml(receipt.route)}</span></div>
        <div class="receipt-row"><strong>Departure</strong><span>${escapeHtml(receipt.busTime)}</span></div>
        <div class="receipt-row"><strong>Price</strong><span>${escapeHtml(receipt.pricePerTicket)}</span></div>
        <div class="receipt-row"><strong>Total Price</strong><span>${escapeHtml(receipt.totalPrice)}</span></div>
        <div class="receipt-row"><strong>Total Seats</strong><span>${escapeHtml(receipt.totalSeats)}</span></div>
        <div class="receipt-row"><strong>Seats</strong><span>${escapeHtml(receipt.seats.join(', '))}</span></div>
        <div class="receipt-row"><strong>Passengers</strong><span>${escapeHtml(receipt.passengers.join(', '))}</span></div>
        <div class="receipt-row"><strong>Email</strong><span>${escapeHtml(receipt.email)}</span></div>
        <div class="receipt-row"><strong>Contact</strong><span>${escapeHtml(receipt.contact)}</span></div>
        <div class="receipt-row"><strong>Payment</strong><span>${escapeHtml(receipt.paymentMethod)}</span></div>
      `;
      document.getElementById('ticketPolicy').textContent = `Cancellation: ${POLICY_SHORT} Cancel at any DTicket counter with this ticket ID.`;
      document.getElementById('ticketIssued').textContent = `Issued ${new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date())} (Dhaka)`;
      receiptCard.style.display = 'block';
      printBtn.style.display = 'inline-flex';
    }

    function formatClock(date) {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dhaka',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(date);
    }

    function startClock() {
      const clock = document.getElementById('clock');
      const tick = () => { clock.textContent = formatClock(new Date()); };
      tick();
      window.setInterval(tick, 1000);
    }

    function renderTripMeta() {
      if (!tripDocData) return;
      const t = tripDocData;
      tripMeta.textContent = `Trip ${tripId} · ${t.origin || 'Unknown'} to ${t.destination || 'Unknown'} · ${t.travel_date || ''} ${shortTime(t.departure_time)} · Seats left: ${t.available_seats ?? 0}`;
    }

    function closeTrip(reason) {
      if (tripClosed === reason) return;
      tripClosed = reason;
      selectedSeats.length = 0;
      renderPassengerFields();
      syncSeatStyles();
      setStatus(reason, true);
    }

    /* Applies a trip snapshot: seats left, price, and whether it can
       still be booked. Used by the live listener and by the fresh read
       made at the moment of booking. */
    function applyTripSnapshot(snap) {
        if (snap.exists()) {
          tripDocData = snap.data();
          const available = Number(tripDocData.available_seats ?? 0);
          totalAvailableSeats = available;
          renderTripMeta();
          updateTotalCostDisplay();
          if (hasDeparted(tripDocData)) {
            closeTrip('This bus has already departed. Please choose another trip.');
          } else if (!inWindow(tripDocData.travel_date, bookingWindow())) {
            closeTrip(`Tickets are sold for today and the next ${BOOKING_WINDOW_DAYS - 1} days only.`);
          }
        } else {
          closeTrip('This trip could not be found. Please search again.');
        }
    }

    // A fresh read from the server (used right before booking).
    async function loadTripMeta() {
      try {
        applyTripSnapshot(await getDoc(doc(db, 'trips', tripId)));
      } catch (error) {
        console.error('Trip load failed', error);
      }
    }

    // Seats left, fare and times update the moment anyone changes them.
    function listenTrip() {
      onSnapshot(doc(db, 'trips', tripId), applyTripSnapshot, error => {
        console.error('Trip listener failed', error);
        loadTripMeta();
      });
    }

    function listenBookings() {
      const bookingsQuery = query(collection(db, 'bookings'), where('trip_id', '==', tripId));
      bookingsUnsub = onSnapshot(bookingsQuery, snap => {
        bookedSeats = new Set();
        snap.forEach(docSnap => {
          const data = docSnap.data();
          if (data && data.seat_label) bookedSeats.add(data.seat_label);
        });
        let lostSeat = false;
        for (let i = selectedSeats.length - 1; i >= 0; i -= 1) {
          if (bookedSeats.has(selectedSeats[i])) {
            selectedSeats.splice(i, 1);
            lostSeat = true;
          }
        }
        // Rebuild the name fields only when one of our seats was taken,
        // so names already typed are not wiped by someone else's booking.
        if (lostSeat) renderPassengerFields();
        syncSeatStyles();
        renderTripMeta();
      }, error => {
        console.error('Booking listener failed', error);
        setStatus('Live updates could not be loaded. Refresh to retry.', true);
      });
    }

    async function refreshAvailability() {
      const button = document.getElementById('refreshBtn');
      button.classList.add('spinning');
      setTimeout(() => button.classList.remove('spinning'), 700);
      setStatus('Refreshing seat availability...');
      await loadTripMeta();
      renderPassengerFields();
      syncSeatStyles();
      setStatus('Availability refreshed.');
    }

    /* =============================================================
       Payment details

       bKash asks for the bKash number; Card asks for number, expiry
       and CVC. Everything is checked here, but only a masked summary
       is saved with the booking ("bKash 019*****432", "Visa •••• 4242"):
       bookings are readable by the seat map, so full card numbers and
       the CVC never leave this page.
       ============================================================= */
    const paymentSelect = document.getElementById('paymentMethod');
    const bkashPanel = document.getElementById('bkashFields');
    const cardPanel = document.getElementById('cardFields');
    const bkashInput = document.getElementById('bkashNumber');
    const cardNumberInput = document.getElementById('cardNumber');
    const cardExpiryInput = document.getElementById('cardExpiry');
    const cardCvcInput = document.getElementById('cardCvc');
    const cardBrandEl = document.getElementById('cardBrand');
    const PAYMENT_LABELS = { cash: 'Cash', bkash: 'bKash', card: 'Card' };

    const digitsOnly = value => String(value || '').replace(/\D/g, '');

    function cardBrand(digits) {
      if (/^3[47]/.test(digits)) return 'Amex';
      if (/^4/.test(digits)) return 'Visa';
      if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
      return '';
    }

    // The checksum every real card number satisfies (catches typos).
    function luhnValid(digits) {
      let sum = 0;
      for (let i = 0; i < digits.length; i += 1) {
        let d = Number(digits[digits.length - 1 - i]);
        if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
        sum += d;
      }
      return digits.length >= 13 && sum % 10 === 0;
    }

    function showPaymentPanel() {
      const method = paymentSelect.value;
      bkashPanel.hidden = method !== 'bkash';
      cardPanel.hidden = method !== 'card';
      // Required only while visible, so hidden fields never block the form.
      bkashInput.required = method === 'bkash';
      [cardNumberInput, cardExpiryInput, cardCvcInput].forEach(input => { input.required = method === 'card'; });
      [bkashInput, cardNumberInput, cardExpiryInput, cardCvcInput].forEach(input => input.setCustomValidity(''));
    }

    paymentSelect.addEventListener('change', showPaymentPanel);

    // A payment error goes away as soon as the field is being fixed
    // (a "trip closed" notice stays).
    [paymentSelect, bkashInput, cardNumberInput, cardExpiryInput, cardCvcInput].forEach(input => {
      input.addEventListener('input', () => {
        if (!tripClosed && statusEl.classList.contains('error')) setStatus('');
      });
    });

    bkashInput.addEventListener('input', () => {
      bkashInput.value = digitsOnly(bkashInput.value).slice(0, 11);
      bkashInput.setCustomValidity('');
    });

    // 4242 4242 4242 4242 (Amex: 3782 822463 10005), with the brand shown.
    cardNumberInput.addEventListener('input', () => {
      const digits = digitsOnly(cardNumberInput.value).slice(0, 19);
      const brand = cardBrand(digits);
      cardNumberInput.value = brand === 'Amex'
        ? [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)].filter(Boolean).join(' ')
        : digits.replace(/(\d{4})(?=\d)/g, '$1 ');
      cardBrandEl.textContent = brand;
      cardBrandEl.dataset.brand = brand.toLowerCase();
      cardCvcInput.maxLength = brand === 'Amex' ? 4 : 3;
      cardNumberInput.setCustomValidity('');
    });

    // MM/YY, with the slash put in as you type.
    cardExpiryInput.addEventListener('input', event => {
      let digits = digitsOnly(cardExpiryInput.value).slice(0, 4);
      // "4" means April (04); "13..." means January then the year (01/3...).
      if (digits.length === 1 && Number(digits) > 1) digits = `0${digits}`;
      if (digits.length >= 2 && Number(digits.slice(0, 2)) > 12) digits = `0${digits}`.slice(0, 4);
      const deleting = event.inputType && event.inputType.startsWith('delete');
      cardExpiryInput.value = digits.length > 2 || (digits.length === 2 && !deleting) ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
      cardExpiryInput.setCustomValidity('');
    });

    cardCvcInput.addEventListener('input', () => {
      cardCvcInput.value = digitsOnly(cardCvcInput.value).slice(0, cardCvcInput.maxLength);
      cardCvcInput.setCustomValidity('');
    });

    function fail(input, message) {
      input.setCustomValidity(message);
      input.reportValidity();
      input.focus();
      setStatus(message, true);
      return null;
    }

    /* Checks the details for the chosen method. Returns the masked
       summary to save ('' for cash), or null if something is wrong. */
    function paymentInfo(method) {
      if (method === 'cash') return '';

      if (method === 'bkash') {
        const number = digitsOnly(bkashInput.value);
        if (!/^01[3-9]\d{8}$/.test(number)) return fail(bkashInput, 'Enter a valid 11-digit bKash number (01XXXXXXXXX).');
        return `bKash ${number.slice(0, 3)}*****${number.slice(-3)}`;
      }

      if (method === 'card') {
        const digits = digitsOnly(cardNumberInput.value);
        const brand = cardBrand(digits);
        if (!brand) return fail(cardNumberInput, 'We accept Visa, Mastercard and American Express cards.');
        if (!luhnValid(digits) || digits.length !== (brand === 'Amex' ? 15 : 16)) return fail(cardNumberInput, 'That card number is not valid. Please check it.');

        const [mm, yy] = cardExpiryInput.value.split('/');
        const month = Number(mm);
        if (!/^\d{2}\/\d{2}$/.test(cardExpiryInput.value) || month < 1 || month > 12) return fail(cardExpiryInput, 'Enter the expiry date as MM/YY.');
        const now = dhakaNow().date; // YYYY-MM-DD
        const expiry = `20${yy}-${mm}`;
        if (expiry < now.slice(0, 7)) return fail(cardExpiryInput, 'This card has expired.');

        const cvcLength = brand === 'Amex' ? 4 : 3;
        if (digitsOnly(cardCvcInput.value).length !== cvcLength) return fail(cardCvcInput, `Enter the ${cvcLength}-digit CVC from your card.`);

        return `${brand} •••• ${digits.slice(-4)} (exp ${mm}/${yy})`;
      }

      return null;
    }

    async function createBookingTransaction(selectedLabels, passengerNames, email, contact, paymentMethod, paymentDetails = '') {
      const tripRef = doc(db, 'trips', tripId);
      const bookingRefs = selectedLabels.map(label => doc(db, 'bookings', `${tripId}_${label}`));

      return runTransaction(db, async transaction => {
        const tripSnap = await transaction.get(tripRef);
        if (!tripSnap.exists()) {
          throw new Error('Trip not found.');
        }

        const tripData = tripSnap.data();
        const availableSeats = Number(tripData.available_seats ?? 0);
        if (availableSeats < selectedLabels.length) {
          throw new Error('Not enough available seats remain for this booking.');
        }

        for (const bookingRef of bookingRefs) {
          const bookingSnap = await transaction.get(bookingRef);
          if (bookingSnap.exists()) {
            throw new Error('One or more selected seats were just booked by another user.');
          }
        }

        bookingRefs.forEach((bookingRef, index) => {
          transaction.set(bookingRef, {
            trip_id: tripId,
            seat_label: selectedLabels[index],
            passenger_name: passengerNames[index],
            email,
            contact_number: contact,
            payment_method: paymentMethod,
            ...(paymentDetails ? { payment_info: paymentDetails } : {}),
            created_at: serverTimestamp(),
          });
        });

        transaction.update(tripRef, { available_seats: increment(-selectedLabels.length) });
      });
    }

    async function submitBooking(event) {
      event.preventDefault();
      // Checked again at the moment of booking: the bus may have left
      // while the form was being filled in.
      await loadTripMeta();
      if (tripClosed) {
        setStatus(tripClosed, true);
        return;
      }
      if (selectedSeats.length === 0) {
        setStatus('Select at least one seat first.', true);
        return;
      }

      const passengerNames = selectedSeats.map((_, index) => {
        const input = document.getElementById(`passengerName${index}`);
        return (input?.value || '').trim();
      });

      if (passengerNames.some(name => !name)) {
        setStatus('Fill every passenger name before submitting.', true);
        return;
      }

      const email = document.getElementById('email').value.trim();
      const contact = document.getElementById('contact').value.trim();
      const paymentMethod = document.getElementById('paymentMethod').value;

      if (!email || !contact || !paymentMethod) {
        setStatus('Email, contact number, and payment method are required.', true);
        return;
      }

      const agree = document.getElementById('agreePolicy');
      if (!agree.checked) {
        agree.focus();
        setStatus('Please read and agree to the cancellation policy to book.', true);
        return;
      }

      const paymentDetails = paymentInfo(paymentMethod);
      if (paymentDetails === null) return;

      const selectedLabels = [...selectedSeats];
      submitBtn.disabled = true;
      setStatus('Booking seats...');

      try {
        await createBookingTransaction(selectedLabels, passengerNames, email, contact, paymentMethod, paymentDetails);

        selectedSeats.length = 0;
        passengerList.innerHTML = '';
        renderPassengerFields();
        syncSeatStyles();
        await loadTripMeta();
        lastBookingReceipt = {
          tripId,
          route: `${tripDocData?.origin || 'Unknown'} to ${tripDocData?.destination || 'Unknown'}`,
          busTime: `${tripDocData?.travel_date || ''} · ${shortTime(tripDocData?.departure_time) || 'Unknown'}`,
          pricePerTicket: `BDT ${Number(tripDocData?.fare || 0).toFixed(2)}`,
          totalPrice: `BDT ${(Number(tripDocData?.fare || 0) * selectedLabels.length).toFixed(2)}`,
          totalSeats: selectedLabels.length,
          seats: selectedLabels,
          passengers: passengerNames,
          email,
          contact,
          paymentMethod: paymentDetails || PAYMENT_LABELS[paymentMethod] || paymentMethod,
        };
        renderReceipt(lastBookingReceipt);
        setStatus('Your ticket(s) have been booked successfully.');
        document.getElementById('bookingForm').reset();
        cardBrandEl.textContent = '';
        showPaymentPanel();
      } catch (error) {
        console.error('Booking failed', error);
        setStatus(error.message || 'Booking failed. Please try again.', true);
      } finally {
        submitBtn.disabled = selectedSeats.length === 0;
      }
    }

    document.getElementById('bookingForm').addEventListener('submit', submitBooking);
    document.getElementById('refreshBtn').addEventListener('click', refreshAvailability);
    printBtn.addEventListener('click', () => window.print());

    buildSeats();
    renderPassengerFields();
    syncSeatStyles();
    listenTrip();
    listenBookings();
    // Departure is a matter of the clock, not the data: check it each minute.
    setInterval(() => {
      if (tripDocData && hasDeparted(tripDocData)) closeTrip('This bus has already departed. Please choose another trip.');
    }, 60000);
  },

  /* ---------------- Cancellation policy (policy.html) ---------------- */
  policy: async () => {
    const tone = pct => (pct >= 80 ? 'good' : pct > 0 ? 'warn' : 'bad');
    document.getElementById('policyTiers').innerHTML = CANCELLATION_TIERS.map((t, i) => `
      <div class="tier tier-${tone(t.refundPercent)}" style="--i:${i}">
        <strong>${t.refundPercent}%</strong>
        <span>${t.refundPercent ? 'refund' : 'no refund'}</span>
        <p>${t.label}</p>
      </div>`).join('');

    const fare = 1200;
    document.getElementById('policyExample').textContent =
      `Example, for a ${formatBdt(fare)} seat: ` +
      CANCELLATION_TIERS.map(t => `${formatBdt((fare * t.refundPercent) / 100)} back ${t.label.toLowerCase()}`).join('; ') + '.';

    document.getElementById('policyPoints').innerHTML = POLICY_POINTS.map(p => `<li>${p}</li>`).join('');
  },
};

PAGES[document.body.dataset.page]?.();
