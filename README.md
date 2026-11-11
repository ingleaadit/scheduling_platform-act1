# Scheduling platform (prototype)

A booking and admin tool for solo therapists and counsellors in India. This repository holds the clickable prototype. It is a single HTML file with no backend: all data is example data and stays in the browser that opens it.

## Run it

Open `index.html` in a browser. No build step and no server are needed.

The therapist console asks for a sign-in. The demo details are shown on the sign-in screen.

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
