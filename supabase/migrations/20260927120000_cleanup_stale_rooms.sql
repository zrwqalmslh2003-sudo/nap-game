-- Remove finished rooms older than 24h and abandoned waiting rooms older than 6h.
-- players, rounds, answers, room_reports cascade through rooms.
-- pending_words has no cascade, so delete explicitly by room_id first.

create index if not exists rooms_status_created_idx
  on rooms (status, created_at);

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
       or (status = 'waiting' and created_at < now() - interval '6 hours')
  );

  with deleted as (
    delete from rooms
    where (status = 'done'    and created_at < now() - interval '24 hours')
       or (status = 'waiting' and created_at < now() - interval '6 hours')
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
