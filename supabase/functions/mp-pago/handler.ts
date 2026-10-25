/**
 * Edge Function `mp-pago`.
 *
 *   POST {"order_id": "..."}               (cliente con sesión)
 *     -> {"url": "https://www.mercadopago.com.mx/checkout/..."}
 *     Crea (o reusa) la preferencia de Checkout Pro del pedido con el
 *     monto que dice la base y devuelve la liga para pagar.
 *
 *   POST {"action": "estado", "store_id": "..."}   (dueño de la sucursal)
 *     -> {"connected": true, "test": false, "account": "VIVAJUGOS"}
 *     Prueba el token contra la API y marca la cuenta como conectada.
 *
 * El handler no toca `Deno`: recibe sus dependencias, para poder probarlo
 * en Node con una base real y un Mercado Pago falso.
 */

import { identificar, leerBearer } from '../checkout/auth.ts';
import {
  checkoutUrl,
  isTestToken,
  MP_API,
  preferenceBody,
  summarizeItems,
} from '../_shared/mercadopago.ts';

export type Sql = (text: string, params?: readonly unknown[]) => Promise<Record<string, unknown>[]>;

export interface MpPagoDeps {
  readonly sql: Sql;
  readonly fetch: typeof fetch;
  readonly supabaseUrl: string;
  readonly anonKey: string;
  /** Access Token de Mercado Pago del negocio. Sin él, todo contesta "no conectado". */
  readonly mpToken: string | null;
  /** Base pública de la app web, con "/" final. */
  readonly appUrl: string;
  /** Para pruebas: API de Mercado Pago. */
  readonly mpApi?: string;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export function createMpPagoHandler(deps: MpPagoDeps): (req: Request) => Promise<Response> {
  const api = deps.mpApi ?? MP_API;

  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'solo POST' });

    const token = leerBearer(req.headers.get('authorization'));
    if (token === null) return json(401, { error: 'no autorizado' });
    const who = await identificar(deps.fetch, { supabaseUrl: deps.supabaseUrl, anonKey: deps.anonKey, token });
    if (!who.ok) return json(401, { error: 'no autorizado' });

    let body: Record<string, unknown>;
    try {
      body = ((await req.json()) ?? {}) as Record<string, unknown>;
    } catch {
      return json(400, { error: 'cuerpo inválido' });
    }

    if (body['action'] === 'estado') return estado(String(body['store_id'] ?? ''), who.userId);
    return pagar(String(body['order_id'] ?? ''), who.userId);
  };

  // ── El dueño prueba la conexión ──────────────────────────────────────
  async function estado(storeId: string, userId: string): Promise<Response> {
    if (!isUuid(storeId)) return json(400, { error: 'store_id inválido' });
    const owner = await deps.sql(
      `select 1 from public.stores s
         join public.restaurant_members m on m.restaurant_id = s.restaurant_id
        where s.id = $1 and m.user_id = $2 and m.role = 'owner'`,
      [storeId, userId],
    );
    if (owner.length === 0) return json(403, { error: 'solo el dueño' });

    if (deps.mpToken === null) {
      await setAccount(storeId, 'pending', null, null);
      return json(200, { connected: false, reason: 'falta_token' });
    }

    let res: Response;
    try {
      res = await deps.fetch(`${api}/users/me`, { headers: { authorization: `Bearer ${deps.mpToken}` } });
    } catch {
      return json(502, { connected: false, reason: 'mercadopago_inalcanzable' });
    }
    if (!res.ok) {
      await setAccount(storeId, 'disabled', null, null);
      return json(200, { connected: false, reason: 'token_rechazado' });
    }
    const me = (await res.json().catch(() => ({}))) as { nickname?: unknown; site_id?: unknown };
    const label = typeof me.nickname === 'string' ? me.nickname.slice(0, 120) : null;
    // Las credenciales de prueba nuevas empiezan con APP_USR- igual que las
    // reales; lo que delata la prueba es la cuenta (TESTUSER...).
    const test = isTestToken(deps.mpToken) || (label !== null && /^TEST_?USER/i.test(label));
    await setAccount(storeId, 'active', !test, label);
    return json(200, { connected: true, test, account: label, site: me.site_id ?? null });
  }

  async function setAccount(storeId: string, status: string, live: boolean | null, label: string | null): Promise<void> {
    await deps.sql(
      `insert into public.payment_provider_accounts (store_id, provider, status, live_mode, account_label, updated_at)
       values ($1, 'mercadopago', $2, $3, $4, now())
       on conflict (store_id, provider) do update
         set status = excluded.status, live_mode = excluded.live_mode,
             account_label = excluded.account_label, updated_at = now()`,
      [storeId, status, live, label],
    );
  }

  // ── El cliente paga su pedido ────────────────────────────────────────
  async function pagar(orderId: string, userId: string): Promise<Response> {
    if (!isUuid(orderId)) return json(400, { error: 'order_id inválido' });
    if (deps.mpToken === null) return json(503, { error: 'mercadopago_no_conectado' });

    const rows = await deps.sql(
      `select o.id, o.order_number, o.user_id, o.status, o.pay_with, o.currency,
              o.paid_confirmed_at, o.mp_preference_id,
              app.order_amount_cents(o.id) as amount_cents,
              s.name as store_name, s.id as store_id,
              app.mercadopago_connected(s.id) as connected,
              coalesce((s.payment_options ->> 'mercadopago')::boolean, false) as enabled,
              u.email
         from public.orders o
         join public.stores s on s.id = o.store_id
         left join auth.users u on u.id = o.user_id
        where o.id = $1`,
      [orderId],
    );
    const o = rows[0];
    // El pedido de otro usuario se contesta igual que uno que no existe.
    if (o === undefined || o['user_id'] !== userId) return json(404, { error: 'pedido_no_encontrado' });
    if (o['pay_with'] !== 'mercadopago') return json(409, { error: 'pedido_no_es_mercadopago' });
    if (o['paid_confirmed_at'] !== null) return json(409, { error: 'ya_pagado' });
    if (o['status'] === 'canceled' || o['status'] === 'completed') return json(409, { error: 'pedido_cerrado' });
    if (o['connected'] !== true || o['enabled'] !== true) return json(503, { error: 'mercadopago_no_conectado' });

    const amountCents = Number(o['amount_cents']);
    if (!Number.isFinite(amountCents) || amountCents <= 0) return json(409, { error: 'monto_invalido' });

    const items = await deps.sql(
      `select name_snapshot as name, quantity from public.order_items where order_id = $1 order by sort_order`,
      [orderId],
    );

    const preference = preferenceBody(
      {
        id: orderId,
        orderNumber: Number(o['order_number']),
        amountCents,
        currency: String(o['currency'] ?? 'MXN'),
        storeName: String(o['store_name'] ?? ''),
        itemsSummary: summarizeItems(items.map((i) => ({ name: String(i['name']), quantity: Number(i['quantity']) }))),
        payerEmail: typeof o['email'] === 'string' ? o['email'] : null,
      },
      { appUrl: deps.appUrl, notificationUrl: `${deps.supabaseUrl}/functions/v1/mp-webhook` },
    );

    let res: Response;
    try {
      res = await deps.fetch(`${api}/checkout/preferences`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${deps.mpToken}`,
          'content-type': 'application/json',
          // Mismo pedido y mismo monto = misma preferencia.
          'x-idempotency-key': `${orderId}-${amountCents}`,
        },
        body: JSON.stringify(preference),
      });
    } catch {
      return json(502, { error: 'mercadopago_inalcanzable' });
    }
    const pref = (await res.json().catch(() => null)) as { id?: unknown; init_point?: unknown; sandbox_init_point?: unknown } | null;
    const url = pref === null ? null : checkoutUrl(pref, deps.mpToken);
    if (!res.ok || url === null) return json(502, { error: 'mercadopago_rechazo', status: res.status });

    await deps.sql(`update public.orders set mp_preference_id = $2 where id = $1`, [orderId, String(pref?.id ?? '')]);
    return json(200, { url, amount_cents: amountCents, test: isTestToken(deps.mpToken) });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
