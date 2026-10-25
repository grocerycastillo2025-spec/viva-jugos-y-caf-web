-- =====================================================================
-- Siembra el historial de migraciones en una base que ya las tiene todas.
--
-- POR QUE EXISTE ESTE ARCHIVO
-- El proyecto juicebar-dev (trqfelkgovygcbqtofrs) se construyo a mano, por
-- el SQL Editor, migracion a migracion. La base tiene las 15 aplicadas,
-- pero `supabase_migrations.schema_migrations` -el registro donde el CLI
-- anota lo que ya corrio- nunca se creo. Sin ese registro, `db push` cree
-- que la base esta vacia e intenta reaplicar desde la 0001: falla con
-- "already exists" y obliga a seguir yendo a mano para siempre.
--
-- Esto NO crea, borra ni modifica ningun objeto de la base. Solo escribe
-- 15 filas de contabilidad, para que el CLI sepa que la 0016 es la
-- siguiente y no la 0001.
--
-- ANTES DE EJECUTARLO hay que haber comprobado que la base de verdad
-- tiene las 15 aplicadas (ver docs/PASO-A-PASO.md, "El historial de
-- migraciones"). Sembrar sin comprobar es decirle al CLI que confie en
-- un estado que nadie ha mirado: a partir de ahi dara por aplicada
-- cualquier migracion que en realidad falte, y en silencio.
--
-- Se puede ejecutar dos veces sin efecto adicional.
-- =====================================================================

create schema if not exists supabase_migrations;

-- Las tres columnas y el tipo son los que crea el propio CLI
-- (`supabase migration repair`). `statements` queda en NULL: el CLI solo
-- lee `version` para decidir que aplicar, y las sentencias de estas 15 ya
-- estan en supabase/migrations/.
create table if not exists supabase_migrations.schema_migrations (
  version    text not null primary key,
  statements text[],
  name       text
);

-- `version` es el prefijo del nombre del archivo y `name` el resto sin
-- .sql: asi es como el CLI parte `0001_core.sql`. Tienen que coincidir
-- exactamente con supabase/migrations/ o la 0001 se reaplicaria.
insert into supabase_migrations.schema_migrations (version, name) values
  ('0001', 'core'),
  ('0002', 'clover_catalog'),
  ('0003', 'orders_loyalty'),
  ('0004', 'rls'),
  ('0005', 'storage'),
  ('0006', 'grants'),
  ('0007', 'view_security'),
  ('0008', 'checkout'),
  ('0009', 'payments'),
  ('0010', 'push_tokens'),
  ('0011', 'recargo'),
  ('0012', 'recovery_token'),
  ('0013', 'refresh_lease'),
  ('0014', 'connect_link'),
  ('0015', 'token_refresh_cron')
on conflict (version) do nothing;

-- Comprobacion: tienen que salir 15 filas, de la 0001 a la 0015.
select version, name from supabase_migrations.schema_migrations order by version;
