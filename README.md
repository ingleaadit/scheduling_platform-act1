# Scheduling platform

A booking and admin tool for solo therapists and counsellors in India. Clients book from a private link; the therapist runs their practice from a console. It is live on Vercel with a Supabase database (Mumbai region). Every push to `main` deploys.

## The pages

| Address | File | What it is |
|---|---|---|
| `/?t=<practice-link>` | `index.html` | A therapist's booking page, loaded from the server. Without `?t=` it shows example data. |
| `/console` | `console.html` | The therapist console. Real sign-in (Supabase), invitation only. |
| `/demo` | `demo.html` | The whole app with example data, already signed in. No account, nothing is sent or saved on a server. |
| `/admin` | `admin.html` | Owner view: lists therapists and opens one (every open is written to an audit log). Needs an admin login. |

## How it fits together

- **Source:** `src/prototype.html` is the single source for the app. `node build.js` writes `app.css`, `app.js`, `index.html`, `console.html`, `demo.html` and `version.json`. Commit the built files too. CI fails if they are out of date.
- **Server:** `api/*.js` are Vercel functions. `book`, `manage` and `practice` serve the public booking page. `remind` sends reminder emails (called every minute by a Supabase pg_cron job). `admin` serves the owner view. `db-health` answers `{ok:true}` when the database is reachable.
- **Database:** Supabase Postgres. Schema changes are in `supabase/migrations/` and are applied by hand in the Supabase SQL editor, in order.
- **Email:** Gmail SMTP through Nodemailer (`SMTP_USER`, `SMTP_PASS`), or Resend (`RESEND_API_KEY`) as a fallback. Only plain single addresses are accepted.

## Environment variables (set in Vercel; never commit values)

`POSTGRES_URL` (or `DATABASE_URL`), `SUPABASE_CA_CERT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `RESEND_API_KEY`, `SITE_URL`, `CRON_SECRET`.

`CRON_SECRET` is optional today. If it is set, `/api/remind` only answers requests that send `Authorization: Bearer <secret>`, so the pg_cron job (migration 0007) must send the same header. Set both together or reminders stop.

The Supabase publishable key in `config.js` is public by design. The secret or service-role key must never go in this repository or in browser code.

## Run and test

```
npm install
node build.js          # after editing src/prototype.html
npm test               # unit tests (booking, admin, database health)
npm run test:e2e       # browser tests (needs: npx playwright install chromium)
```

The browser tests live in `tests/e2e/`. They cover booking, attendance replies from email links, sign-in, the first-login tutorial, navigation and undo, the demo, security headers, and accessibility and slow-network load times. GitHub Actions (`.github/workflows/ci.yml`) runs everything on each push.

## Deploy and roll back

Push to `main` and Vercel deploys. To roll back, open the project in Vercel, go to Deployments, pick the last good one and choose Promote to Production (instant, no rebuild). Then `git revert` the bad commit so `main` matches.

Database changes are not rolled back by Vercel. Free Supabase projects have no automatic backups, so export before risky changes.

## Security notes

- Responses carry a Content-Security-Policy and other headers (see `vercel.json`).
- Booking, change and cancel requests are rate limited per person and per address.
- `/console`, `/admin` and the booking pages are marked noindex. `robots.txt` blocks them and `/api`.
- Do not use real client data on `/demo`. It is example data in the visitor's own browser.

## Plans

A few features sit on a paid plan: the waitlist, insights, a new video link for each session, the payments export and automatic WhatsApp messages with no monthly limit. Everything else is free. That includes automatic email reminders, the Google Calendar connection, and the WhatsApp Business connection with 30 automatic messages a month; after 30, reminders go by email until the next month. The plan switch under Practice, Account is a demo: no payment is taken and no price is set.

## What it does

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

