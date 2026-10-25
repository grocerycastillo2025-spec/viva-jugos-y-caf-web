/**
 * Rate limiting y reintentos para la API de Clover.
 *
 * Límites oficiales (docs.clover.com/dev/docs/api-usage-rate-limits):
 *   Por app:   50 req/s,  10 concurrentes
 *   Por token: 16 req/s,   5 concurrentes
 *
 * El límite por app es COMPARTIDO entre todos los merchants. Con 200
 * sucursales, un sync masivo simultáneo tumba el servicio para todos.
 * Por eso el presupuesto se reparte en cuotas por prioridad y el tráfico
 * transaccional siempre puede robar de las demás, nunca al revés.
 */

export type Priority = 'transactional' | 'catalog' | 'reconciliation';

/** Reparto del techo de 50 req/s. Ver §4 del addendum de ajustes. */
export const PRIORITY_SHARE: Record<Priority, number> = {
  transactional: 0.6,
  catalog: 0.25,
  reconciliation: 0.15,
};

export const CLOVER_LIMITS = {
  appRequestsPerSecond: 50,
  appConcurrent: 10,
  tokenRequestsPerSecond: 16,
  tokenConcurrent: 5,
} as const;

/**
 * Token bucket sencillo. Se rellena de forma continua, no por ventanas,
 * para no generar ráfagas en el borde de cada segundo.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;

  constructor(capacity: number, refillPerSecond: number, now: () => number = Date.now) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.now = now;
    this.tokens = capacity;
    this.lastRefill = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = (t - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefill = t;
  }

  /** Consume un token si hay. No bloquea. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Milisegundos hasta que haya un token disponible. */
  msUntilAvailable(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000);
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }
}

/**
 * Limitador global de la app, con cuotas por prioridad.
 *
 * Regla clave: una petición transaccional puede consumir del presupuesto
 * global aunque su cuota esté agotada; catálogo y reconciliación no.
 */
export class CloverRateLimiter {
  private readonly global: TokenBucket;
  private readonly buckets: Record<Priority, TokenBucket>;
  private readonly perToken = new Map<string, TokenBucket>();
  private readonly now: () => number;
  /**
   * Inyectable junto con el reloj: sin esto, una prueba del limitador
   * tiene que esperar de verdad, y una suite que duerme se acaba
   * borrando. Ver `http.test.ts`, donde dormir adelanta el reloj falso.
   */
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(now: () => number = Date.now, sleepFn: (ms: number) => Promise<void> = sleep) {
    this.now = now;
    this.sleepFn = sleepFn;
    this.global = new TokenBucket(
      CLOVER_LIMITS.appRequestsPerSecond,
      CLOVER_LIMITS.appRequestsPerSecond,
      now,
    );
    this.buckets = {
      transactional: this.makeShare('transactional'),
      catalog: this.makeShare('catalog'),
      reconciliation: this.makeShare('reconciliation'),
    };
  }

  private makeShare(p: Priority): TokenBucket {
    const rate = CLOVER_LIMITS.appRequestsPerSecond * PRIORITY_SHARE[p];
    return new TokenBucket(rate, rate, this.now);
  }

  private tokenBucket(merchantId: string): TokenBucket {
    let b = this.perToken.get(merchantId);
    if (!b) {
      b = new TokenBucket(
        CLOVER_LIMITS.tokenRequestsPerSecond,
        CLOVER_LIMITS.tokenRequestsPerSecond,
        this.now,
      );
      this.perToken.set(merchantId, b);
    }
    return b;
  }

  /** ¿Se puede emitir ya la petición? No bloquea. */
  tryAcquire(merchantId: string, priority: Priority): boolean {
    const perMerchant = this.tokenBucket(merchantId);
    if (perMerchant.available < 1) return false;
    if (this.global.available < 1) return false;

    // El tráfico transaccional ignora su cuota y va contra el global.
    if (priority !== 'transactional' && !this.buckets[priority].tryTake()) {
      return false;
    }

    perMerchant.tryTake();
    this.global.tryTake();
    return true;
  }

  /** Espera hasta poder emitir. */
  async acquire(merchantId: string, priority: Priority): Promise<void> {
    while (true) {
      if (this.tryAcquire(merchantId, priority)) return;
      const wait = Math.max(
        10,
        Math.min(
          this.global.msUntilAvailable() || 10,
          this.tokenBucket(merchantId).msUntilAvailable() || 10,
        ),
      );
      await this.sleepFn(wait);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Backoff exponencial con jitter, respetando `retry-after`.
 *
 * Clover documenta que pedir antes de que expire `retry-after` ALARGA la
 * espera, así que ese header siempre gana sobre nuestro cálculo.
 */
export function backoffMs(
  attempt: number,
  retryAfterSeconds?: number,
  rand: () => number = Math.random,
): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000 + Math.floor(rand() * 250);
  }
  const base = Math.min(2 ** attempt * 1000, 30_000);
  return base + Math.floor(rand() * 1000);
}

/** ¿Este fallo se puede reintentar? */
export function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

/**
 * Un 429 puede venir de cuatro límites distintos. Saber cuál permite
 * decidir si conviene frenar solo a ese merchant o a toda la app.
 */
export function rateLimitKind(
  headers: Headers | Record<string, string>,
): 'app' | 'token' | 'app-concurrent' | 'token-concurrent' | 'unknown' {
  const get = (k: string): string | null =>
    headers instanceof Headers ? headers.get(k) : (headers[k] ?? headers[k.toLowerCase()] ?? null);

  if (get('X-RateLimit-crossTokenConcurrentLimit')) return 'app-concurrent';
  if (get('X-RateLimit-tokenConcurrentLimit')) return 'token-concurrent';
  if (get('X-RateLimit-crossTokenLimit')) return 'app';
  if (get('X-RateLimit-tokenLimit')) return 'token';
  return 'unknown';
}

/**
 * Circuit breaker por merchant. Aísla una sucursal con problemas para que
 * no consuma el presupuesto compartido de los demás tenants.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(threshold = 5, cooldownMs = 60_000, now: () => number = Date.now) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
  }

  get isOpen(): boolean {
    if (this.openedAt === null) return false;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      this.openedAt = null;
      this.failures = 0;
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }
}
