-- The runner substitutes only two literal, owned table/RPC names. This fixture
-- runs on the actual schema in an offline disposable PostgreSQL, never live DB.
truncate public.@TABLE@;
insert into public.@TABLE@(id,name,sort_order,active) values
 ('a','Kept A',0,true), ('b','Kept B',1,false), ('c','Kept C',2,true);

create or replace function public.reorder_fixture_fail_second()
returns trigger language plpgsql as $$
begin
 if new.id = 'b' and current_setting('cats.fixture.fail', true) = 'raise' then
   raise exception 'fixture second row failed';
 end if;
 if new.id = 'b' and current_setting('cats.fixture.fail', true) = 'skip' then return null; end if;
 return new;
end;
$$;
create trigger reorder_fixture_fail_second before update on public.@TABLE@
 for each row execute function public.reorder_fixture_fail_second();

-- ACL checks include inherited PUBLIC grants, invoker/search_path and the
-- actual service_role BYPASSRLS role (NOLOGIN, no password).
do $$
declare fn oid := 'public.@RPC@(text,text,jsonb)'::regprocedure;
begin
 if has_function_privilege('anon',fn,'execute') or has_function_privilege('authenticated',fn,'execute')
    or not has_function_privilege('service_role',fn,'execute') then raise exception 'RPC ACL drift'; end if;
 if exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid=fn and a.grantee=0 and a.privilege_type='EXECUTE')
    then raise exception 'PUBLIC can execute RPC'; end if;
 if (select prosecdef from pg_proc where oid=fn) then raise exception 'RPC is SECURITY DEFINER'; end if;
 if not (select proconfig @> array['search_path=pg_catalog, public','lock_timeout=2s'] from pg_proc where oid=fn)
    then raise exception 'RPC settings missing'; end if;
 if not (select relrowsecurity from pg_class where oid='public.@TABLE@'::regclass)
    then raise exception 'Existing RLS not enabled'; end if;
end $$;
set role anon;
do $$ begin
 if exists(select 1 from public.@TABLE@) then raise exception 'Anonymous RLS leak'; end if;
 begin perform public.@RPC@('a','down','[]'); raise exception 'Anonymous RPC allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
do $$ begin
 if exists(select 1 from public.@TABLE@) then raise exception 'Authenticated RLS leak'; end if;
 begin perform public.@RPC@('a','down','[]'); raise exception 'Authenticated RPC allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;

create function pg_temp.reorder_snapshot() returns jsonb language sql as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'sort_order',t.sort_order) order by t.sort_order,t.id),'[]')
 from public.@TABLE@ t;
$$;
create function pg_temp.reorder_full_rows() returns jsonb language sql as $$
 select jsonb_agg(to_jsonb(t) order by t.id) from public.@TABLE@ t;
$$;
create function pg_temp.reorder_metadata() returns jsonb language sql as $$
 select jsonb_agg(to_jsonb(t)-'sort_order'-'updated_at' order by t.id) from public.@TABLE@ t;
$$;

do $$
declare expected jsonb := pg_temp.reorder_snapshot(); before_rows jsonb := pg_temp.reorder_full_rows();
begin
 if (select count(*) from public.@TABLE@) <> 3 then raise exception 'service_role cannot read through RLS'; end if;
 -- On a second-row exception, the first UPDATE and its timestamp roll back.
 perform set_config('cats.fixture.fail','raise',true);
 begin
   perform public.@RPC@('a','down',expected);
   raise exception 'Expected second-row failure did not happen';
 exception when raise_exception then
   if sqlerrm <> 'fixture second row failed' then raise; end if;
 end;
 if pg_temp.reorder_full_rows() <> before_rows then raise exception 'Second-row failure partially committed'; end if;
 -- A trigger returning NULL must also roll the first row back.
 perform set_config('cats.fixture.fail','skip',true);
 begin
   perform public.@RPC@('a','down',expected);
   raise exception 'Expected skipped-row failure did not happen';
 exception when raise_exception then
   if sqlerrm <> 'Не удалось сохранить порядок' then raise; end if;
 end;
 if pg_temp.reorder_full_rows() <> before_rows then raise exception 'Skipped-row failure partially committed'; end if;
 perform set_config('cats.fixture.fail','',true);
 -- Invalid/missing/unknown IDs and invalid direction never mutate the list.
 begin perform public.@RPC@('missing','up',expected); raise exception 'Unknown ID accepted'; exception when sqlstate 'PT400' then null; end;
 begin perform public.@RPC@(null,'up',expected); raise exception 'NULL ID accepted'; exception when sqlstate 'PT400' then null; end;
 begin perform public.@RPC@('','up',expected); raise exception 'Empty ID accepted'; exception when sqlstate 'PT400' then null; end;
 begin perform public.@RPC@('a','sideways',expected); raise exception 'Invalid direction accepted'; exception when sqlstate 'PT400' then null; end;
 begin perform public.@RPC@('a',null,expected); raise exception 'NULL direction accepted'; exception when sqlstate 'PT400' then null; end;
 begin perform public.@RPC@('a','down',null); raise exception 'NULL snapshot accepted'; exception when sqlstate 'PT409' then null; end;
 begin perform public.@RPC@('a','down','[]'); raise exception 'Stale snapshot accepted'; exception when sqlstate 'PT409' then null; end;
 begin perform public.@RPC@('a','down','{}'); raise exception 'Malformed snapshot accepted'; exception when sqlstate 'PT409' then null; end;
 perform public.@RPC@('a','up',expected);
 perform public.@RPC@('c','down',expected);
 if pg_temp.reorder_full_rows() <> before_rows then raise exception 'Edge/invalid action changed a row'; end if;

 -- Ordinary metadata updates are intentionally outside the order snapshot.
 update public.@TABLE@ set name='Edited metadata' where id='a';
 perform public.@RPC@('a','down',expected);
 if (select array_agg(id order by sort_order,id) from public.@TABLE@) <> array['b','a','c']
    or (select name from public.@TABLE@ where id='a') <> 'Edited metadata' then raise exception 'Metadata/move lost'; end if;
 -- Insert/delete/reorder after a snapshot must reject the whole move.
 expected := pg_temp.reorder_snapshot();
 insert into public.@TABLE@(id,name,sort_order) values('d','D',3);
 before_rows := pg_temp.reorder_full_rows();
 begin perform public.@RPC@('a','down',expected); raise exception 'Stale insert accepted'; exception when sqlstate 'PT409' then null; end;
 if pg_temp.reorder_full_rows() <> before_rows then raise exception 'Stale insert mutated'; end if;
 expected := pg_temp.reorder_snapshot(); delete from public.@TABLE@ where id='d'; before_rows := pg_temp.reorder_full_rows();
 begin perform public.@RPC@('a','down',expected); raise exception 'Stale delete accepted'; exception when sqlstate 'PT409' then null; end;
 if pg_temp.reorder_full_rows() <> before_rows then raise exception 'Stale delete mutated'; end if;
 expected := pg_temp.reorder_snapshot(); update public.@TABLE@ set sort_order=4 where id='c'; before_rows := pg_temp.reorder_full_rows();
 begin perform public.@RPC@('a','down',expected); raise exception 'Stale reorder accepted'; exception when sqlstate 'PT409' then null; end;
 if pg_temp.reorder_full_rows() <> before_rows then raise exception 'Stale reorder mutated'; end if;
end $$;

truncate public.@TABLE@;
insert into public.@TABLE@(id,name,sort_order,active) values
 ('a','Tie A',7,true), ('b','Tie B',7,false), ('c','Tie C',19,true);
do $$
declare expected jsonb := pg_temp.reorder_snapshot(); before_rows jsonb := pg_temp.reorder_full_rows(); metadata jsonb := pg_temp.reorder_metadata();
begin
 -- A boundary no-op must not repair ties or touch timestamps.
 perform public.@RPC@('a','up',expected);
 if pg_temp.reorder_full_rows() <> before_rows then raise exception 'Tied edge was rewritten'; end if;
 -- The repair itself participates in rollback on trigger failure.
 perform set_config('cats.fixture.fail','raise',true);
 begin perform public.@RPC@('a','down',expected); raise exception 'Repair failure accepted';
 exception when raise_exception then if sqlerrm <> 'fixture second row failed' then raise; end if; end;
 if pg_temp.reorder_full_rows() <> before_rows then raise exception 'Tied repair partially committed'; end if;
 perform set_config('cats.fixture.fail','',true);
 perform public.@RPC@('b','up',expected);
 if (select array_agg(id order by sort_order,id) from public.@TABLE@) <> array['b','a','c'] then raise exception 'Tied pair did not move'; end if;
 if pg_temp.reorder_metadata() <> metadata then raise exception 'Tie repair lost non-order fields'; end if;
 if (select count(distinct sort_order) from public.@TABLE@) <> 3 then raise exception 'Tie repair did not give deterministic ranks'; end if;
end $$;

truncate public.@TABLE@;
insert into public.@TABLE@(id,name,sort_order,active) values
 ('z','Low rank Z',0,true), ('a','Tied A',1,true), ('b','Tied B',1,false);
do $$
declare metadata jsonb := pg_temp.reorder_metadata();
begin
 -- Unequal adjacent ranks still need repair when a third row shares a rank.
 perform public.@RPC@('z','down',pg_temp.reorder_snapshot());
 if (select array_agg(id order by sort_order,id) from public.@TABLE@) <> array['a','z','b'] then raise exception 'Move jumped over third tied row'; end if;
 if pg_temp.reorder_metadata() <> metadata then raise exception 'Third-row repair lost metadata'; end if;
end $$;
reset role;
drop trigger reorder_fixture_fail_second on public.@TABLE@;
drop function pg_temp.reorder_snapshot(), pg_temp.reorder_full_rows(), pg_temp.reorder_metadata();
