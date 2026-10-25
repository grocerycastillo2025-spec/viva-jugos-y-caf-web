/**
 * Lo que tienen que decir igual el worker y `pg_cron`.
 *
 * ─────────────────────────────────────────────────────────────────────
 * EL PROBLEMA QUE RESUELVE ESTE ARCHIVO
 * ─────────────────────────────────────────────────────────────────────
 *
 * El periodo del worker está escrito en dos idiomas: `WORKER_PERIOD_MS`
 * en `policy.ts` y una expresión de cron en la 0015. Los dos números
 * tienen que ser el mismo y nada en TypeScript puede leer un `.sql`… si
 * no se lo pide expresamente. Aquí se deriva la expresión DEL periodo, y
 * una prueba abre la migración y comprueba que dice lo mismo.
 *
 * No es celo: `policy.ts` razona sobre cuántos intentos caben dentro del
 * margen (`REFRESH_MARGIN_MS / WORKER_PERIOD_MS >= 2`), y ese razonamiento
 * es falso en cuanto el cron dispara con otro periodo. Bajar el periodo a
 * 2 minutos en `policy.ts` y dejar el cron de la 0015 en cinco no rompe
 * nada visible:
 * simplemente el aserto que protege la disponibilidad deja de proteger
 * nada, en silencio, hasta el día que una sucursal se queda sin token.
 *
 * LA URL TAMBIÉN VIVE AQUÍ, y por el mismo motivo que en la función de
 * OAuth: el nombre del directorio ES parte de la ruta que llama el cron.
 * Renombrar `supabase/functions/token-refresh/` cambia lo que hay que
 * escribir en la 0015.
 */

import { REFRESH_MARGIN_MS, WORKER_PERIOD_MS } from '../../../workers/src/token-refresh/index.ts';

/** El nombre del directorio de esta Edge Function. Es parte de la ruta. */
export const FUNCTION_NAME = 'token-refresh';

/** Prefijo que Supabase antepone a toda Edge Function. No es nuestro. */
export const FUNCTIONS_PREFIX = '/functions/v1';

/** Lo que `net.http_post` pega detrás del origen del proyecto. */
export const FUNCTION_PATH = `${FUNCTIONS_PREFIX}/${FUNCTION_NAME}`;

/** El `jobname` de `cron.schedule`. Es la clave: reprogramar pisa. */
export const CRON_JOB_NAME = 'token-refresh';

export class CronScheduleError extends Error {
  override readonly name = 'CronScheduleError';
}

/**
 * La expresión de cron que corresponde a un periodo.
 *
 * Solo se admiten los periodos que un cron de cinco campos sabe expresar
 * SIN DERIVA: divisores exactos de una hora. Un cron «cada 7 minutos» no
 * lo es —salta de :56 a :00, que son cuatro— y esa clase de detalle es
 * justo la que nadie mira hasta que hay un hueco.
 */
export function cronSchedule(periodMs: number): string {
  if (!Number.isFinite(periodMs) || periodMs <= 0 || periodMs % 60_000 !== 0) {
    throw new CronScheduleError(
      `El periodo del worker (${periodMs} ms) no es un número entero de minutos, ` +
        'y cron no sabe expresar nada más fino.',
    );
  }
  const minutos = periodMs / 60_000;
  if (minutos === 60) return '0 * * * *';
  if (minutos > 60 || 60 % minutos !== 0) {
    throw new CronScheduleError(
      `El periodo del worker (${minutos} min) no divide la hora en partes iguales, ` +
        'así que `*/N` dejaría un hueco al cambiar de hora. Elige un divisor de 60.',
    );
  }
  return `*/${minutos} * * * *`;
}

/**
 * La expresión que TIENE que estar en la 0015. Hay una prueba que abre la
 * migración y lo comprueba.
 */
export const CRON_SCHEDULE = cronSchedule(WORKER_PERIOD_MS);

/**
 * Cuántas vueltas completas caben en el margen con este cron. Es el mismo
 * aserto de `policy.ts`, pero calculado sobre lo que de verdad dispara.
 */
export function attemptsInsideMargin(): number {
  return Math.floor(REFRESH_MARGIN_MS / WORKER_PERIOD_MS);
}
