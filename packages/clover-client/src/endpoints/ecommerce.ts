/**
 * Cobro: tokenizar la tarjeta y pagar la orden.
 *
 * TRES HOSTS Y TRES CREDENCIALES DISTINTAS, QUE NO SE PARECEN EN NADA
 *
 *   PAKMS      scl   GET  /pakms/apikey       auth: Bearer del merchant
 *   tokenizar  token POST /v1/tokens          auth: cabecera `apikey`
 *   pagar      scl   POST /v1/orders/{id}/pay auth: Bearer del merchant
 *
 * La clave que devuelve PAKMS (`apiAccessKey`) es la clave PÚBLICA de
 * ecommerce del merchant, y es la que va en la cabecera `apikey` al
 * tokenizar. No es un secreto —está pensada para vivir en el navegador—
 * pero tampoco es el access token: confundirlas da 401.
 *
 * DÓNDE NO ENTRA UNA TARJETA
 * En ningún sitio de nuestro backend. La tokenización la hace el cliente
 * contra el host de Clover, y lo que llega aquí es un `clv_...` de un solo
 * uso. `tokenizeCard` existe para pruebas de integración con las tarjetas
 * de test del sandbox; en producción, ese paso lo hace el iframe de Clover
 * dentro de la app y el backend nunca ve un PAN. §14: alcance PCI mínimo.
 *
 * SE COBRA SOBRE LA ORDEN, NUNCA UN CHARGE SUELTO
 * Regla 27. Un charge suelto no queda ligado a la orden en el POS del
 * merchant: sus informes descuadran y el reembolso desde el POS deja de
 * ser posible. Por eso aquí no hay `createCharge`, aunque la API lo
 * permita.
 *
 * Fuentes verificadas: docs/CLOVER-ENDPOINTS.md
 */

import type { CloverHttp } from '../http.ts';
import type { CloverApiAccessKey, CloverCardToken, CloverPayment } from '../types.ts';

export class CloverEcommerce {
  private readonly http: CloverHttp;

  constructor(http: CloverHttp) {
    this.http = http;
  }

  /**
   * La clave pública de ecommerce del merchant.
   *
   * Cambia poco: cachearla por merchant en vez de pedirla en cada pago.
   * Prioridad transaccional porque está en el camino del cobro.
   */
  async apiAccessKey(input: {
    readonly merchantId: string;
    readonly token: string;
  }): Promise<CloverApiAccessKey> {
    return this.http.request<CloverApiAccessKey>({
      api: 'ecommerce',
      method: 'GET',
      path: '/pakms/apikey',
      auth: { kind: 'bearer', token: input.token },
      priority: 'transactional',
      rateKey: input.merchantId,
    });
  }

  /**
   * Cambia una tarjeta por un token `clv_...` de un solo uso.
   *
   * SOLO PARA PRUEBAS DE INTEGRACIÓN, con las tarjetas de test del
   * sandbox. Ver la cabecera: en producción tokeniza el cliente, no
   * nosotros. Está aquí porque la verificación de la Fase 7 necesita
   * recorrer el flujo entero de punta a punta sin un dispositivo.
   */
  async tokenizeCard(input: {
    readonly merchantId: string;
    readonly apiAccessKey: string;
    readonly card: {
      readonly number: string;
      readonly exp_month: string;
      readonly exp_year: string;
      readonly cvv: string;
      readonly brand?: string;
    };
  }): Promise<CloverCardToken> {
    return this.http.request<CloverCardToken>({
      api: 'token',
      method: 'POST',
      path: '/v1/tokens',
      auth: { kind: 'apikey', key: input.apiAccessKey },
      priority: 'transactional',
      rateKey: input.merchantId,
      body: { card: input.card },
    });
  }

  /**
   * Cobra una orden ya creada.
   *
   * `source` es el token `clv_...`. La orden tiene que existir: este es el
   * paso 4 de la secuencia, nunca el primero.
   *
   * La clave de idempotencia es obligatoria y es la misma del checkout.
   * Es lo único que separa "el cliente pulsó dos veces" de "el cliente
   * pagó dos veces".
   *
   * La propina va aparte del importe: `tipAmount` en centavos. Cómo se
   * comporta el cobro con propina sobre una orden atómica está en la lista
   * de verificación de sandbox: es de las cosas que hay que ver funcionar
   * antes de darla por buena.
   */
  async payOrder(input: {
    readonly merchantId: string;
    readonly token: string;
    readonly orderId: string;
    readonly source: string;
    readonly idempotencyKey: string;
    readonly amount?: number;
    readonly tipAmount?: number;
    readonly currency?: string;
  }): Promise<CloverPayment> {
    const cuerpo: Record<string, unknown> = { source: input.source };
    if (input.amount !== undefined) cuerpo['amount'] = input.amount;
    if (input.tipAmount !== undefined) cuerpo['tip_amount'] = input.tipAmount;
    if (input.currency !== undefined) cuerpo['currency'] = input.currency;

    return this.http.request<CloverPayment>({
      api: 'ecommerce',
      method: 'POST',
      path: `/v1/orders/${encodeURIComponent(input.orderId)}/pay`,
      auth: { kind: 'bearer', token: input.token },
      priority: 'transactional',
      rateKey: input.merchantId,
      idempotencyKey: input.idempotencyKey,
      body: cuerpo,
    });
  }
}
