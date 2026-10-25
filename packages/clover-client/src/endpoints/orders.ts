/**
 * Órdenes: totales, creación e impresión.
 *
 * EL ORDEN DE OPERACIONES NO ES NEGOCIABLE
 *
 *   1. tokenizar la tarjeta            -> CloverEcommerce.tokenizeCard
 *   2. totales con atomic_order/checkouts -> checkout()
 *   3. crear la orden                  -> createAtomicOrder()
 *   4. pagar LA ORDEN                  -> CloverEcommerce.payOrder
 *   5. print_event                     -> print()
 *
 * La orden se crea ANTES de cobrar. Al revés —cobrar y luego crear— deja
 * el peor estado posible: dinero cobrado y ninguna orden que la cocina
 * pueda ver ni el merchant reembolsar desde su POS. Y el cobro va SOBRE
 * la orden, nunca como charge suelto (regla 27).
 *
 * ESTE MÓDULO NO ORQUESTA, SOLO LLAMA
 * La secuencia con su idempotencia es la Edge Function de la PR 4. Aquí
 * están las piezas, tipadas y con el orden escrito, para que quien las
 * monte no tenga que deducirlo.
 *
 * PRIORIDAD `transactional` EN TODO
 * Es el único tráfico que puede robar presupuesto a las otras colas. Un
 * sync de catálogo puede esperar; un cliente pagando, no.
 *
 * NADA DE LINE ITEMS AD-HOC
 * Los ítems tienen que ser items REALES del inventario del merchant y los
 * modificadores tienen que pertenecer a grupos existentes ligados a esos
 * items. Un modificador ad-hoc no se imprime: el ticket sale incompleto y
 * la cocina prepara mal el pedido. Es la variable 2 del addendum, y es la
 * razón de la regla 26.
 *
 * Fuentes verificadas: docs/CLOVER-ENDPOINTS.md
 */

import type { CloverHttp } from '../http.ts';
import type { CloverList } from '../pagination.ts';
import type {
  CloverCheckout,
  CloverOrder,
  CloverOrderType,
  CloverPrintEvent,
} from '../types.ts';

/** Un modificador del carrito. Siempre por id de un grupo existente. */
export interface CartModification {
  readonly modifier: { readonly id: string };
}

/** Una línea del carrito. `item.id` es un item real del inventario. */
export interface CartLineItem {
  readonly item: { readonly id: string };
  /** Por defecto 1. Clover cuenta en milésimas para items por peso. */
  readonly unitQty?: number;
  /** Nota de la línea: "sin hielo". Se imprime. */
  readonly note?: string;
  readonly modifications?: readonly CartModification[];
}

/**
 * El carrito que entiende `atomic_order`.
 *
 * `title` y `note` son el único sitio donde cabe la hora de pickup:
 * Clover no tiene campo para eso y estos dos SÍ se imprimen. La
 * convención está fijada en el addendum, variable 2, y sin acentos ni
 * emojis porque las impresoras térmicas los degradan:
 *
 *   title: "APP #1052 · PICKUP 4:30 PM"
 *   note:  "PEDIDO MOVIL\nCliente: Maria G.\nRecoge: 4:30 PM\nCodigo: 7K2"
 */
export interface OrderCart {
  readonly lineItems: readonly CartLineItem[];
  readonly orderType?: { readonly id: string };
  readonly title?: string;
  readonly note?: string;
  readonly groupLineItems?: boolean;
}

export class CloverOrders {
  private readonly http: CloverHttp;

  constructor(http: CloverHttp) {
    this.http = http;
  }

  /**
   * Los totales con los impuestos del merchant, SIN crear nada.
   *
   * Es la única forma honesta de enseñarle un total al cliente: calcular
   * los impuestos por nuestra cuenta y que luego Clover cobre otra cosa es
   * un problema legal, no un detalle. §13.1 y regla 9: Clover manda en
   * dinero e impuestos.
   */
  async checkout(input: {
    readonly merchantId: string;
    readonly token: string;
    readonly cart: OrderCart;
  }): Promise<CloverCheckout> {
    return this.http.request<CloverCheckout>({
      api: 'platform',
      method: 'POST',
      path: `/v3/merchants/${encodeURIComponent(input.merchantId)}/atomic_order/checkouts`,
      auth: { kind: 'bearer', token: input.token },
      priority: 'transactional',
      rateKey: input.merchantId,
      body: { orderCart: input.cart },
    });
  }

  /**
   * Crea la orden con todo dentro en una sola llamada.
   *
   * `idempotencyKey` es obligatorio aquí y no por gusto: sin él, esta
   * llamada no se reintenta (ver `http.ts`), porque un 500 reintentado a
   * ciegas puede dejar dos órdenes idénticas en el POS del merchant. La
   * clave sale de la fila de checkout de nuestra base, así que un reintento
   * del cliente reutiliza la misma.
   */
  async createAtomicOrder(input: {
    readonly merchantId: string;
    readonly token: string;
    readonly cart: OrderCart;
    readonly idempotencyKey: string;
  }): Promise<CloverOrder> {
    return this.http.request<CloverOrder>({
      api: 'platform',
      method: 'POST',
      path: `/v3/merchants/${encodeURIComponent(input.merchantId)}/atomic_order/orders`,
      auth: { kind: 'bearer', token: input.token },
      priority: 'transactional',
      rateKey: input.merchantId,
      idempotencyKey: input.idempotencyKey,
      body: { orderCart: input.cart },
    });
  }

  /**
   * Anula una orden SIN PAGAR.
   *
   * ES LA COMPENSACIÓN DEL PASO 4, y la única marcha atrás de todo el
   * flujo. Se llama cuando el cobro falla: la orden ya existe en el POS
   * del merchant y, si nadie la anula, se queda ahí como un pedido que la
   * cocina ve y que nadie va a pagar.
   *
   * NO SIRVE PARA DESHACER UN COBRO. Una orden pagada no se anula: se
   * reembolsa, que es otra operación, con otro endpoint y con una
   * decisión humana detrás. Si esto se llamara sobre una orden pagada,
   * Clover la rechazaría — y menos mal.
   *
   * Sin `idempotencyKey` a propósito: `DELETE` ya es idempotente, y
   * repetirlo sobre una orden que ya no está es un 404 que el flujo trata
   * como éxito.
   */
  async voidOrder(input: {
    readonly merchantId: string;
    readonly token: string;
    readonly orderId: string;
  }): Promise<void> {
    await this.http.request<unknown>({
      api: 'platform',
      method: 'DELETE',
      path: `/v3/merchants/${encodeURIComponent(input.merchantId)}/orders/${encodeURIComponent(input.orderId)}`,
      auth: { kind: 'bearer', token: input.token },
      priority: 'transactional',
      rateKey: input.merchantId,
    });
  }

  /** Re-consulta la orden. Regla 11: el webhook avisa, el objeto se pide. */
  async get(input: {
    readonly merchantId: string;
    readonly token: string;
    readonly orderId: string;
    readonly expand?: readonly string[];
  }): Promise<CloverOrder> {
    return this.http.request<CloverOrder>({
      api: 'platform',
      method: 'GET',
      path: `/v3/merchants/${encodeURIComponent(input.merchantId)}/orders/${encodeURIComponent(input.orderId)}`,
      query: { expand: input.expand === undefined ? undefined : input.expand.join(',') },
      auth: { kind: 'bearer', token: input.token },
      priority: 'transactional',
      rateKey: input.merchantId,
    });
  }

  /**
   * Los tipos de orden del merchant. Hace falta uno para crear la orden, y
   * el id es del merchant: no se puede fijar en el código.
   */
  async orderTypes(input: {
    readonly merchantId: string;
    readonly token: string;
  }): Promise<CloverList<CloverOrderType>> {
    return this.http.request<CloverList<CloverOrderType>>({
      api: 'platform',
      method: 'GET',
      path: `/v3/merchants/${encodeURIComponent(input.merchantId)}/order_types`,
      auth: { kind: 'bearer', token: input.token },
      priority: 'catalog',
      rateKey: input.merchantId,
    });
  }

  /**
   * Manda la orden al destino de órdenes del merchant.
   *
   * "IMPRIMIR" ES UN NOMBRE ENGAÑOSO AQUÍ
   * Viva no usa papel en cocina: usa un KDS en pantalla. Da igual —
   * `print_event` se enruta al destino de órdenes del dispositivo de
   * disparo, y si ese destino es el KDS, la orden le llega igual. No hay
   * dos caminos; hay uno que sirve para impresora y para pantalla.
   *
   * UNA ORDEN CREADA POR API NO LLEGA SOLA. Aparece en Orders y en
   * Register, y ahí se queda. Sin esta llamada, el pedido está pagado y la
   * cocina no lo ha visto: el peor fallo posible de esta plataforma
   * (variable 2 del addendum). Que falle o no progrese tiene que ser una
   * alerta inmediata, no una línea de log.
   *
   * ESTO NO CONFIRMA QUE LA COCINA LO VIERA
   * Una respuesta buena aquí solo dice que Clover ACEPTÓ la petición. La
   * confirmación de verdad es `printed: true` en las líneas de la orden,
   * que llega como webhook de tipo `O`. De ahí sale `PREPARING`, no de
   * esta llamada.
   *
   * Y CON TRES DISPOSITIVOS EN LA TIENDA, HAY QUE MIRAR A CUÁL VA
   * Viva tiene tablet de POS, KDS y kiosco de entrada. Si el dispositivo
   * de disparo por defecto resultara ser el kiosco, el ticket podría no
   * llegar al KDS. Está en la lista de verificación de sandbox.
   *
   * Idempotente por la clave: mandar el mismo ticket dos veces es confuso
   * para la cocina, así que se reusa la clave del checkout.
   */
  async print(input: {
    readonly merchantId: string;
    readonly token: string;
    readonly orderId: string;
    readonly idempotencyKey: string;
  }): Promise<CloverPrintEvent> {
    return this.http.request<CloverPrintEvent>({
      api: 'platform',
      method: 'POST',
      path: `/v3/merchants/${encodeURIComponent(input.merchantId)}/print_event`,
      auth: { kind: 'bearer', token: input.token },
      priority: 'transactional',
      rateKey: input.merchantId,
      idempotencyKey: input.idempotencyKey,
      body: { orderRef: { id: input.orderId } },
    });
  }

  /** Estado de una impresión, para el monitoreo continuo. */
  async printEvent(input: {
    readonly merchantId: string;
    readonly token: string;
    readonly printEventId: string;
  }): Promise<CloverPrintEvent> {
    return this.http.request<CloverPrintEvent>({
      api: 'platform',
      method: 'GET',
      path: `/v3/merchants/${encodeURIComponent(input.merchantId)}/print_event/${encodeURIComponent(input.printEventId)}`,
      auth: { kind: 'bearer', token: input.token },
      priority: 'transactional',
      rateKey: input.merchantId,
    });
  }
}
