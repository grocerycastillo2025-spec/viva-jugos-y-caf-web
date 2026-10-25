/**
 * Arranque en Deno de `mp-webhook`. La lógica está en handler.ts.
 *
 * Secretos (Supabase -> Edge Functions -> Secrets):
 *   MP_ACCESS_TOKEN   Access Token de Mercado Pago del negocio.
 *   APP_PUBLIC_URL    (opcional) base de la app web, con "/" final.
 * SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_DB_URL los pone Supabase.
 */

import postgres from 'npm:postgres@3.4.5';

import { createMpWebhookHandler } from './handler.ts';

const sql = postgres(requerida('SUPABASE_DB_URL'), { prepare: false, max: 2 });

Deno.serve(
  createMpWebhookHandler({
    sql: (text, params) => sql.unsafe(text, params),
    fetch,
    mpToken: Deno.env.get('MP_ACCESS_TOKEN')?.trim() || null,
    log: (event, data) => console.log(JSON.stringify({ fn: 'mp-webhook', event, ...data })),
  }),
);

function requerida(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (valor === undefined || valor === '') throw new Error(`Falta la variable de entorno ${nombre}.`);
  return valor;
}
