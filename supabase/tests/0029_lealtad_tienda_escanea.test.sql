-- =====================================================================
-- Pruebas de 0029: la tienda escanea el QR del cliente.
-- =====================================================================

\set ON_ERROR_STOP on

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

\i supabase/seed/viva_jugos_mx.sql
\i supabase/seed/viva_menu_base.sql
begin;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-000000000001', 'duena9@viva.mx'),
  ('ffffffff-0000-4000-8000-000000000002', 'cajero9@viva.mx'),
  ('ffffffff-0000-4000-8000-000000000003', 'fulano@correo.mx'),
  ('ffffffff-0000-4000-8000-000000000004', 'extrano@correo.mx');
insert into public.profiles (id, first_name, last_name)
values ('ffffffff-0000-4000-8000-000000000003', 'Fulano', 'Pérez')
on conflict (id) do update set first_name = excluded.first_name, last_name = excluded.last_name;
select app.grant_restaurant_role('duena9@viva.mx', '11111111-1111-4111-8111-111111111111', 'owner');
select app.grant_restaurant_role('cajero9@viva.mx', '11111111-1111-4111-8111-111111111111', 'staff');

update public.loyalty_programs set enabled = true, points_per_visit = 50, visit_cooldown_hours = 20
 where restaurant_id = '11111111-1111-4111-8111-111111111111';
insert into public.rewards (tenant_id, name, cost_points) values
  ('11111111-1111-4111-8111-111111111111', 'Jugo gratis', 100),
  ('11111111-1111-4111-8111-111111111111', 'Café gratis', 60);

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

-- El cliente saca su QR.
select pg_temp.como('ffffffff-0000-4000-8000-000000000003');
create temp table qr as select (public.my_loyalty_qr() ->> 'payload') as p;
grant select on qr to authenticated;
-- El cliente no puede leer los secretos ni sumarse puntos él solo.
select pg_temp.esperar_error($$select * from public.customer_qr_keys$$, 'permission denied');
select pg_temp.esperar_error($$select public.staff_add_visit('33333333-3333-4333-8333-333333333333', (select p from qr))$$, 'staff_only');

-- Un extraño tampoco.
select pg_temp.como('ffffffff-0000-4000-8000-000000000004');
select pg_temp.esperar_error($$select public.staff_scan_customer('33333333-3333-4333-8333-333333333333', (select p from qr))$$, 'staff_only');

-- El cajero escanea: ve a Fulano con 0 puntos.
select pg_temp.como('ffffffff-0000-4000-8000-000000000002');
do $$
declare v jsonb := public.staff_scan_customer('33333333-3333-4333-8333-333333333333', (select p from qr));
begin
  if v ->> 'name' <> 'Fulano Pérez' or (v ->> 'points')::int <> 0 or not (v ->> 'can_visit')::boolean then
    raise exception 'Ficha incorrecta: %', v;
  end if;
end $$;

-- QR alterado o de otra persona: no sirve.
select pg_temp.esperar_error($$select public.staff_scan_customer('33333333-3333-4333-8333-333333333333', 'VIVA1.ffffffff-0000-4000-8000-000000000003.AAAAAAAAAA')$$, 'customer_qr_expired');
select pg_temp.esperar_error($$select public.staff_scan_customer('33333333-3333-4333-8333-333333333333', 'hola')$$, 'customer_qr_invalid');

-- Suma visita; la segunda el mismo día se rechaza.
do $$
declare v jsonb := public.staff_add_visit('33333333-3333-4333-8333-333333333333', (select p from qr));
begin
  if (v ->> 'points')::int <> 50 or (v ->> 'added')::int <> 50 or (v ->> 'can_visit')::boolean then
    raise exception 'Visita mal sumada: %', v;
  end if;
end $$;
select pg_temp.esperar_error($$select public.staff_add_visit('33333333-3333-4333-8333-333333333333', (select p from qr))$$, 'too_soon');

-- Con 50 puntos no le alcanza el jugo (100); el café (60) tampoco.
select pg_temp.esperar_error(
  $$select public.staff_give_reward('33333333-3333-4333-8333-333333333333', (select p from qr),
      (select id from public.rewards where name = 'Jugo gratis'))$$, 'not_enough_points');

-- Pasan 2 días y vuelve: 100 puntos, ya puede el jugo.
reset role;
update public.loyalty_transactions set created_at = now() - interval '2 days'
 where account_id = (select id from public.loyalty_accounts where user_id = 'ffffffff-0000-4000-8000-000000000003');
select pg_temp.como('ffffffff-0000-4000-8000-000000000002');
do $$
declare v jsonb := public.staff_add_visit('33333333-3333-4333-8333-333333333333', (select p from qr));
begin
  if (v ->> 'points')::int <> 100
     or not exists (select 1 from jsonb_array_elements(v -> 'rewards') r
                     where r ->> 'name' = 'Jugo gratis' and (r ->> 'eligible')::boolean) then
    raise exception 'Debería alcanzarle el jugo: %', v;
  end if;
end $$;

-- Entrega el jugo: puntos a 0 y queda registrado con el cajero.
do $$
declare v jsonb := public.staff_give_reward('33333333-3333-4333-8333-333333333333', (select p from qr),
                     (select id from public.rewards where name = 'Jugo gratis'));
begin
  if (v ->> 'points')::int <> 0 or v ->> 'given' <> 'Jugo gratis' then
    raise exception 'Entrega incorrecta: %', v;
  end if;
end $$;
do $$
declare r record;
begin
  select * into r from public.given_rewards('11111111-1111-4111-8111-111111111111') limit 1;
  if r.reward_name <> 'Jugo gratis' or r.status <> 'used' or r.customer_name <> 'Fulano Pérez'
     or r.staff_name <> 'cajero9' or r.used_at is null then
    raise exception 'Historial incorrecto: %', row_to_json(r);
  end if;
end $$;

-- El cliente no ve el historial del negocio.
select pg_temp.como('ffffffff-0000-4000-8000-000000000003');
select pg_temp.esperar_error($$select * from public.given_rewards('11111111-1111-4111-8111-111111111111')$$, 'staff_only');
reset role;

rollback;
\echo 'OK 0029: la tienda escanea el QR del cliente, suma visitas y entrega recompensas'
