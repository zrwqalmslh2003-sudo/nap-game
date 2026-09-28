-- Active public waiting lobbies may outlive the short 10-minute TTL,
-- but the hard 2-hour cap prevents abandoned lobbies from living forever.
--
-- Replaces the function from 20260928120000_public_room_ttl.sql.
-- The existing migration is already applied in production, so this override
-- is intentionally delivered as a new migration.

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
    select r.id from rooms r
    where (
      (r.status = 'done'    and r.created_at < now() - interval '24 hours')
      or (r.status = 'waiting' and r.is_public = false and r.created_at < now() - interval '6 hours')
      or (r.status = 'waiting' and r.is_public = true  and r.created_at < now() - interval '2 hours')
      or (r.status = 'waiting' and r.is_public = true  and r.created_at < now() - interval '10 minutes'
          and not exists (
            select 1 from players p
            where p.room_id = r.id and p.kicked_at is null and p.connected is not false))
    )
  );

  with deleted as (
    delete from rooms r
    where (
      (r.status = 'done'    and r.created_at < now() - interval '24 hours')
      or (r.status = 'waiting' and r.is_public = false and r.created_at < now() - interval '6 hours')
      or (r.status = 'waiting' and r.is_public = true  and r.created_at < now() - interval '2 hours')
      or (r.status = 'waiting' and r.is_public = true  and r.created_at < now() - interval '10 minutes'
          and not exists (
            select 1 from players p
            where p.room_id = r.id and p.kicked_at is null and p.connected is not false))
    )
    returning r.status
  )
  select
    count(*) filter (where status = 'done')::integer,
    count(*) filter (where status = 'waiting')::integer
  into d_done, d_waiting
  from deleted;

  return query select d_done, d_waiting;
end;
$$;
