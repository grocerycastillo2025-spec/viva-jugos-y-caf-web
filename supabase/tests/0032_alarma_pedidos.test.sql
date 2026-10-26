-- =====================================================================
-- Pruebas de 0032: sonido propio de la alarma de pedidos.
-- =====================================================================

\set ON_ERROR_STOP on

\i supabase/seed/viva_jugos_mx.sql
begin;

-- Acepta una liga https y la vuelve a quitar.
update public.stores set alert_sound_url = 'https://x.supabase.co/storage/v1/object/public/sounds/a/b.mp3'
 where id = (select id from public.stores limit 1);
update public.stores set alert_sound_url = null where id = (select id from public.stores limit 1);

-- Rechaza http y ligas larguísimas.
do $$
begin
  begin
    update public.stores set alert_sound_url = 'http://malo.mx/a.mp3' where id = (select id from public.stores limit 1);
    raise exception 'FALLO: aceptó http';
  exception when check_violation then null;
  end;
  begin
    update public.stores set alert_sound_url = 'https://' || repeat('a', 600) where id = (select id from public.stores limit 1);
    raise exception 'FALLO: aceptó liga larga';
  exception when check_violation then null;
  end;
end $$;

rollback;
\echo 'OK 0032'
