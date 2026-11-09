# DTicket — The all-in-one Ticketing Website
DTicket – The all-in-one Ticketing Website. Real-time seat booking, role-based dashboards (Admin, Counter Manager), and insightful analytics – all in one platform.

📌 Changelog
**Version 1.0 – Initial Release**

🎉 First stable release of DTicket (The all-in-one Ticketing Website)

**👤 Passenger's Ticket Booking:**

-Search buses by city & date

-Real-time seat availability

-Select up to 4 seats per booking

-Multiple payment options (Cash, Bkash, Card)

-PDF Download option for tickets

**🏢 Admin:**

-Individual Dashboard

-Manage trips CRUD (Create, Update, Delete, Overview)

-Manage tickets CRUD (Create, Update, Delete, Overview)

-Handle requests from managers (CRUD)

**🎟️ Counter Manager:**

-Individual Dashboard

-View trip schedules

-Ticket management CRUD (create, update, delete, overview)

-Request to Admin

**🎨 UI & Styling:**

-Role-based dashboards with color based themes for better user reliability

-Separate HTML and CSS files for each module and js files to connect with firebase database.

**🔥 Firebase / Firestore Data:**

- Project: `btbms-b79f0`

- Firestore database: `(default)`

- Collections: `buses`, `trips`, `bookings`

- `buses` documents store bus metadata, including `bus_id` and `total_seats`

- `trips` documents store route, time, fare, travel date, and current `available_seats`

- `bookings` documents store `trip_id`, `seat_label`, passenger details, contact info, payment method, and timestamp

- In the Firebase Console, open **Build > Firestore Database > Data** to show these collections to your professor

**Please note that this version doesn't represent the full version, more features and testing are under development.**

**All Rights Reserved by Md. Fuad Hasan, 2026© | For enquiries, email at: fuaadhassaan@gmail.com**

