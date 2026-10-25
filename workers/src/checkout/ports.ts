/**
 * Las fronteras del checkout: Clover y la base.
 *
 * Igual que en los otros dos trabajos, y por lo mismo: la secuencia
 * —incluida la compensación, que es la parte que no se puede ensayar en
 * producción— se prueba entera sin red y sin base.
 *
 * NINGUNA DE ESTAS INTERFACES ACEPTA UN PRECIO DEL CLIENTE. El carrito
 * que entra ya viene releído de la base por `app.open_checkout_attempt`
 * (0018): lo que el teléfono manda son ids y cantidades, nunca importes.
 */

import type { CloverCheckout, CloverOrder, CloverPayment } from '@juicebar/clover-client';
import type { Estado } from './maquina.ts';

/** Una línea ya validada y con el precio releído de NUESTRA base. */
export interface LineaValidada {
  readonly cloverItemId: string;
  readonly nombre: string;
  readonly cantidad: number;
  readonly unitPriceCents: number;
  readonly nota: string | null;
  readonly modificadores: readonly { readonly cloverModifierId: string }[];
}

/**
 * El intento, tal como lo devuelve la base al abrirlo o al recuperarlo.
 *
 * `idempotencyKey` es la MISMA que viaja a Clover en `atomic_order/orders`
 * y en `/pay`. Una sola clave de punta a punta es lo que separa "pulsó dos
 * veces" de "pagó dos veces".
 */
export interface Intento {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly estado: Estado;
  readonly orderId: string;
  readonly storeId: string;
  readonly merchantId: string;
  readonly environment: string;
  readonly orderNumber: number;
  readonly pickupCode: string;
  readonly pickupAt: Date | null;
  readonly subtotalCents: number;
  readonly lineas: readonly LineaValidada[];
  /** El id de la orden EN CLOVER. `null` hasta que se crea. */
  readonly cloverOrderId: string | null;
  /** Para el título y la nota que se imprimen. */
  readonly titulo: string;
  readonly nota: string;
}

/**
 * Las cuatro llamadas a Clover del flujo, ya atadas a merchant y token.
 *
 * `cobrar` NO recibe `amount`, y es deliberado: se paga LA ORDEN, así que
 * el importe lo pone Clover. Pasarle un importe nuestro sería volver a
 * calcular dinero por nuestra cuenta, que es justo lo que la regla 9
 * prohíbe — y con el recargo por tarjeta de por medio, sería además el
 * camino a cobrar de más. Ver docs/PEDIDOS-COBRO.md, parte 1.
 */
export interface CheckoutApi {
  totales(lineas: readonly LineaValidada[], intento: Intento): Promise<CloverCheckout>;
  crearOrden(lineas: readonly LineaValidada[], intento: Intento): Promise<CloverOrder>;
  cobrar(input: {
    readonly cloverOrderId: string;
    readonly source: string;
    readonly idempotencyKey: string;
    readonly tipCents: number;
  }): Promise<CloverPayment>;
  /** La clave viaja también aquí: mandar el mismo ticket dos veces
   *  confunde a la cocina tanto como no mandarlo. */
  imprimir(cloverOrderId: string, idempotencyKey: string): Promise<void>;
  /** La compensación. Solo se llama tras un cobro fallido. */
  anularOrden(cloverOrderId: string): Promise<void>;
}

/** Lo que Clover dijo que cobró, ya separado en sus dos mitades. */
export interface Cobro {
  readonly providerPaymentId: string;
  /** El total de la orden. NO incluye el recargo por tarjeta. */
  readonly amountCents: number;
  readonly tipCents: number;
  /**
   * El recargo por tarjeta, si lo hubo. Lo aplica Clover, no nosotros.
   * `0` = no hubo; `null` = no se pudo leer, que no es lo mismo.
   */
  readonly surchargeCents: number | null;
  readonly cardBrand: string | null;
  readonly cardLast4: string | null;
}

export interface CheckoutStore {
  /** Mueve el estado. Rechaza ir hacia atrás: ver `avanza()`. */
  avanzar(intentoId: string, desde: Estado, hasta: Estado): Promise<void>;
  /** Los totales que dijo Clover. Es el único origen del total del pedido. */
  guardarTotales(
    orderId: string,
    totales: {
      readonly subtotalCents: number;
      readonly taxCents: number;
      readonly totalCents: number;
    },
  ): Promise<void>;
  guardarOrdenClover(orderId: string, cloverOrderId: string): Promise<void>;
  guardarCobro(orderId: string, cobro: Cobro): Promise<void>;
  marcarCobroFallido(orderId: string, error: string): Promise<void>;
  marcarImpreso(orderId: string, ok: boolean): Promise<void>;
  /** La orden quedó viva en el POS y no se pudo anular. Sale en la vista. */
  marcarAnulacionPendiente(intentoId: string, error: string): Promise<void>;
  terminar(intentoId: string, resultado: unknown): Promise<void>;
}

export interface CheckoutLog {
  info(event: string, datos?: Readonly<Record<string, unknown>>): void;
  warn(event: string, datos?: Readonly<Record<string, unknown>>): void;
  error(event: string, datos?: Readonly<Record<string, unknown>>): void;
}

export const SILENT_CHECKOUT_LOG: CheckoutLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
