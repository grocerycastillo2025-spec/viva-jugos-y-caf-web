/**
 * Catálogo. SOLO LECTURA.
 *
 * Regla 26 del addendum: "si un producto no existe en el inventario de
 * Clover, no se vende en la app". La consecuencia técnica es que aquí no
 * hay un solo POST. Clover manda el catálogo; nosotros lo espejamos.
 *
 * No es una limitación temporal ni una fase pendiente: escribir catálogo
 * desde la app rompería el ruteo a impresora (que va por labels de item,
 * configuración del merchant) y descuadraría sus informes. Si alguna vez
 * hace falta, se decide como producto, no se cuela como método.
 *
 * PRIORIDAD `catalog`
 * Todo lo de aquí va con la cuota del 25 %. Un sync masivo NO puede robar
 * presupuesto al tráfico transaccional: mientras se sincroniza un menú,
 * alguien está pagando.
 *
 * SIN `expand` ANIDADOS
 * §4.5 del addendum: Clover documenta que las expansiones anidadas dan
 * timeouts y 502, y el sandbox es más frágil todavía. Se pide un nivel y
 * se cruzan las listas en nuestro lado.
 *
 * Fuentes verificadas: docs/CLOVER-ENDPOINTS.md
 */

import type { CloverHttp } from '../http.ts';
import { modifiedSince, paginate, type CloverList, type PageParams } from '../pagination.ts';
import type {
  CloverCategory,
  CloverItem,
  CloverModifier,
  CloverModifierGroup,
  CloverTaxRate,
} from '../types.ts';

export interface ListOptions {
  /**
   * Solo lo modificado desde esta marca (milisegundos). Es lo que
   * convierte un barrido diario en unas pocas peticiones en vez de en el
   * catálogo entero.
   *
   * Cuidado con rangos largos: Clover recorta a 90 días sin avisar. Para
   * un backfill, usa `timeWindows` y llama una vez por ventana.
   */
  readonly modifiedSinceMs?: number;
  readonly pageSize?: number;
  readonly expand?: readonly string[];
}

export class CloverInventory {
  private readonly http: CloverHttp;

  constructor(http: CloverHttp) {
    this.http = http;
  }

  /** Los ítems. `expand: ['itemStock']` trae el stock; nada más anidado. */
  items(
    merchantId: string,
    token: string,
    options: ListOptions = {},
  ): AsyncGenerator<readonly CloverItem[], void, void> {
    return paginate<CloverItem>(
      (p) => this.listaAutenticada<CloverItem>(merchantId, token, '/items', options, p),
      { pageSize: options.pageSize },
    );
  }

  categories(
    merchantId: string,
    token: string,
    options: ListOptions = {},
  ): AsyncGenerator<readonly CloverCategory[], void, void> {
    return paginate<CloverCategory>(
      (p) => this.listaAutenticada<CloverCategory>(merchantId, token, '/categories', options, p),
      { pageSize: options.pageSize },
    );
  }

  modifierGroups(
    merchantId: string,
    token: string,
    options: ListOptions = {},
  ): AsyncGenerator<readonly CloverModifierGroup[], void, void> {
    return paginate<CloverModifierGroup>(
      (p) => this.listaAutenticada<CloverModifierGroup>(merchantId, token, '/modifier_groups', options, p),
      { pageSize: options.pageSize },
    );
  }

  /**
   * Los modificadores cuelgan de su grupo: no hay listado plano de
   * modificadores del merchant. Con N grupos son N llamadas, y por eso
   * esto va escalonado y con prioridad de catálogo.
   */
  modifiers(
    merchantId: string,
    token: string,
    modifierGroupId: string,
    options: ListOptions = {},
  ): AsyncGenerator<readonly CloverModifier[], void, void> {
    const path = `/modifier_groups/${encodeURIComponent(modifierGroupId)}/modifiers`;
    return paginate<CloverModifier>(
      (p) => this.listaAutenticada<CloverModifier>(merchantId, token, path, options, p),
      { pageSize: options.pageSize },
    );
  }

  /** Las tasas de impuesto. Clover es la fuente de verdad (regla 9). */
  taxRates(
    merchantId: string,
    token: string,
    options: ListOptions = {},
  ): AsyncGenerator<readonly CloverTaxRate[], void, void> {
    return paginate<CloverTaxRate>(
      (p) => this.listaAutenticada<CloverTaxRate>(merchantId, token, '/tax_rates', options, p),
      { pageSize: options.pageSize },
    );
  }

  private listaAutenticada<T>(
    merchantId: string,
    token: string,
    path: string,
    options: ListOptions,
    { limit, offset }: PageParams,
  ): Promise<CloverList<T>> {
    return this.http.request<CloverList<T>>({
      api: 'platform',
      method: 'GET',
      path: `/v3/merchants/${encodeURIComponent(merchantId)}${path}`,
      query: {
        limit,
        offset,
        filter: options.modifiedSinceMs === undefined ? undefined : modifiedSince(options.modifiedSinceMs),
        expand: options.expand === undefined ? undefined : options.expand.join(','),
      },
      auth: { kind: 'bearer', token },
      priority: 'catalog',
      rateKey: merchantId,
    });
  }
}
