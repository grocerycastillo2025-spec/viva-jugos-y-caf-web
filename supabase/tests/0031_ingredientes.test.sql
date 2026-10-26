-- =====================================================================
-- Pruebas de 0031: ingredientes que arrastran productos y opciones.
-- =====================================================================

\set ON_ERROR_STOP on

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

\i supabase/seed/viva_jugos_mx.sql
\i supabase/seed/viva_menu_base.sql
\i supabase/seed/viva_ingredientes.sql
begin;

insert into auth.users (id, email) values
  ('abababab-0000-4000-8000-000000000001', 'duena31@viva.mx'),
  ('abababab-0000-4000-8000-000000000002', 'cliente31@correo.mx');
select app.grant_restaurant_role('duena31@viva.mx', '11111111-1111-4111-8111-111111111111', 'owner');

create or replace function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  if p_user is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
end $$;
create or replace function pg_temp.esperar_error(p_sql text, p_contiene text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'SE ESPERABA ERROR (%): %', p_contiene, p_sql;
exception when others then
  if sqlerrm like 'SE ESPERABA ERROR%' then raise; end if;
  if p_contiene is not null and position(p_contiene in sqlerrm) = 0 then
    raise exception 'Error distinto al esperado (%): %', p_contiene, sqlerrm;
  end if;
end $$;

-- El cliente ve los ingredientes pero no puede apagarlos.
select pg_temp.como('abababab-0000-4000-8000-000000000002');
do $$ begin
  if (select count(*) from public.ingredients) < 20 then raise exception 'cliente no ve ingredientes'; end if;
end $$;
select pg_temp.esperar_error(
  $$select public.ingredient_impact((select id from public.ingredients where name = 'Naranja'))$$, 'owner_only');
update public.ingredients set available = false where name = 'Naranja';
reset role;
do $$ begin
  if not (select available from public.ingredients where name = 'Naranja') then raise exception 'cliente apagó'; end if;
end $$;

-- La dueña consulta el impacto y apaga Naranja con 2 productos y la opción.
select pg_temp.como('abababab-0000-4000-8000-000000000001');
do $$
declare v jsonb := public.ingredient_impact((select id from public.ingredients where name = 'Naranja'));
begin
  if jsonb_array_length(v -> 'items') <> 3 or jsonb_array_length(v -> 'modifiers') <> 1 then
    raise exception 'impacto incorrecto: %', v;
  end if;
end $$;
do $$
declare v jsonb;
begin
  v := public.set_ingredient_available(
    (select id from public.ingredients where name = 'Naranja'), false,
    array(select id from public.catalog_items where name in ('Viva Juice', 'Anti Flu', 'Café')),  -- Café no lleva naranja
    array(select id from public.catalog_modifiers where clover_modifier_id = 'viva-mod-naranja'));
  if (v ->> 'items')::int <> 2 or (v ->> 'modifiers')::int <> 1 then raise exception 'set incorrecto: %', v; end if;
end $$;
reset role;
do $$ begin
  if (select available from public.catalog_items where name = 'Viva Juice')
     or (select available from public.catalog_items where name = 'Anti Flu')
     or not (select available from public.catalog_items where name = 'Jugo Verde')
     or not (select available from public.catalog_items where name = 'Café')
     or (select available from public.catalog_modifiers where clover_modifier_id = 'viva-mod-naranja')
     or (select available from public.ingredients where name = 'Naranja') then
    raise exception 'disponibilidad incorrecta tras apagar';
  end if;
end $$;

-- Con Naranja y Zanahoria apagadas, Viva Juice sigue faltando Zanahoria.
select pg_temp.como('abababab-0000-4000-8000-000000000001');
select public.set_ingredient_available((select id from public.ingredients where name = 'Zanahoria'), false, '{}', '{}');
do $$
declare v jsonb := public.ingredient_impact((select id from public.ingredients where name = 'Naranja'));
begin
  if not exists (select 1 from jsonb_array_elements(v -> 'items') e
                  where e ->> 'name' = 'Viva Juice' and e -> 'other_missing' ? 'Zanahoria') then
    raise exception 'other_missing incorrecto: %', v;
  end if;
end $$;

-- Prender Naranja y reactivar.
select public.set_ingredient_available(
  (select id from public.ingredients where name = 'Naranja'), true,
  array(select id from public.catalog_items where name in ('Viva Juice', 'Anti Flu')),
  array(select id from public.catalog_modifiers where clover_modifier_id = 'viva-mod-naranja'));
reset role;
do $$ begin
  if not (select available from public.catalog_items where name = 'Anti Flu')
     or not (select available from public.catalog_modifiers where clover_modifier_id = 'viva-mod-naranja') then
    raise exception 'no se reactivó';
  end if;
end $$;

rollback;
\echo 'OK 0031: ingredientes apagan y prenden productos y opciones'
