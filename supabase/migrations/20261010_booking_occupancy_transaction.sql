-- CR06: targeted migration; apply before deploying booking.js.
-- Fail closed on existing drift. Resolve reported rows explicitly, then retry.
begin;
lock table public.reservations, public.table_occupancy in share row exclusive mode;
do $$
begin
  if exists (
    select 1 from public.reservations r
    where r.status = 'seated' and not exists (
      select 1 from public.table_occupancy o
      where o.reservation_id = r.id and o.table_id = r.table_id
        and o.source = 'reservation' and o.freed_at is null
    )
  ) or exists (
    select 1 from public.table_occupancy o
    left join public.reservations r on r.id = o.reservation_id
    where o.freed_at is null and (o.source = 'reservation' or o.reservation_id is not null)
      and (o.source <> 'reservation' or r.id is null or r.status <> 'seated' or r.table_id <> o.table_id)
  ) then
    raise exception 'CR06 preflight: reservation occupancy drift; reconcile explicitly before migration';
  end if;
end $$;

create or replace function public.sync_reservation_occupancy()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if TG_OP = 'UPDATE' then
    -- Preserve the current prohibition on relocation after guests sit down.
    if OLD.status = 'seated' and
      (NEW.table_id, NEW.date, NEW.time_from, NEW.time_to) is distinct from
      (OLD.table_id, OLD.date, OLD.time_from, OLD.time_to) then
      raise exception using errcode = '23514', message = 'Seated reservation cannot be relocated';
    end if;
    if NEW.status is not distinct from OLD.status then return NEW; end if;
    if not (
      (OLD.status = 'pending' and NEW.status in ('confirmed', 'cancelled')) or
      (OLD.status = 'confirmed' and NEW.status in ('seated', 'completed', 'no_show', 'cancelled')) or
      (OLD.status = 'seated' and NEW.status in ('completed', 'no_show', 'cancelled'))
    ) then
      raise exception using errcode = '23514', message = 'Invalid reservation status transition';
    end if;
  end if;

  if NEW.status = 'seated' then
    -- No ON CONFLICT: a walk-in or another reservation must roll back seating.
    insert into public.table_occupancy (id, table_id, source, reservation_id, occupied_since)
    values ('occ_db_' || gen_random_uuid()::text, NEW.table_id, 'reservation', NEW.id, now());
  elsif NEW.status in ('completed', 'no_show', 'cancelled') then
    update public.table_occupancy set freed_at = now()
    where reservation_id = NEW.id and freed_at is null;
  end if;
  return NEW;
end $$;

-- Invoker privileges: no SECURITY DEFINER escalation and no callable guest RPC.
revoke all on function public.sync_reservation_occupancy() from public;
drop trigger if exists reservations_sync_occupancy on public.reservations;
create trigger reservations_sync_occupancy
  after insert or update of status, table_id, date, time_from, time_to
  on public.reservations for each row execute function public.sync_reservation_occupancy();
commit;

-- DDL rollback ONLY after restoring the previous app (its second-request
-- occupancy writes require the trigger to be absent). Historical rows remain.
-- begin;
-- drop trigger if exists reservations_sync_occupancy on public.reservations;
-- drop function if exists public.sync_reservation_occupancy();
-- commit;
