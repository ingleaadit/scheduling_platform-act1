-- Reminder emails 30 minutes before a session, and the client's reply ("I'll be there" / "I can't make it").
--   remind_sent_at: set when the reminder for this booking is claimed, so it is sent once.
--   remind_hash:    hash of a second private key that goes only in the reminder email (the booking-confirmation key stays valid).
--   kind 'attend':  the client's reply, which the console copies in like any other client change.
alter table public.booking_inbox drop constraint booking_inbox_kind_check;
alter table public.booking_inbox add constraint booking_inbox_kind_check
  check (kind in ('booking', 'waitlist', 'cancel', 'reschedule', 'payment', 'attend'));
alter table public.booking_inbox add column remind_hash text, add column remind_sent_at timestamptz;
create index booking_inbox_remind_idx on public.booking_inbox (starts_at)
  where kind = 'booking' and remind_sent_at is null and cancelled_at is null;
