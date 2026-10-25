/**
 * Edge Function `mp-webhook`: Mercado Pago avisa que hubo un pago.
 *
 * NO SE CREE EL AVISO. Del aviso solo se toma el id del pago; el estado,
 * el monto y a qué pedido pertenece se le preguntan a la API de Mercado
 * Pago con nuestro token. Quien mande un aviso falso solo consigue que
 * consultemos un pago que no existe o que no es de esta cuenta.
 *
 * Respuestas: 200 para todo lo que ya quedó resuelto (incluido "no es
 * nuestro"), para que Mercado Pago no reintente; 500 solo cuando vale la
 * pena que reintente (no se pudo consultar el pago o la base falló).
 */

import { decidePayment, MP_API, paymentIdFromNotification, readPayment } from '../_shared/mercadopago.ts';

export type Sql = (text: string, params?: readonly unknown[]) => Promise<Record<string, unknown>[]>;

export interface MpWebhookDeps {
  readonly sql: Sql;
  readonly fetch: typeof fetch;
  readonly mpToken: string | null;
  readonly mpApi?: string;
  readonly log?: (event: string, data?: Record<string, unknown>) => void;
}

export function createMpWebhookHandler(deps: MpWebhookDeps): (req: Request) => Promise<Response> {
  const api = deps.mpApi ?? MP_API;
  const log = deps.log ?? (() => undefined);

  return async (req) => {
    if (req.method !== 'POST' && req.method !== 'GET') return text(405, 'solo POST');
    const url = new URL(req.url);
    let body: unknown = null;
    if (req.method === 'POST') body = await req.json().catch(() => null);

    const paymentId = paymentIdFromNotification(url, body);
    if (paymentId === null) return text(200, 'ignorado');
    if (deps.mpToken === null) {
      log('sin_token');
      return text(500, 'sin token');
    }

    let res: Response;
    try {
      res = await deps.fetch(`${api}/v1/payments/${paymentId}`, {
        headers: { authorization: `Bearer ${deps.mpToken}` },
      });
    } catch {
      return text(500, 'mercadopago inalcanzable');
    }
    if (res.status === 404) return text(200, 'pago desconocido');
    if (!res.ok) return text(500, `mercadopago ${res.status}`);

    const payment = readPayment(await res.json().catch(() => null));
    if (payment === null) return text(200, 'pago ilegible');
    if (payment.externalReference === null || !/^[0-9a-f-]{36}$/i.test(payment.externalReference)) {
      return text(200, 'sin pedido');
    }

    const rows = await deps.sql(
      `select id, pay_with, currency, app.order_amount_cents(id) as amount_cents
         from public.orders where id = $1`,
      [payment.externalReference],
    );
    const row = rows[0];
    const order =
      row === undefined
        ? null
        : {
            id: String(row['id']),
            payWith: row['pay_with'] === null ? null : String(row['pay_with']),
            currency: String(row['currency'] ?? ''),
            amountCents: Number(row['amount_cents']),
          };

    const decision = decidePayment(payment, order);
    log('decision', { pago: payment.id, estado: payment.status, pedido: payment.externalReference, decision: decision.kind });

    switch (decision.kind) {
      case 'reject':
        return text(200, decision.reason);
      case 'mark_paid':
        await deps.sql(
          `update public.orders
              set paid_confirmed_at = coalesce(paid_confirmed_at, now()),
                  mp_payment_id = $2, mp_payment_status = 'approved', mp_paid_cents = $3
            where id = $1`,
          [payment.externalReference, payment.id, payment.amountCents],
        );
        return text(200, 'pagado');
      case 'mark_unpaid':
        // Devolución o contracargo del MISMO pago que lo había pagado.
        await deps.sql(
          `update public.orders
              set paid_confirmed_at = null, paid_confirmed_by = null, mp_payment_status = $3
            where id = $1 and (mp_payment_id = $2 or mp_payment_id is null)`,
          [payment.externalReference, payment.id, payment.status],
        );
        return text(200, decision.reason);
      case 'record_only':
        await deps.sql(
          `update public.orders set mp_payment_status = $2
            where id = $1 and paid_confirmed_at is null`,
          [payment.externalReference, payment.status],
        );
        return text(200, decision.reason);
    }
  };
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
