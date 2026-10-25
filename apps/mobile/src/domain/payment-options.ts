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

// ---------------------------------------------------------------------
// 0026: Mercado Pago con liga de cobro y transferencia con CLABE.
// ---------------------------------------------------------------------

/** Lo que el cliente puede elegir al pedir. */
export type CustomerMethod = 'cash' | 'card_counter' | 'transfer' | 'mercadopago';
export const CUSTOMER_METHODS: readonly CustomerMethod[] = ['cash', 'card_counter', 'transfer', 'mercadopago'];

/** Cobro automático por pedido (fase 2): aún sin cuenta conectada. */
export const AUTOMATIC_PROVIDERS: readonly OnlineProvider[] = ['stripe', 'clip'];

export interface PaymentSetup {
  readonly payment_options?: PaymentOptions | null;
  readonly transfer_info?: string | null;
  readonly transfer_clabe?: string | null;
  readonly mercadopago_link?: string | null;
}

/**
 * Formas de pago que se le ofrecen al cliente. Mismas reglas que
 * `app.pay_with_available` en la base:
 *  - transferencia: prendida Y con CLABE o datos escritos;
 *  - Mercado Pago: prendido Y con liga de cobro.
 */
export function customerMethods(store: PaymentSetup | null | undefined): CustomerMethod[] {
  const options = store?.payment_options;
  if (options === null || options === undefined) return ['cash', 'card_counter', 'transfer'];
  return CUSTOMER_METHODS.filter((m) => {
    if (options[m] !== true) return false;
    if (m === 'transfer') return nonEmpty(store?.transfer_clabe) || nonEmpty(store?.transfer_info);
    if (m === 'mercadopago') return nonEmpty(store?.mercadopago_link);
    return true;
  });
}

function nonEmpty(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value.trim() !== '';
}

/** Quita espacios y guiones de una CLABE escrita a mano. */
export function normalizeClabe(input: string): string {
  return input.replace(/[\s-]/g, '');
}

/** CLABE de 18 dígitos con dígito de control correcto (pesos 3-7-1). */
export function clabeValid(input: string): boolean {
  const clabe = normalizeClabe(input);
  if (!/^\d{18}$/.test(clabe)) return false;
  const weights = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += (Number(clabe[i]) * (weights[i % 3] ?? 0)) % 10;
  return (10 - (sum % 10)) % 10 === Number(clabe[17]);
}

/** "002 010 07777777777 1": banco, plaza, cuenta, control. Más fácil de dictar. */
export function formatClabe(input: string): string {
  const c = normalizeClabe(input);
  if (c.length !== 18) return c;
  return `${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6, 17)} ${c.slice(17)}`;
}

const MP_LINK = /^https:\/\/(link\.mercadopago\.com\.mx|www\.mercadopago\.com\.mx|mpago\.mx|mpago\.la|mpago\.li)\/\S+$/;

/** Liga de cobro de Mercado Pago México (mismos dominios que la base). */
export function isMercadoPagoLink(input: string): boolean {
  return MP_LINK.test(input.trim()) && input.trim().length <= 300;
}

/** Pedidos cuyo pago tiene que confirmar alguien del negocio. */
export function needsPaymentConfirmation(payWith: string | null | undefined): boolean {
  return payWith === 'transfer' || payWith === 'mercadopago';
}

export type PaymentSetupProblem = 'clabe_invalid' | 'transfer_without_data' | 'mp_link_invalid' | 'mp_without_link' | 'none_on';

/** Lo que falta o está mal antes de guardar en el panel. */
export function paymentSetupProblems(input: {
  readonly options: PaymentOptions;
  readonly clabe: string;
  readonly transferInfo: string;
  readonly mpLink: string;
}): PaymentSetupProblem[] {
  const problems: PaymentSetupProblem[] = [];
  const clabe = normalizeClabe(input.clabe);
  if (clabe !== '' && !clabeValid(clabe)) problems.push('clabe_invalid');
  if (input.options.transfer === true && clabe === '' && input.transferInfo.trim() === '') {
    problems.push('transfer_without_data');
  }
  const link = input.mpLink.trim();
  if (link !== '' && !isMercadoPagoLink(link)) problems.push('mp_link_invalid');
  if (input.options.mercadopago === true && link === '') problems.push('mp_without_link');
  if (!CUSTOMER_METHODS.some((m) => input.options[m] === true)) problems.push('none_on');
  return problems;
}
