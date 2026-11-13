-- A client who pays by UPI from the booked page can tell the therapist (UTR = the 12-digit UPI reference).
-- It is stored as a request in the inbox; the therapist checks their bank and records the payment themselves.
alter table public.booking_inbox drop constraint booking_inbox_kind_check;
alter table public.booking_inbox add constraint booking_inbox_kind_check
  check (kind in ('booking', 'waitlist', 'cancel', 'reschedule', 'payment'));
