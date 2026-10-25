/**
 * Dinero. Regla del proyecto: SIEMPRE centavos enteros, nunca float.
 * Este modulo no importa nada en tiempo de ejecucion a proposito, para
 * poder correrlo bajo `node --test --experimental-strip-types`.
 */

import type { Cents } from '@juicebar/shared-types';

export type { Cents };

/** Formatea centavos como moneda. 850 -> "$8.50". */
export function formatMoney(cents: Cents, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

/**
 * Formatea un recargo con signo: 100 -> "+$1.00", 0 -> "".
 * Los modificadores sin costo no muestran precio.
 */
export function formatSurcharge(cents: Cents, currency = 'USD', locale = 'en-US'): string {
  if (cents === 0) return '';
  const sign = cents > 0 ? '+' : '-';
  return `${sign}${formatMoney(Math.abs(cents), currency, locale)}`;
}

/** Suma defensiva: cualquier valor no finito se trata como 0. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    total += Number.isFinite(value) ? Math.trunc(value) : 0;
  }
  return total;
}
