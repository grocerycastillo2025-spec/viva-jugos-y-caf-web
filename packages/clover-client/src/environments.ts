/**
 * Dónde vive cada API de Clover.
 *
 * CLOVER NO ES UN SOLO HOST, SON CUATRO
 * Esto es lo primero que sorprende y lo que más fácil se escribe mal. Las
 * cuatro APIs que necesitamos viven en dominios distintos:
 *
 *   plataforma (REST v3)  apisandbox.dev.clover.com   catálogo, órdenes
 *   OAuth                 sandbox.dev.clover.com      SOLO authorize
 *   ecommerce             scl-sandbox.dev.clover.com  cobrar, PAKMS
 *   tokenización          token-sandbox.dev.clover.com  tarjeta -> clv_...
 *
 * OJO CON EL HOST DE OAUTH: el único endpoint que vive ahí es
 * `/oauth/v2/authorize`. El canje (`/oauth/v2/token`) y el refresco
 * (`/oauth/v2/refresh`) viven en el host de PLATAFORMA. Lo dice la tabla
 * "Sandbox and production environment URLs" de la documentación, idéntica
 * en tres páginas del flujo v2/OAuth. Ver `endpoints/oauth.ts`.
 *
 * Mandar una petición al host equivocado no da un 404 claro: da un 401, o
 * un HTML de portal, o un 403 de CORS. Por eso el host no se elige en el
 * punto de llamada; se elige aquí, una sola vez, y cada endpoint declara a
 * QUÉ API pertenece.
 *
 * Y ningún host se escribe en el código de negocio: §13.1 de la
 * arquitectura lo pide explícito —"toda URL se resuelve por configuración,
 * nunca hardcodeada"— porque hay dominios distintos por región y el día
 * que haya un merchant fuera de Norteamérica esto tiene que ser un cambio
 * de configuración, no de código.
 *
 * Fuentes verificadas: docs/CLOVER-ENDPOINTS.md
 */

/** Las cuatro APIs. Cada endpoint declara la suya. */
export type CloverApi = 'platform' | 'oauth' | 'ecommerce' | 'token';

export type CloverHosts = Readonly<Record<CloverApi, string>>;

/**
 * `sandbox` es el entorno de pruebas. `na-production` es Norteamérica,
 * que es la plataforma que tenemos contratada.
 *
 * Las demás regiones (Europa, Latinoamérica) tienen dominios propios que
 * NO están verificados aquí. Se añaden cuando haga falta y se comprueben,
 * no antes: un dominio inventado se descubre en producción.
 */
export type CloverEnvironment = 'sandbox' | 'na-production';

/**
 * Hosts conocidos. Los ocho verificados contra la documentación oficial;
 * las fuentes, una por fila, están en `docs/CLOVER-ENDPOINTS.md`.
 *
 * El de tokenización en producción estuvo en `null` mientras no se pudo
 * confirmar. Ya está: `token.clover.com`, de la tabla de URLs de sandbox y
 * producción de "Ecommerce API tutorials". Era el único de los ocho que
 * faltaba, y era el que habría fallado en el primer cobro real.
 */
const KNOWN: Readonly<Record<CloverEnvironment, Readonly<Record<CloverApi, string | null>>>> = {
  sandbox: {
    platform: 'https://apisandbox.dev.clover.com',
    oauth: 'https://sandbox.dev.clover.com',
    ecommerce: 'https://scl-sandbox.dev.clover.com',
    token: 'https://token-sandbox.dev.clover.com',
  },
  'na-production': {
    platform: 'https://api.clover.com',
    oauth: 'https://www.clover.com',
    ecommerce: 'https://scl.clover.com',
    token: 'https://token.clover.com',
  },
};

/** Sobrescritura por configuración. Todo opcional; lo que no venga, se toma de `KNOWN`. */
export type HostOverrides = Partial<Record<CloverApi, string>>;

export class CloverConfigError extends Error {
  override readonly name = 'CloverConfigError';
}

function normalize(url: string, api: CloverApi): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new CloverConfigError(`El host de la API '${api}' no es una URL válida: ${url}`);
  }
  // Clover exige HTTPS en todo. Un http:// aquí sería un fallo silencioso
  // de configuración que expone un token en claro.
  if (u.protocol !== 'https:') {
    throw new CloverConfigError(`El host de la API '${api}' tiene que ser https:, no ${u.protocol}`);
  }
  // Sin barra final: las rutas se concatenan y '//v3/...' no es lo mismo.
  return u.origin;
}

/**
 * Los cuatro hosts del entorno, con las sobrescrituras aplicadas.
 *
 * Falla en el arranque si falta alguno, no en la primera petición: un
 * error de configuración tiene que salir al desplegar, no cuando un
 * cliente esté pagando.
 */
export function resolveHosts(
  environment: CloverEnvironment,
  overrides: HostOverrides = {},
): CloverHosts {
  const base = KNOWN[environment];
  const salida: Partial<Record<CloverApi, string>> = {};

  for (const api of ['platform', 'oauth', 'ecommerce', 'token'] as const) {
    const valor = overrides[api] ?? base[api];
    if (valor === null || valor === undefined || valor === '') {
      throw new CloverConfigError(
        `Falta el host de la API '${api}' para el entorno '${environment}'.\n` +
          'Los ocho hosts de sandbox y de Norteamérica vienen por defecto y están\n' +
          'verificados. Si ves esto es porque se añadió una región sin confirmar sus\n' +
          'dominios, o porque una sobrescritura llegó vacía. No lo adivines: un host\n' +
          'inventado no da 404, da un 401 que parece "credenciales mal". Confírmalo en\n' +
          'la documentación de Clover y pásalo por configuración.',
      );
    }
    salida[api] = normalize(valor, api);
  }

  return salida as CloverHosts;
}
