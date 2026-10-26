/**
 * Arranque en Deno de `equipo-crear`. La lógica está en handler.ts.
 * SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY y
 * SUPABASE_DB_URL los pone Supabase; no hay que configurar nada.
 */

import postgres from 'npm:postgres@3.4.5';

import { createEquipoCrearHandler } from './handler.ts';

const sql = postgres(requerida('SUPABASE_DB_URL'), { prepare: false, max: 2 });

Deno.serve(
  createEquipoCrearHandler({
    sql: (text, params) => sql.unsafe(text, params),
    fetch,
    supabaseUrl: requerida('SUPABASE_URL'),
    anonKey: requerida('SUPABASE_ANON_KEY'),
    serviceKey: requerida('SUPABASE_SERVICE_ROLE_KEY'),
  }),
);

function requerida(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (valor === undefined || valor === '') throw new Error(`Falta la variable de entorno ${nombre}.`);
  return valor;
}
