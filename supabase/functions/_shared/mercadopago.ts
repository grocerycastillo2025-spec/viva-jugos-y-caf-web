/**
 * Mercado Pago (Checkout Pro) — lógica pura, sin red ni base.
 *
 * Lo usan las Edge Functions `mp-pago` y `mp-webhook`. Todo lo que decide
 * dinero vive aquí para poder probarlo en Node sin Mercado Pago.
 *
 * REGLAS QUE NO SE NEGOCIAN
 *  - El monto sale de la base, nunca del teléfono.
 *  - Un aviso (webhook) no se cree: con el id del pago se le pregunta a la
 *    API de Mercado Pago, con nuestro token. Un aviso falso solo consigue
 *    que consultemos un pago que no existe o que no es nuestro.
 *  - Un pedido se marca pagado solo si el pago está `approved`, es en MXN,
 *    apunta a ESE pedido (`external_reference`) y cubre el monto.
 */

export const MP_API = 'https://api.mercadopago.com';

export interface OrderForPayment {
  readonly id: string;
  readonly orderNumber: number;
  readonly amountCents: number;
  readonly currency: string;
  readonly storeName: string;
  readonly itemsSummary: string;
  readonly payerEmail: string | null;
}

export interface PreferenceUrls {
  /** Base pública de la app web, con "/" final. */
  readonly appUrl: string;
  /** URL pública del webhook (Edge Function mp-webhook). */
  readonly notificationUrl: string;
}

/** Cuerpo de POST /checkout/preferences para un pedido. */
export function preferenceBody(order: OrderForPayment, urls: PreferenceUrls): Record<string, unknown> {
  const back = `${urls.appUrl}order/${order.id}`;
  const title = `Pedido #${order.orderNumber} · ${order.storeName}`.slice(0, 250);
  return {
    items: [
      {
        id: order.id,
        title,
        description: order.itemsSummary.slice(0, 250),
        quantity: 1,
        currency_id: order.currency,
        unit_price: centsToAmount(order.amountCents),
      },
    ],
    ...(order.payerEmail === null ? {} : { payer: { email: order.payerEmail } }),
    external_reference: order.id,
    metadata: { order_id: order.id, order_number: order.orderNumber },
    notification_url: urls.notificationUrl,
    back_urls: { success: back, pending: back, failure: back },
    auto_return: 'approved',
    statement_descriptor: 'VIVA JUGOS',
    binary_mode: false,
  };
}

/** 4550 -> 45.5 (Mercado Pago trabaja en pesos con decimales). */
export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

/** 45.5 -> 4550, sin errores de coma flotante. */
export function amountToCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Las credenciales de prueba empiezan con TEST-. */
export function isTestToken(token: string): boolean {
  return token.startsWith('TEST-');
}

/** La liga a la que se manda al cliente. */
export function checkoutUrl(
  preference: { init_point?: unknown; sandbox_init_point?: unknown },
  token: string,
): string | null {
  const url = isTestToken(token) ? preference.sandbox_init_point ?? preference.init_point : preference.init_point;
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

/**
 * El id del pago en un aviso de Mercado Pago, o null si el aviso no es de
 * un pago (p. ej. `merchant_order`), que se contesta 200 y se ignora.
 *
 * Formatos que manda:
 *  - Webhook:  body {"type":"payment","data":{"id":"123"}} y/o
 *              query ?type=payment&data.id=123
 *  - IPN:      query ?topic=payment&id=123
 */
export function paymentIdFromNotification(url: URL, body: unknown): string | null {
  const q = url.searchParams;
  const b = (body ?? {}) as { type?: unknown; topic?: unknown; action?: unknown; data?: { id?: unknown } };
  const kind = String(b.type ?? q.get('type') ?? b.topic ?? q.get('topic') ?? '');
  const action = typeof b.action === 'string' ? b.action : '';
  const isPayment = kind === 'payment' || action.startsWith('payment.');
  if (!isPayment) return null;
  const raw = b.data?.id ?? q.get('data.id') ?? q.get('id');
  const id = raw === undefined || raw === null ? '' : String(raw);
  return /^\d{1,20}$/.test(id) ? id : null;
}

export interface MpPayment {
  readonly id: string;
  readonly status: string;
  readonly externalReference: string | null;
  readonly amountCents: number;
  readonly currency: string;
}

/** Lo que nos importa de GET /v1/payments/{id}. */
export function readPayment(json: unknown): MpPayment | null {
  const p = json as {
    id?: unknown;
    status?: unknown;
    external_reference?: unknown;
    transaction_amount?: unknown;
    currency_id?: unknown;
  } | null;
  if (p === null || typeof p !== 'object') return null;
  if (typeof p.status !== 'string' || typeof p.transaction_amount !== 'number') return null;
  return {
    id: String(p.id ?? ''),
    status: p.status,
    externalReference: typeof p.external_reference === 'string' ? p.external_reference : null,
    amountCents: amountToCents(p.transaction_amount),
    currency: typeof p.currency_id === 'string' ? p.currency_id : '',
  };
}

export type PaymentDecision =
  | { readonly kind: 'mark_paid' }
  | { readonly kind: 'mark_unpaid'; readonly reason: string }
  | { readonly kind: 'record_only'; readonly reason: string }
  | { readonly kind: 'reject'; readonly reason: string };

const REVERSED = new Set(['refunded', 'charged_back', 'cancelled']);

/**
 * Qué hacer con un pago consultado a Mercado Pago, frente al pedido al
 * que dice pertenecer.
 */
export function decidePayment(
  payment: MpPayment,
  order: { readonly id: string; readonly amountCents: number; readonly currency: string; readonly payWith: string | null } | null,
): PaymentDecision {
  if (order === null || payment.externalReference !== order.id) {
    return { kind: 'reject', reason: 'pedido_desconocido' };
  }
  if (order.payWith !== 'mercadopago') return { kind: 'reject', reason: 'pedido_no_es_mercadopago' };
  if (payment.currency !== order.currency) return { kind: 'reject', reason: 'moneda_distinta' };
  if (payment.status === 'approved') {
    if (payment.amountCents < order.amountCents) return { kind: 'reject', reason: 'monto_insuficiente' };
    return { kind: 'mark_paid' };
  }
  if (REVERSED.has(payment.status)) return { kind: 'mark_unpaid', reason: payment.status };
  return { kind: 'record_only', reason: payment.status };
}

/** "2× Viva Juice, 1× Café" para la descripción del cobro. */
export function summarizeItems(items: readonly { readonly name: string; readonly quantity: number }[]): string {
  return items.map((i) => `${i.quantity}× ${i.name}`).join(', ');
}
