-- Additive: old writers continue to work and also advance the revision.
-- Rollback of application code keeps this column and trigger in place.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.app_config
  add column if not exists revision bigint not null default 0;

create or replace function public.bump_app_config_revision()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    new.revision = 0;
  else
    new.revision = old.revision + 1;
  end if;
  return new;
end;
$$;
revoke all on function public.bump_app_config_revision() from public;

drop trigger if exists app_config_revision on public.app_config;
create trigger app_config_revision
  before insert or update on public.app_config
  for each row execute function public.bump_app_config_revision();
notify pgrst, 'reload schema';
commit;
