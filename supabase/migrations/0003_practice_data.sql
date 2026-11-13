-- One private row per practitioner holding the console's data (clients, sessions, waitlist, settings).
-- This is a stopgap so the console can save to the database now; it can be split into proper tables later.
-- Row Level Security: each signed-in practitioner can only read and write their own row.

create table public.practice_data (
  practitioner_id uuid primary key references public.practitioners(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.practice_data enable row level security;

create policy "own practice data" on public.practice_data
  for all to authenticated
  using (practitioner_id = (select auth.uid()))
  with check (practitioner_id = (select auth.uid()));
