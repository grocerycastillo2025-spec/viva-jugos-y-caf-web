/**
 * La URL exacta que hay que registrar en el Developer Dashboard de Clover.
 *
 * POR QUÉ ESTO ES UN ARCHIVO Y NO UNA CONSTANTE SUELTA
 * Clover compara el `redirect_uri` que le mandamos con el que está
 * registrado en el dashboard, byte a byte. No hay normalización, no hay
 * tolerancia: una barra final de más, un `http` en vez de `https`, o el
 * nombre de la función escrito de otra manera, y el flujo muere con
 * `invalid_request` o con una página de error de Clover. El merchant ve una
 * pantalla rota y nosotros no recibimos nada — ni un log, porque la
 * petición nunca llega aquí.
 *
 * Así que la URL se calcula UNA vez, en esta función, y de ella salen las
 * tres cosas que tienen que coincidir o no coincide nada:
 *
 *   1. la que se manda en `/oauth/v2/authorize` (ruta `start`);
 *   2. la que atiende el callback (ruta `callback`);
 *   3. la que se pega en el dashboard, que sale por `GET .../redirect-uri`
 *      para no tener que teclearla desde un documento.
 *
 * DÓNDE VIVE
 * En esta Edge Function, no en `apps/admin`. La decisión y sus razones
 * están en `docs/OAUTH-CONEXION.md`; el resumen es que el `client_secret`,
 * Vault y el worker de refresco ya viven en el backend de Supabase, y
 * partir el ciclo de vida del token entre dos despliegues solo añade un
 * sitio más donde puede caerse a medias.
 *
 * LA FORMA DE LA URL
 *
 *   https://<project-ref>.supabase.co/functions/v1/oauth/callback
 *   └────────── SUPABASE_URL ─────────┘└ fijo ┘└ nombre ┘└ ruta ┘
 *
 * `functions/v1` lo pone Supabase, no nosotros. `oauth` es el nombre del
 * directorio de esta función: RENOMBRARLO CAMBIA LA URL y por tanto exige
 * volver al dashboard de Clover. Por eso el nombre está aquí escrito y hay
 * una prueba que lo fija.
 */

/**
 * El nombre del directorio de esta Edge Function. Es un dato de despliegue
 * disfrazado de constante: `supabase/functions/oauth/` -> `/oauth`.
 */
export const FUNCTION_NAME = 'oauth';

/** Prefijo que Supabase antepone a toda Edge Function. No es nuestro. */
export const FUNCTIONS_PREFIX = '/functions/v1';

/** Las cuatro rutas de esta función, relativas a su base. */
export const ROUTES = {
  /** Donde aterriza el merchant desde el enlace que le manda el operador. */
  start: '/start',
  /** LO QUE SE REGISTRA EN CLOVER como Default OAuth Response URL. */
  callback: '/callback',
  /** LO QUE SE REGISTRA EN CLOVER como Alternate Launch Path. */
  launch: '/launch',
  /** Devuelve en texto plano lo que hay que pegar en el dashboard. */
  redirectUri: '/redirect-uri',
} as const;

export class RedirectUriError extends Error {
  override readonly name = 'RedirectUriError';
}

/**
 * La base pública de las Edge Functions del proyecto.
 *
 * Sale de `SUPABASE_URL`, que Supabase inyecta en toda Edge Function sin
 * que haya que configurar nada. Se acepta una sobrescritura para el día que
 * haya dominio propio, y se valida igual de duro: el modo de fallar de esta
 * variable no es un error, es un flujo de OAuth que no completa nunca.
 */
export function functionsBaseUrl(supabaseUrl: string): string {
  const u = parseHttps(supabaseUrl, 'SUPABASE_URL');
  if (u.pathname !== '/' || u.search !== '' || u.hash !== '') {
    throw new RedirectUriError(
      `SUPABASE_URL tiene que ser solo el origen (https://<ref>.supabase.co), y llegó: ${supabaseUrl}`,
    );
  }
  return `${u.origin}${FUNCTIONS_PREFIX}`;
}

/**
 * La URL del callback. ESTA es la que se pega en el dashboard.
 *
 * Sin barra final, y no por gusto: `new URL('/callback', base).toString()`
 * no añade ninguna, pero un `redirect_uri` copiado a mano de un navegador
 * sí puede traerla, y entonces Clover ve dos cadenas distintas. Ver
 * `assertRegisteredRedirectUri`.
 */
export function cloverRedirectUri(supabaseUrl: string): string {
  return `${functionsBaseUrl(supabaseUrl)}/${FUNCTION_NAME}${ROUTES.callback}`;
}

/**
 * La URL del aterrizaje del App Market. ESTA es la que se pega en el
 * dashboard como *Alternate Launch Path*.
 *
 * NO ES EL CALLBACK, Y CONFUNDIRLAS ES CARO. El callback lo abre Clover al
 * final del OAuth, con `code` y `state`. Este lo abre Clover cuando el
 * merchant instala la app o pulsa su icono, con `merchant_id`,
 * `employee_id` y `client_id` — y sin `state`, que es lo único que ata un
 * callback a UNA sucursal. Por eso esta ruta no conecta nada: explica.
 * Ver `docs/OAUTH-CONEXION.md`, *El aterrizaje del App Market*.
 *
 * Se deriva aquí, con el callback, porque las dos se pegan en el mismo
 * dashboard en la misma visita y las dos se rompen igual si alguien
 * renombra el directorio de la función.
 *
 * Una diferencia que conviene saber: Clover NO compara esta cadena byte a
 * byte contra nada, así que equivocarse aquí no mata el OAuth. Solo manda
 * al merchant a otro sitio — un fallo visible, no silencioso.
 */
export function cloverLaunchUri(supabaseUrl: string): string {
  return `${functionsBaseUrl(supabaseUrl)}/${FUNCTION_NAME}${ROUTES.launch}`;
}

/**
 * Comprueba que lo que hay registrado (o configurado a mano) es exactamente
 * lo que esta función atiende.
 *
 * EXISTE PARA QUE EL FALLO SALGA AL ARRANCAR. Sin esto, una
 * `CLOVER_REDIRECT_URL` con una barra de más se despliega sin quejarse y el
 * error aparece la primera vez que un merchant real intenta conectar, en
 * una pantalla de Clover que no controlamos y sin dejar rastro en nuestros
 * logs. Un error de configuración tiene que salir al desplegar.
 */
export function assertRegisteredRedirectUri(configurada: string, supabaseUrl: string): string {
  const esperada = cloverRedirectUri(supabaseUrl);
  const u = parseHttps(configurada, 'CLOVER_REDIRECT_URL');

  if (configurada !== u.toString().replace(/\/$/, '') || configurada.endsWith('/')) {
    throw new RedirectUriError(
      `CLOVER_REDIRECT_URL no está normalizada: '${configurada}'.\n` +
        `Clover compara la cadena tal cual, así que una barra final o un puerto\n` +
        `implícito escrito a mano ya no coinciden. La forma buena es:\n  ${esperada}`,
    );
  }

  if (configurada !== esperada) {
    throw new RedirectUriError(
      `CLOVER_REDIRECT_URL apunta a otro sitio que el que atiende esta función.\n` +
        `  configurada: ${configurada}\n` +
        `  esta función: ${esperada}\n` +
        'Las dos tienen que ser idénticas Y estar registradas igual en el\n' +
        'Developer Dashboard de Clover. Si de verdad hay un dominio propio\n' +
        'delante, lo que hay que cambiar es SUPABASE_URL, no esto: así el\n' +
        'authorize y el callback siguen saliendo del mismo sitio.',
    );
  }
  return configurada;
}

function parseHttps(url: string, nombre: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new RedirectUriError(`${nombre} no es una URL válida: ${url}`);
  }
  // Clover rechaza `http` en el redirect de producción, y en sandbox lo
  // acepta a veces: exactamente el peor caso, porque funciona mientras se
  // prueba y falla al publicar.
  if (u.protocol !== 'https:') {
    throw new RedirectUriError(`${nombre} tiene que ser https:, y es ${u.protocol}`);
  }
  return u;
}
