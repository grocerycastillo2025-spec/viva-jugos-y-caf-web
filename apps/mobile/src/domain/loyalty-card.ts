/**
 * Tarjeta de puntos del cliente (0029). Módulo puro.
 */

/** "VIVA1.<id del cliente>.<firma>" — lo que lleva el QR personal. */
export function isCustomerQr(text: string): boolean {
  return /^VIVA1\.[0-9a-f-]{36}\.[A-Z0-9]{10}$/i.test(text.trim());
}

export interface RewardLite {
  readonly id: string;
  readonly name: string;
  readonly cost_points: number;
}

/** Recompensas que ya alcanza, de la más cara a la más barata. */
export function reachableRewards<T extends RewardLite>(points: number, rewards: readonly T[]): T[] {
  return rewards.filter((r) => points >= r.cost_points).sort((a, b) => b.cost_points - a.cost_points);
}

/** La siguiente meta: la recompensa más barata que todavía no alcanza. */
export function nextGoal<T extends RewardLite>(points: number, rewards: readonly T[]): { reward: T; missing: number; progress: number } | null {
  const pending = rewards.filter((r) => r.cost_points > points).sort((a, b) => a.cost_points - b.cost_points);
  const reward = pending[0];
  if (reward === undefined) return null;
  return { reward, missing: reward.cost_points - points, progress: Math.max(0, Math.min(1, points / reward.cost_points)) };
}

/** Avance hacia una recompensa, de 0 a 1. */
export function progressTo(points: number, cost: number): number {
  if (cost <= 0) return 1;
  return Math.max(0, Math.min(1, points / cost));
}

/** Motivos de error del mostrador → clave de texto. */
export function staffErrorKey(message: string): 'qr_expired' | 'qr_invalid' | 'too_soon' | 'not_enough' | 'disabled' | 'not_available' | 'staff_only' | 'other' {
  if (message.includes('customer_qr_expired')) return 'qr_expired';
  if (message.includes('customer_qr_invalid')) return 'qr_invalid';
  if (message.includes('too_soon')) return 'too_soon';
  if (message.includes('not_enough_points')) return 'not_enough';
  if (message.includes('loyalty_disabled')) return 'disabled';
  if (message.includes('reward_not_available')) return 'not_available';
  if (message.includes('staff_only')) return 'staff_only';
  return 'other';
}
