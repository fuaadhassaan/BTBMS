# DTicket — The all-in-one Ticketing Website

Bus ticket booking and management for Dhaka ↔ Chittagong and Dhaka ↔ Sylhet, live at **https://dticket.vercel.app**.

## What's in it

**Passengers** (no sign-in)
- Search by route and date; tickets are on sale for today and the next 13 days (Dhaka time).
- Live seat map; book up to 4 seats; pay by cash, bKash or card (details checked, only a masked summary stored).
- Branded e-ticket with PDF download; cancellation policy shown and agreed to before booking.

**Admin console** (`admin.html`, red)
- Dashboard, Stats (with CSV export), Trips, Tickets, Buses, Users, Passengers, Requests, Notices, Audit log, My account.
- Full create / edit / delete, refunds calculated from the cancellation policy, every change logged.

**Counter Manager console** (`cmanager.html`, red)
- Dashboard, Stats, Trips (view), Tickets (issue / edit / cancel, stamped with the counter), Buses (view), Passengers, own Requests, Notices, My account.

**Company Manager console** (`company.html`, purple)
- Dashboard, Stats and My account, read-only.

## Files

| Who | Files |
| --- | --- |
| Landing page | `index.html`, `index.css`, `index.js` |
| Admin | `admin.html`, `admin.css`, `admin.js` |
| Counter Manager | `cmanager.html`, `cmanager.css`, `cmanager.js` |
| Company Manager | `company.html`, `company.css`, `company.js` |
| Passengers | `ticket-booking.html` (search), `trip-results.html`, `seat-selection.html`, `policy.html`, sharing `passenger.css` and `passenger.js` |
| Database | `database.js` (Firestore connection, trip schedule, staff sign-in, audit log) and `config.js` (timetable, cancellation policy, roles) |

The three consoles share the same code with their role fixed at the top of each script, so a change to shared console behaviour belongs in all three.

## How it runs

- Static site on Vercel (auto-deploys from `main`), data in Firebase Firestore (project `dticket-b79f0`), updates in real time.
- **Timetable:** `config.js` holds the 8 daily trips (times, buses, fares). The GitHub Action `.github/workflows/daily-trips.yml` runs `scripts/generate-trips.mjs` at 00:05 Dhaka every night to keep 14 days on sale; site visits also top it up.
- **Cancellation policy:** `config.js` (90% > 24 h, 50% 6–24 h, none after).
- **Staff sign-in:** accounts live in the `staff` collection with salted PBKDF2 password hashes; create them in Admin → Users.
- **Security rules:** `firestore.rules` (deploy with `firebase deploy --only firestore:rules`).

Collections: `trips`, `bookings`, `buses`, `staff`, `requests`, `notices`, `audit`, `schedule`.

`archive/` and `data/` are from the earlier PHP version, kept for reference and not published to the site.

---

All Rights Reserved by Md. Fuad Hasan, 2026© · fuaadhassaan@gmail.com
