#!/usr/bin/env bash
# Isolated PostgreSQL only. Usage: bash this-file cats-restore-check-<id>
set -euo pipefail
container=${1:?isolated Docker container required}
[[ "$container" == cats-restore-check-* ]] || { echo 'Refusing non-test container' >&2; exit 2; }
[[ "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")" == none ]] || { echo 'Test container must use network none' >&2; exit 2; }
psql_test() { docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U supabase_admin -d postgres; }
cleanup() {
  psql_test <<'SQL'
begin;
delete from public.table_occupancy where id like 'cr06_race_%' or reservation_id like 'cr06_race_%';
delete from public.reservations where id like 'cr06_race_%';
commit;
SQL
}
trap cleanup EXIT
cleanup
psql_test <<'SQL'
begin;
set local role service_role;
insert into public.reservations (id,table_id,status,date,time_from,time_to) values
('cr06_race_finish','CR06_RACE_A','confirmed','2099-10-10','20:00','23:00'),
('cr06_race_walkin','CR06_RACE_B','confirmed','2099-10-10','20:00','23:00'),
('cr06_race_seat','CR06_RACE_C','confirmed','2099-10-10','20:00','23:00');
commit;
SQL
# The advisory lock is only a visible readiness marker. The actual writes are
# serialized by PostgreSQL reservation row locks and occupancy unique index.
run_pair() {
  local holder_sql=$1 waiter_sql=$2 holder_pid holder_code=0 waiter_code=0 ready=false
  printf 'begin; set local role service_role; %s select pg_advisory_xact_lock(9061010); select pg_sleep(2); commit;\n' "$holder_sql" | psql_test &
  holder_pid=$!
  for attempt in {1..100}; do
    if [[ "$(printf "select exists(select 1 from pg_locks where locktype='advisory' and objid=9061010 and granted);" | psql_test | tr -d '[:space:]')" == t ]]; then ready=true; break; fi
    sleep 0.02
  done
  if [[ "$ready" != true ]]; then wait "$holder_pid" || holder_code=$?; echo 'Holder readiness failed' >&2; return 1; fi
  printf 'begin; set local role service_role; %s commit;\n' "$waiter_sql" | psql_test || waiter_code=$?
  wait "$holder_pid" || holder_code=$?
  [[ "$holder_code" == 0 && "$waiter_code" == 0 ]]
}
run_pair \
  "update public.reservations set status='seated' where id='cr06_race_finish';" \
  "update public.reservations set status='completed' where id='cr06_race_finish';"
psql_test <<'SQL'
set role service_role;
do $$ begin
  if (select status from public.reservations where id='cr06_race_finish') <> 'completed'
    or exists(select 1 from public.table_occupancy where reservation_id='cr06_race_finish' and freed_at is null)
    then raise exception 'seat/completion race drift'; end if;
end $$;
SQL
run_pair \
  "insert into public.table_occupancy(id,table_id) values('cr06_race_walkin_occ','CR06_RACE_B');" \
  "do \$\$ begin begin update public.reservations set status='seated' where id='cr06_race_walkin'; raise exception 'walk-in conflict unexpectedly succeeded'; exception when unique_violation then null; end; end \$\$;"
run_pair \
  "update public.reservations set status='seated' where id='cr06_race_seat';" \
  "do \$\$ begin begin insert into public.table_occupancy(id,table_id) values('cr06_race_late_walkin','CR06_RACE_C'); raise exception 'seating conflict unexpectedly succeeded'; exception when unique_violation then null; end; end \$\$;"
psql_test <<'SQL'
set role service_role;
do $$ begin
  if (select status from public.reservations where id='cr06_race_walkin') <> 'confirmed'
    or exists(select 1 from public.table_occupancy where reservation_id='cr06_race_walkin' and freed_at is null)
    then raise exception 'walk-in/seating conflict committed partial state'; end if;
  if (select status from public.reservations where id='cr06_race_seat') <> 'seated'
    or not exists(select 1 from public.table_occupancy where reservation_id='cr06_race_seat' and freed_at is null)
    then raise exception 'seating/walk-in conflict lost reservation occupancy'; end if;
end $$;
update public.reservations set status='cancelled' where id='cr06_race_seat' and status='seated';
do $$ begin
  if exists(select 1 from public.table_occupancy where reservation_id='cr06_race_seat' and freed_at is null)
    then raise exception 'service_role cancellation did not close occupancy'; end if;
end $$;
SQL
echo 'PASS CR06 real concurrent sessions under service_role: completion, both walk-in race orders, cancellation'
