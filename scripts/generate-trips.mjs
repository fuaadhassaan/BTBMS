/* =============================================================
   Nightly trip generator

   Keeps the next 14 days of trips on sale with no code changes and
   no visitors needed. Run by .github/workflows/daily-trips.yml at
   00:05 Dhaka time; safe to run any number of times.

   It does the same thing the website's ensureSchedule() does:
   - reads schedule/window (the last date already generated),
   - creates the missing days' trips from timetable.js (the same
     8 daily trips and buses the site uses),
   - advances schedule/window.
   Trips that already exist are skipped, never overwritten, so seats
   already sold and anything an admin changed are left alone.

   It writes through the public Firestore REST API with the site's own
   web API key, so the same security rules apply as for the website.

   Usage:
     node scripts/generate-trips.mjs            create what is missing
     node scripts/generate-trips.mjs --dry      only report
     node scripts/generate-trips.mjs --today=2026-11-23 --dry   pretend a date
   ============================================================= */

import { DAILY_TRIPS, bookingWindow, addDays, buildTrip, dhakaNow } from '../timetable.js';

const PROJECT = 'btbms-b79f0';
const API_KEY = 'AIzaSyDF2L2QCs9g0KGzyLGp03aQTaZ6A20zdPk'; // public web key (same as firebase-init.js)
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const dry = Boolean(args.dry);
const now = args.today ? { date: String(args.today), time: '00:05:00' } : dhakaNow();
const { first, last } = bookingWindow(now);

const value = v => (typeof v === 'number'
  ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : v instanceof Date ? { timestampValue: v.toISOString() } : { stringValue: String(v) });
const fields = obj => ({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, value(v)])) });

async function call(url, method = 'GET', body) {
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}key=${API_KEY}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, json: text ? JSON.parse(text) : {} };
}

/* Runs once; finishes on its own (no process.exit) so open network
   connections close cleanly. Failures set a non-zero exit code. */
async function main() {
  const marker = await call(`${DOCS}/schedule/window`);
  if (!marker.ok && marker.status !== 404) {
    console.error(`Could not read schedule/window: ${marker.status} ${JSON.stringify(marker.json).slice(0, 200)}`);
    process.exitCode = 1;
      return;
  }
  const through = marker.ok ? marker.json.fields?.generated_through?.stringValue || '' : '';
  console.log(`Today (Dhaka): ${now.date}. Booking window: ${first} to ${last}. Generated through: ${through || 'nothing yet'}.`);

  if (through >= last) {
    console.log('Nothing to do: every day in the window already has its trips.');
    return;
  }

  const start = through && through >= first ? addDays(through, 1) : first;
  let created = 0;
  let existed = 0;
  for (let date = start; date <= last; date = addDays(date, 1)) {
    for (const slot of DAILY_TRIPS) {
      const trip = buildTrip(date, slot);
      if (dry) {
        console.log(`would create ${trip.trip_id}  ${trip.origin} -> ${trip.destination}  ${date} ${trip.departure_time.slice(0, 5)}-${trip.arrival_time.slice(0, 5)}  ${trip.bus_id}  BDT ${trip.fare}`);
        created += 1;
        continue;
      }
      const stamp = new Date();
      const res = await call(`${DOCS}/trips?documentId=${encodeURIComponent(trip.trip_id)}`, 'POST',
        fields({ ...trip, created_at: stamp, updated_at: stamp }));
      if (res.ok) {
        created += 1;
        console.log(`created ${trip.trip_id}`);
      } else if (res.status === 409) {
        existed += 1; // already there (made by a visitor or by hand): leave it
      } else {
        console.error(`Failed to create ${trip.trip_id}: ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`);
        process.exitCode = 1;
      return;
      }
    }
  }

  if (!dry) {
    const res = await call(`${DOCS}/schedule/window?updateMask.fieldPaths=generated_through&updateMask.fieldPaths=updated_at`, 'PATCH',
      fields({ generated_through: last, updated_at: new Date() }));
    if (!res.ok) {
      console.error(`Trips created, but schedule/window could not be advanced: ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`${dry ? 'DRY RUN: would create' : 'Created'} ${created} trip(s) for ${start} to ${last}${existed ? `; ${existed} already existed` : ''}.`);
}

await main();
