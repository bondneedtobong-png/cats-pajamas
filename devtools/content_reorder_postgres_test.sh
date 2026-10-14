#!/usr/bin/env bash
set -Eeuo pipefail
# A dedicated Linux CI runner: offline, disposable PG, no credentials/mounts.
root=$(cd -- "$(dirname -- "$0")/.." && pwd -P)
name="cats-reorder-fixture-$$-$RANDOM"
owned=0
cleanup() {
  status=$?
  trap - EXIT
  if [[ $owned == 1 ]] && docker inspect "$name" >/dev/null 2>&1; then
    [[ $(docker inspect "$name" --format '{{index .Config.Labels "cats.reorder.fixture"}}') == true ]]
    docker rm -f -v "$name" >/dev/null
  fi
  exit "$status"
}
trap cleanup EXIT
command -v docker >/dev/null
! docker inspect "$name" >/dev/null 2>&1
owned=1
docker create --name "$name" --label cats.reorder.fixture=true --network none \
  --memory 256m --cpus 1 --pids-limit 128 --user postgres \
  --tmpfs /tmp:rw,mode=1777,size=128m --entrypoint bash postgres:17 -ceu '
  initdb -D /tmp/reorder-db -U postgres --auth-local=trust --auth-host=reject >/dev/null
  exec postgres -D /tmp/reorder-db -c listen_addresses= -c unix_socket_directories=/tmp
' >/dev/null
docker start "$name" >/dev/null
ready=0
for attempt in $(seq 1 60); do
  if docker exec "$name" pg_isready -h /tmp -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ $ready == 1 ]]
psql() { timeout 60 docker exec -e "PGAPPNAME=${PGAPPNAME:-cats-reorder-test}" -i "$name" psql -h /tmp -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql <<'SQL' >/dev/null
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
SQL
# Existing RLS/column/timestamp triggers are exercised from the actual schema.
psql < "$root/supabase/schema.sql" >/dev/null
psql <<'SQL' >/dev/null
-- Model an existing database before the new RPC migration. The current fresh
-- schema already includes these definitions, so remove only our two functions
-- here to prove first installation as well as subsequent migration replay.
drop function public.move_team_member_atomic(text,text,jsonb);
drop function public.move_cocktail_atomic(text,text,jsonb);
do $$ begin
 if to_regprocedure('public.move_team_member_atomic(text,text,jsonb)') is not null
    or to_regprocedure('public.move_cocktail_atomic(text,text,jsonb)') is not null
 then raise exception 'RPC pre-migration fixture was not reset'; end if;
end $$;
grant usage on schema public to anon,authenticated,service_role;
grant select on public.team_members,public.cocktails to anon,authenticated;
grant select,insert,update,delete,truncate on public.team_members,public.cocktails to service_role;
insert into public.team_members(id,name,sort_order) values('preserved','Kept team',17);
insert into public.cocktails(id,name,sort_order) values('preserved','Kept cocktail',17);
create table public.reorder_install_before as
 select 'team' as kind, to_jsonb(t) as value from public.team_members t
 union all select 'cocktails',to_jsonb(c) from public.cocktails c;
SQL
migration="$root/supabase/migrations/20261014202634_atomic_content_reorder.sql"
psql < "$migration" >/dev/null
psql < "$migration" >/dev/null
psql <<'SQL' >/dev/null
do $$ begin
 if exists(select 1 from public.reorder_install_before b where b.value is distinct from
   case b.kind when 'team' then (select to_jsonb(t) from public.team_members t where id='preserved')
   else (select to_jsonb(c) from public.cocktails c where id='preserved') end)
 then raise exception 'Replayed migration changed existing data'; end if;
end $$;
drop table public.reorder_install_before;
SQL

for table in team_members cocktails; do
  if [[ $table == team_members ]]; then rpc=move_team_member_atomic; else rpc=move_cocktail_atomic; fi
  sed -e "s/@TABLE@/$table/g" -e "s/@RPC@/$rpc/g" "$root/devtools/content_reorder_postgres.fixture.sql" | psql >/dev/null
  # Two overlapping moves must contend on the actual table lock. The loser
  # re-reads after the winner commits and rejects its stale complete snapshot.
  # Also prove regular INSERT/DELETE/UPDATE are covered by that same lock.
  for writer in move insert delete reorder; do
    psql -c "truncate public.$table; insert into public.$table(id,name,sort_order) values ('a','A',0),('b','B',1),('c','C',2);" >/dev/null
    expected='[{"id":"a","sort_order":0},{"id":"b","sort_order":1},{"id":"c","sort_order":2}]'
    case "$writer" in
      move) first_sql="select public.$rpc('a','down','$expected');"; result='b,a,c';;
      insert) first_sql="insert into public.$table(id,name,sort_order) values('d','D',3);"; result='a,b,c,d';;
      delete) first_sql="delete from public.$table where id='c';"; result='a,b';;
      reorder) first_sql="update public.$table set sort_order=4 where id='a';"; result='b,c,a';;
    esac
    first_app="cats-reorder-first-$table-$writer"
    second_app="cats-reorder-second-$table-$writer"
    PGAPPNAME="$first_app" psql <<SQL >/dev/null &
begin;
set local role service_role;
$first_sql
select pg_sleep(1.3);
commit;
SQL
    first=$!
    locked=0
    for attempt in $(seq 1 100); do
      if [[ $(psql -Atc "select exists(select 1 from pg_stat_activity where application_name='$first_app' and wait_event='PgSleep')") == t ]]; then locked=1; break; fi
      sleep 0.02
    done
    [[ $locked == 1 ]]
    PGAPPNAME="$second_app" psql <<SQL >/dev/null &
set role service_role;
do \$\$ begin
 begin perform public.$rpc('b','down','$expected'); raise exception 'Concurrent stale move accepted';
 exception when sqlstate 'PT409' then null; end;
end \$\$;
SQL
    second=$!
    waiting=0
    for attempt in $(seq 1 100); do
      if [[ $(psql -Atc "select exists(select 1 from pg_stat_activity a join pg_locks l on a.pid=l.pid where a.application_name='$second_app' and not l.granted and l.locktype='relation')") == t ]]; then waiting=1; break; fi
      sleep 0.02
    done
    [[ $waiting == 1 ]]
    wait "$first"
    wait "$second"
    [[ $(psql -Atc "select string_agg(id,',' order by sort_order,id) from public.$table") == "$result" ]]
    echo "PASS PostgreSQL $table overlapping $writer/move waits, then rejects stale snapshot without partial writes"
  done
done
echo 'PASS real PostgreSQL reorder: actual RLS/service_role/ACL, replay preserves data, second-row rollback, trigger skip, edge/invalid IDs, stale snapshots, metadata, tied pair/third-row repair'
