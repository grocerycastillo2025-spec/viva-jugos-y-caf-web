-- =====================================================================
-- seed_viva.sql — Datos de desarrollo: Viva Juice and Coffee
--
-- ⚠️ SOLO PARA EL ENTORNO DE DESARROLLO. No ejecutar en produccion.
--
-- IMPORTANTE — esto NO es el catalogo real de la plataforma.
-- Clover es la fuente de verdad de productos, precios y modificadores.
-- Este seed es un espejo temporal para poder construir la app antes de
-- que exista la conexion con Clover (Fase 7). Todos los identificadores
-- llevan el prefijo 'SEED-' para poder purgarlos de un solo golpe cuando
-- entre la sincronizacion real:
--
--     delete from catalog_items where clover_item_id like 'SEED-%';
--
-- Es idempotente: se puede correr varias veces sin duplicar.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- MARCA
-- ---------------------------------------------------------------------

insert into public.restaurants (id, name, slug, status, support_email, support_phone, subscription_status)
values (
  '11111111-1111-4111-8111-111111111111',
  'Viva Juice and Coffee',
  'viva-juice-coffee',
  'active',
  'hola@vivajuicecoffee.com',
  '+17324968863',
  'trial'
)
on conflict (id) do update set
  name = excluded.name,
  status = excluded.status;

-- Branding tomado del logo: verde profundo, crema y naranja.
insert into public.app_settings (
  restaurant_id, app_display_name, primary_color, secondary_color, accent_color, features, legal_urls
)
values (
  '11111111-1111-4111-8111-111111111111',
  'Viva Juice and Coffee',
  '#0E4A2B',   -- verde del logotipo
  '#F5F0E6',   -- crema del fondo
  '#E87722',   -- naranja de "JUICE"
  jsonb_build_object(
    'loyalty', true, 'promotions', true, 'tips', true,
    'favorites', true, 'scheduling', true
  ),
  jsonb_build_object('website', 'https://vivajuicecoffee.com')
)
on conflict (restaurant_id) do update set
  app_display_name = excluded.app_display_name,
  primary_color = excluded.primary_color,
  secondary_color = excluded.secondary_color,
  accent_color = excluded.accent_color;

-- ---------------------------------------------------------------------
-- SUCURSAL
-- El checklist se marca completo SOLO porque es un entorno de desarrollo
-- y necesitamos que la tienda sea visible en la app. En produccion cada
-- casilla la marca el proceso de onboarding real, nunca a mano.
-- ---------------------------------------------------------------------

insert into public.stores (
  id, restaurant_id, name, slug, status,
  address_line1, city, state, postal_code, country,
  latitude, longitude, phone, timezone,
  pickup_enabled, delivery_enabled, setup_checklist
)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Freehold',
  'freehold',
  'active',
  '31 South St', 'Freehold', 'NJ', '07728', 'US',
  40.259500, -74.274300,
  '+17324968863',
  'America/New_York',
  true, false,
  jsonb_build_object(
    'clover_connected',    true,
    'ecommerce_enabled',   true,
    'order_type_ready',    true,
    'order_printer_ready', true,
    'catalog_synced',      true,
    'smoke_test_passed',   true,
    'not_using_dining',    true
  )
)
on conflict (id) do update set
  name = excluded.name,
  address_line1 = excluded.address_line1,
  status = excluded.status;

-- ---------------------------------------------------------------------
-- LA CONEXION DE CLOVER, VACIA
--
-- POR QUE ESTA FILA VIVE AQUI Y NO LA CREA NADIE MAS
-- `app.issue_clover_connect_token` (0014) emite el enlace con un UPDATE
-- sobre una conexion que YA existe, y falla si no la encuentra. No la
-- crea a proposito: la funcion que emite enlaces no debe fabricar
-- conexiones que nadie pidio. Asi que alguien tiene que crearla antes, y
-- ese alguien sera el SaaS del operador cuando exista (apps/admin). Hasta
-- entonces, este seed.
--
-- VA VACIA, Y ESO ES LO CORRECTO
-- Sin merchant_id, sin tokens, en 'not_connected': una sucursal que
-- todavia no ha autorizado nada. La rellena el flujo de OAuth. Importa
-- que arranque en 'not_connected' porque la 0014 solo mueve a
-- 'pending_auth' desde ahi (o desde 'revoked'); con cualquier otro
-- estado, emitir el enlace dejaria la fila diciendo algo que no es.
--
-- `restaurant_id` SALE DE `stores`, no escrito a mano. Es la fila que
-- decide a que cocina van los pedidos: emparejarla con el restaurante
-- equivocado no da error, da pedidos en el sitio que no.
--
-- `api_base_url` se queda en su default. Es anterior a `environments.ts`
-- y hoy no la lee nadie: los cuatro hosts salen de `environment`.
--
-- `do nothing` Y NO `do update`, QUE ES LA PARTE QUE IMPORTA AL REPETIR
-- Este seed se corre varias veces. Si la sucursal ya esta conectada, la
-- fila tiene merchant_id, ids de Vault y status 'connected'. Un
-- `do update` la devolveria a 'not_connected' y dejaria los secretos
-- huerfanos en Vault: la sucursal dejaria de vender y habria que rehacer
-- el OAuth con el merchant delante. Sembrar es crear lo que falta, nunca
-- pisar una conexion viva.
-- ---------------------------------------------------------------------

insert into public.clover_connections (store_id, restaurant_id, environment)
select s.id, s.restaurant_id, 'sandbox'
  from public.stores s
 where s.id = '22222222-2222-4222-8222-222222222222'
on conflict (store_id) do nothing;

-- Horarios reales confirmados por el negocio (agosto 2026).
-- Sabado abre mas tarde que el resto de la semana.
delete from public.store_hours
where store_id = '22222222-2222-4222-8222-222222222222';

insert into public.store_hours (store_id, weekday, opens_at, closes_at)
select '22222222-2222-4222-8222-222222222222', t.d, t.o, t.c
from (values
  (0, time '06:00', time '21:00'),  -- domingo
  (1, time '06:00', time '21:00'),  -- lunes
  (2, time '06:00', time '21:00'),
  (3, time '06:00', time '21:00'),
  (4, time '06:00', time '21:00'),
  (5, time '06:00', time '21:00'),  -- viernes
  (6, time '09:00', time '21:00')   -- sabado
) as t(d, o, c);

insert into public.store_pickup_config (
  store_id, slot_minutes, lead_time_minutes, max_orders_per_slot, max_days_ahead, asap_enabled
)
values ('22222222-2222-4222-8222-222222222222', 15, 10, 8, 2, true)
on conflict (store_id) do update set
  slot_minutes = excluded.slot_minutes,
  lead_time_minutes = excluded.lead_time_minutes;

insert into public.loyalty_programs (restaurant_id, enabled, points_per_dollar, min_points_to_redeem)
values ('11111111-1111-4111-8111-111111111111', true, 1.00, 100)
on conflict (restaurant_id) do nothing;

-- ---------------------------------------------------------------------
-- CATEGORIAS
-- ---------------------------------------------------------------------

insert into public.catalog_categories (store_id, clover_category_id, name, sort_order)
values
  ('22222222-2222-4222-8222-222222222222', 'SEED-CAT-JUICES',      'Juices',           10),
  ('22222222-2222-4222-8222-222222222222', 'SEED-CAT-SMOOTHIES',   'Smoothies',        20),
  ('22222222-2222-4222-8222-222222222222', 'SEED-CAT-VIRGIN',      'Virgin Drinks',    30),
  ('22222222-2222-4222-8222-222222222222', 'SEED-CAT-WATER',       'Fruit Water',      40),
  ('22222222-2222-4222-8222-222222222222', 'SEED-CAT-SHOTS',       'Viva Boost Shots', 50),
  ('22222222-2222-4222-8222-222222222222', 'SEED-CAT-BOWLS',       'Bowls',            60),
  ('22222222-2222-4222-8222-222222222222', 'SEED-CAT-ICED',        'Iced Coffee',      70),
  ('22222222-2222-4222-8222-222222222222', 'SEED-CAT-HOT',         'Hot Coffee',       80),
  ('22222222-2222-4222-8222-222222222222', 'SEED-CAT-BITES',       'Viva Bites',       90),
  ('22222222-2222-4222-8222-222222222222', 'SEED-CAT-CREPES',      'Crepes & Waffles', 100),
  ('22222222-2222-4222-8222-222222222222', 'SEED-CAT-FRUITCUP',    'Fresh Fruit Cup',  110),
  ('22222222-2222-4222-8222-222222222222', 'SEED-CAT-TREATS',      'Treats',           120),
  ('22222222-2222-4222-8222-222222222222', 'SEED-CAT-ICECREAM',    'Ice Cream',        130)
on conflict (store_id, clover_category_id) do update set
  name = excluded.name, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- PRODUCTOS  (precios del menu vigente, en centavos)
-- ---------------------------------------------------------------------

insert into public.catalog_items
  (store_id, clover_item_id, category_id, name, alternate_name, price_cents)
select
  '22222222-2222-4222-8222-222222222222',
  v.item_id,
  c.id,
  v.name,
  v.descr,
  v.price
from (values
  -- JUICES · 8.50
  ('SEED-CAT-JUICES','SEED-JUICE-VIVA',     'Viva Juice',            'Orange, carrot and beet',                 850),
  ('SEED-CAT-JUICES','SEED-JUICE-GREEN',    'Green Juice',           'Cucumber, celery, kale, ginger, apple, orange', 850),
  ('SEED-CAT-JUICES','SEED-JUICE-DETOX',    'Super Detox',           'Carrot, apple, celery, lime',             850),
  ('SEED-CAT-JUICES','SEED-JUICE-ANTIFLU',  'Anti Flu',              'Orange, lime, ginger, raw honey',         850),
  ('SEED-CAT-JUICES','SEED-JUICE-REFRESH',  'Refresh Me',            'Watermelon, lime, mint',                  850),
  ('SEED-CAT-JUICES','SEED-JUICE-CUSTOM',   'Create Your Own Juice', 'Pick 3 fruits or veggies',                850),

  -- SMOOTHIES · 8.50
  ('SEED-CAT-SMOOTHIES','SEED-SMOOTH-BERRY','Viva Berry',            'Strawberry, blueberry, goji berry',       850),
  ('SEED-CAT-SMOOTHIES','SEED-SMOOTH-CHOCO','Chocolate Protein',     'Banana, peanut butter, chocolate whey',   850),
  ('SEED-CAT-SMOOTHIES','SEED-SMOOTH-VANIL','Vanilla Protein',       'Banana, strawberry, vanilla whey',        850),

  -- VIRGIN DRINKS · 7.50
  ('SEED-CAT-VIRGIN','SEED-VIRGIN-PINA',    'Pina Colada',           'Virgin',                                  750),
  ('SEED-CAT-VIRGIN','SEED-VIRGIN-TEPACHE', 'Tepache',               'Virgin',                                  750),
  ('SEED-CAT-VIRGIN','SEED-VIRGIN-SANGRIA', 'Sangria',               'Virgin',                                  750),

  -- FRUIT WATER · 4.50
  ('SEED-CAT-WATER','SEED-WATER-FRUIT',     'Fruit Water',           'Refreshing fruit-infused water',          450),

  -- BOOST SHOTS · 3.50
  ('SEED-CAT-SHOTS','SEED-SHOT-GINGER',     'Ginger Shot',           'Ginger, orange and lemon',                350),
  ('SEED-CAT-SHOTS','SEED-SHOT-TURMERIC',   'Turmeric Shot',         'Turmeric, ginger, raw honey',             350),
  ('SEED-CAT-SHOTS','SEED-SHOT-POMEGR',     'Pomegranate Shot',      'Pomegranate and turmeric',                350),

  -- BOWLS · 12.50
  ('SEED-CAT-BOWLS','SEED-BOWL-ACAI',       'Acai Bowl',             'Acai, Nutella, blueberries, strawberries, banana, granola', 1250),
  ('SEED-CAT-BOWLS','SEED-BOWL-PITAYA',     'Pitaya Bowl',           'Pitaya, granola, kiwi, pineapple, banana', 1250),
  ('SEED-CAT-BOWLS','SEED-BOWL-COCONUT',    'Coconut Bowl',          'Coconut, chia, granola, mango, blueberry, papaya', 1250),
  ('SEED-CAT-BOWLS','SEED-BOWL-CUSTOM',     'Create Your Own Bowl',  'Pick 3 fruits and 2 toppings',            1250),

  -- ICED COFFEE
  ('SEED-CAT-ICED','SEED-ICED-LATTE',       'Iced Latte',            null,                                      475),
  ('SEED-CAT-ICED','SEED-ICED-AMERICANO',   'Iced Americano',        null,                                      475),
  ('SEED-CAT-ICED','SEED-ICED-COLDBREW',    'Cold Brew',             null,                                      599),
  ('SEED-CAT-ICED','SEED-ICED-FRAPPE',      'Viva Frappe',           null,                                      675),
  ('SEED-CAT-ICED','SEED-ICED-MATCHA',      'Iced Matcha',           null,                                      535),

  -- HOT COFFEE
  ('SEED-CAT-HOT','SEED-HOT-BREW',          'Fresh Brew Coffee',     null,                                      200),
  ('SEED-CAT-HOT','SEED-HOT-AMERICANO',     'Americano',             null,                                      450),
  ('SEED-CAT-HOT','SEED-HOT-CAPPUCCINO',    'Cappuccino',            null,                                      450),
  ('SEED-CAT-HOT','SEED-HOT-LATTE',         'Latte',                 null,                                      450),
  ('SEED-CAT-HOT','SEED-HOT-MATCHA',        'Hot Matcha',            null,                                      550),
  ('SEED-CAT-HOT','SEED-HOT-SINGLE',        'Single Shot',           'Espresso',                                450),
  ('SEED-CAT-HOT','SEED-HOT-DOUBLE',        'Double Shot',           'Espresso',                                550),
  ('SEED-CAT-HOT','SEED-HOT-AFFOGATO',      'Affogato',              null,                                      650),

  -- VIVA BITES
  ('SEED-CAT-BITES','SEED-BITE-TUNA',       'Tuna Sandwich',         'With carrot and celery sticks',           850),
  ('SEED-CAT-BITES','SEED-BITE-SALMON',     'Smoked Salmon Sandwich','With carrot and celery sticks',           999),
  ('SEED-CAT-BITES','SEED-BITE-GUAC',       'Guacamole',             'With carrot and celery sticks',           999),

  -- CREPES & WAFFLES
  ('SEED-CAT-CREPES','SEED-CREPE-VIVA',     'Viva Crepe',            'Strawberry, banana, chocolate drizzle, whipped cream', 1150),
  ('SEED-CAT-CREPES','SEED-WAFFLE-VIVA',    'Viva Waffle',           'Strawberry, banana, Nutella, powdered sugar', 1000),

  -- FRESH FRUIT CUP
  ('SEED-CAT-FRUITCUP','SEED-CUP-10',       'Fresh Fruit Cup 10 oz', null,                                      550),
  ('SEED-CAT-FRUITCUP','SEED-CUP-12',       'Fresh Fruit Cup 12 oz', null,                                      650),

  -- TREATS
  ('SEED-CAT-TREATS','SEED-TREAT-GELWATER', 'Gelatin (Water-Based)', null,                                      200),
  ('SEED-CAT-TREATS','SEED-TREAT-GELMILK',  'Gelatin (Milk-Based)',  null,                                      300),
  ('SEED-CAT-TREATS','SEED-TREAT-TRESLECHE','Three Milk Cake',       null,                                      350),
  ('SEED-CAT-TREATS','SEED-TREAT-CARROT',   'Carrot Cake Slice',     null,                                      350),
  ('SEED-CAT-TREATS','SEED-TREAT-TIRAMISU', 'Tiramisu Cake Slice',   null,                                      399),
  ('SEED-CAT-TREATS','SEED-TREAT-LEMON',    'Lemon Cake Slice',      null,                                      300),
  ('SEED-CAT-TREATS','SEED-TREAT-BANSPLIT', 'Banana Split',          null,                                     1050),
  ('SEED-CAT-TREATS','SEED-TREAT-SORBET',   'Mango Chili Sorbet',    null,                                      850),

  -- ICE CREAM
  ('SEED-CAT-ICECREAM','SEED-ICE-CUP',      'Ice Cream Cup',         null,                                      550),
  ('SEED-CAT-ICECREAM','SEED-ICE-CONE',     'Ice Cream Cone',        null,                                      600)
) as v(cat_id, item_id, name, descr, price)
join public.catalog_categories c
  on c.store_id = '22222222-2222-4222-8222-222222222222'
 and c.clover_category_id = v.cat_id
on conflict (store_id, clover_item_id) do update set
  name = excluded.name,
  alternate_name = excluded.alternate_name,
  price_cents = excluded.price_cents,
  category_id = excluded.category_id;

-- ---------------------------------------------------------------------
-- GRUPOS DE MODIFICADORES
-- ---------------------------------------------------------------------

insert into public.catalog_modifier_groups
  (store_id, clover_group_id, name, min_required, max_allowed, sort_order)
values
  ('22222222-2222-4222-8222-222222222222','SEED-MG-MILK',   'Milk',          1, 1, 10),
  ('22222222-2222-4222-8222-222222222222','SEED-MG-FLAVOR', 'Flavor',        0, 1, 20),
  ('22222222-2222-4222-8222-222222222222','SEED-MG-BREAD',  'Bread',         1, 1, 30)
on conflict (store_id, clover_group_id) do update set
  name = excluded.name, min_required = excluded.min_required, max_allowed = excluded.max_allowed;

insert into public.catalog_modifiers
  (store_id, modifier_group_id, clover_modifier_id, name, price_cents, sort_order)
select '22222222-2222-4222-8222-222222222222', g.id, v.mod_id, v.name, v.price, v.sort
from (values
  -- Avena y coco llevan recargo de 1.00 USD; regular, almendra y soya no.
  ('SEED-MG-MILK','SEED-MOD-MILK-REG',    'Regular Milk',    0, 10),
  ('SEED-MG-MILK','SEED-MOD-MILK-ALMOND', 'Almond Milk',     0, 20),
  ('SEED-MG-MILK','SEED-MOD-MILK-SOY',    'Soy Milk',        0, 30),
  ('SEED-MG-MILK','SEED-MOD-MILK-OAT',    'Oat Milk',      100, 40),
  ('SEED-MG-MILK','SEED-MOD-MILK-COCONUT','Coconut Milk',  100, 50),

  ('SEED-MG-FLAVOR','SEED-MOD-FLAV-VANILLA',   'Vanilla',    0, 10),
  ('SEED-MG-FLAVOR','SEED-MOD-FLAV-LAVENDER',  'Lavender',   0, 20),
  ('SEED-MG-FLAVOR','SEED-MOD-FLAV-BANANA',    'Banana',     0, 30),
  ('SEED-MG-FLAVOR','SEED-MOD-FLAV-HAZELNUT',  'Hazelnut',   0, 40),
  ('SEED-MG-FLAVOR','SEED-MOD-FLAV-ALMOND',    'Almond',     0, 50),
  ('SEED-MG-FLAVOR','SEED-MOD-FLAV-STRAWBERRY','Strawberry', 0, 60),
  ('SEED-MG-FLAVOR','SEED-MOD-FLAV-CARAMEL',   'Caramel',    0, 70),
  ('SEED-MG-FLAVOR','SEED-MOD-FLAV-CHOCOLATE', 'Chocolate',  0, 80),

  ('SEED-MG-BREAD','SEED-MOD-BREAD-CROISSANT', 'Croissant',   0, 10),
  ('SEED-MG-BREAD','SEED-MOD-BREAD-WHEAT',     'Whole Wheat', 0, 20)
) as v(group_id, mod_id, name, price, sort)
join public.catalog_modifier_groups g
  on g.store_id = '22222222-2222-4222-8222-222222222222'
 and g.clover_group_id = v.group_id
on conflict (store_id, clover_modifier_id) do update set
  name = excluded.name, price_cents = excluded.price_cents;

-- Asociar grupos a los productos que corresponden
insert into public.catalog_item_modifier_groups (item_id, modifier_group_id, sort_order)
select i.id, g.id, 10
from public.catalog_items i
join public.catalog_modifier_groups g
  on g.store_id = i.store_id and g.clover_group_id = 'SEED-MG-MILK'
where i.store_id = '22222222-2222-4222-8222-222222222222'
  and i.clover_item_id in (
    'SEED-SMOOTH-BERRY','SEED-SMOOTH-CHOCO','SEED-SMOOTH-VANIL',
    'SEED-ICED-LATTE','SEED-ICED-MATCHA','SEED-ICED-FRAPPE',
    'SEED-HOT-LATTE','SEED-HOT-CAPPUCCINO','SEED-HOT-MATCHA'
  )
on conflict do nothing;

insert into public.catalog_item_modifier_groups (item_id, modifier_group_id, sort_order)
select i.id, g.id, 20
from public.catalog_items i
join public.catalog_modifier_groups g
  on g.store_id = i.store_id and g.clover_group_id = 'SEED-MG-FLAVOR'
where i.store_id = '22222222-2222-4222-8222-222222222222'
  and i.clover_item_id like 'SEED-ICED-%'
on conflict do nothing;

insert into public.catalog_item_modifier_groups (item_id, modifier_group_id, sort_order)
select i.id, g.id, 10
from public.catalog_items i
join public.catalog_modifier_groups g
  on g.store_id = i.store_id and g.clover_group_id = 'SEED-MG-BREAD'
where i.store_id = '22222222-2222-4222-8222-222222222222'
  and i.clover_item_id in ('SEED-BITE-TUNA','SEED-BITE-SALMON','SEED-BITE-GUAC')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- MERCHANDISING: destacados para la pantalla Home
-- ---------------------------------------------------------------------

insert into public.app_item_overrides (store_id, clover_item_id, featured, sort_order, badge)
values
  ('22222222-2222-4222-8222-222222222222','SEED-JUICE-GREEN',  true, 10, 'Best seller'),
  ('22222222-2222-4222-8222-222222222222','SEED-BOWL-ACAI',    true, 20, 'Popular'),
  ('22222222-2222-4222-8222-222222222222','SEED-SMOOTH-BERRY', true, 30, null),
  ('22222222-2222-4222-8222-222222222222','SEED-ICED-COLDBREW',true, 40, null)
on conflict (store_id, clover_item_id) do update set
  featured = excluded.featured, badge = excluded.badge;

-- ---------------------------------------------------------------------
-- ORDEN DEL MENU DENTRO DE CADA CATEGORIA
--
-- Entre categorias manda `catalog_categories.sort_order`. Dentro de cada
-- una manda esto: `app_item_overrides.sort_order`.
--
-- Sin estos valores casi todos los productos quedan en 0, y Postgres
-- devuelve las filas empatadas en el orden que le conviene: el menu se
-- recoloca solo entre una carga y otra. La app NO lo arregla ordenando
-- por nombre, porque un menu por orden alfabetico no es el que el
-- restaurante decidio.
--
-- Los numeros son el orden de docs/FOTOS-PRODUCTO.md, que es la lista tal
-- como la escribio Viva. De diez en diez para poder meter un producto
-- nuevo en medio sin renumerar nada.
-- ---------------------------------------------------------------------

with ordenados (clover_item_id, orden) as (values
  ('SEED-JUICE-VIVA', 10),
  ('SEED-JUICE-GREEN', 20),
  ('SEED-JUICE-DETOX', 30),
  ('SEED-JUICE-ANTIFLU', 40),
  ('SEED-JUICE-REFRESH', 50),
  ('SEED-JUICE-CUSTOM', 60),
  ('SEED-SMOOTH-BERRY', 70),
  ('SEED-SMOOTH-CHOCO', 80),
  ('SEED-SMOOTH-VANIL', 90),
  ('SEED-VIRGIN-PINA', 100),
  ('SEED-VIRGIN-TEPACHE', 110),
  ('SEED-VIRGIN-SANGRIA', 120),
  ('SEED-WATER-FRUIT', 130),
  ('SEED-SHOT-GINGER', 140),
  ('SEED-SHOT-TURMERIC', 150),
  ('SEED-SHOT-POMEGR', 160),
  ('SEED-BOWL-ACAI', 170),
  ('SEED-BOWL-PITAYA', 180),
  ('SEED-BOWL-COCONUT', 190),
  ('SEED-BOWL-CUSTOM', 200),
  ('SEED-ICED-LATTE', 210),
  ('SEED-ICED-AMERICANO', 220),
  ('SEED-ICED-COLDBREW', 230),
  ('SEED-ICED-FRAPPE', 240),
  ('SEED-ICED-MATCHA', 250),
  ('SEED-HOT-BREW', 260),
  ('SEED-HOT-AMERICANO', 270),
  ('SEED-HOT-CAPPUCCINO', 280),
  ('SEED-HOT-LATTE', 290),
  ('SEED-HOT-MATCHA', 300),
  ('SEED-HOT-SINGLE', 310),
  ('SEED-HOT-DOUBLE', 320),
  ('SEED-HOT-AFFOGATO', 330),
  ('SEED-BITE-TUNA', 340),
  ('SEED-BITE-SALMON', 350),
  ('SEED-BITE-GUAC', 360),
  ('SEED-CREPE-VIVA', 370),
  ('SEED-WAFFLE-VIVA', 380),
  ('SEED-CUP-10', 390),
  ('SEED-CUP-12', 400),
  ('SEED-TREAT-GELWATER', 410),
  ('SEED-TREAT-GELMILK', 420),
  ('SEED-TREAT-TRESLECHE', 430),
  ('SEED-TREAT-CARROT', 440),
  ('SEED-TREAT-TIRAMISU', 450),
  ('SEED-TREAT-LEMON', 460),
  ('SEED-TREAT-BANSPLIT', 470),
  ('SEED-TREAT-SORBET', 480),
  ('SEED-ICE-CUP', 490),
  ('SEED-ICE-CONE', 500)
)
insert into public.app_item_overrides (store_id, clover_item_id, sort_order)
select i.store_id, i.clover_item_id, o.orden
from ordenados o
join public.catalog_items i
  on i.clover_item_id = o.clover_item_id
 and i.store_id = '22222222-2222-4222-8222-222222222222'
on conflict (store_id, clover_item_id) do update
  set sort_order = excluded.sort_order;

-- Si esto no da 50, algun identificador de la lista no existe en el
-- catalogo y ese producto se quedaria sin orden.
do $orden$
declare
  n int;
begin
  select count(*) into n
  from public.app_item_overrides
  where store_id = '22222222-2222-4222-8222-222222222222'
    and sort_order > 0;
  if n <> 50 then
    raise exception 'Orden del menu incompleto: solo % de 50 productos', n;
  end if;
end;
$orden$;

commit;

-- ---------------------------------------------------------------------
-- VERIFICACION
-- ---------------------------------------------------------------------
select
  (select count(*) from public.catalog_categories where store_id='22222222-2222-4222-8222-222222222222') as categorias,
  (select count(*) from public.catalog_items      where store_id='22222222-2222-4222-8222-222222222222') as productos,
  (select count(*) from public.catalog_modifiers  where store_id='22222222-2222-4222-8222-222222222222') as modificadores,
  (select count(*) from public.menu_items where store_id='22222222-2222-4222-8222-222222222222' and is_available) as disponibles,
  (select count(*) from public.clover_connections where store_id='22222222-2222-4222-8222-222222222222') as conexion;
