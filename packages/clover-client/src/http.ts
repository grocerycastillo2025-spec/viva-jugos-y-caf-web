/**
 * El transporte: una sola puerta por la que salen TODAS las peticiones.
 *
 * Que sea una sola no es estética. Es lo que hace que estas cinco cosas se
 * cumplan siempre y no "casi siempre":
 *
 *   1. el rate limiter global con cuotas por prioridad (§13.2). El techo de
 *      50 req/s es COMPARTIDO por todos los merchants: si una llamada se
 *      salta el limitador, se lo come del presupuesto de los demás;
 *   2. el circuit breaker por merchant, que aísla una sucursal enferma;
 *   3. el backoff con `retry-after`. Clover documenta que pedir antes de
 *      tiempo ALARGA la espera, así que ese header siempre gana;
 *   4. el timeout. Sin él, una petición colgada retiene un hueco de
 *      concurrencia para siempre;
 *   5. la redacción. El único error que sale de aquí ya viene limpio.
 *
 * NO REINTENTA LO QUE NO SE PUEDE REINTENTAR
 * Un `POST` sin clave de idempotencia que devuelve 500 puede haber creado
 * la orden igualmente. Reintentarlo a ciegas es cobrar dos veces. Por eso
 * un POST solo se reintenta si trae `idempotencyKey`, o si el fallo ocurrió
 * ANTES de que la petición saliera (el limitador, el DNS): ahí no hay nada
 * que duplicar.
 */

import { CloverApiError, CloverCircuitOpenError, CloverTransportError, redactBody } from './errors.ts';
import {
  resolveHosts,
  type CloverApi,
  type CloverEnvironment,
  type CloverHosts,
  type HostOverrides,
} from './environments.ts';
import {
  backoffMs,
  CircuitBreaker,
  CloverRateLimiter,
  isRetryable,
  rateLimitKind,
  sleep as defaultSleep,
  type Priority,
} from './rate-limit.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * `X-Clover-Recovery-Available` de una respuesta de error.
 *
 * Es la unica cabecera que sale de aqui, y sale porque es la AUTORIDAD
 * sobre algo que nosotros solo estimamos: si un 401 del refresco todavia
 * tiene red de recuperacion. Nuestra `recovery_token_expires_at` se
 * calcula con nuestro reloj, asi que cuando las dos se contradicen manda
 * esta. Ver `docs/REFRESCO-TOKENS.md`.
 *
 * Los tres estados no se colapsan a dos: `undefined` (no vino la cabecera)
 * NO es `false` (Clover dice que no hay red). Confundirlos haria que el
 * worker borrase el token de recuperacion de una conexion sana el dia que
 * Clover deje de mandar la cabecera en algun 401.
 */
function readRecoveryAvailable(headers: Headers): boolean | undefined {
  const crudo = headers.get('x-clover-recovery-available');
  if (crudo === null) return undefined;
  return crudo.trim().toLowerCase() === 'true';
}

/**
 * Cómo se autentica una petición. Cada API de Clover usa una forma
 * distinta, y confundirlas da 401 en vez de un error claro.
 */
export type CloverAuth =
  /** Token OAuth del merchant. API de plataforma y de ecommerce. */
  | { readonly kind: 'bearer'; readonly token: string }
  /** Clave PAKMS en la cabecera `apikey`. Solo el host de tokenización. */
  | { readonly kind: 'apikey'; readonly key: string }
  /** El canje de OAuth: las credenciales van en el cuerpo, no en cabecera. */
  | { readonly kind: 'none' };

export interface CloverRequest {
  readonly api: CloverApi;
  readonly method: HttpMethod;
  /** Empieza por '/'. Sin host y sin query. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  readonly auth: CloverAuth;
  readonly priority: Priority;
  /**
   * Clave del limitador por token y del circuit breaker. El merchant de
   * Clover cuando lo hay; para las llamadas que aún no tienen merchant
   * (el canje de OAuth) se usa un identificador estable de la app.
   */
  readonly rateKey: string;
  /**
   * Sin esto, un POST no se reintenta. Es deliberado: ver la cabecera.
   */
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
}

export interface RetryNotice {
  readonly attempt: number;
  readonly waitMs: number;
  readonly status: number | null;
  readonly path: string;
  readonly rateKey: string;
  readonly limitKind: ReturnType<typeof rateLimitKind> | null;
}

export interface CloverHttpConfig {
  readonly environment: CloverEnvironment;
  readonly hostOverrides?: HostOverrides;
  /** App Id del Developer Dashboard. Identifica la app, no es un secreto. */
  readonly appId: string;
  /** Inyectable para los tests: aquí no se toca la red de verdad. */
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly rand?: () => number;
  readonly limiter?: CloverRateLimiter;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  /** Umbral y enfriamiento del breaker por merchant. */
  readonly breakerThreshold?: number;
  readonly breakerCooldownMs?: number;
  /** Para observabilidad. Recibe datos ya redactados. */
  readonly onRetry?: (n: RetryNotice) => void;
}

export class CloverHttp {
  readonly hosts: CloverHosts;
  private readonly cfg: Required<
    Pick<CloverHttpConfig, 'appId' | 'timeoutMs' | 'maxAttempts' | 'breakerThreshold' | 'breakerCooldownMs'>
  >;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly rand: () => number;
  private readonly limiter: CloverRateLimiter;
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly onRetry: ((n: RetryNotice) => void) | undefined;

  constructor(config: CloverHttpConfig) {
    this.hosts = resolveHosts(config.environment, config.hostOverrides ?? {});
    this.now = config.now ?? Date.now;
    this.sleep = config.sleep ?? defaultSleep;
    this.rand = config.rand ?? Math.random;
    this.doFetch = config.fetch ?? globalThis.fetch;
    this.limiter = config.limiter ?? new CloverRateLimiter(this.now, this.sleep);
    this.onRetry = config.onRetry;
    this.cfg = {
      appId: config.appId,
      // El sandbox es más lento que producción y las consultas grandes
      // tardan; 20 s corta lo colgado sin cortar lo lento.
      timeoutMs: config.timeoutMs ?? 20_000,
      maxAttempts: config.maxAttempts ?? 4,
      breakerThreshold: config.breakerThreshold ?? 5,
      breakerCooldownMs: config.breakerCooldownMs ?? 60_000,
    };
  }

  private breaker(key: string): CircuitBreaker {
    let b = this.breakers.get(key);
    if (!b) {
      b = new CircuitBreaker(this.cfg.breakerThreshold, this.cfg.breakerCooldownMs, this.now);
      this.breakers.set(key, b);
    }
    return b;
  }

  /** ¿Está aislado este merchant? Lo consulta el SaaS para pintar `DEGRADED`. */
  isolated(rateKey: string): boolean {
    return this.breaker(rateKey).isOpen;
  }

  private url(req: CloverRequest): string {
    const u = new URL(this.hosts[req.api] + req.path);
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  private headers(req: CloverRequest): Headers {
    const h = new Headers({ accept: 'application/json' });
    if (req.body !== undefined) h.set('content-type', 'application/json');
    if (req.auth.kind === 'bearer') h.set('authorization', `Bearer ${req.auth.token}`);
    if (req.auth.kind === 'apikey') h.set('apikey', req.auth.key);
    if (req.idempotencyKey !== undefined) h.set('idempotency-key', req.idempotencyKey);
    return h;
  }

  /**
   * Un POST solo se reintenta con clave de idempotencia. Ver la cabecera
   * del módulo: sin ella, reintentar un 500 puede duplicar un cobro.
   */
  private canRetryAfterSend(req: CloverRequest): boolean {
    if (req.method === 'GET') return true;
    return req.idempotencyKey !== undefined;
  }

  async request<T>(req: CloverRequest): Promise<T> {
    const breaker = this.breaker(req.rateKey);
    if (breaker.isOpen) throw new CloverCircuitOpenError(req.rateKey);

    let ultimoTransporte: unknown = null;
    let intento = 0;

    while (intento < this.cfg.maxAttempts) {
      intento += 1;

      // Esperar turno ANTES de salir. Lo que se para aquí no ha llegado a
      // Clover, así que no cuenta contra ningún límite ni duplica nada.
      await this.limiter.acquire(req.rateKey, req.priority);

      const controller = new AbortController();
      const corte = setTimeout(() => controller.abort(), req.timeoutMs ?? this.cfg.timeoutMs);

      let res: Response;
      try {
        res = await this.doFetch(this.url(req), {
          method: req.method,
          headers: this.headers(req),
          body: req.body === undefined ? null : JSON.stringify(req.body),
          signal: controller.signal,
        });
      } catch (causa) {
        clearTimeout(corte);
        ultimoTransporte = causa;
        breaker.recordFailure();
        // Un fallo de transporte NO dice si la petición llegó. Vale lo
        // mismo que un 500: solo se reintenta lo idempotente.
        if (!this.canRetryAfterSend(req) || intento >= this.cfg.maxAttempts) {
          throw new CloverTransportError(
            `No hubo respuesta de Clover en ${req.method} ${req.path}`,
            intento,
            { cause: causa },
          );
        }
        const espera = backoffMs(intento, undefined, this.rand);
        this.onRetry?.({
          attempt: intento,
          waitMs: espera,
          status: null,
          path: req.path,
          rateKey: req.rateKey,
          limitKind: null,
        });
        await this.sleep(espera);
        continue;
      }
      clearTimeout(corte);

      if (res.ok) {
        breaker.recordSuccess();
        return (await this.parse<T>(res)) as T;
      }

      const cuerpo = redactBody(await res.text().catch(() => ''));
      const requestId = res.headers.get('x-clover-request-id') ?? undefined;
      const retryAfter = Number(res.headers.get('retry-after') ?? '') || undefined;
      const recoveryAvailable = readRecoveryAvailable(res.headers);

      // Un 4xx nuestro (400, 404, 422) no dice nada de la salud de la
      // sucursal: es nuestro payload. No debe abrir el breaker ni gastar
      // reintentos.
      if (!isRetryable(res.status)) {
        breaker.recordSuccess();
        throw new CloverApiError({
          status: res.status,
          method: req.method,
          path: req.path,
          body: cuerpo,
          requestId,
          recoveryAvailable,
          attempts: intento,
        });
      }

      breaker.recordFailure();

      const clase = res.status === 429 ? rateLimitKind(res.headers) : null;
      const agotado = intento >= this.cfg.maxAttempts;
      if (agotado || !this.canRetryAfterSend(req)) {
        throw new CloverApiError({
          status: res.status,
          method: req.method,
          path: req.path,
          body: cuerpo,
          requestId,
          retryAfterSeconds: retryAfter,
          recoveryAvailable,
          attempts: intento,
        });
      }

      const espera = backoffMs(intento, retryAfter, this.rand);
      this.onRetry?.({
        attempt: intento,
        waitMs: espera,
        status: res.status,
        path: req.path,
        rateKey: req.rateKey,
        limitKind: clase,
      });
      await this.sleep(espera);
    }

    // Solo se llega aquí si `maxAttempts` es 0 o negativo.
    throw new CloverTransportError(
      `Se agotaron los intentos en ${req.method} ${req.path}`,
      intento,
      ultimoTransporte === null ? undefined : { cause: ultimoTransporte },
    );
  }

  /** 204 y cuerpos vacíos son legítimos (por ejemplo un DELETE). */
  private async parse<T>(res: Response): Promise<T | undefined> {
    if (res.status === 204) return undefined;
    const texto = await res.text();
    if (texto.trim() === '') return undefined;
    return JSON.parse(texto) as T;
  }
}
