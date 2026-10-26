/**
 * Qué cambio de estatus vale la pena avisarle al cliente. Módulo puro.
 */

export type UpdateKind = 'preparing' | 'ready' | 'canceled' | 'completed';

export interface StatusChange {
  readonly orderId: string;
  readonly orderNumber: number;
  readonly kind: UpdateKind;
}

const NOTIFY: ReadonlySet<string> = new Set(['preparing', 'ready', 'canceled']);

/**
 * Compara los estatus anteriores con los actuales. En la primera lectura
 * (`previous` null) no avisa nada: solo aprende dónde está cada pedido.
 */
export function statusChanges(
  previous: ReadonlyMap<string, string> | null,
  current: readonly { readonly id: string; readonly order_number: number; readonly status: string }[],
): StatusChange[] {
  if (previous === null) return [];
  return current
    // Un pedido que no estaba en la lectura anterior (se hizo entre dos
    // revisiones) avisa si el negocio ya lo movió a preparando o listo.
    .filter((o) => previous.get(o.id) !== o.status && NOTIFY.has(o.status) && (previous.has(o.id) || o.status !== 'canceled'))
    .map((o) => ({ orderId: o.id, orderNumber: o.order_number, kind: o.status as UpdateKind }));
}

/** Los pedidos que siguen vivos: mientras haya, se revisa seguido. */
export function hasLiveOrders(orders: readonly { readonly status: string }[]): boolean {
  return orders.some((o) => ['confirmed', 'preparing', 'ready', 'payment_pending'].includes(o.status));
}
