-- Additive: no data rewrite or uniqueness constraint at installation.
-- The atomic guarantee starts when the RPC-backed application is active.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.move_team_member_atomic(p_id text, p_direction text, p_expected jsonb)
returns setof public.team_members
language plpgsql security invoker
set search_path = pg_catalog, public
set lock_timeout = '2s'
as $$
declare
  current_snapshot jsonb;
  ordered_ids text[];
  position integer;
  neighbor integer;
  first_order integer;
  second_order integer;
  changed integer;
begin
  if p_direction is null or p_direction not in ('up', 'down') then
    raise sqlstate 'PT400' using message = 'Направление должно быть up или down';
  end if;
  if p_id is null or btrim(p_id) = '' then
    raise sqlstate 'PT400' using message = 'Участник не найден';
  end if;
  -- Unlike an advisory lock, this also excludes ordinary INSERT/UPDATE/DELETE.
  -- Readers remain available. Re-read only after the lock, at READ COMMITTED.
  lock table public.team_members in share row exclusive mode;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'sort_order', t.sort_order)
                          order by t.sort_order, t.id), '[]'::jsonb),
         array_agg(t.id order by t.sort_order, t.id)
    into current_snapshot, ordered_ids from public.team_members t;
  position := array_position(ordered_ids, p_id);
  if position is null then
    raise sqlstate 'PT400' using message = 'Участник не найден';
  end if;
  if p_expected is distinct from current_snapshot then
    raise sqlstate 'PT409' using message = 'Порядок уже изменён. Обновите список и повторите действие.';
  end if;
  neighbor := position + case when p_direction = 'up' then -1 else 1 end;
  if neighbor < 1 or neighbor > array_length(ordered_ids, 1) then
    return query select t.* from public.team_members t order by t.sort_order, t.id;
    return;
  end if;
  select t.sort_order into first_order from public.team_members t where t.id = p_id;
  select t.sort_order into second_order from public.team_members t where t.id = ordered_ids[neighbor];
  if exists (select 1 from public.team_members group by sort_order having count(*) > 1) then
    -- Any ties can move a third row during a swap. Repair only for a real
    -- move, preserving the existing deterministic total order before swapping.
    with ranked as (
      select t.id, (row_number() over (order by t.sort_order, t.id) - 1)::integer as rank
      from public.team_members t
    )
    update public.team_members t set sort_order = ranked.rank
      from ranked where t.id = ranked.id and t.sort_order is distinct from ranked.rank;
    -- A trigger that silently skips a repair must not produce a false success.
    if exists (
      select 1 from public.team_members t
      join unnest(ordered_ids) with ordinality as expected(id, rank) on expected.id = t.id
      where t.sort_order <> expected.rank - 1
    ) then
      raise exception 'Не удалось сохранить порядок';
    end if;
    first_order := position - 1;
    second_order := neighbor - 1;
  end if;
  update public.team_members set sort_order = second_order where id = p_id;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Не удалось сохранить порядок'; end if;
  update public.team_members set sort_order = first_order where id = ordered_ids[neighbor];
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Не удалось сохранить порядок'; end if;
  return query select t.* from public.team_members t order by t.sort_order, t.id;
end;
$$;
revoke all on function public.move_team_member_atomic(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.move_team_member_atomic(text, text, jsonb) to service_role;

create or replace function public.move_cocktail_atomic(p_id text, p_direction text, p_expected jsonb)
returns setof public.cocktails
language plpgsql security invoker
set search_path = pg_catalog, public
set lock_timeout = '2s'
as $$
declare
  current_snapshot jsonb;
  ordered_ids text[];
  position integer;
  neighbor integer;
  first_order integer;
  second_order integer;
  changed integer;
begin
  if p_direction is null or p_direction not in ('up', 'down') then
    raise sqlstate 'PT400' using message = 'Направление должно быть up или down';
  end if;
  if p_id is null or btrim(p_id) = '' then
    raise sqlstate 'PT400' using message = 'Коктейль не найден';
  end if;
  -- Unlike an advisory lock, this also excludes ordinary INSERT/UPDATE/DELETE.
  -- Readers remain available. Re-read only after the lock, at READ COMMITTED.
  lock table public.cocktails in share row exclusive mode;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'sort_order', t.sort_order)
                          order by t.sort_order, t.id), '[]'::jsonb),
         array_agg(t.id order by t.sort_order, t.id)
    into current_snapshot, ordered_ids from public.cocktails t;
  position := array_position(ordered_ids, p_id);
  if position is null then
    raise sqlstate 'PT400' using message = 'Коктейль не найден';
  end if;
  if p_expected is distinct from current_snapshot then
    raise sqlstate 'PT409' using message = 'Порядок уже изменён. Обновите список и повторите действие.';
  end if;
  neighbor := position + case when p_direction = 'up' then -1 else 1 end;
  if neighbor < 1 or neighbor > array_length(ordered_ids, 1) then
    return query select t.* from public.cocktails t order by t.sort_order, t.id;
    return;
  end if;
  select t.sort_order into first_order from public.cocktails t where t.id = p_id;
  select t.sort_order into second_order from public.cocktails t where t.id = ordered_ids[neighbor];
  if exists (select 1 from public.cocktails group by sort_order having count(*) > 1) then
    -- Any ties can move a third row during a swap. Repair only for a real
    -- move, preserving the existing deterministic total order before swapping.
    with ranked as (
      select t.id, (row_number() over (order by t.sort_order, t.id) - 1)::integer as rank
      from public.cocktails t
    )
    update public.cocktails t set sort_order = ranked.rank
      from ranked where t.id = ranked.id and t.sort_order is distinct from ranked.rank;
    -- A trigger that silently skips a repair must not produce a false success.
    if exists (
      select 1 from public.cocktails t
      join unnest(ordered_ids) with ordinality as expected(id, rank) on expected.id = t.id
      where t.sort_order <> expected.rank - 1
    ) then
      raise exception 'Не удалось сохранить порядок';
    end if;
    first_order := position - 1;
    second_order := neighbor - 1;
  end if;
  update public.cocktails set sort_order = second_order where id = p_id;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Не удалось сохранить порядок'; end if;
  update public.cocktails set sort_order = first_order where id = ordered_ids[neighbor];
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Не удалось сохранить порядок'; end if;
  return query select t.* from public.cocktails t order by t.sort_order, t.id;
end;
$$;
revoke all on function public.move_cocktail_atomic(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.move_cocktail_atomic(text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
