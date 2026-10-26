-- =====================================================================
-- 0029_lealtad_tienda_escanea.sql
-- La TIENDA escanea el QR del CLIENTE (al revés que 0021).
--
--   1. El cliente abre "Mi tarjeta": un QR personal que cambia cada 2
--      minutos (una captura vieja no sirve).
--   2. El cajero lo escanea en el panel: ve nombre, puntos y qué
--      recompensas ya alcanza.
--   3. "Sumar visita" (misma regla de horas entre visitas que 0021) y
--      "Entregar recompensa": descuenta los puntos y queda registrado
--      quién, qué, cuándo y qué cajero la dio.
--
-- El QR del local (0021) sigue funcionando; las dos formas conviven.
--
-- MIGRACION NUEVA. Las 0001 a 0028 estan aplicadas y no se tocan.
-- =====================================================================

-- Secreto por cliente para firmar su QR. Nadie lo lee desde la app.
create table if not exists public.customer_qr_keys (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  secret     text not null default md5(random()::text || clock_timestamp()::text),
  created_at timestamptz not null default now()
);
alter table public.customer_qr_keys enable row level security;
revoke all on public.customer_qr_keys from anon, authenticated;

-- Qué cajero sumó la visita.
alter table public.loyalty_transactions
  add column if not exists staff_id uuid references auth.users(id) on delete set null;

-- Ventanas de 2 minutos.
create or replace function app.customer_qr_window(p_at timestamptz default now())
returns bigint language sql stable
as $$ select floor(extract(epoch from p_at) / 120)::bigint $$;

create or replace function app.customer_qr_sig(p_secret text, p_user uuid, p_window bigint)
returns text language sql immutable
as $$ select upper(left(md5(p_secret || ':' || p_user::text || ':' || p_window::text), 10)) $$;

-- ---------------------------------------------------------------------
-- El cliente pide su QR
-- ---------------------------------------------------------------------
create or replace function public.my_loyalty_qr()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_user   uuid := auth.uid();
  v_secret text;
  v_window bigint := app.customer_qr_window();
  v_name   text;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  select coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), split_part(u.email::text, '@', 1))
    into v_name
    from auth.users u left join public.profiles p on p.id = u.id
   where u.id = v_user;
  insert into public.customer_qr_keys (user_id) values (v_user) on conflict (user_id) do nothing;
  select secret into v_secret from public.customer_qr_keys where user_id = v_user;
  return jsonb_build_object(
    'payload', 'VIVA1.' || v_user::text || '.' || app.customer_qr_sig(v_secret, v_user, v_window),
    'expires_at', to_timestamp((v_window + 1) * 120),
    'name', v_name
  );
end;
$$;

-- De un QR escaneado al cliente. Vale el de esta ventana y el anterior
-- (hasta 4 minutos), para quien lo abrió justo en el cambio.
create or replace function app.customer_from_qr(p_payload text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_parts  text[] := string_to_array(btrim(coalesce(p_payload, '')), '.');
  v_user   uuid;
  v_secret text;
  v_window bigint := app.customer_qr_window();
begin
  if array_length(v_parts, 1) <> 3 or v_parts[1] <> 'VIVA1'
     or v_parts[2] !~ '^[0-9a-f-]{36}$' then
    raise exception 'customer_qr_invalid' using errcode = '22023';
  end if;
  v_user := v_parts[2]::uuid;
  select secret into v_secret from public.customer_qr_keys where user_id = v_user;
  if v_secret is null then
    raise exception 'customer_qr_invalid' using errcode = '22023';
  end if;
  if upper(v_parts[3]) not in (app.customer_qr_sig(v_secret, v_user, v_window),
                               app.customer_qr_sig(v_secret, v_user, v_window - 1)) then
    raise exception 'customer_qr_expired' using errcode = '22023';
  end if;
  return v_user;
end;
$$;

-- Ficha del cliente para el mostrador.
create or replace function app.customer_card(p_restaurant uuid, p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_program public.loyalty_programs%rowtype;
  v_account public.loyalty_accounts%rowtype;
  v_last    timestamptz;
  v_name    text;
  v_email   text;
begin
  select * into v_program from public.loyalty_programs where restaurant_id = p_restaurant;
  v_account := app.loyalty_account_for(p_restaurant, p_user);

  select max(created_at) into v_last from public.loyalty_transactions
   where account_id = v_account.id and source = 'visit';

  select nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') into v_name
    from public.profiles p where p.id = p_user;
  select email into v_email from auth.users where id = p_user;

  return jsonb_build_object(
    'user_id', p_user,
    'name', coalesce(v_name, split_part(coalesce(v_email, ''), '@', 1)),
    'email', v_email,
    'points', v_account.points_balance,
    'lifetime_points', v_account.lifetime_points,
    'program_enabled', coalesce(v_program.enabled, false),
    'points_per_visit', coalesce(v_program.points_per_visit, 0),
    'last_visit_at', v_last,
    'next_visit_at', case when v_last is null then null
                          else v_last + make_interval(hours => coalesce(v_program.visit_cooldown_hours, 0)) end,
    'can_visit', v_last is null
                 or v_last + make_interval(hours => coalesce(v_program.visit_cooldown_hours, 0)) <= now(),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'name', r.name, 'cost_points', r.cost_points,
               'eligible', v_account.points_balance >= r.cost_points)
             order by r.cost_points)
        from public.rewards r
       where r.tenant_id = p_restaurant and r.active
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function app.staff_restaurant(p_store_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_rest uuid;
begin
  select restaurant_id into v_rest from public.stores where id = p_store_id and deleted_at is null;
  if v_rest is null or not coalesce(app.works_at_restaurant(v_rest), false) then
    raise exception 'staff_only' using errcode = '42501';
  end if;
  return v_rest;
end;
$$;

-- ---------------------------------------------------------------------
-- El cajero escanea
-- ---------------------------------------------------------------------
create or replace function public.staff_scan_customer(p_store_id uuid, p_payload text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_rest uuid := app.staff_restaurant(p_store_id);
begin
  return app.customer_card(v_rest, app.customer_from_qr(p_payload));
end;
$$;

create or replace function public.staff_add_visit(p_store_id uuid, p_payload text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_rest    uuid := app.staff_restaurant(p_store_id);
  v_user    uuid := app.customer_from_qr(p_payload);
  v_program public.loyalty_programs%rowtype;
  v_account public.loyalty_accounts%rowtype;
  v_last    timestamptz;
  v_next    timestamptz;
begin
  select * into v_program from public.loyalty_programs where restaurant_id = v_rest;
  if not found or not v_program.enabled then
    raise exception 'loyalty_disabled' using errcode = '22023';
  end if;

  v_account := app.loyalty_account_for(v_rest, v_user);  -- bloquea la fila
  select max(created_at) into v_last from public.loyalty_transactions
   where account_id = v_account.id and source = 'visit';
  v_next := v_last + make_interval(hours => v_program.visit_cooldown_hours);
  if v_last is not null and v_next > now() then
    raise exception 'too_soon:%', to_char(v_next at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      using errcode = '22023';
  end if;

  insert into public.loyalty_transactions (account_id, delta_points, reason, source, store_id, staff_id)
  values (v_account.id, v_program.points_per_visit, 'earn', 'visit', p_store_id, auth.uid());
  update public.loyalty_accounts
     set points_balance  = points_balance + v_program.points_per_visit,
         lifetime_points = lifetime_points + v_program.points_per_visit
   where id = v_account.id;

  return app.customer_card(v_rest, v_user) || jsonb_build_object('added', v_program.points_per_visit);
end;
$$;

create or replace function public.staff_give_reward(p_store_id uuid, p_payload text, p_reward_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_rest    uuid := app.staff_restaurant(p_store_id);
  v_user    uuid := app.customer_from_qr(p_payload);
  v_reward  public.rewards%rowtype;
  v_account public.loyalty_accounts%rowtype;
  v_code    text;
begin
  select * into v_reward from public.rewards where id = p_reward_id and tenant_id = v_rest and active;
  if not found then
    raise exception 'reward_not_available' using errcode = '22023';
  end if;

  v_account := app.loyalty_account_for(v_rest, v_user);  -- bloquea la fila
  if v_account.points_balance < v_reward.cost_points then
    raise exception 'not_enough_points' using errcode = '22023';
  end if;

  loop
    v_code := app.redemption_code();
    exit when not exists (select 1 from public.reward_redemptions where tenant_id = v_rest and code = v_code);
  end loop;

  insert into public.reward_redemptions
    (reward_id, user_id, points_cost, code, status, tenant_id, reward_name, used_at, used_by)
  values
    (v_reward.id, v_user, v_reward.cost_points, v_code, 'used', v_rest, v_reward.name, now(), auth.uid());

  insert into public.loyalty_transactions (account_id, delta_points, reason, source, store_id, staff_id)
  values (v_account.id, -v_reward.cost_points, 'redeem', 'redeem', p_store_id, auth.uid());
  update public.loyalty_accounts
     set points_balance = points_balance - v_reward.cost_points
   where id = v_account.id;

  return app.customer_card(v_rest, v_user) || jsonb_build_object('given', v_reward.name);
end;
$$;

-- ---------------------------------------------------------------------
-- Recompensas entregadas (para el panel): quién, qué, cuándo, qué cajero.
-- ---------------------------------------------------------------------
create or replace function public.given_rewards(p_restaurant_id uuid, p_limit int default 50)
returns table (
  id uuid, reward_name text, points_cost int, status text, code text,
  redeemed_at timestamptz, used_at timestamptz,
  customer_name text, customer_email text, staff_name text
)
language plpgsql
stable
security definer
set search_path = public, app, pg_catalog
as $$
begin
  if not coalesce(app.works_at_restaurant(p_restaurant_id), false) then
    raise exception 'staff_only' using errcode = '42501';
  end if;
  return query
    select r.id, r.reward_name, r.points_cost, r.status, r.code, r.redeemed_at, r.used_at,
           coalesce(nullif(btrim(concat_ws(' ', pc.first_name, pc.last_name)), ''), split_part(uc.email::text, '@', 1)),
           uc.email::text,
           coalesce(nullif(btrim(concat_ws(' ', ps.first_name, ps.last_name)), ''), split_part(us.email::text, '@', 1))
      from public.reward_redemptions r
      left join auth.users uc on uc.id = r.user_id
      left join public.profiles pc on pc.id = r.user_id
      left join auth.users us on us.id = r.used_by
      left join public.profiles ps on ps.id = r.used_by
     where r.tenant_id = p_restaurant_id
     order by coalesce(r.used_at, r.redeemed_at) desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke execute on function public.my_loyalty_qr() from public, anon;
revoke execute on function public.staff_scan_customer(uuid, text) from public, anon;
revoke execute on function public.staff_add_visit(uuid, text) from public, anon;
revoke execute on function public.staff_give_reward(uuid, text, uuid) from public, anon;
revoke execute on function public.given_rewards(uuid, int) from public, anon;
grant execute on function public.my_loyalty_qr() to authenticated;
grant execute on function public.staff_scan_customer(uuid, text) to authenticated;
grant execute on function public.staff_add_visit(uuid, text) to authenticated;
grant execute on function public.staff_give_reward(uuid, text, uuid) to authenticated;
grant execute on function public.given_rewards(uuid, int) to authenticated;

revoke execute on function app.customer_from_qr(text) from public, anon, authenticated;
revoke execute on function app.customer_card(uuid, uuid) from public, anon, authenticated;
