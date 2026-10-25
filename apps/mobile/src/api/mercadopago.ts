/**
 * Mercado Pago automático (0028): llamadas a las Edge Functions.
 * El token de Mercado Pago vive en Supabase; la app nunca lo ve.
 */

import { dataError } from '../domain/errors';
import { getSupabase } from '../supabase';

interface FunctionError {
  readonly context?: { json?: () => Promise<unknown> };
  readonly message: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke<T>('mp-pago', { body });
  if (error !== null) {
    // El cuerpo trae el motivo ("ya_pagado", "mercadopago_no_conectado"...).
    let reason = (error as FunctionError).message;
    try {
      const payload = (await (error as FunctionError).context?.json?.()) as { error?: unknown } | undefined;
      if (typeof payload?.error === 'string') reason = payload.error;
    } catch {
      // se queda el mensaje genérico
    }
    throw dataError(reason);
  }
  if (data === null) throw dataError('respuesta_vacia');
  return data;
}

/** La liga de Checkout Pro con el monto exacto del pedido. */
export async function startMercadoPago(orderId: string): Promise<string> {
  const result = await invoke<{ url?: unknown }>({ order_id: orderId });
  if (typeof result.url !== 'string') throw dataError('mercadopago_rechazo');
  return result.url;
}

export interface MercadoPagoStatus {
  readonly connected: boolean;
  readonly test?: boolean;
  readonly account?: string | null;
  readonly reason?: string;
}

/** El dueño prueba que el token guardado en Supabase funciona. */
export async function checkMercadoPago(storeId: string): Promise<MercadoPagoStatus> {
  return invoke<MercadoPagoStatus>({ action: 'estado', store_id: storeId });
}

/** ¿La sucursal cobra con Mercado Pago automático? (lectura pública) */
export async function isMercadoPagoConnected(storeId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('payment_provider_accounts')
    .select('status')
    .eq('store_id', storeId)
    .eq('provider', 'mercadopago')
    .maybeSingle<{ status: string }>();
  if (error !== null) return false;
  return data?.status === 'active';
}
