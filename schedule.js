/* =============================================================
   DTicket timetable and booking window

   One place for:
   - the 8 trips that run every day,
   - the booking window: today plus the next 13 days, in Dhaka time
     (so at 11:59 PM today stops being bookable and a new day opens),
   - ensureSchedule(): makes sure every day in the window has its
     trips in Firestore.

   How the trips get created: a single marker document,
   schedule/window, records the last date already generated. Any page
   that calls ensureSchedule() reads it (one read when nothing is due);
   when the window has moved on, the missing days are created in one
   transaction and the marker is advanced. So each day is generated
   exactly once, two visitors at the same moment cannot double it, and
   a trip an admin deletes is not brought back.
   ============================================================= */


import { doc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';
import { DAILY_TRIPS, bookingWindow, addDays, buildTrip } from './timetable.js';

// Everything the pages use from here, in one place.
export * from './timetable.js';

/* Creates whatever days of the booking window are still missing.
   Resolves to the number of trips created (0 almost always). Never
   throws: a page that cannot reach the database still works with
   whatever trips already exist. */
export async function ensureSchedule(db) {
  const { first, last } = bookingWindow();
  const markerRef = doc(db, 'schedule', 'window');

  try {
    return await runTransaction(db, async transaction => {
      const marker = await transaction.get(markerRef);
      const through = marker.exists() ? String(marker.data().generated_through || '') : '';
      if (through >= last) return 0;

      const start = through && through >= first ? addDays(through, 1) : first;
      const planned = [];
      for (let date = start; date <= last; date = addDays(date, 1)) {
        for (const slot of DAILY_TRIPS) {
          const trip = buildTrip(date, slot);
          planned.push({ ref: doc(db, 'trips', trip.trip_id), trip });
        }
      }

      // All reads before any write, as transactions require. A trip
      // that already exists (made by hand, say) is left alone.
      const snaps = await Promise.all(planned.map(p => transaction.get(p.ref)));
      let created = 0;
      snaps.forEach((snap, i) => {
        if (snap.exists()) return;
        transaction.set(planned[i].ref, { ...planned[i].trip, created_at: serverTimestamp(), updated_at: serverTimestamp() });
        created += 1;
      });

      transaction.set(markerRef, { generated_through: last, updated_at: serverTimestamp() });
      return created;
    });
  } catch (error) {
    console.warn('[DTicket] Trip schedule could not be checked.', error);
    return 0;
  }
}
