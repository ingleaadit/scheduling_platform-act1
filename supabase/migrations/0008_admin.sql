-- Platform admin: the people allowed to look at every therapist's account on the /admin page, and a record of each time they open one.
-- Only the server (api/admin.js) touches these tables. Nobody signed in from a browser can read or change them.

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.admin_audit (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users(id) on delete cascade,
  practitioner_id uuid references auth.users(id) on delete set null,
  action text not null,                 -- what was opened, for example 'view'
  at timestamptz not null default now()
);
create index admin_audit_at_idx on public.admin_audit (at desc);

alter table public.admins enable row level security;
alter table public.admin_audit enable row level security;
revoke all on public.admins, public.admin_audit from anon, authenticated;
