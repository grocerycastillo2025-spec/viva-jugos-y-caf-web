/**
 * Las cinco llamadas del flujo, atadas a un merchant y a un token.
 *
 * Cableado: convierte `@juicebar/clover-client` en el puerto `CheckoutApi`.
 * Aquí no hay ni una decisión — el orden está en `maquina.ts` y la
 * secuencia en `flujo.ts`.
 *
 * LO QUE SÍ ESTÁ AQUÍ Y NO ES CABLEADO: que `cobrar` NO manda `amount`.
 * Se paga LA ORDEN, así que el importe lo pone Clover. Mandarle un importe
 * nuestro sería volver a calcular dinero por nuestra cuenta, y con el
 * recargo por tarjeta de por medio sería el camino directo a cobrar de
 * más. Ver docs/PEDIDOS-COBRO.md, parte 1.
 */

import type {
  CloverClient,
  CartLineItem,
  OrderCart,
} from '../../../packages/clover-client/src/index.ts';
import type { CheckoutApi, Intento, LineaValidada } from '../../../workers/src/checkout/index.ts';

/**
 * El carrito que entiende `atomic_order`.
 *
 * NADA DE LINE ITEMS AD-HOC: los ítems son items REALES del inventario del
 * merchant y los modificadores pertenecen a grupos ligados a esos items.
 * Un modificador ad-hoc no se imprime, y el ticket llega a cocina
 * incompleto. Es la variable 2 del addendum.
 *
 * Los precios NO viajan: Clover los pone de su inventario. Los nuestros
 * sirven para el subtotal que enseña la app, no para cobrar.
 */
export function carritoDe(lineas: readonly LineaValidada[], intento: Intento): OrderCart {
  const lineItems: CartLineItem[] = [];
  for (const linea of lineas) {
    // Una línea por unidad y no `unitQty`: `unitQty` en Clover es para
    // items por peso, en milésimas. Dos cafés son dos líneas.
    for (let n = 0; n < linea.cantidad; n += 1) {
      lineItems.push({
        item: { id: linea.cloverItemId },
        ...(linea.nota === null ? {} : { note: linea.nota }),
        ...(linea.modificadores.length === 0
          ? {}
          : {
              modifications: linea.modificadores.map((m) => ({
                modifier: { id: m.cloverModifierId },
              })),
            }),
      });
    }
  }

  return {
    lineItems,
    title: intento.titulo,
    note: intento.nota,
    // Agrupado: el ticket sale con "2x Green Juice" en vez de dos líneas
    // sueltas, que es como lo lee la cocina.
    groupLineItems: true,
  };
}

export function cloverCheckoutApi(
  cliente: CloverClient,
  merchantId: string,
  accessToken: string,
): CheckoutApi {
  return {
    totales: (lineas, intento) =>
      cliente.orders.checkout({ merchantId, token: accessToken, cart: carritoDe(lineas, intento) }),

    crearOrden: (lineas, intento) =>
      cliente.orders.createAtomicOrder({
        merchantId,
        token: accessToken,
        cart: carritoDe(lineas, intento),
        // LA MISMA CLAVE que el cobro. Sin ella esta llamada no se
        // reintenta, porque un 500 reintentado a ciegas deja dos órdenes
        // idénticas en el POS del merchant.
        idempotencyKey: intento.idempotencyKey,
      }),

    cobrar: (input) =>
      cliente.ecommerce.payOrder({
        merchantId,
        token: accessToken,
        orderId: input.cloverOrderId,
        source: input.source,
        idempotencyKey: input.idempotencyKey,
        // Sin `amount`: se paga la orden. Ver la cabecera.
        ...(input.tipCents > 0 ? { tipAmount: input.tipCents } : {}),
      }),

    imprimir: async (cloverOrderId, idempotencyKey) => {
      await cliente.orders.print({
        merchantId,
        token: accessToken,
        orderId: cloverOrderId,
        idempotencyKey,
      });
    },

    anularOrden: async (cloverOrderId) => {
      await cliente.orders.voidOrder({ merchantId, token: accessToken, orderId: cloverOrderId });
    },
  };
}
