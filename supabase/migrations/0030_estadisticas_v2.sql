-- =====================================================================
-- 0030_estadisticas_v2.sql
-- Datos extra para estadísticas más gráficas (complementa 0023):
--   horas pico, días de la semana, formas de pago, mejores clientes,
--   clientes nuevos vs. que regresan y recompensas entregadas.
-- Solo el dueño. Mismo criterio de "pedido vendido" que business_stats.
--
-- MIGRACION NUEVA. Las 0001 a 0029 estan aplicadas y no se tocan.
-- =====================================================================

create or replace function public.business_insights(p_restaurant_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_tz     text;
  v_result jsonb;
begin
  if not coalesce(app.owns_restaurant(p_restaurant_id), false) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  select coalesce(min(timezone), 'America/Mexico_City') into v_tz
    from public.stores where restaurant_id = p_restaurant_id and deleted_at is null;

  with sold as (
    select o.id, o.user_id, o.pay_with, o.created_at,
           case when o.total_cents > 0 then o.total_cents else o.subtotal_cents end as amount
      from public.orders o
     where o.tenant_id = p_restaurant_id
       and o.business_day between p_from and p_to
       and o.status in ('confirmed', 'preparing', 'ready', 'completed')
  ),
  by_hour as (
    select h as hour, count(s.id)::int as orders
      from generate_series(0, 23) h
      left join sold s on extract(hour from s.created_at at time zone v_tz)::int = h
     group by h order by h
  ),
  by_weekday as (
    select d as dow, count(s.id)::int as orders, coalesce(sum(s.amount), 0)::bigint as revenue_cents
      from generate_series(0, 6) d
      left join sold s on extract(dow from s.created_at at time zone v_tz)::int = d
     group by d order by d
  ),
  by_pay as (
    select coalesce(pay_with, 'cash') as method, count(*)::int as orders, sum(amount)::bigint as revenue_cents
      from sold group by 1 order by 3 desc
  ),
  top_customers as (
    select coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
                    split_part(u.email::text, '@', 1), 'Cliente') as name,
           count(*)::int as orders, sum(s.amount)::bigint as revenue_cents
      from sold s
      left join auth.users u on u.id = s.user_id
      left join public.profiles p on p.id = s.user_id
     where s.user_id is not null
     group by s.user_id, 1
     order by 3 desc, 2 desc
     limit 5
  ),
  first_order as (
    select o.user_id, min(o.business_day) as first_day
      from public.orders o
     where o.tenant_id = p_restaurant_id and o.user_id is not null
       and o.status in ('confirmed', 'preparing', 'ready', 'completed')
     group by o.user_id
  ),
  customers as (
    select count(*) filter (where f.first_day >= p_from)::int as new_customers,
           count(*) filter (where f.first_day <  p_from)::int as returning_customers
      from (select distinct user_id from sold where user_id is not null) c
      join first_order f on f.user_id = c.user_id
  )
  select jsonb_build_object(
    'by_hour',     coalesce((select jsonb_agg(to_jsonb(b)) from by_hour b), '[]'::jsonb),
    'by_weekday',  coalesce((select jsonb_agg(to_jsonb(b)) from by_weekday b), '[]'::jsonb),
    'by_pay',      coalesce((select jsonb_agg(to_jsonb(b)) from by_pay b), '[]'::jsonb),
    'top_customers', coalesce((select jsonb_agg(to_jsonb(t)) from top_customers t), '[]'::jsonb),
    'new_customers', (select new_customers from customers),
    'returning_customers', (select returning_customers from customers),
    'rewards_given', (select count(*)::int from public.reward_redemptions r
                       where r.tenant_id = p_restaurant_id and r.status = 'used'
                         and (r.used_at at time zone v_tz)::date between p_from and p_to)
  ) into v_result;
  return v_result;
end;
$$;

revoke execute on function public.business_insights(uuid, date, date) from public, anon;
grant execute on function public.business_insights(uuid, date, date) to authenticated;
