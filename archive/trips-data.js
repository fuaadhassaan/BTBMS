// trips-data.js
// This file replaces search_trips.php's data + logic, since Vercel (static hosting)
// cannot execute PHP. This is a hardcoded snapshot of your `trips` table.
//
// TO SWITCH TO A REAL BACKEND LATER:
// If you deploy the PHP files to a real PHP-capable host (or rewrite
// search_trips.php as a Vercel serverless function in Node/Python),
// just replace searchTrips() below with a fetch() call to that endpoint,
// and everything else (ticket-booking.html, trip-results.html) keeps working
// unchanged since they only call searchTrips().

const BASE_TRIPS = [
  { trip_id: "TR1", bus_id: "BUS1", origin: "Dhaka",      destination: "Chittagong", departure_time: "09:00:00", arrival_time: "15:00:00", fare: 1200.00, travel_date: "2026-07-27", available_seats: 28 },
  { trip_id: "TR2", bus_id: "BUS2", origin: "Dhaka",      destination: "Sylhet",     departure_time: "10:00:00", arrival_time: "17:00:00", fare: 1000.00, travel_date: "2026-07-29", available_seats: 28 },
  { trip_id: "TR3", bus_id: "BUS1", origin: "Chittagong", destination: "Dhaka",      departure_time: "10:00:00", arrival_time: "16:00:00", fare: 1200.00, travel_date: "2026-07-31", available_seats: 28 },
  { trip_id: "TR4", bus_id: "BUS2", origin: "Sylhet",     destination: "Dhaka",      departure_time: "10:00:00", arrival_time: "16:00:00", fare: 1000.00, travel_date: "2026-08-03", available_seats: 28 },
];

const SCHEDULE_DATES = [
  "2026-08-06",
  "2026-08-07",
  "2026-08-08",
  "2026-08-09",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
];

const SCHEDULE_PLANS = [
  { bus_id: "BUS1", origin: "Dhaka", destination: "Chittagong", departure_time: "10:00:00", arrival_time: "16:00:00", fare: 1200.00 },
  { bus_id: "BUS1", origin: "Chittagong", destination: "Dhaka", departure_time: "23:00:00", arrival_time: "05:00:00", fare: 1200.00 },
  { bus_id: "BUS2", origin: "Dhaka", destination: "Sylhet", departure_time: "10:00:00", arrival_time: "17:00:00", fare: 1000.00 },
  { bus_id: "BUS2", origin: "Sylhet", destination: "Dhaka", departure_time: "23:00:00", arrival_time: "05:00:00", fare: 1000.00 },
];

function buildScheduledTrips() {
  const trips = [];
  let tripNumber = 5;

  for (const travelDate of SCHEDULE_DATES) {
    for (const plan of SCHEDULE_PLANS) {
      trips.push({
        trip_id: `TR${tripNumber++}`,
        bus_id: plan.bus_id,
        origin: plan.origin,
        destination: plan.destination,
        departure_time: plan.departure_time,
        arrival_time: plan.arrival_time,
        fare: plan.fare,
        travel_date: travelDate,
        available_seats: 28,
      });
    }
  }

  return trips;
}

const TRIPS = [...BASE_TRIPS, ...buildScheduledTrips()];

// Placeholder for booked-seat counts per trip_id (mirrors the `tickets` table
// join in search_trips.php). Since there's no backend, this stays empty here.
// If you add client-side booking with localStorage later, populate this from
// localStorage the same way get-booked-seats.php would.
const BOOKED_COUNTS = {
  // trip_id: numberOfSeatsBooked
};

/**
 * Mirrors search_trips.php's logic:
 * - filters by origin/destination
 * - filters travel_date between `date` and `date + 60 days`
 * - computes available_seats = max(0, available_seats - booked)
 * - sorts by travel_date asc, then departure_time asc
 */
function searchTrips(from, to, date) {
  from = (from || "").trim();
  to = (to || "").trim();
  date = (date || "").trim();

  if (!date) {
    date = new Date().toISOString().slice(0, 10);
  }
  if (!from || !to) {
    return [];
  }

  const startDate = new Date(date + "T00:00:00");
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 60);

  const results = TRIPS.filter(t => {
    if (t.origin !== from || t.destination !== to) return false;
    const travelDate = new Date(t.travel_date + "T00:00:00");
    return travelDate >= startDate && travelDate <= endDate;
  }).map(t => {
    const booked = BOOKED_COUNTS[t.trip_id] || 0;
    return {
      ...t,
      available_seats: Math.max(0, t.available_seats - booked),
    };
  });

  results.sort((a, b) => {
    if (a.travel_date !== b.travel_date) return a.travel_date < b.travel_date ? -1 : 1;
    return a.departure_time < b.departure_time ? -1 : a.departure_time > b.departure_time ? 1 : 0;
  });

  return results;
}

export { TRIPS, searchTrips };
