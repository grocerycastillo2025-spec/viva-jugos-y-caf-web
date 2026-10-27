-- =====================================================================
-- Pruebas de 0033: comunidad (reseñas, preguntas, sugerencias, avisos).
-- =====================================================================

\set ON_ERROR_STOP on

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

\i supabase/seed/viva_jugos_mx.sql
begin;

insert into auth.users (id, email) values
  ('c0c0c0c0-0000-4000-8000-000000000001', 'duena33@viva.mx'),
  ('c0c0c0c0-0000-4000-8000-000000000002', 'ana33@correo.mx'),
  ('c0c0c0c0-0000-4000-8000-000000000003', 'beto33@correo.mx'),
  ('c0c0c0c0-0000-4000-8000-000000000004', 'caro33@correo.mx'),
  ('c0c0c0c0-0000-4000-8000-000000000005', 'dani33@correo.mx');
insert into public.profiles (id, first_name, last_name) values
  ('c0c0c0c0-0000-4000-8000-000000000002', 'ana maría', 'López Pérez'),
  ('c0c0c0c0-0000-4000-8000-000000000003', 'Beto', null)
on conflict (id) do update set first_name = excluded.first_name, last_name = excluded.last_name;
select app.grant_restaurant_role('duena33@viva.mx', '11111111-1111-4111-8111-111111111111', 'owner');

-- Ana ya tuvo un pedido entregado: es cliente verificada.
insert into public.orders (tenant_id, store_id, order_number, user_id, status)
values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 9901,
        'c0c0c0c0-0000-4000-8000-000000000002', 'completed');

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

-- Detector de datos personales.
do $$ begin
  if not app.community_personal_data('llámame al 442 123 4567') then raise exception 'teléfono'; end if;
  if not app.community_personal_data('escríbeme a ana@correo.mx') then raise exception 'correo'; end if;
  if not app.community_personal_data('CLABE 012180001234567891') then raise exception 'clabe'; end if;
  if app.community_personal_data('El jugo verde de 500 ml a $65 está buenísimo') then raise exception 'falso positivo'; end if;
  if not app.community_needs_review('qué pendejos') then raise exception 'grosería'; end if;
  if app.community_needs_review('Puntual y muy rico') then raise exception 'grosería falsa'; end if;
end $$;

-- La dueña da 10 puntos por la primera reseña.
select pg_temp.como('c0c0c0c0-0000-4000-8000-000000000001');
select public.set_community_settings('11111111-1111-4111-8111-111111111111', true, true, 10);

-- Anónimo no publica; sí ve el resumen.
select pg_temp.como(null);
select pg_temp.esperar_error($$select public.community_create_post('11111111-1111-4111-8111-111111111111', 'review', 'Muy rico', 5)$$, 'permission denied');
do $$ begin
  if (public.community_summary('11111111-1111-4111-8111-111111111111') ->> 'reviews')::int <> 0 then raise exception 'resumen'; end if;
end $$;

-- Ana reseña: verificada, "Ana L.", 10 puntos.
select pg_temp.como('c0c0c0c0-0000-4000-8000-000000000002');
select pg_temp.esperar_error($$select public.community_create_post('11111111-1111-4111-8111-111111111111', 'review', 'Muy rico, mi cel 4421234567', 5)$$, 'personal_data');
select pg_temp.esperar_error($$select public.community_create_post('11111111-1111-4111-8111-111111111111', 'review', 'Sin estrellas')$$, 'rating_required');
select pg_temp.esperar_error($$select public.community_create_post('11111111-1111-4111-8111-111111111111', 'review', 'Foto ajena', 4, null, 'https://malo.mx/x.jpg')$$, 'bad_photo');
do $$
declare v jsonb := public.community_create_post('11111111-1111-4111-8111-111111111111', 'review',
  'El jugo verde está buenísimo y me lo tuvieron listo a tiempo', 5, '33333333-3333-4333-8333-333333333333');
begin
  if v ->> 'author_name' <> 'Ana L.' then raise exception 'nombre: %', v ->> 'author_name'; end if;
  if not (v ->> 'verified')::boolean then raise exception 'no verificada'; end if;
  if v ->> 'status' <> 'published' then raise exception 'estatus %', v ->> 'status'; end if;
  if (v ->> 'points_earned')::int <> 10 then raise exception 'puntos %', v; end if;
  perform set_config('t.post_ana', v ->> 'id', true);
end $$;
-- Segunda reseña: ya no da puntos. Una sugerencia privada.
do $$ begin
  if (public.community_create_post('11111111-1111-4111-8111-111111111111', 'review', 'Otra vez excelente', 4) ->> 'points_earned')::int <> 0 then
    raise exception 'puntos dobles'; end if;
  perform set_config('t.sug', public.community_create_post('11111111-1111-4111-8111-111111111111', 'suggestion', 'Pongan leche de avena por favor') ->> 'id', true);
end $$;
reset role;
do $$ begin
  if (select points_balance from public.loyalty_accounts where user_id = 'c0c0c0c0-0000-4000-8000-000000000002') <> 10 then
    raise exception 'saldo'; end if;
end $$;

-- Beto: no verificado, ve la reseña pero no la sugerencia; pregunta con
-- grosería queda en revisión.
select pg_temp.como('c0c0c0c0-0000-4000-8000-000000000003');
do $$
declare f jsonb := public.community_feed('11111111-1111-4111-8111-111111111111');
begin
  if jsonb_array_length(f) <> 2 then raise exception 'feed beto: %', jsonb_array_length(f); end if;
  if exists (select 1 from jsonb_array_elements(f) e where e ->> 'kind' = 'suggestion') then raise exception 've sugerencia'; end if;
  if public.community_post(current_setting('t.sug')::uuid) is not null then raise exception 'abre sugerencia'; end if;
end $$;
do $$
declare v jsonb := public.community_create_post('11111111-1111-4111-8111-111111111111', 'question', 'Qué pendejos, ¿abren el domingo?');
begin
  if v ->> 'status' <> 'pending' or (v ->> 'verified')::boolean then raise exception 'pregunta %', v; end if;
  perform set_config('t.preg', v ->> 'id', true);
end $$;
-- Beto responde y le da "Me sirvió" a Ana. No puede a lo suyo.
select public.community_reply(current_setting('t.post_ana')::uuid, '¡Coincido, el verde es el mejor!');
select public.community_toggle_helpful(current_setting('t.post_ana')::uuid);
select public.community_toggle_helpful(current_setting('t.post_ana')::uuid);
do $$ begin
  if (public.community_toggle_helpful(current_setting('t.post_ana')::uuid) ->> 'count')::int <> 1 then raise exception 'me sirvió'; end if;
end $$;
select pg_temp.esperar_error($$select public.community_toggle_helpful(current_setting('t.preg')::uuid)$$, 'not_found');
-- Beto no modera.
select pg_temp.esperar_error($$select public.community_moderate(current_setting('t.post_ana')::uuid, null, 'hidden', 'x')$$, 'staff_only');
select pg_temp.esperar_error($$select public.community_admin_list('11111111-1111-4111-8111-111111111111')$$, 'staff_only');
select pg_temp.esperar_error($$select * from public.community_posts$$, 'permission denied');

-- Ana tiene avisos: respuesta de Beto y un solo "me sirvió".
select pg_temp.como('c0c0c0c0-0000-4000-8000-000000000002');
do $$
declare v jsonb := public.my_community_inbox();
begin
  if (v ->> 'unread')::int <> 2 then raise exception 'avisos ana: %', v; end if;
end $$;
select public.mark_community_inbox_read();
do $$ begin
  if (public.my_community_inbox() ->> 'unread')::int <> 0 then raise exception 'no marcó leído'; end if;
end $$;

-- La dueña: bandeja, responde, aprueba la pregunta, premia la sugerencia.
select pg_temp.como('c0c0c0c0-0000-4000-8000-000000000001');
do $$
declare v jsonb := public.community_admin_list('11111111-1111-4111-8111-111111111111', 'all');
begin
  if (v -> 'counts' ->> 'pending')::int <> 1 then raise exception 'pendientes %', v -> 'counts'; end if;
  if (v -> 'counts' ->> 'unanswered')::int <> 2 then raise exception 'sin responder %', v -> 'counts'; end if;
  if jsonb_array_length(v -> 'posts') <> 4 then raise exception 'bandeja %', jsonb_array_length(v -> 'posts'); end if;
end $$;
select public.community_reply(current_setting('t.post_ana')::uuid, '¡Gracias Ana! Te esperamos pronto.');
select pg_temp.esperar_error($$select public.community_moderate(current_setting('t.preg')::uuid, null, 'hidden', '  ')$$, 'reason_required');
select public.community_moderate(current_setting('t.preg')::uuid, null, 'hidden', 'Lenguaje ofensivo');
select public.community_reward(current_setting('t.sug')::uuid, 15);
select pg_temp.esperar_error($$select public.community_reward(current_setting('t.sug')::uuid, 15)$$, 'already_rewarded');
do $$
declare v jsonb := public.community_post(current_setting('t.post_ana')::uuid);
begin
  if jsonb_array_length(v -> 'replies') <> 2 then raise exception 'respuestas'; end if;
  if not (v -> 'replies' -> 1 ->> 'is_store')::boolean then raise exception 'respuesta tienda'; end if;
  if not (v ->> 'store_replied')::boolean then raise exception 'store_replied'; end if;
  if jsonb_array_length(public.community_log_list('11111111-1111-4111-8111-111111111111')) < 4 then raise exception 'bitácora'; end if;
end $$;
-- Avisos (aviso de evento) los crea el negocio, los ve cualquiera.
insert into public.community_notices (restaurant_id, title, body)
values ('11111111-1111-4111-8111-111111111111', 'Feria del jugo este sábado', 'Degustación gratis de 10 a 2');

-- Beto: le avisaron que se ocultó con el motivo.
select pg_temp.como('c0c0c0c0-0000-4000-8000-000000000003');
do $$
declare v jsonb := public.my_community_inbox();
begin
  if not exists (select 1 from jsonb_array_elements(v -> 'items') e
                  where e ->> 'type' = 'community_hidden' and e ->> 'body' like '%Lenguaje ofensivo%') then
    raise exception 'beto sin aviso: %', v;
  end if;
end $$;
select pg_temp.esperar_error($$insert into public.community_notices (restaurant_id, title) values ('11111111-1111-4111-8111-111111111111', 'Hackeo')$$, 'row-level security');

-- Reportes: con 3 se oculta sola mientras la tienda revisa.
select public.community_report(current_setting('t.post_ana')::uuid, null, 'spam');
select pg_temp.como('c0c0c0c0-0000-4000-8000-000000000004');
select public.community_report(current_setting('t.post_ana')::uuid, null, 'falso');
select pg_temp.como('c0c0c0c0-0000-4000-8000-000000000005');
do $$ begin
  if not (public.community_report(current_setting('t.post_ana')::uuid, null, 'ofensivo') ->> 'hidden')::boolean then
    raise exception 'no se ocultó con 3 reportes'; end if;
end $$;

-- Resumen público.
select pg_temp.como(null);
do $$
declare v jsonb := public.community_summary('11111111-1111-4111-8111-111111111111');
begin
  if (v ->> 'reviews')::int <> 1 or (v ->> 'avg_rating')::numeric <> 4.0 then raise exception 'resumen %', v; end if;
  if jsonb_array_length(v -> 'notices') <> 1 then raise exception 'avisos %', v -> 'notices'; end if;
end $$;

-- Comunidad apagada: nadie publica.
select pg_temp.como('c0c0c0c0-0000-4000-8000-000000000001');
select public.set_community_settings('11111111-1111-4111-8111-111111111111', false, null, null);
select pg_temp.como('c0c0c0c0-0000-4000-8000-000000000003');
select pg_temp.esperar_error($$select public.community_create_post('11111111-1111-4111-8111-111111111111', 'question', '¿Tienen estacionamiento?')$$, 'community_off');

rollback;
\echo 'OK 0033'
