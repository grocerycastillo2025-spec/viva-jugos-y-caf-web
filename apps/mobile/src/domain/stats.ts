/**
 * Cálculos para la pantalla de estadísticas. Módulo puro.
 */

/** Cambio porcentual contra el periodo anterior; null si antes no hubo nada. */
export function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** La entrada con más valor (la primera si empatan); null si todo es 0. */
export function peak<T>(rows: readonly T[], value: (row: T) => number): T | null {
  let best: T | null = null;
  let max = 0;
  for (const row of rows) {
    const v = value(row);
    if (v > max) {
      max = v;
      best = row;
    }
  }
  return best;
}

/** 9 -> "9 a 10 am", 13 -> "1 a 2 pm", 23 -> "11 pm a 12 am". */
export function hourRange(hour: number): string {
  const label = (h: number): { n: number; ap: string } => {
    const hh = ((h % 24) + 24) % 24;
    return { n: hh % 12 === 0 ? 12 : hh % 12, ap: hh < 12 ? 'am' : 'pm' };
  };
  const a = label(hour);
  const b = label(hour + 1);
  return a.ap === b.ap ? `${a.n} a ${b.n} ${b.ap}` : `${a.n} ${a.ap} a ${b.n} ${b.ap}`;
}

/** Hora corta para el eje: 6 -> "6", 12 -> "12", 15 -> "3". */
export function hourTick(hour: number): string {
  const hh = hour % 12 === 0 ? 12 : hour % 12;
  return String(hh);
}

/**
 * Porcentajes enteros que suman exactamente 100 (residuo mayor), para que
 * una barra apilada y sus etiquetas cuadren.
 */
export function shares(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}

/** Rango de horas a mostrar: de la primera a la última con pedidos, mínimo 7 a 21. */
export function activeHours(rows: readonly { hour: number; orders: number }[]): { from: number; to: number } {
  const withOrders = rows.filter((r) => r.orders > 0).map((r) => r.hour);
  const from = Math.min(7, ...withOrders);
  const to = Math.max(21, ...withOrders);
  return { from, to };
}

/** Días de la semana empezando en lunes (Postgres: 0 = domingo). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
