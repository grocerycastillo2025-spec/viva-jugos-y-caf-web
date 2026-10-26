-- =====================================================================
-- 0031_ingredientes.sql
-- Ingredientes que se agotan y arrastran a los productos que los usan.
--
--   ingredients            Naranja, Zanahoria, Leche de almendra...
--   item_ingredients       qué productos llevan qué ingredientes
--   catalog_modifiers.ingredient_id
--                          la opción "Naranja" de "Crea el tuyo" ES el
--                          ingrediente Naranja
--
-- Al apagar un ingrediente, el panel pregunta qué productos y opciones
-- apagar también (`ingredient_impact`) y lo hace todo de una vez
-- (`set_ingredient_available`). Al prenderlo, propone reactivar los que
-- ya tienen todos sus ingredientes.
--
-- `app.autolink_ingredients` liga sola los ingredientes con los productos
-- cuya descripción los menciona y con las opciones del mismo nombre, para
-- arrancar con el menú que ya existe.
--
-- MIGRACION NUEVA. Las 0001 a 0030 estan aplicadas y no se tocan.
-- =====================================================================

create table if not exists public.ingredients (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references public.stores(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  available  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_ingredients_name on public.ingredients(store_id, lower(btrim(name)));

create table if not exists public.item_ingredients (
  item_id       uuid not null references public.catalog_items(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  primary key (item_id, ingredient_id)
);
create index if not exists idx_item_ingredients_ing on public.item_ingredients(ingredient_id);

alter table public.catalog_modifiers
  add column if not exists ingredient_id uuid references public.ingredients(id) on delete set null;

alter table public.ingredients enable row level security;
alter table public.item_ingredients enable row level security;

drop policy if exists ingredients_read on public.ingredients;
create policy ingredients_read on public.ingredients for select to anon, authenticated using (true);
drop policy if exists ingredients_owner_all on public.ingredients;
create policy ingredients_owner_all on public.ingredients
  for all to authenticated
  using (coalesce(app.owns_own_catalog(store_id), false))
  with check (coalesce(app.owns_own_catalog(store_id), false));

drop policy if exists item_ingredients_read on public.item_ingredients;
create policy item_ingredients_read on public.item_ingredients for select to anon, authenticated using (true);
drop policy if exists item_ingredients_owner_all on public.item_ingredients;
create policy item_ingredients_owner_all on public.item_ingredients
  for all to authenticated
  using (exists (select 1 from public.catalog_items i
                  where i.id = item_ingredients.item_id and coalesce(app.owns_own_catalog(i.store_id), false)))
  with check (exists (select 1 from public.catalog_items i
                       where i.id = item_ingredients.item_id and coalesce(app.owns_own_catalog(i.store_id), false)));

grant select on public.ingredients, public.item_ingredients to anon, authenticated;
grant insert, update, delete on public.ingredients, public.item_ingredients to authenticated;

-- ---------------------------------------------------------------------
-- Qué se afecta si se apaga (o prende) un ingrediente
-- ---------------------------------------------------------------------
create or replace function public.ingredient_impact(p_ingredient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_ing public.ingredients%rowtype;
begin
  select * into v_ing from public.ingredients where id = p_ingredient_id;
  if not found or not coalesce(app.owns_own_catalog(v_ing.store_id), false) then
    raise exception 'owner_only' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ingredient', jsonb_build_object('id', v_ing.id, 'name', v_ing.name, 'available', v_ing.available),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'name', i.name, 'available', i.available,
               -- Otros ingredientes del producto que siguen apagados: al
               -- prender este, el producto aún no se puede reactivar.
               'other_missing', coalesce((
                 select jsonb_agg(o.name order by o.name)
                   from public.item_ingredients x
                   join public.ingredients o on o.id = x.ingredient_id
                  where x.item_id = i.id and o.id <> v_ing.id and not o.available
               ), '[]'::jsonb))
             order by i.name)
        from public.item_ingredients li
        join public.catalog_items i on i.id = li.item_id
       where li.ingredient_id = v_ing.id and i.deleted_at is null
    ), '[]'::jsonb),
    'modifiers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'name', m.name, 'group', g.name, 'available', m.available)
             order by g.name, m.name)
        from public.catalog_modifiers m
        join public.catalog_modifier_groups g on g.id = m.modifier_group_id
       where m.ingredient_id = v_ing.id and m.deleted_at is null
    ), '[]'::jsonb)
  );
end;
$$;

-- Apaga/prende el ingrediente y, de una vez, los productos y opciones
-- que el dueño marcó. Solo toca los que de verdad usan ese ingrediente.
create or replace function public.set_ingredient_available(
  p_ingredient_id uuid,
  p_available     boolean,
  p_item_ids      uuid[] default '{}',
  p_modifier_ids  uuid[] default '{}'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_ing   public.ingredients%rowtype;
  v_items int;
  v_mods  int;
begin
  select * into v_ing from public.ingredients where id = p_ingredient_id for update;
  if not found or not coalesce(app.owns_own_catalog(v_ing.store_id), false) then
    raise exception 'owner_only' using errcode = '42501';
  end if;

  update public.ingredients set available = p_available where id = v_ing.id;

  update public.catalog_items i set available = p_available
   where i.id = any(coalesce(p_item_ids, '{}'))
     and exists (select 1 from public.item_ingredients x where x.item_id = i.id and x.ingredient_id = v_ing.id);
  get diagnostics v_items = row_count;

  update public.catalog_modifiers m set available = p_available
   where m.id = any(coalesce(p_modifier_ids, '{}')) and m.ingredient_id = v_ing.id;
  get diagnostics v_mods = row_count;

  return jsonb_build_object('items', v_items, 'modifiers', v_mods);
end;
$$;

revoke execute on function public.ingredient_impact(uuid) from public, anon;
revoke execute on function public.set_ingredient_available(uuid, boolean, uuid[], uuid[]) from public, anon;
grant execute on function public.ingredient_impact(uuid) to authenticated;
grant execute on function public.set_ingredient_available(uuid, boolean, uuid[], uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- Ligar solo: productos cuya descripción menciona el ingrediente y
-- opciones con el mismo nombre. No borra ligas que ya existan.
-- ---------------------------------------------------------------------
create or replace function app.autolink_ingredients(p_store_id uuid)
returns void
language sql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
  insert into public.item_ingredients (item_id, ingredient_id)
  select i.id, g.id
    from public.ingredients g
    join public.catalog_items i on i.store_id = g.store_id and i.deleted_at is null
    left join public.app_item_overrides o on o.store_id = i.store_id and o.clover_item_id = i.clover_item_id
   where g.store_id = p_store_id
     and (translate(lower(coalesce(o.marketing_copy, '')), 'áéíóú', 'aeiou')
            ~ ('(^|[^a-z])' || translate(lower(btrim(g.name)), 'áéíóú', 'aeiou') || '([^a-z]|$)')
          or lower(btrim(i.name)) = lower(btrim(g.name)))
  on conflict do nothing;

  update public.catalog_modifiers m set ingredient_id = g.id
    from public.ingredients g
   where g.store_id = p_store_id and m.store_id = p_store_id and m.ingredient_id is null
     and translate(lower(btrim(m.name)), 'áéíóú', 'aeiou') = translate(lower(btrim(g.name)), 'áéíóú', 'aeiou');
$$;
