/**
 * Errores de Clover, y la regla de que un token nunca acaba en un log.
 *
 * §14 de la arquitectura: "prohibido loguear tokens, PAN, emails completos
 * o payloads de pago sin redactar". Esa regla se cumple sola si el único
 * camino por el que un fallo sale de este paquete es un error que ya viene
 * redactado. Por eso `CloverApiError` guarda un cuerpo recortado y pasado
 * por `redact`, y su `toString` no imprime cabeceras.
 *
 * El caso que da miedo no es loguear el token a propósito: es que Clover
 * devuelva un 400 cuyo cuerpo repite la petición, y ese cuerpo acabe en
 * Sentry.
 */

/** Claves cuyo valor no se imprime jamás, venga de donde venga. */
const CLAVES_SENSIBLES =
  /^(access_token|refresh_token|client_secret|apikey|api_key|apiaccesskey|authorization|token|source|card|number|cvv|cvc|exp_month|exp_year|x-clover-auth)$/i;

/** Un valor suelto que PARECE una credencial aunque su clave no lo diga. */
const VALOR_SENSIBLE = /\bclv_[A-Za-z0-9]+|\b[0-9]{12,19}\b/;

/**
 * Deja un objeto apto para un log: las claves sensibles pasan a
 * `[redactado]` y los valores con pinta de credencial también.
 *
 * Recursivo y sin ciclos: los cuerpos de Clover son JSON plano.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[demasiado profundo]';
  if (typeof value === 'string') return VALOR_SENSIBLE.test(value) ? '[redactado]' : value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    salida[k] = CLAVES_SENSIBLES.test(k) ? '[redactado]' : redact(v, depth + 1);
  }
  return salida;
}

/** Redacta y recorta: un cuerpo de error no debería ocupar un log entero. */
export function redactBody(raw: string, maxChars = 2000): string {
  let texto: string;
  try {
    texto = JSON.stringify(redact(JSON.parse(raw)));
  } catch {
    texto = raw.replace(/clv_[A-Za-z0-9]+/g, '[redactado]');
  }
  return texto.length > maxChars ? `${texto.slice(0, maxChars)}…[recortado]` : texto;
}

export interface CloverApiErrorInit {
  readonly status: number;
  readonly method: string;
  /** Ruta SIN host y sin query, para no filtrar tokens que viajen en la url. */
  readonly path: string;
  readonly body: string;
  /** `X-Clover-Request-Id`, lo que hay que darle a soporte de Clover. */
  readonly requestId?: string | undefined;
  readonly retryAfterSeconds?: number | undefined;
  /**
   * `X-Clover-Recovery-Available` tal y como vino: `true`, `false`, o
   * `undefined` si la cabecera no estaba. Los tres estados son distintos y
   * por eso `undefined` no se colapsa a `false`: ver el campo del mismo
   * nombre en `CloverApiError`.
   */
  readonly recoveryAvailable?: boolean | undefined;
  readonly attempts: number;
}

/**
 * Un fallo con respuesta de Clover. Que exista `status` es lo que permite
 * a quien llama decidir sin volver a parsear nada.
 */
export class CloverApiError extends Error {
  override readonly name = 'CloverApiError';
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  /**
   * Lo que dijo `X-Clover-Recovery-Available` en un 401 del refresco.
   *
   * `true`   Clover confirma que hay token de recuperacion vivo.
   * `false`  Clover confirma que NO lo hay.
   * `undefined` la cabecera no vino, que no es lo mismo que `false`.
   *
   * Esta cabecera es la AUTORIDAD sobre nuestra `recovery_token_expires_at`,
   * que es una estimacion con nuestro reloj. Sirve para avisar y para
   * limpiar; nunca para decidir NO intentar la recuperacion. Ver
   * `0012_recovery_token.sql` y `docs/REFRESCO-TOKENS.md`.
   */
  readonly recoveryAvailable: boolean | undefined;
  readonly attempts: number;

  constructor(init: CloverApiErrorInit) {
    super(
      `Clover ${init.status} en ${init.method} ${init.path}` +
        (init.requestId ? ` (request-id ${init.requestId})` : '') +
        (init.attempts > 1 ? ` tras ${init.attempts} intentos` : '') +
        `: ${init.body}`,
    );
    this.status = init.status;
    this.method = init.method;
    this.path = init.path;
    this.body = init.body;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.recoveryAvailable = init.recoveryAvailable;
    this.attempts = init.attempts;
  }

  /** 401/403: el token no sirve. Quien llama debe refrescar o marcar la conexión. */
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }

  /** 404 sobre un objeto que creíamos que existía: divergencia con Clover. */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** Un fallo sin respuesta: red caída, DNS, timeout nuestro. */
export class CloverTransportError extends Error {
  override readonly name = 'CloverTransportError';
  readonly attempts: number;

  constructor(message: string, attempts: number, options?: { cause?: unknown }) {
    super(message, options);
    this.attempts = attempts;
  }
}

/**
 * El merchant está aislado por el circuit breaker.
 *
 * No es un fallo de esta petición: es que la sucursal acumuló errores y se
 * la apartó para que no se coma el techo compartido de 50 req/s (§13.2).
 * Se distingue del resto porque la respuesta operativa es distinta: no se
 * reintenta, se avisa al SaaS.
 */
export class CloverCircuitOpenError extends Error {
  override readonly name = 'CloverCircuitOpenError';
  readonly merchantId: string;

  constructor(merchantId: string) {
    super(
      `El merchant ${merchantId} está aislado por acumulación de errores. ` +
        'No se emite la petición para no consumir el presupuesto compartido de la app.',
    );
    this.merchantId = merchantId;
  }
}
