-- Public booking path.
-- practice_public: the part of a practice that the booking page may show (profile, session types, hours, taken times).
--   The therapist's console writes it; the booking page reads it only through the server (/api/practice), never directly.
-- booking_inbox: bookings and waitlist requests made on the booking page. Only the server (/api/book) inserts rows.
--   The therapist's console reads its own rows, copies them into the practice data, then marks them imported.
-- Row Level Security: a signed-in therapist can only touch their own rows; visitors have no direct access to either table.

create table public.practice_public (
  practitioner_id uuid primary key references public.practitioners(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.practice_public enable row level security;

create policy "own public page" on public.practice_public
  for all to authenticated
  using (practitioner_id = (select auth.uid()))
  with check (practitioner_id = (select auth.uid()));

create table public.booking_inbox (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioners(id) on delete cascade,
  kind text not null check (kind in ('booking', 'waitlist')),
  starts_at timestamptz,
  ends_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  imported_at timestamptz
);
create index booking_inbox_practitioner_idx on public.booking_inbox (practitioner_id, imported_at);

alter table public.booking_inbox enable row level security;

create policy "read own inbox" on public.booking_inbox
  for select to authenticated
  using (practitioner_id = (select auth.uid()));

create policy "mark own inbox imported" on public.booking_inbox
  for update to authenticated
  using (practitioner_id = (select auth.uid()))
  with check (practitioner_id = (select auth.uid()));
