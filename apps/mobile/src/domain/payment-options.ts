/**
 * Formas de pago (migracion 0024). Modulo puro.
 */

export type CounterMethod = 'cash' | 'card_counter' | 'transfer';
export type OnlineProvider = 'mercadopago' | 'stripe' | 'clip';
export type PayWith = CounterMethod | OnlineProvider;

export const COUNTER_METHODS: readonly CounterMethod[] = ['cash', 'card_counter', 'transfer'];
export const ONLINE_PROVIDERS: readonly OnlineProvider[] = ['mercadopago', 'stripe', 'clip'];

export type PaymentOptions = Partial<Record<PayWith, boolean>>;

/** Las formas de pago en mostrador que el cliente puede elegir. */
export function enabledCounterMethods(options: PaymentOptions | null | undefined): CounterMethod[] {
  // Sin configuracion (base sin la 0024) se ofrece todo lo de mostrador.
  if (options === null || options === undefined) return [...COUNTER_METHODS];
  return COUNTER_METHODS.filter((method) => options[method] === true);
}

/**
 * Proveedores en linea que se le pueden ofrecer al cliente: prendidos por
 * el dueño Y con cuenta conectada. Las dos cosas.
 */
export function availableOnline(
  options: PaymentOptions | null | undefined,
  connected: ReadonlySet<OnlineProvider>,
): OnlineProvider[] {
  return ONLINE_PROVIDERS.filter((p) => options?.[p] === true && connected.has(p));
}
