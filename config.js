/* =============================================================
   DTicket configuration: the rules the whole site follows.

   1. Timetable and booking window (the 8 daily trips, Dhaka dates)
   2. Cancellation policy (refund tiers)
   3. Staff roles and the consoles they open

   Plain JavaScript with no imports, so the website (through
   database.js) and the nightly job (scripts/generate-trips.mjs) use
   exactly the same rules. Change a number here and it changes
   everywhere.
   ============================================================= */

/* =============================================================
   1. Timetable and booking window
   ============================================================= */
export const TIME_ZONE = 'Asia/Dhaka';
export const BOOKING_WINDOW_DAYS = 14;
export const SEATS_PER_BUS = 28;

/* Every day: Dhaka <-> Chittagong twice each way, Dhaka <-> Sylhet
   twice each way. Each bus does one leg and comes back on the
   opposite leg, so four buses cover the timetable. */
export const DAILY_TRIPS = [
  { code: 'DC1', origin: 'Dhaka', destination: 'Chittagong', departure_time: '10:00:00', arrival_time: '16:00:00', bus_id: 'BUS1', fare: 1200 },
  { code: 'DC2', origin: 'Dhaka', destination: 'Chittagong', departure_time: '23:00:00', arrival_time: '05:00:00', bus_id: 'BUS3', fare: 1200 },
  { code: 'CD1', origin: 'Chittagong', destination: 'Dhaka', departure_time: '10:00:00', arrival_time: '16:00:00', bus_id: 'BUS3', fare: 1200 },
  { code: 'CD2', origin: 'Chittagong', destination: 'Dhaka', departure_time: '23:00:00', arrival_time: '05:00:00', bus_id: 'BUS1', fare: 1200 },
  { code: 'DS1', origin: 'Dhaka', destination: 'Sylhet', departure_time: '10:00:00', arrival_time: '17:00:00', bus_id: 'BUS2', fare: 1000 },
  { code: 'DS2', origin: 'Dhaka', destination: 'Sylhet', departure_time: '23:00:00', arrival_time: '06:00:00', bus_id: 'BUS4', fare: 1000 },
  { code: 'SD1', origin: 'Sylhet', destination: 'Dhaka', departure_time: '10:00:00', arrival_time: '17:00:00', bus_id: 'BUS4', fare: 1000 },
  { code: 'SD2', origin: 'Sylhet', destination: 'Dhaka', departure_time: '23:00:00', arrival_time: '06:00:00', bus_id: 'BUS2', fare: 1000 },
];

/* ---- dates and times, always in Dhaka ---- */
export function dhakaNow(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(at).map(p => [p.type, p.value])
  );
  // Some engines print midnight as 24:00:00.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}:${parts.second}` };
}

export function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* Today and the last bookable day (13 days later). */
export function bookingWindow(now = dhakaNow()) {
  return { first: now.date, last: addDays(now.date, BOOKING_WINDOW_DAYS - 1) };
}

export function inWindow(date, window = bookingWindow()) {
  return typeof date === 'string' && date >= window.first && date <= window.last;
}

/* Times are stored as HH:MM:SS (older trips) or HH:MM (typed in the
   admin console); padding makes them compare the same way. */
const fullTime = t => (String(t || '').length === 5 ? `${t}:00` : String(t || ''));

export function hasDeparted(trip, now = dhakaNow()) {
  if (!trip?.travel_date) return false;
  if (trip.travel_date < now.date) return true;
  return trip.travel_date === now.date && fullTime(trip.departure_time) <= now.time;
}

/* Why a trip cannot be booked right now, or '' if it can. */
export function closedReason(trip, now = dhakaNow()) {
  if (!trip) return 'This trip could not be found.';
  if (hasDeparted(trip, now)) return 'This bus has already departed.';
  if (!inWindow(trip.travel_date, bookingWindow(now))) return `Tickets are sold for the next ${BOOKING_WINDOW_DAYS} days only.`;
  if (Number(trip.available_seats || 0) <= 0) return 'This trip is sold out.';
  return '';
}

export const shortTime = t => String(t || '').slice(0, 5);

/* TR-261109-DC1: date (yymmdd) and the timetable slot. */
export function tripIdFor(date, code) {
  return `TR-${date.replaceAll('-', '').slice(2)}-${code}`;
}

export function buildTrip(date, slot) {
  return {
    trip_id: tripIdFor(date, slot.code),
    schedule_code: slot.code,
    bus_id: slot.bus_id,
    origin: slot.origin,
    destination: slot.destination,
    departure_time: slot.departure_time,
    arrival_time: slot.arrival_time,
    fare: slot.fare,
    travel_date: date,
    available_seats: SEATS_PER_BUS,
    total_seats: SEATS_PER_BUS,
  };
}

/* =============================================================
   2. Cancellation policy
   ============================================================= */
/* Refund by how long before departure the ticket is cancelled.
   Checked top to bottom; the first tier whose minimum is met wins. */
export const CANCELLATION_TIERS = [
  { minHours: 24, refundPercent: 90, label: 'More than 24 hours before departure' },
  { minHours: 6, refundPercent: 50, label: '6 to 24 hours before departure' },
  { minHours: -Infinity, refundPercent: 0, label: 'Less than 6 hours before departure, after departure, or no-show' },
];

export const POLICY_SHORT = '90% refund up to 24 h before departure, 50% up to 6 h before, no refund after that.';

export const POLICY_POINTS = [
  'Cancel at any DTicket counter (Dhaka, Chittagong or Sylhet) with your ticket ID and the phone number used to book.',
  'Refunds are paid by the same method you paid with (cash at the counter, bKash or card) within 7 working days.',
  'Each seat is cancelled separately; the refund is worked out per seat from its fare.',
  'Date or seat changes are a cancellation plus a new booking, under the same rules.',
  'If DTicket cancels a trip (breakdown, weather, strikes), you get a full refund or a free move to another trip.',
];

/* When a trip leaves, as a real moment in time (Dhaka is UTC+6, no DST). */
export function departureDate(trip) {
  if (!trip?.travel_date || !trip?.departure_time) return null;
  const time = String(trip.departure_time).length === 5 ? `${trip.departure_time}:00` : String(trip.departure_time);
  const d = new Date(`${trip.travel_date}T${time}+06:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function hoursUntilDeparture(trip, now = new Date()) {
  const dep = departureDate(trip);
  return dep ? (dep.getTime() - now.getTime()) / 3600000 : -Infinity;
}

/* What cancelling one seat on this trip refunds right now. */
export function refundFor(trip, fare = trip?.fare, now = new Date()) {
  const hours = hoursUntilDeparture(trip, now);
  const tier = CANCELLATION_TIERS.find(t => hours >= t.minHours) || CANCELLATION_TIERS[CANCELLATION_TIERS.length - 1];
  const paid = Number(fare || 0);
  const amount = Math.round((paid * tier.refundPercent) / 100 * 100) / 100;
  return { hours, percent: tier.refundPercent, amount, fee: Math.round((paid - amount) * 100) / 100, paid, tier };
}

export const formatBdt = n => `BDT ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* "2 days 3 h", "5 h 20 min", "departed" */
export function describeTimeLeft(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return 'already departed';
  if (hours >= 48) return `${Math.floor(hours / 24)} days ${Math.floor(hours % 24)} h before departure`;
  if (hours >= 1) return `${Math.floor(hours)} h ${Math.round((hours % 1) * 60)} min before departure`;
  return `${Math.max(1, Math.round(hours * 60))} min before departure`;
}

/* =============================================================
   3. Staff roles
   ============================================================= */
/* Who may sign in lives in the database (`staff`, see database.js).
   Passengers never sign in. */
export const ROLES = {
  admin: { label: 'Admin', accent: '#ff4d4d', text: '#ffd6d6', page: 'admin.html' },
  cmanager: { label: 'Counter Manager', accent: '#ff4d4d', text: '#ffd6d6', page: 'cmanager.html' },
  company: { label: 'Company Manager', accent: '#b37bff', text: '#ead9ff', page: 'company.html' }
};

/* The keys the landing page and the consoles share. */
export const HANDOFF_KEY = 'btbms.handoff';
export const SIGNIN_ERROR_KEY = 'btbms.signin-error';
