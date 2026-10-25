/**
 * El merchant: sus datos y si puede cobrar online.
 *
 * `timezone` no es decorativo: el escalonado de barridos y las reparaciones
 * de madrugada (§4.4 del addendum, entre 2 y 5 AM hora LOCAL de la
 * sucursal) se calculan con él.
 *
 * Fuentes verificadas: docs/CLOVER-ENDPOINTS.md
 */

import type { CloverHttp } from '../http.ts';
import type {
  CloverEcommPaymentConfigs,
  CloverGateway,
  CloverMerchant,
} from '../types.ts';

export class CloverMerchants {
  private readonly http: CloverHttp;

  constructor(http: CloverHttp) {
    this.http = http;
  }

  /**
   * Los datos del merchant. Es la llamada más barata que hay, así que es
   * la que se usa para comprobar que un token recién canjeado sirve.
   */
  async get(input: {
    readonly merchantId: string;
    readonly token: string;
  }): Promise<CloverMerchant> {
    return this.http.request<CloverMerchant>({
      api: 'platform',
      method: 'GET',
      path: `/v3/merchants/${encodeURIComponent(input.merchantId)}`,
      auth: { kind: 'bearer', token: input.token },
      priority: 'transactional',
      rateKey: input.merchantId,
    });
  }

  /**
   * La cuenta de pasarela del merchant.
   *
   * Es la unica de las tres llamadas de onboarding que dice si el merchant
   * tiene cuenta de pasarela SIQUIERA. `accountName` sirve para ensenarlo
   * en el checklist del SaaS: "Sandbox Test Merchant" se lee; un booleano
   * no le dice nada a quien esta dando de alta la sucursal.
   */
  async gateway(input: {
    readonly merchantId: string;
    readonly token: string;
  }): Promise<CloverGateway> {
    return this.http.request<CloverGateway>({
      api: 'platform',
      method: 'GET',
      path: `/v3/merchants/${encodeURIComponent(input.merchantId)}/gateway`,
      auth: { kind: 'bearer', token: input.token },
      priority: 'reconciliation',
      rateKey: input.merchantId,
    });
  }

  /**
   * Que funciones de pago tiene habilitadas.
   *
   * Se consulta por el RECARGO. Si el merchant lo tiene activo, el cliente
   * paga mas de lo que le ensenamos en la app, y eso no es un detalle de
   * configuracion: es una diferencia entre el precio anunciado y el
   * cobrado. Hay que verlo en el alta, no en la primera reclamacion.
   */
  async ecommPaymentConfigs(input: {
    readonly merchantId: string;
    readonly token: string;
  }): Promise<CloverEcommPaymentConfigs> {
    return this.http.request<CloverEcommPaymentConfigs>({
      api: 'platform',
      method: 'GET',
      path: `/v3/merchants/${encodeURIComponent(input.merchantId)}/ecomm_payment_configs`,
      auth: { kind: 'bearer', token: input.token },
      priority: 'reconciliation',
      rateKey: input.merchantId,
    });
  }
}
