#!/usr/bin/env bash
set -Eeuo pipefail
# No production credentials, ports, mounts, or network in the test container.
root=$(cd -- "$(dirname -- "$0")/.." && pwd -P)
name="cats-config-fixture-$$-$RANDOM"
owned=0
cleanup() {
  status=$?
  trap - EXIT
  if [[ $owned == 1 ]] && docker inspect "$name" >/dev/null 2>&1; then
    [[ $(docker inspect "$name" --format '{{index .Config.Labels "cats.config.fixture"}}') == true ]]
    docker rm -f "$name" >/dev/null
  fi
  exit "$status"
}
trap cleanup EXIT
command -v docker >/dev/null
! docker inspect "$name" >/dev/null 2>&1
owned=1
docker create --name "$name" --label cats.config.fixture=true --network none \
  --memory 256m --cpus 1 --pids-limit 128 --user postgres \
  --tmpfs /tmp:rw,mode=1777,size=128m --entrypoint bash postgres:15 -ceu '
  initdb -D /tmp/config-db -U postgres --auth-local=trust --auth-host=reject >/dev/null
  exec postgres -D /tmp/config-db -c listen_addresses= -c unix_socket_directories=/tmp
' >/dev/null
docker start "$name" >/dev/null
ready=0
for attempt in $(seq 1 60); do
  if docker exec "$name" pg_isready -h /tmp -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ $ready == 1 ]]
psql() { timeout 60 docker exec -e "PGAPPNAME=${PGAPPNAME:-cats-config-test}" -i "$name" psql -h /tmp -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql <<'SQL' >/dev/null
create table public.app_config(key text primary key, value jsonb not null default '{}', updated_at timestamptz not null default now());
insert into public.app_config values ('menu', '{"kept":"🐈","price":250}', now());
SQL
psql < "$root/supabase/migrations/20261014152121_app_config_revision.sql" >/dev/null
psql < "$root/supabase/migrations/20261014152121_app_config_revision.sql" >/dev/null
psql <<'SQL' >/dev/null
do $$ begin
 if (select value from public.app_config where key='menu') <> '{"kept":"🐈","price":250}'::jsonb then raise exception 'Migration changed data'; end if;
 if (select revision from public.app_config where key='menu') <> 0 then raise exception 'Migration reset revision'; end if;
end $$;
-- Even repeated writes in the same transaction must advance the revision.
begin;
update public.app_config set value=value where key='menu';
update public.app_config set value=value,revision=0 where key='menu';
commit;
do $$ begin
 if (select revision from public.app_config where key='menu') <> 2 then raise exception 'Revision not monotonic'; end if;
end $$;
SQL
psql < "$root/supabase/migrations/20261014152121_app_config_revision.sql" >/dev/null
[[ $(psql -Atc "select revision from public.app_config where key='menu'") == 2 ]]
# First writer holds its row lock; second sees the old revision but must wait
# and recheck its CAS predicate after the first transaction commits.
PGAPPNAME=cats-config-first psql <<'SQL' >/dev/null &
begin;
update public.app_config set value='{"winner":"first"}' where key='menu' and revision=2;
select pg_sleep(5);
commit;
SQL
first=$!
locked=0
for attempt in $(seq 1 50); do
  if [[ $(psql -Atc "select exists(select 1 from pg_stat_activity where application_name='cats-config-first' and wait_event='PgSleep')") == t ]]; then locked=1; break; fi
  sleep 0.05
done
[[ $locked == 1 ]]
psql <<'SQL' >/dev/null &
update public.app_config set value='{"winner":"second"}' where key='menu' and revision=2;
SQL
second=$!
wait "$first"
wait "$second"
psql <<'SQL' >/dev/null
do $$ begin
 if (select value from public.app_config where key='menu') <> '{"winner":"first"}'::jsonb then raise exception 'Concurrent update overwritten'; end if;
 if (select revision from public.app_config where key='menu') <> 3 then raise exception 'Stale update changed revision'; end if;
end $$;
begin;
update public.app_config set value='{"rolledBack":true}' where key='menu' and revision=3;
rollback;
do $$ begin
 if (select revision from public.app_config where key='menu') <> 3 then raise exception 'Rollback changed revision'; end if;
end $$;
create role service_role;
grant select,insert,update on public.app_config to service_role;
set role service_role;
insert into public.app_config(key,value,revision) values('new', '{}',99);
update public.app_config set value='{"legacy":true}' where key='new';
reset role;
do $$ begin
 if (select revision from public.app_config where key='new') <> 1 then raise exception 'Legacy writer trigger failed'; end if;
end $$;
SQL
echo 'PASS real PostgreSQL settings revision: data preserved, repeated migration, monotonic writes, concurrent CAS, rollback'
