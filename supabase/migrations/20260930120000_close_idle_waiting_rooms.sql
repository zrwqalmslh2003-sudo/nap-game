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
       or (status = 'waiting' and created_at < now() - interval '10 minutes')
  );

  with deleted as (
    delete from rooms
    where (status = 'done'    and created_at < now() - interval '24 hours')
       or (status = 'waiting' and created_at < now() - interval '10 minutes')
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
