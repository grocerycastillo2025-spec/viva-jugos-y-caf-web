-- =====================================================================
-- viva_ingredientes.sql — Ingredientes de VIVA Jugos y Café (0031)
--
-- Crea los ingredientes del menú base y los liga solos: a los productos
-- cuya descripción los menciona y a las opciones del mismo nombre ("Crea
-- el tuyo"). Las leches se ligan a las opciones de "Elige tu leche".
-- IDEMPOTENTE: no duplica nada ni borra ligas hechas por el dueño.
-- =====================================================================

do $ing$
declare
  v_store uuid := '33333333-3333-4333-8333-333333333333';
begin
  insert into public.ingredients (store_id, name, sort_order)
  select v_store, n, o
    from unnest(array[
      'Naranja','Zanahoria','Betabel','Pepino','Apio','Kale','Jengibre','Manzana','Limón','Miel',
      'Sandía','Menta','Fresa','Arándano','Goji berry','Mango','Pasas','Piña','Plátano',
      'Mantequilla de maní','Proteína de chocolate','Proteína de vainilla','Café de grano',
      'Leche entera','Leche de almendra','Leche de avena','Leche de soya'
    ]) with ordinality as t(n, o)
  on conflict do nothing;

  perform app.autolink_ingredients(v_store);

  update public.catalog_modifiers m set ingredient_id = g.id
    from (values ('viva-mod-entera','Leche entera'), ('viva-mod-almendra','Leche de almendra'),
                 ('viva-mod-avena','Leche de avena'), ('viva-mod-soya','Leche de soya')) as v(mod, ing)
    join public.ingredients g on g.store_id = v_store and g.name = v.ing
   where m.store_id = v_store and m.clover_modifier_id = v.mod and m.ingredient_id is null;
end
$ing$;
