-- Run ONLY against an isolated restored database, after the CR06 migration.
-- All fixtures, triggers and updates roll back. No production run.
\set ON_ERROR_STOP on
begin;
insert into public.reservations (id, table_id, status, date, time_from, time_to)
values ('cr06_test_seat', 'CR06_TEST_A', 'confirmed', '2099-10-10', '20:00', '23:00');
update public.reservations set status = 'seated' where id = 'cr06_test_seat';
do $$ begin
  if not exists (select 1 from public.table_occupancy where reservation_id = 'cr06_test_seat'
      and table_id = 'CR06_TEST_A' and freed_at is null) then raise exception 'seating missing occupancy'; end if;
  begin
    update public.reservations set table_id = 'CR06_TEST_B' where id = 'cr06_test_seat';
    raise exception 'seated relocation unexpectedly succeeded';
  exception when check_violation then null; end;
end $$;
update public.reservations set status = 'completed' where id = 'cr06_test_seat';
do $$ begin
  if exists (select 1 from public.table_occupancy where reservation_id = 'cr06_test_seat' and freed_at is null)
    then raise exception 'completion did not close occupancy'; end if;
end $$;

-- A physical occupancy conflict must leave the reservation confirmed.
insert into public.table_occupancy (id, table_id) values ('cr06_test_walkin', 'CR06_TEST_B');
insert into public.reservations (id, table_id, status, date, time_from, time_to)
values ('cr06_test_conflict', 'CR06_TEST_B', 'confirmed', '2099-10-10', '20:00', '23:00');
do $$ begin
  begin
    update public.reservations set status = 'seated' where id = 'cr06_test_conflict';
    raise exception 'occupied table seating unexpectedly succeeded';
  exception when unique_violation then null; end;
  if (select status from public.reservations where id = 'cr06_test_conflict') <> 'confirmed'
    then raise exception 'seating failure committed status'; end if;
end $$;

-- Every terminal path closes exactly the reservation's occupancy.
do $$ declare terminal text; rid text; tid text; begin
  foreach terminal in array array['completed', 'no_show', 'cancelled'] loop
    rid := 'cr06_test_' || terminal; tid := 'CR06_TEST_' || terminal;
    insert into public.reservations (id, table_id, status, date, time_from, time_to)
      values (rid, tid, 'confirmed', '2099-10-10', '20:00', '23:00');
    update public.reservations set status = 'seated' where id = rid;
    update public.reservations set status = terminal where id = rid;
    if exists (select 1 from public.table_occupancy where reservation_id = rid and freed_at is null)
      then raise exception 'terminal % left occupancy open', terminal; end if;
  end loop;
  if not exists (select 1 from public.table_occupancy where id = 'cr06_test_walkin' and freed_at is null)
    then raise exception 'unrelated walk-in closed'; end if;
end $$;

-- Inject an actual occupancy write failure; the status update must roll back.
create function public.cr06_test_fail_close() returns trigger language plpgsql as $$
begin
  if OLD.reservation_id = 'cr06_test_fail' then raise exception 'CR06 injected close failure'; end if;
  return NEW;
end $$;
create trigger cr06_test_fail_close before update on public.table_occupancy
for each row execute function public.cr06_test_fail_close();
insert into public.reservations (id, table_id, status, date, time_from, time_to)
values ('cr06_test_fail', 'CR06_TEST_FAIL', 'confirmed', '2099-10-10', '20:00', '23:00');
update public.reservations set status = 'seated' where id = 'cr06_test_fail';
do $$ begin
  begin
    update public.reservations set status = 'cancelled' where id = 'cr06_test_fail';
    raise exception 'close failure unexpectedly succeeded';
  exception when others then
    if SQLERRM <> 'CR06 injected close failure' then raise; end if;
  end;
  if (select status from public.reservations where id = 'cr06_test_fail') <> 'seated'
    then raise exception 'close failure committed cancellation'; end if;
  if not exists (select 1 from public.table_occupancy where reservation_id = 'cr06_test_fail' and freed_at is null)
    then raise exception 'close failure lost occupancy'; end if;
end $$;
select 'CR06 transaction regression PASS' as result;
rollback;
