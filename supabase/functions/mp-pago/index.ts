/**
 * Arranque en Deno de `mp-pago`. La lógica está en handler.ts.
 *
 * Secretos (Supabase -> Edge Functions -> Secrets):
 *   MP_ACCESS_TOKEN   Access Token de Mercado Pago del negocio.
 *   APP_PUBLIC_URL    (opcional) base de la app web, con "/" final.
 * SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_DB_URL los pone Supabase.
 */

import postgres from 'npm:postgres@3.4.5';

import { createMpPagoHandler } from './handler.ts';

const sql = postgres(requerida('SUPABASE_DB_URL'), { prepare: false, max: 2 });

Deno.serve(
  createMpPagoHandler({
    sql: (text, params) => sql.unsafe(text, params),
    fetch,
    supabaseUrl: requerida('SUPABASE_URL'),
    anonKey: requerida('SUPABASE_ANON_KEY'),
    mpToken: Deno.env.get('MP_ACCESS_TOKEN')?.trim() || null,
    appUrl: Deno.env.get('APP_PUBLIC_URL') || 'https://grocerycastillo2025-spec.github.io/viva-jugos-y-caf-web/',
  }),
);

function requerida(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (valor === undefined || valor === '') throw new Error(`Falta la variable de entorno ${nombre}.`);
  return valor;
}
