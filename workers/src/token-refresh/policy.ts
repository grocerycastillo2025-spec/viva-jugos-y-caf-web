/**
 * Cuándo se refresca, cuánto se espera al fallar, y por qué esos números.
 *
 * TODO ES PURO. Ni reloj propio, ni red, ni base: se le pasa `now` y
 * devuelve. Es lo que permite probar "qué pasa a los trece días" sin
 * esperar trece días.
 *
 * EL MARGEN ES LA PIEZA IMPORTANTE
 * El access token de Clover dura 30 minutos según su documentación (en
 * sandbox se midió ~24 h). Refrescarlo cuando le quedan
 * segundos es apostar a que ni la red, ni Clover, ni nuestro proceso van a
 * fallar ese día. El margen existe para que quepan VARIOS intentos antes
 * de que el token muera:
 *
 *   vida del access token   30 min
 *   margen                  10 min  <- se refresca al entrar aquí
 *   periodo del worker       5 min
 *
 * Con esos tres números caben dos ejecuciones completas dentro del margen.
 * Si alguien baja el margen o sube el periodo hasta que solo quepa una,
 * una sola ejecución fallida deja la sucursal sin token, y eso en hora
 * punta es la app caída. Hay una prueba que lo comprueba: no es un
 * comentario, es un aserto.
 */

/**
 * Valor de RESERVA para la vida del access token. Solo se usa si el canje
 * no trae `access_token_expiration`; no decide cuándo se refresca, que eso
 * sale de la caducidad real guardada en la fila.
 *
 * MEDIDO EN SANDBOX (2026-09-05): duró ~24 h, no los 30 minutos que
 * documenta Clover. Aun así se queda en 30, y a propósito: como reserva,
 * quedarse corto cuesta rotaciones de más y ningún riesgo, mientras que
 * pasarse programa el refresco casi un día tarde y deja la sucursal sin
 * token. La medición es de sandbox y producción no está confirmada.
 *
 * Ojo si alguien se plantea subirlo: el aserto de `policy.test.ts` no
 * avisaría, porque subir el TTL hace `REFRESH_MARGIN_MS < TTL / 2` más
 * cierto, no menos. Ver docs/REFRESCO-TOKENS.md, "La vida real del token,
 * medida".
 */
export const ACCESS_TOKEN_TTL_MS = 30 * 60_000;

/**
 * Cada cuánto corre el worker (pg_cron).
 *
 * ─────────────────────────────────────────────────────────────────────
 * ESTE ES EL PUNTO DE AJUSTE. Si algún día hace falta más holgura, se
 * toca este número y no `REFRESH_MARGIN_MS`.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Los dos dan más intentos, pero no cuestan lo mismo:
 *
 *   bajar el periodo a 2 min   5 intentos dentro del mismo margen de 10,
 *                              sin acortar la vida útil de ningún token.
 *                              Cuesta consultas de claim contra un índice
 *                              parcial, la mayoría devolviendo cero filas.
 *
 *   subir el margen a 15 min   1 intento más, y cada token se usaría la
 *                              MITAD de su vida: el doble de rotaciones,
 *                              el doble de secretos en Vault y el doble de
 *                              llamadas a /refresh, que es tráfico contra
 *                              el techo de 50 req/s que se comparte con
 *                              gente pagando.
 *
 * Y hay un motivo más para no tocar el margen: cada rotación es una
 * oportunidad de perder un par entre que Clover lo emite y lo guardamos.
 * Rotar el doble de veces duplica esa exposición para ganar un intento
 * contra un fallo que se arregla solo en la vuelta siguiente.
 *
 * POR QUÉ SE QUEDA EN 5 MINUTOS DE MOMENTO
 * Porque el modo de fallo está acotado y es barato: quedarse sin margen
 * NO mata la conexión. El access token caducado no invalida el refresh
 * —la cadena de recuperación es de dos semanas—, así que el coste de
 * llegar tarde es que esa sucursal no pueda hablar con Clover durante
 * como mucho una vuelta, y se arregla sola en la siguiente. El margen
 * protege DISPONIBILIDAD, no recuperabilidad.
 *
 * Con el piloto de una sola sucursal y sin tráfico real, ese coste es
 * aceptable y la alternativa sería afinar a ciegas. Se ajusta con datos
 * —cuántas vueltas se han saltado de verdad, cuánto tarda Clover en el
 * peor percentil— cuando el piloto lleve semanas operando, no antes.
 *
 * Si se cambia: el aserto de `policy.test.ts` protege la invariante que
 * de verdad importa (en el margen tienen que caber al menos DOS
 * intentos), así que un valor que la rompa no llega a main.
 */
export const WORKER_PERIOD_MS = 5 * 60_000;

/**
 * Cuánta vida le tiene que quedar al access token para que se refresque.
 * Ver la cabecera: tiene que caber más de un intento.
 *
 * NO ES ESTE EL NÚMERO QUE SE TOCA para ganar holgura. Subirlo acorta la
 * vida útil de cada token y duplica las rotaciones; el punto de ajuste es
 * `WORKER_PERIOD_MS`, y ahí está el razonamiento entero.
 */
export const REFRESH_MARGIN_MS = 10 * 60_000;

/**
 * La ventana de recuperación: dos semanas desde que se generó el par
 * ACTUAL. Se usa en los dos caminos —refresco y recuperación—, porque la
 * ventana cuelga del par nuevo y no del token de recuperación: cada par
 * emitido la reancla. Confirmado por Developer Relations de Clover; hasta
 * la 0016 el código asumía lo contrario. Ver `chain.ts`.
 *
 * Esto era una pregunta abierta y Clover la contestó: cada refresco con
 * éxito genera un par nuevo Y una ventana fresca, y el token consumido
 * pasa a ser el de recuperación del par nuevo. O sea que un refresco
 * normal NO cierra la ventana: la hace rodar hacia adelante.
 *
 * La contradicción que parecía haber entre esa respuesta y otra anterior
 * quedó resuelta el 2026-09-16: hablaban de rutas distintas, no de la
 * misma. Las dos reglas —una por endpoint— y por qué una sola línea las
 * implementa están en la cabecera de `chain.ts`, que es donde vive la
 * regla. No se duplican aquí para que no acaben diciendo cosas
 * distintas.
 *
 * Lo que no depende de la respuesta: el worker intenta la recuperación
 * SIEMPRE, con dos candidatos, y la autoridad es
 * `X-Clover-Recovery-Available`. Esta constante solo decide qué fecha se
 * escribe para avisar.
 */
export const RECOVERY_WINDOW_MS = 14 * 24 * 60 * 60_000;

/**
 * Cuánto se reserva una conexión al empezar a refrescarla.
 *
 * Tiene que superar con holgura lo que tarda una rotación completa
 * (dos llamadas a Clover con timeout de 20 s, más Vault), y ser lo
 * bastante corta como para que un worker muerto no bloquee la conexión
 * más de un par de ciclos.
 */
export const LEASE_MS = 2 * 60_000;

/**
 * Cuántas conexiones por ejecución. El techo de 50 req/s es de la APP y
 * se comparte entre todos los merchants; el limitador del cliente reparte
 * dentro de ese techo, pero pedir 500 rotaciones de golpe llenaría la cola
 * de lo transaccional (que es gente pagando). Con 5 minutos de periodo,
 * 50 por vuelta son 600 conexiones por hora: de sobra para la escala del
 * §18, y sin ráfaga.
 */
export const MAX_BATCH = 50;

/**
 * Cuántas conexiones se reclaman de una vez.
 *
 * El arriendo se toma para TODO el lote a la vez, así que un lote grande
 * puede tardar más de lo que dura su propio arriendo, y ahí otra ejecución
 * podría coger una fila que todavía no hemos tocado. Se reclama en trozos
 * pequeños y se comprueba el arriendo antes de cada fila; el tamaño del
 * trozo deja de ser una apuesta.
 */
export const CLAIM_CHUNK = 5;

/**
 * Lo que puede tardar, como mucho, una conexión: el refresco más los dos
 * intentos de recuperación, con el timeout de 20 s del cliente. Si no cabe
 * en lo que queda de arriendo, el lote se corta.
 */
export const PER_CONNECTION_BUDGET_MS = 60_000;

/** Fallos seguidos que hacen falta para degradar por un fallo NO de auth. */
export const FAILURES_BEFORE_DEGRADED = 3;

const MIN_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;

/**
 * La frontera del lote: se reclama todo lo que caduque antes de esto.
 *
 * `now + margen`, y no `now`, es lo que hace que el refresco sea
 * PROACTIVO. Con `now` se refrescaría lo que ya está muerto, que es
 * exactamente lo que este worker existe para evitar.
 */
export function refreshDueBefore(now: Date): Date {
  return new Date(now.getTime() + REFRESH_MARGIN_MS);
}

/**
 * `null` = no sabemos cuándo caduca, y eso se trata como vencido.
 *
 * Es el lado barato de equivocarse: un refresco de más gasta una llamada;
 * uno de menos deja a la sucursal sin token.
 */
export function isDue(accessTokenExpiresAt: Date | null, now: Date): boolean {
  if (accessTokenExpiresAt === null) return true;
  return accessTokenExpiresAt.getTime() <= refreshDueBefore(now).getTime();
}

/** Cuántas ejecuciones completas caben dentro del margen. Debe ser >= 2. */
export function attemptsInsideMargin(): number {
  return Math.floor(REFRESH_MARGIN_MS / WORKER_PERIOD_MS);
}

/**
 * Cuándo caduca el access token que acaba de llegar.
 *
 * Clover manda `access_token_expiration` en segundos unix, pero es
 * opcional en el tipo porque la API omite lo que quiere. Sin ese campo se
 * usa la vida documentada.
 *
 * Y si la fecha que llega ya está pasada —reloj torcido, campo raro— se
 * ignora: guardarla provocaría un refresco inmediato en cada vuelta, o
 * sea un bucle contra Clover con un token que en realidad sirve.
 */
export function accessTokenExpiryFrom(unixSeconds: number | undefined, now: Date): Date {
  const porDefecto = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
  if (unixSeconds === undefined || !Number.isFinite(unixSeconds)) return porDefecto;
  const fecha = new Date(unixSeconds * 1000);
  return fecha.getTime() > now.getTime() ? fecha : porDefecto;
}

/** Igual, pero el del refresh es informativo: si no viene, no se inventa. */
export function refreshTokenExpiryFrom(unixSeconds: number | undefined): Date | null {
  if (unixSeconds === undefined || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000);
}

/**
 * Espera tras un fallo: 1, 2, 4… hasta 30 minutos.
 *
 * Se escribe en el arriendo, no en una columna nueva: mientras el arriendo
 * esté en el futuro, el claim no vuelve a coger la fila. Un solo mecanismo
 * para dos cosas que son la misma —"esta conexión no se toca ahora"— y una
 * cosa menos que se puede quedar desincronizada.
 */
export function failureBackoffMs(consecutiveFailures: number): number {
  const n = Math.max(1, Math.floor(consecutiveFailures));
  return Math.min(MIN_BACKOFF_MS * 2 ** (n - 1), MAX_BACKOFF_MS);
}

/**
 * Si la ventana de recuperación que tenemos apuntada ya venció.
 *
 * SOLO SIRVE PARA AVISAR. Nunca para decidir no intentar la recuperación:
 * la fecha la calculamos nosotros, con nuestro reloj, y la autoridad es
 * `X-Clover-Recovery-Available`. Ver `docs/REFRESCO-TOKENS.md`.
 */
export function recoveryWindowLooksClosed(expiresAt: Date | null, now: Date): boolean {
  if (expiresAt === null) return true;
  return expiresAt.getTime() <= now.getTime();
}
