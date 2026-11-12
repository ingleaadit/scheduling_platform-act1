-- First schema: practitioners, clients, sessions. Row Level Security is on for every table.
-- Each row belongs to one practitioner (the signed-in user); policies only let that user see or change their own rows.
-- Intake answers, consent records and payments are deliberately not here yet.

create table public.practitioners (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioners(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now()
);
create index clients_practitioner_id_idx on public.clients (practitioner_id);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioners(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  starts_at timestamptz not null,
  duration_min integer not null default 50,
  session_type text not null default 'first',
  status text not null default 'upcoming',
  fee_inr integer not null default 0,
  paid boolean not null default false,
  utr text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index sessions_practitioner_id_idx on public.sessions (practitioner_id);
create index sessions_client_id_idx on public.sessions (client_id);
create index sessions_starts_at_idx on public.sessions (starts_at);

alter table public.practitioners enable row level security;
alter table public.clients enable row level security;
alter table public.sessions enable row level security;

create policy "own practitioner row" on public.practitioners
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "own clients" on public.clients
  for all to authenticated
  using (practitioner_id = (select auth.uid()))
  with check (practitioner_id = (select auth.uid()));

-- A session must also point at one of the same practitioner's own clients.
create policy "own sessions" on public.sessions
  for all to authenticated
  using (practitioner_id = (select auth.uid()))
  with check (
    practitioner_id = (select auth.uid())
    and exists (
      select 1 from public.clients c
      where c.id = client_id and c.practitioner_id = (select auth.uid())
    )
  );
