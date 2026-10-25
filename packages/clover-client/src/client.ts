/**
 * La fachada: un `CloverClient` por proceso, no uno por petición.
 *
 * POR QUÉ IMPORTA QUE SEA UNO SOLO
 * El rate limiter y los circuit breakers viven DENTRO del cliente. Dos
 * instancias son dos limitadores que no se hablan, cada uno convencido de
 * tener 50 req/s para él: entre los dos piden 100 y Clover devuelve 429 a
 * todos los merchants, no solo a los del proceso culpable. El techo de la
 * app es compartido, así que su contador también tiene que serlo.
 *
 * EL TOKEN NO SE GUARDA AQUÍ
 * Cada método lo recibe. Es más verboso y es a propósito: un cliente que
 * guarda el token del merchant es un cliente por merchant, y entonces cada
 * uno trae su propio limitador —el problema de arriba— o hay que
 * compartirlo por fuera, que es peor. Además obliga a que quien llama haya
 * pasado por el refresco, en vez de servirse de una copia vieja.
 *
 * CÓMO SE CONFIGURA
 * Sin secretos en el código. `appId` identifica la app y no es secreto; el
 * App Secret solo aparece en `oauth.exchangeCode`, por parámetro, desde
 * una variable de entorno del backend.
 */

import { CloverEcommerce } from './endpoints/ecommerce.ts';
import { CloverInventory } from './endpoints/inventory.ts';
import { CloverMerchants } from './endpoints/merchants.ts';
import { CloverOAuth } from './endpoints/oauth.ts';
import { CloverOrders } from './endpoints/orders.ts';
import { CloverHttp, type CloverHttpConfig } from './http.ts';

export type CloverClientConfig = CloverHttpConfig;

export class CloverClient {
  readonly http: CloverHttp;
  readonly oauth: CloverOAuth;
  readonly merchants: CloverMerchants;
  readonly inventory: CloverInventory;
  readonly orders: CloverOrders;
  readonly ecommerce: CloverEcommerce;

  constructor(config: CloverClientConfig) {
    this.http = new CloverHttp(config);
    this.oauth = new CloverOAuth(this.http);
    this.merchants = new CloverMerchants(this.http);
    this.inventory = new CloverInventory(this.http);
    this.orders = new CloverOrders(this.http);
    this.ecommerce = new CloverEcommerce(this.http);
  }

  /** ¿Está esta sucursal aislada por el breaker? Lo pinta el SaaS. */
  isolated(merchantId: string): boolean {
    return this.http.isolated(merchantId);
  }
}
