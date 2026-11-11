# Scheduling platform (prototype)

A booking and admin tool for solo therapists and counsellors in India. This repository holds the clickable prototype. It has no backend: all data is example data and stays in the browser that opens it.

## The two pages

- `index.html` is the client booking page. On the deployed site this is the root address.
- `console.html` is the therapist console. On the deployed site this is `/console`.

Each page fits itself to the screen: a phone gets the phone layout and a wider screen gets the desktop layout. Both pages read the same saved data in the browser, so a booking made on the client page shows up in the console when both are open in the same browser.

## Run it

Open `index.html` or `console.html` in a browser. The console asks for a sign-in; the demo details are shown on the sign-in screen.

## Change it

Edit `src/prototype.html`, then run `node build.js`. That rewrites `app.css`, `app.js`, `index.html` and `console.html`. Commit all of them.

## Plans

A few features sit on a paid plan: the waitlist, insights, a new video link for each session and the payments export. Everything else is free, including the Google Calendar and WhatsApp Business connections. The plan switch under Practice, Account is a demo: no payment is taken and no price is set.

## What it shows

**Client side** (a booking link, no app)
- Therapist intro page with FAQ
- Booking: session type, time, details, intake questions, consent and cancellation policy
- Reschedule and cancel, with the late-cancellation rule applied
- Waitlist sign-up and a crisis line on every page

**Therapist console**
- Today: a to-do queue (label sessions, record payments, offer freed slots, nudge unconfirmed clients) and the calendar
- People: one page per client with sessions, payments, intake and waitlist status; client import from CSV
- Practice: working hours in split blocks, breaks between sessions, blocked time, profile and forms, message templates, connected apps, training log, insights
- Recurring sessions, session labels, a "take to supervision" tag, UPI payment requests with UTR recording, and WhatsApp reminder messages
- Desktop and phone layouts, light and dark, and a choice of colour schemes

## What is not real yet

- No server or database. A booking made on one device does not reach another.
- Sign-in, WhatsApp sending, Google Calendar sync and per-session video links are mocked.
- Payments are recorded by hand; nothing is checked against a bank.
- No encryption, consent records or data-deletion handling. Do not put real client data in it.
