-- Wakes the reminder job every minute. /api/remind only sends reminders that are due and not yet sent,
-- so calling it more often than needed is harmless.
-- Needs the pg_cron and pg_net extensions (Supabase: Database > Extensions).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'practice-reminders';
select cron.schedule('practice-reminders', '* * * * *',
  $$ select net.http_get(url := 'https://schedulingplatform-act1.vercel.app/api/remind') $$);
