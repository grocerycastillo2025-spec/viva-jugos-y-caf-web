-- =====================================================================
-- 0033_comunidad.sql
-- La comunidad VIVA: reseñas, preguntas entre clientes, sugerencias a la
-- tienda y avisos del negocio.
--
--   community_settings   por negocio: prendida, publicar al momento o
--                        revisar antes, puntos por participar
--   community_posts      reseña (con estrellas), pregunta, sugerencia
--                        (privada: solo la ve el cliente y el negocio)
--   community_replies    respuestas de la tienda y de otros clientes
--   community_helpful    "Me sirvió"
--   community_reports    "Reportar": a los 3 reportes se oculta sola
--   community_notices    avisos del negocio (eventos, promociones...)
--   community_log        bitácora de moderación (quién, qué, por qué)
--
-- Espacio seguro:
--   * bloquea teléfonos, correos, CLABE y tarjetas en lo que se publica;
--   * solo se publica nombre e inicial del apellido;
--   * palabras ofensivas mandan la publicación a revisión;
--   * ocultar siempre lleva motivo y queda en la bitácora, y al cliente
--     se le avisa.
--
-- La conversación regresa al cliente con `notifications` (0003): la
-- tienda te respondió, alguien te respondió, a alguien le sirvió.
--
-- MIGRACION NUEVA. Las 0001 a 0032 estan aplicadas y no se tocan.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------
create table if not exists public.community_settings (
  restaurant_id       uuid primary key references public.restaurants(id) on delete cascade,
  enabled             boolean not null default true,
  -- true: se publica al momento (y el negocio oculta lo que no le parezca);
  -- false: todo espera a que el negocio lo apruebe.
  auto_publish        boolean not null default true,
  first_review_points int not null default 0 check (first_review_points between 0 and 1000),
  updated_at          timestamptz not null default now()
);

create table if not exists public.community_posts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  store_id      uuid references public.stores(id) on delete set null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('review', 'question', 'suggestion')),
  rating        int check (rating between 1 and 5),
  body          text not null check (char_length(btrim(body)) between 3 and 600),
  photo_url     text check (photo_url is null or (photo_url ~ '^https?://' and char_length(photo_url) <= 500)),
  item_id       uuid references public.catalog_items(id) on delete set null,
  author_name   text not null,
  verified      boolean not null default false,
  status        text not null default 'published' check (status in ('published', 'pending', 'hidden')),
  hidden_reason text check (hidden_reason is null or char_length(hidden_reason) <= 200),
  helpful_count int not null default 0,
  reply_count   int not null default 0,
  report_count  int not null default 0,
  rewarded_points int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint community_posts_rating check ((kind = 'review') = (rating is not null))
);
create index if not exists idx_community_posts_feed
  on public.community_posts(restaurant_id, status, created_at desc);
create index if not exists idx_community_posts_user on public.community_posts(user_id, created_at desc);

create table if not exists public.community_replies (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.community_posts(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  is_store      boolean not null default false,
  author_name   text not null,
  verified      boolean not null default false,
  body          text not null check (char_length(btrim(body)) between 1 and 500),
  status        text not null default 'published' check (status in ('published', 'pending', 'hidden')),
  hidden_reason text check (hidden_reason is null or char_length(hidden_reason) <= 200),
  report_count  int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_community_replies_post on public.community_replies(post_id, created_at);

create table if not exists public.community_helpful (
  post_id    uuid not null references public.community_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.community_reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid references public.community_posts(id) on delete cascade,
  reply_id    uuid references public.community_replies(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason      text not null check (reason in ('ofensivo', 'spam', 'datos_personales', 'falso', 'otro')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  constraint community_reports_target check ((post_id is null) <> (reply_id is null))
);
create unique index if not exists uq_community_reports_post
  on public.community_reports(post_id, reporter_id) where post_id is not null;
create unique index if not exists uq_community_reports_reply
  on public.community_reports(reply_id, reporter_id) where reply_id is not null;

create table if not exists public.community_notices (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 2 and 80),
  body          text check (body is null or char_length(body) <= 600),
  photo_url     text check (photo_url is null or (photo_url ~ '^https?://' and char_length(photo_url) <= 500)),
  event_at      timestamptz,
  pinned        boolean not null default false,
  expires_at    timestamptz,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_community_notices on public.community_notices(restaurant_id, created_at desc);

create table if not exists public.community_log (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  actor_id      uuid references auth.users(id) on delete set null,
  action        text not null,
  post_id       uuid references public.community_posts(id) on delete set null,
  reply_id      uuid references public.community_replies(id) on delete set null,
  reason        text,
  detail        text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_community_log on public.community_log(restaurant_id, created_at desc);

-- Puntos por participar.
alter table public.loyalty_transactions drop constraint if exists loyalty_transactions_source_check;
alter table public.loyalty_transactions add constraint loyalty_transactions_source_check
  check (source is null or source in ('visit', 'order', 'redeem', 'refund', 'adjust', 'community'));

-- ---------------------------------------------------------------------
-- 2. RLS: nadie lee ni escribe las tablas directo, salvo avisos y
--    ajustes. Todo lo demás pasa por las funciones de abajo.
-- ---------------------------------------------------------------------
alter table public.community_settings enable row level security;
alter table public.community_posts    enable row level security;
alter table public.community_replies  enable row level security;
alter table public.community_helpful  enable row level security;
alter table public.community_reports  enable row level security;
alter table public.community_notices  enable row level security;
alter table public.community_log      enable row level security;

drop policy if exists community_settings_read on public.community_settings;
create policy community_settings_read on public.community_settings
  for select to anon, authenticated using (true);

drop policy if exists community_notices_read on public.community_notices;
create policy community_notices_read on public.community_notices
  for select to anon, authenticated
  using (expires_at is null or expires_at > now() or coalesce(app.works_at_restaurant(restaurant_id), false));
drop policy if exists community_notices_staff on public.community_notices;
create policy community_notices_staff on public.community_notices
  for all to authenticated
  using (coalesce(app.works_at_restaurant(restaurant_id), false))
  with check (coalesce(app.works_at_restaurant(restaurant_id), false));

grant select on public.community_settings, public.community_notices to anon, authenticated;
grant insert, update, delete on public.community_notices to authenticated;

-- ---------------------------------------------------------------------
-- 3. AYUDANTES
-- ---------------------------------------------------------------------

-- Datos personales que no se publican: correo, teléfono (8+ dígitos con
-- o sin espacios/guiones), CLABE o tarjeta.
create or replace function app.community_personal_data(p text)
returns boolean
language sql
immutable
as $$
  select coalesce(p, '') ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
      or regexp_replace(coalesce(p, ''), '[\s().+-]', '', 'g') ~ '[0-9]{8,}'
$$;

-- Palabras que mandan a revisión en lugar de publicar al momento.
create or replace function app.community_needs_review(p text)
returns boolean
language sql
immutable
as $$
  select translate(lower(coalesce(p, '')), 'áéíóúü', 'aeiouu')
    ~ '(^|[^a-z])(pendej[a-z]*|put[ao]s?|chingad[a-z]*|cabr[oó]n[a-z]*|mierda|verga|culer[ao]s?|estupid[ao]s?|idiota[s]?|imbecil[a-z]*|maldit[ao]s?|naco[s]?|fraude|ratas?|asquero[a-z]*)([^a-z]|$)'
$$;

-- "Marco C." — nunca el apellido completo ni el correo.
create or replace function app.community_author(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    nullif(btrim(
      initcap(split_part(btrim(coalesce(p.first_name, '')), ' ', 1)) ||
      case when btrim(coalesce(p.last_name, '')) <> ''
           then ' ' || upper(left(btrim(p.last_name), 1)) || '.' else '' end), ''),
    'Cliente VIVA')
    from (select 1) x
    left join public.profiles p on p.id = p_user
$$;

-- Cliente verificado: ya tuvo un pedido entregado en ese negocio.
create or replace function app.community_verified(p_restaurant uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.orders o join public.stores s on s.id = o.store_id
     where o.user_id = p_user and s.restaurant_id = p_restaurant and o.status = 'completed')
$$;

create or replace function app.community_settings_for(p_restaurant uuid)
returns public.community_settings
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v public.community_settings%rowtype;
begin
  insert into public.community_settings (restaurant_id) values (p_restaurant)
  on conflict (restaurant_id) do nothing;
  select * into v from public.community_settings where restaurant_id = p_restaurant;
  return v;
end;
$$;

create or replace function app.community_notify(
  p_user uuid, p_restaurant uuid, p_type text, p_title text, p_body text, p_post uuid)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  insert into public.notifications (user_id, tenant_id, type, title, body, data)
  select p_user, p_restaurant, p_type, p_title, left(p_body, 200),
         jsonb_build_object('post_id', p_post)
   where p_user is not null and p_user is distinct from auth.uid();
$$;

create or replace function app.community_log_add(
  p_restaurant uuid, p_action text, p_post uuid, p_reply uuid, p_reason text, p_detail text)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  insert into public.community_log (restaurant_id, actor_id, action, post_id, reply_id, reason, detail)
  values (p_restaurant, auth.uid(), p_action, p_post, p_reply, p_reason, left(p_detail, 300));
$$;

create or replace function app.community_post_json(p public.community_posts, p_viewer uuid, p_staff boolean)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'rating', p.rating, 'body', p.body,
    'photo_url', p.photo_url, 'item_id', p.item_id,
    'item_name', (select i.name from public.catalog_items i where i.id = p.item_id),
    'store_id', p.store_id,
    'store_name', (select s.name from public.stores s where s.id = p.store_id),
    'author_name', p.author_name, 'verified', p.verified,
    'status', p.status,
    'hidden_reason', case when p_staff or p.user_id = p_viewer then p.hidden_reason end,
    'helpful_count', p.helpful_count, 'reply_count', p.reply_count,
    'report_count', case when p_staff then p.report_count end,
    'rewarded_points', p.rewarded_points,
    'mine', p.user_id = p_viewer,
    'i_found_helpful', exists (select 1 from public.community_helpful h where h.post_id = p.id and h.user_id = p_viewer),
    'store_replied', exists (select 1 from public.community_replies r where r.post_id = p.id and r.is_store and r.status = 'published'),
    'created_at', p.created_at)
$$;

-- ---------------------------------------------------------------------
-- 4. LO QUE VE EL CLIENTE
-- ---------------------------------------------------------------------

-- Resumen para Inicio y para elegir sucursal: promedio, por sucursal y
-- lo más reciente.
create or replace function public.community_summary(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, app, pg_catalog
as $$
  select jsonb_build_object(
    'enabled', coalesce((select c.enabled from public.community_settings c where c.restaurant_id = p_restaurant_id), true),
    'reviews', (select count(*) from public.community_posts p
                 where p.restaurant_id = p_restaurant_id and p.kind = 'review' and p.status = 'published'),
    'avg_rating', (select round(avg(p.rating)::numeric, 1) from public.community_posts p
                    where p.restaurant_id = p_restaurant_id and p.kind = 'review' and p.status = 'published'),
    'stars', (select jsonb_object_agg(r, n) from (
               select p.rating as r, count(*) as n from public.community_posts p
                where p.restaurant_id = p_restaurant_id and p.kind = 'review' and p.status = 'published'
                group by p.rating) x),
    'by_store', coalesce((select jsonb_agg(jsonb_build_object('store_id', x.store_id, 'avg', x.avg, 'count', x.n))
                  from (select p.store_id, round(avg(p.rating)::numeric, 1) as avg, count(*) as n
                          from public.community_posts p
                         where p.restaurant_id = p_restaurant_id and p.kind = 'review'
                           and p.status = 'published' and p.store_id is not null
                         group by p.store_id) x), '[]'::jsonb),
    'latest', coalesce((select jsonb_agg(app.community_post_json(p, auth.uid(), false) order by p.created_at desc)
                 from (select * from public.community_posts p
                        where p.restaurant_id = p_restaurant_id and p.status = 'published'
                          and p.kind <> 'suggestion'
                        order by p.created_at desc limit 3) p), '[]'::jsonb),
    'notices', coalesce((select jsonb_agg(to_jsonb(n) order by n.pinned desc, n.created_at desc)
                 from (select n.id, n.title, n.body, n.photo_url, n.event_at, n.pinned, n.created_at
                         from public.community_notices n
                        where n.restaurant_id = p_restaurant_id
                          and (n.expires_at is null or n.expires_at > now())
                        order by n.pinned desc, n.created_at desc limit 5) n), '[]'::jsonb)
  )
$$;

-- El muro. p_kind: 'all' | 'review' | 'question' | 'mine'.
-- Las sugerencias solo las ve quien las escribió.
create or replace function public.community_feed(
  p_restaurant_id uuid, p_kind text default 'all', p_limit int default 30, p_before timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path = public, app, pg_catalog
as $$
  select coalesce(jsonb_agg(app.community_post_json(p, auth.uid(), false) order by p.created_at desc), '[]'::jsonb)
    from (
      select * from public.community_posts p
       where p.restaurant_id = p_restaurant_id
         and (p_before is null or p.created_at < p_before)
         and case coalesce(p_kind, 'all')
               when 'mine' then p.user_id = auth.uid()
               when 'review' then p.kind = 'review' and p.status = 'published'
               when 'question' then p.kind = 'question' and p.status = 'published'
               else (p.status = 'published' and p.kind <> 'suggestion')
                    or (p.user_id = auth.uid() and p.user_id is not null)
             end
       order by p.created_at desc
       limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) p
$$;

-- Una publicación con sus respuestas.
create or replace function public.community_post(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v public.community_posts%rowtype;
  v_staff boolean;
begin
  select * into v from public.community_posts where id = p_post_id;
  if not found then return null; end if;
  v_staff := coalesce(app.works_at_restaurant(v.restaurant_id), false);
  if not v_staff and v.user_id is distinct from auth.uid()
     and (v.status <> 'published' or v.kind = 'suggestion') then
    return null;
  end if;
  return app.community_post_json(v, auth.uid(), v_staff) || jsonb_build_object(
    'replies', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'body', r.body, 'author_name', r.author_name, 'is_store', r.is_store,
               'verified', r.verified, 'status', r.status,
               'hidden_reason', case when v_staff or r.user_id = auth.uid() then r.hidden_reason end,
               'mine', r.user_id = auth.uid(), 'created_at', r.created_at)
             order by r.created_at)
        from public.community_replies r
       where r.post_id = v.id
         and (r.status = 'published' or v_staff or r.user_id = auth.uid())
    ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- 5. EL CLIENTE PARTICIPA
-- ---------------------------------------------------------------------
create or replace function public.community_create_post(
  p_restaurant_id uuid,
  p_kind          text,
  p_body          text,
  p_rating        int  default null,
  p_store_id      uuid default null,
  p_photo_url     text default null,
  p_item_id       uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_user     uuid := auth.uid();
  v_set      public.community_settings%rowtype;
  v_status   text;
  v_post     public.community_posts%rowtype;
  v_points   int := 0;
  v_account  public.loyalty_accounts%rowtype;
  v_body     text := btrim(coalesce(p_body, ''));
begin
  if v_user is null then raise exception 'login_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.restaurants r where r.id = p_restaurant_id and r.status = 'active') then
    raise exception 'not_found' using errcode = '22023';
  end if;
  v_set := app.community_settings_for(p_restaurant_id);
  if not v_set.enabled then raise exception 'community_off' using errcode = '22023'; end if;
  if p_kind not in ('review', 'question', 'suggestion') then raise exception 'bad_kind' using errcode = '22023'; end if;
  if p_kind = 'review' and (p_rating is null or p_rating not between 1 and 5) then
    raise exception 'rating_required' using errcode = '22023';
  end if;
  if char_length(v_body) < 3 then raise exception 'too_short' using errcode = '22023'; end if;
  if char_length(v_body) > 600 then raise exception 'too_long' using errcode = '22023'; end if;
  if app.community_personal_data(v_body) then raise exception 'personal_data' using errcode = '22023'; end if;
  if p_photo_url is not null and p_photo_url !~ '/storage/v1/object/public/community/' then
    raise exception 'bad_photo' using errcode = '22023';
  end if;
  if p_store_id is not null and not exists (
       select 1 from public.stores s where s.id = p_store_id and s.restaurant_id = p_restaurant_id) then
    raise exception 'bad_store' using errcode = '22023';
  end if;
  if p_item_id is not null and not exists (
       select 1 from public.catalog_items i join public.stores s on s.id = i.store_id
        where i.id = p_item_id and s.restaurant_id = p_restaurant_id) then
    raise exception 'bad_item' using errcode = '22023';
  end if;
  -- Freno de spam: máximo 5 publicaciones por hora.
  if (select count(*) from public.community_posts
       where user_id = v_user and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too_many' using errcode = '22023';
  end if;

  v_status := case when v_set.auto_publish and not app.community_needs_review(v_body)
                   then 'published' else 'pending' end;

  insert into public.community_posts
    (restaurant_id, store_id, user_id, kind, rating, body, photo_url, item_id, author_name, verified, status)
  values
    (p_restaurant_id, p_store_id, v_user, p_kind, case when p_kind = 'review' then p_rating end,
     v_body, p_photo_url, p_item_id, app.community_author(v_user),
     app.community_verified(p_restaurant_id, v_user), v_status)
  returning * into v_post;

  -- Puntos por la primera reseña.
  if p_kind = 'review' and v_set.first_review_points > 0
     and not exists (select 1 from public.community_posts
                      where user_id = v_user and restaurant_id = p_restaurant_id
                        and kind = 'review' and id <> v_post.id) then
    v_account := app.loyalty_account_for(p_restaurant_id, v_user);
    v_points := v_set.first_review_points;
    insert into public.loyalty_transactions (account_id, delta_points, reason, source, store_id)
    values (v_account.id, v_points, 'earn', 'community', p_store_id);
    update public.loyalty_accounts
       set points_balance = points_balance + v_points, lifetime_points = lifetime_points + v_points
     where id = v_account.id;
  end if;

  return app.community_post_json(v_post, v_user, false) || jsonb_build_object('points_earned', v_points);
end;
$$;

create or replace function public.community_reply(p_post_id uuid, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_user  uuid := auth.uid();
  v_post  public.community_posts%rowtype;
  v_set   public.community_settings%rowtype;
  v_staff boolean;
  v_body  text := btrim(coalesce(p_body, ''));
  v_reply public.community_replies%rowtype;
  v_status text;
begin
  if v_user is null then raise exception 'login_required' using errcode = '42501'; end if;
  select * into v_post from public.community_posts where id = p_post_id for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  v_staff := coalesce(app.works_at_restaurant(v_post.restaurant_id), false);
  -- Clientes: solo en lo publicado. En las sugerencias solo platican el
  -- autor y la tienda.
  if not v_staff then
    if v_post.status <> 'published' and v_post.user_id <> v_user then
      raise exception 'not_found' using errcode = '22023';
    end if;
    if v_post.kind = 'suggestion' and v_post.user_id <> v_user then
      raise exception 'not_found' using errcode = '22023';
    end if;
  end if;
  v_set := app.community_settings_for(v_post.restaurant_id);
  if not v_set.enabled and not v_staff then raise exception 'community_off' using errcode = '22023'; end if;
  if char_length(v_body) < 1 then raise exception 'too_short' using errcode = '22023'; end if;
  if char_length(v_body) > 500 then raise exception 'too_long' using errcode = '22023'; end if;
  if app.community_personal_data(v_body) and not v_staff then
    raise exception 'personal_data' using errcode = '22023';
  end if;
  if not v_staff and (select count(*) from public.community_replies
                        where user_id = v_user and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too_many' using errcode = '22023';
  end if;

  v_status := case when v_staff then 'published'
                   when v_set.auto_publish and not app.community_needs_review(v_body) then 'published'
                   else 'pending' end;

  insert into public.community_replies (post_id, user_id, is_store, author_name, verified, body, status)
  values (v_post.id, v_user, v_staff,
          case when v_staff then (select r.name from public.restaurants r where r.id = v_post.restaurant_id)
               else app.community_author(v_user) end,
          case when v_staff then false else app.community_verified(v_post.restaurant_id, v_user) end,
          v_body, v_status)
  returning * into v_reply;

  if v_status = 'published' then
    update public.community_posts set reply_count = reply_count + 1 where id = v_post.id;
    perform app.community_notify(
      v_post.user_id, v_post.restaurant_id,
      case when v_staff then 'community_store_reply' else 'community_reply' end,
      case when v_staff then 'La tienda respondió tu publicación'
           else v_reply.author_name || ' respondió tu publicación' end,
      v_body, v_post.id);
  end if;
  if v_staff then
    perform app.community_log_add(v_post.restaurant_id, 'reply', v_post.id, v_reply.id, null, v_body);
  end if;

  return jsonb_build_object('id', v_reply.id, 'status', v_status);
end;
$$;

create or replace function public.community_toggle_helpful(p_post_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_post public.community_posts%rowtype;
  v_on   boolean;
begin
  if v_user is null then raise exception 'login_required' using errcode = '42501'; end if;
  select * into v_post from public.community_posts where id = p_post_id and status = 'published' for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if v_post.user_id = v_user then raise exception 'own_post' using errcode = '22023'; end if;

  delete from public.community_helpful where post_id = p_post_id and user_id = v_user;
  v_on := not found;
  if v_on then
    insert into public.community_helpful (post_id, user_id) values (p_post_id, v_user);
    -- Un solo aviso por persona y publicación, aunque quite y ponga.
    if not exists (select 1 from public.notifications n
                    where n.user_id = v_post.user_id and n.type = 'community_helpful'
                      and n.data ->> 'post_id' = p_post_id::text
                      and n.data ->> 'from' = v_user::text) then
      insert into public.notifications (user_id, tenant_id, type, title, body, data)
      values (v_post.user_id, v_post.restaurant_id, 'community_helpful',
              'A alguien le sirvió tu publicación', left(v_post.body, 120),
              jsonb_build_object('post_id', p_post_id, 'from', v_user));
    end if;
  end if;
  update public.community_posts
     set helpful_count = (select count(*) from public.community_helpful where post_id = p_post_id)
   where id = p_post_id
  returning helpful_count into v_post.helpful_count;
  return jsonb_build_object('on', v_on, 'count', v_post.helpful_count);
end;
$$;

create or replace function public.community_report(
  p_post_id uuid default null, p_reply_id uuid default null, p_reason text default 'otro')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_user  uuid := auth.uid();
  v_rest  uuid;
  v_count int;
  v_hidden boolean := false;
begin
  if v_user is null then raise exception 'login_required' using errcode = '42501'; end if;
  if (p_post_id is null) = (p_reply_id is null) then raise exception 'bad_target' using errcode = '22023'; end if;
  if p_reason not in ('ofensivo', 'spam', 'datos_personales', 'falso', 'otro') then
    raise exception 'bad_reason' using errcode = '22023';
  end if;

  if p_post_id is not null then
    select restaurant_id into v_rest from public.community_posts where id = p_post_id and status = 'published';
    if v_rest is null then raise exception 'not_found' using errcode = '22023'; end if;
    insert into public.community_reports (post_id, reporter_id, reason) values (p_post_id, v_user, p_reason)
    on conflict do nothing;
    select count(*) into v_count from public.community_reports where post_id = p_post_id and resolved_at is null;
    update public.community_posts set report_count = v_count where id = p_post_id;
    -- La comunidad cuida el espacio: con 3 reportes se oculta mientras la
    -- tienda revisa.
    if v_count >= 3 then
      update public.community_posts set status = 'pending' where id = p_post_id and status = 'published';
      v_hidden := found;
      if v_hidden then
        perform app.community_log_add(v_rest, 'auto_hide', p_post_id, null, '3 reportes', null);
      end if;
    end if;
  else
    select p.restaurant_id into v_rest
      from public.community_replies r join public.community_posts p on p.id = r.post_id
     where r.id = p_reply_id and r.status = 'published';
    if v_rest is null then raise exception 'not_found' using errcode = '22023'; end if;
    insert into public.community_reports (reply_id, reporter_id, reason) values (p_reply_id, v_user, p_reason)
    on conflict do nothing;
    select count(*) into v_count from public.community_reports where reply_id = p_reply_id and resolved_at is null;
    update public.community_replies set report_count = v_count where id = p_reply_id;
    if v_count >= 3 then
      update public.community_replies set status = 'pending' where id = p_reply_id and status = 'published';
      v_hidden := found;
      if v_hidden then
        update public.community_posts p set reply_count = greatest(reply_count - 1, 0)
          from public.community_replies r where r.id = p_reply_id and p.id = r.post_id;
        perform app.community_log_add(v_rest, 'auto_hide', null, p_reply_id, '3 reportes', null);
      end if;
    end if;
  end if;
  return jsonb_build_object('reported', true, 'hidden', v_hidden);
end;
$$;

-- El autor borra lo suyo.
create or replace function public.community_delete_own(p_post_id uuid default null, p_reply_id uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  if p_post_id is not null then
    delete from public.community_posts where id = p_post_id and user_id = auth.uid();
  end if;
  if p_reply_id is not null then
    update public.community_posts p set reply_count = greatest(reply_count - 1, 0)
      from public.community_replies r
     where r.id = p_reply_id and r.user_id = auth.uid() and r.status = 'published' and p.id = r.post_id;
    delete from public.community_replies where id = p_reply_id and user_id = auth.uid();
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. EL NEGOCIO MODERA
-- ---------------------------------------------------------------------

-- Bandeja del panel. p_filter: 'all' | 'pending' | 'reported' | 'hidden'
-- | 'suggestion' | 'review' | 'question' | 'unanswered'.
create or replace function public.community_admin_list(
  p_restaurant_id uuid, p_filter text default 'all', p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_catalog
as $$
begin
  if not coalesce(app.works_at_restaurant(p_restaurant_id), false) then
    raise exception 'staff_only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'pending', (select count(*) from public.community_posts where restaurant_id = p_restaurant_id and status = 'pending')
               + (select count(*) from public.community_replies r join public.community_posts p on p.id = r.post_id
                   where p.restaurant_id = p_restaurant_id and r.status = 'pending'),
      'reported', (select count(*) from public.community_posts where restaurant_id = p_restaurant_id and report_count > 0)
                + (select count(*) from public.community_replies r join public.community_posts p on p.id = r.post_id
                    where p.restaurant_id = p_restaurant_id and r.report_count > 0),
      'suggestion', (select count(*) from public.community_posts
                      where restaurant_id = p_restaurant_id and kind = 'suggestion'
                        and not exists (select 1 from public.community_replies r where r.post_id = community_posts.id and r.is_store)),
      'unanswered', (select count(*) from public.community_posts
                      where restaurant_id = p_restaurant_id and kind = 'review' and status = 'published'
                        and not exists (select 1 from public.community_replies r where r.post_id = community_posts.id and r.is_store))
    ),
    'posts', coalesce((
      select jsonb_agg(app.community_post_json(p, auth.uid(), true) || jsonb_build_object(
               'pending_replies', (select count(*) from public.community_replies r where r.post_id = p.id and r.status = 'pending'),
               'reported_replies', (select count(*) from public.community_replies r where r.post_id = p.id and r.report_count > 0),
               'reports', coalesce((select jsonb_agg(c.reason) from public.community_reports c
                                     where c.post_id = p.id and c.resolved_at is null), '[]'::jsonb))
             order by p.created_at desc)
        from (
          select * from public.community_posts p
           where p.restaurant_id = p_restaurant_id
             and case coalesce(p_filter, 'all')
                   when 'pending' then p.status = 'pending'
                        or exists (select 1 from public.community_replies r where r.post_id = p.id and r.status = 'pending')
                   when 'reported' then p.report_count > 0
                        or exists (select 1 from public.community_replies r where r.post_id = p.id and r.report_count > 0)
                   when 'hidden' then p.status = 'hidden'
                   when 'suggestion' then p.kind = 'suggestion'
                   when 'review' then p.kind = 'review'
                   when 'question' then p.kind = 'question'
                   when 'unanswered' then p.kind in ('review', 'suggestion', 'question') and p.status = 'published'
                        and not exists (select 1 from public.community_replies r where r.post_id = p.id and r.is_store)
                   else true
                 end
           order by p.created_at desc
           limit least(greatest(coalesce(p_limit, 100), 1), 300)
        ) p
    ), '[]'::jsonb)
  );
end;
$$;

-- Publicar u ocultar una publicación o respuesta. Ocultar pide motivo.
create or replace function public.community_moderate(
  p_post_id uuid default null, p_reply_id uuid default null,
  p_status text default 'hidden', p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_rest   uuid;
  v_owner  uuid;
  v_post   uuid;
  v_old    text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if (p_post_id is null) = (p_reply_id is null) then raise exception 'bad_target' using errcode = '22023'; end if;
  if p_status not in ('published', 'hidden') then raise exception 'bad_status' using errcode = '22023'; end if;
  if p_status = 'hidden' and v_reason is null then raise exception 'reason_required' using errcode = '22023'; end if;

  if p_post_id is not null then
    select restaurant_id, user_id, status into v_rest, v_owner, v_old
      from public.community_posts where id = p_post_id for update;
    v_post := p_post_id;
  else
    select p.restaurant_id, r.user_id, r.status, p.id into v_rest, v_owner, v_old, v_post
      from public.community_replies r join public.community_posts p on p.id = r.post_id
     where r.id = p_reply_id for update of r;
  end if;
  if v_rest is null or not coalesce(app.works_at_restaurant(v_rest), false) then
    raise exception 'staff_only' using errcode = '42501';
  end if;

  if p_post_id is not null then
    update public.community_posts
       set status = p_status,
           hidden_reason = case when p_status = 'hidden' then left(v_reason, 200) end,
           report_count = case when p_status = 'published' then 0 else report_count end,
           updated_at = now()
     where id = p_post_id;
    update public.community_reports set resolved_at = now(), resolved_by = auth.uid()
     where post_id = p_post_id and resolved_at is null;
  else
    update public.community_replies
       set status = p_status,
           hidden_reason = case when p_status = 'hidden' then left(v_reason, 200) end,
           report_count = case when p_status = 'published' then 0 else report_count end
     where id = p_reply_id;
    update public.community_reports set resolved_at = now(), resolved_by = auth.uid()
     where reply_id = p_reply_id and resolved_at is null;
    update public.community_posts
       set reply_count = (select count(*) from public.community_replies r where r.post_id = v_post and r.status = 'published')
     where id = v_post;
  end if;

  perform app.community_log_add(v_rest, case when p_status = 'hidden' then 'hide' else 'publish' end,
                                p_post_id, p_reply_id, v_reason, 'antes: ' || coalesce(v_old, '?'));

  if p_status = 'hidden' and v_old is distinct from 'hidden' then
    perform app.community_notify(v_owner, v_rest, 'community_hidden',
      'Ocultamos tu ' || case when p_post_id is not null then 'publicación' else 'respuesta' end,
      'Motivo: ' || v_reason, v_post);
  elsif p_status = 'published' and v_old = 'pending' then
    perform app.community_notify(v_owner, v_rest, 'community_published',
      'Tu ' || case when p_post_id is not null then 'publicación' else 'respuesta' end || ' ya está publicada',
      'Gracias por participar en la comunidad.', v_post);
  end if;
  return jsonb_build_object('status', p_status);
end;
$$;

-- Premiar una sugerencia o reseña útil con puntos (una vez).
create or replace function public.community_reward(p_post_id uuid, p_points int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v_post    public.community_posts%rowtype;
  v_account public.loyalty_accounts%rowtype;
begin
  select * into v_post from public.community_posts where id = p_post_id for update;
  if not found or not coalesce(app.owns_restaurant(v_post.restaurant_id), false) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if p_points is null or p_points not between 1 and 500 then raise exception 'bad_points' using errcode = '22023'; end if;
  if v_post.rewarded_points is not null then raise exception 'already_rewarded' using errcode = '22023'; end if;

  v_account := app.loyalty_account_for(v_post.restaurant_id, v_post.user_id);
  insert into public.loyalty_transactions (account_id, delta_points, reason, source, store_id, staff_id)
  values (v_account.id, p_points, 'earn', 'community', v_post.store_id, auth.uid());
  update public.loyalty_accounts
     set points_balance = points_balance + p_points, lifetime_points = lifetime_points + p_points
   where id = v_account.id;
  update public.community_posts set rewarded_points = p_points where id = p_post_id;

  perform app.community_log_add(v_post.restaurant_id, 'reward', p_post_id, null, null, p_points || ' puntos');
  perform app.community_notify(v_post.user_id, v_post.restaurant_id, 'community_reward',
    '¡Ganaste ' || p_points || ' puntos!', 'Gracias por tu aportación a la comunidad VIVA.', p_post_id);
  return jsonb_build_object('points', p_points);
end;
$$;

create or replace function public.set_community_settings(
  p_restaurant_id uuid, p_enabled boolean, p_auto_publish boolean, p_first_review_points int)
returns public.community_settings
language plpgsql
volatile
security definer
set search_path = public, app, pg_catalog
as $$
declare
  v public.community_settings%rowtype;
begin
  if not coalesce(app.owns_restaurant(p_restaurant_id), false) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  perform app.community_settings_for(p_restaurant_id);
  update public.community_settings
     set enabled = coalesce(p_enabled, enabled),
         auto_publish = coalesce(p_auto_publish, auto_publish),
         first_review_points = coalesce(p_first_review_points, first_review_points),
         updated_at = now()
   where restaurant_id = p_restaurant_id
  returning * into v;
  perform app.community_log_add(p_restaurant_id, 'settings', null, null, null,
    format('activa=%s, publicar_al_momento=%s, puntos_1a_reseña=%s', v.enabled, v.auto_publish, v.first_review_points));
  return v;
end;
$$;

-- Bitácora.
create or replace function public.community_log_list(p_restaurant_id uuid, p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_catalog
as $$
begin
  if not coalesce(app.works_at_restaurant(p_restaurant_id), false) then
    raise exception 'staff_only' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'action', l.action, 'reason', l.reason, 'detail', l.detail,
             'created_at', l.created_at, 'post_id', coalesce(l.post_id, r.post_id),
             'actor', coalesce(nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
                               split_part(u.email, '@', 1), 'Sistema'),
             'target', left(coalesce(p.body, r.body, ''), 80))
           order by l.created_at desc)
      from (select * from public.community_log
             where restaurant_id = p_restaurant_id
             order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 300)) l
      left join public.profiles pr on pr.id = l.actor_id
      left join auth.users u on u.id = l.actor_id
      left join public.community_posts p on p.id = l.post_id
      left join public.community_replies r on r.id = l.reply_id
  ), '[]'::jsonb);
end;
$$;

-- Avisos del cliente (campana): los de la comunidad.
create or replace function public.my_community_inbox(p_limit int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.notifications
                where user_id = auth.uid() and type like 'community\_%' and read_at is null),
    'items', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc)
               from (select id, type, title, body, data, read_at, created_at
                       from public.notifications
                      where user_id = auth.uid() and type like 'community\_%'
                      order by created_at desc
                      limit least(greatest(coalesce(p_limit, 30), 1), 100)) n), '[]'::jsonb))
$$;

create or replace function public.mark_community_inbox_read()
returns void
language sql
volatile
security definer
set search_path = public, pg_catalog
as $$
  update public.notifications set read_at = now()
   where user_id = auth.uid() and type like 'community\_%' and read_at is null;
$$;

-- ---------------------------------------------------------------------
-- 7. PERMISOS
-- ---------------------------------------------------------------------
revoke execute on function app.community_author(uuid) from public, anon, authenticated;
revoke execute on function app.community_verified(uuid, uuid) from public, anon, authenticated;
revoke execute on function app.community_settings_for(uuid) from public, anon, authenticated;
revoke execute on function app.community_notify(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function app.community_log_add(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function app.community_post_json(public.community_posts, uuid, boolean) from public, anon, authenticated;

grant execute on function public.community_summary(uuid) to anon, authenticated;
grant execute on function public.community_feed(uuid, text, int, timestamptz) to anon, authenticated;
grant execute on function public.community_post(uuid) to anon, authenticated;

revoke execute on function public.community_create_post(uuid, text, text, int, uuid, text, uuid) from public, anon;
revoke execute on function public.community_reply(uuid, text) from public, anon;
revoke execute on function public.community_toggle_helpful(uuid) from public, anon;
revoke execute on function public.community_report(uuid, uuid, text) from public, anon;
revoke execute on function public.community_delete_own(uuid, uuid) from public, anon;
revoke execute on function public.community_admin_list(uuid, text, int) from public, anon;
revoke execute on function public.community_moderate(uuid, uuid, text, text) from public, anon;
revoke execute on function public.community_reward(uuid, int) from public, anon;
revoke execute on function public.set_community_settings(uuid, boolean, boolean, int) from public, anon;
revoke execute on function public.community_log_list(uuid, int) from public, anon;
revoke execute on function public.my_community_inbox(int) from public, anon;
revoke execute on function public.mark_community_inbox_read() from public, anon;

grant execute on function public.community_create_post(uuid, text, text, int, uuid, text, uuid) to authenticated;
grant execute on function public.community_reply(uuid, text) to authenticated;
grant execute on function public.community_toggle_helpful(uuid) to authenticated;
grant execute on function public.community_report(uuid, uuid, text) to authenticated;
grant execute on function public.community_delete_own(uuid, uuid) to authenticated;
grant execute on function public.community_admin_list(uuid, text, int) to authenticated;
grant execute on function public.community_moderate(uuid, uuid, text, text) to authenticated;
grant execute on function public.community_reward(uuid, int) to authenticated;
grant execute on function public.set_community_settings(uuid, boolean, boolean, int) to authenticated;
grant execute on function public.community_log_list(uuid, int) to authenticated;
grant execute on function public.my_community_inbox(int) to authenticated;
grant execute on function public.mark_community_inbox_read() to authenticated;

-- ---------------------------------------------------------------------
-- 8. FOTOS: bucket público `community`, carpeta por usuario.
--   community/{user_id}/{archivo}   (5 MB, imágenes)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Esquema storage no disponible: se omite la parte de archivos de 0033.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('community', 'community', true, 5242880,
          array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
  on conflict (id) do nothing;

  execute $p$ drop policy if exists "public read community" on storage.objects $p$;
  execute $p$
    create policy "public read community" on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'community')
  $p$;
  execute $p$ drop policy if exists "users upload their community photos" on storage.objects $p$;
  execute $p$
    create policy "users upload their community photos" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'community' and (storage.foldername(name))[1] = auth.uid()::text)
  $p$;
  execute $p$ drop policy if exists "users delete their community photos" on storage.objects $p$;
  execute $p$
    create policy "users delete their community photos" on storage.objects
      for delete to authenticated
      using (bucket_id = 'community' and (storage.foldername(name))[1] = auth.uid()::text)
  $p$;
end $$;
