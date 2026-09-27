-- Public waiting rooms expire after 10 minutes; private keep the 6h window.
--
-- Why: an abandoned public room is visible to everyone in غرف عامة, so one
-- created for a test and abandoned blocks the list until the 6h sweep. Ten
-- minutes is long enough to invite someone and start a round.
--
-- Finished rooms and private waiting rooms are unchanged: 24h and 6h.
-- players, rounds, answers, room_reports cascade through rooms.
-- pending_words has no cascade, so it is deleted explicitly by room_id first.
--
-- Replaces the function from 20260927120000_cleanup_stale_rooms.sql.

create index if not exists rooms_public_waiting_recent_idx
  on rooms (is_public, created_at desc)
  where status = 'waiting';

create or replace function public.cleanup_stale_rooms()
returns table (deleted_done integer, deleted_waiting integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  d_done integer := 0;
  d_waiting integer := 0;
begin
  delete from pending_words
  where room_id in (
    select id from rooms
    where (status = 'done'    and created_at < now() - interval '24 hours')
       or (status = 'waiting' and is_public = true  and created_at < now() - interval '10 minutes')
       or (status = 'waiting' and is_public = false and created_at < now() - interval '6 hours')
  );

  with deleted as (
    delete from rooms
    where (status = 'done'    and created_at < now() - interval '24 hours')
       or (status = 'waiting' and is_public = true  and created_at < now() - interval '10 minutes')
       or (status = 'waiting' and is_public = false and created_at < now() - interval '6 hours')
    returning status
  )
  select
    count(*) filter (where status = 'done')::integer,
    count(*) filter (where status = 'waiting')::integer
  into d_done, d_waiting
  from deleted;

  return query select d_done, d_waiting;
end;
$$;

revoke all on function public.cleanup_stale_rooms() from public;
grant execute on function public.cleanup_stale_rooms() to anon, authenticated;
