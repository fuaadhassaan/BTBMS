/* =============================================================
   DTicket timetable: the 8 daily trips, the booking window and the
   date helpers. Plain JavaScript with no imports, so both the website
   (via schedule.js) and the nightly job (scripts/generate-trips.mjs)
   use exactly the same rules. Change the timetable here.
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
