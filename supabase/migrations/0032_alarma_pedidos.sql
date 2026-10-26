-- =====================================================================
-- 0032_alarma_pedidos.sql
-- Sonido propio para la alarma de pedidos nuevos del panel.
--
--   stores.alert_sound_url   el sonido que sube el dueño (todos los
--                            dispositivos del panel lo usan)
--   bucket "sounds"          sounds/{restaurant_id}/archivo (2 MB, audio)
--
-- Lo demás (volumen, cada cuánto repite, vibrar, pantalla encendida) es
-- de cada dispositivo y vive en el navegador.
--
-- MIGRACION NUEVA. Las 0001 a 0031 estan aplicadas y no se tocan.
-- =====================================================================

alter table public.stores
  add column if not exists alert_sound_url text
    check (alert_sound_url is null or (alert_sound_url ~ '^https://' and char_length(alert_sound_url) <= 500));

comment on column public.stores.alert_sound_url is
  'Sonido propio de la alarma de pedidos nuevos (0032). Null = sonido incluido.';

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Esquema storage no disponible: se omite la parte de archivos de 0032.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('sounds', 'sounds', true, 2097152,
          array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg',
                'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/webm'])
  on conflict (id) do nothing;

  execute $p$ drop policy if exists "public read sounds" on storage.objects $p$;
  execute $p$
    create policy "public read sounds" on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'sounds')
  $p$;

  execute $p$ drop policy if exists "owners manage their sounds" on storage.objects $p$;
  execute $p$
    create policy "owners manage their sounds" on storage.objects
      for all to authenticated
      using (
        bucket_id = 'sounds'
        and exists (select 1 from public.restaurants r
                     where r.id::text = (storage.foldername(name))[1]
                       and coalesce(app.owns_restaurant(r.id), false))
      )
      with check (
        bucket_id = 'sounds'
        and exists (select 1 from public.restaurants r
                     where r.id::text = (storage.foldername(name))[1]
                       and coalesce(app.owns_restaurant(r.id), false))
      )
  $p$;
end;
$$;
