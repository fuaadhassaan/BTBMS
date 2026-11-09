/* =============================================================
   DTicket cancellation policy

   The one place the rules live. The booking page, the ticket, the
   policy page and both consoles all read from here, so changing a
   number below changes it everywhere.
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
