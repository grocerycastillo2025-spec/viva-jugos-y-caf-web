/**
 * El periodo del worker está escrito en dos idiomas. Esto los compara.
 *
 * `WORKER_PERIOD_MS` (policy.ts) y la expresión de cron de la 0015 tienen
 * que decir lo mismo, y nada obliga a que lo hagan: son dos archivos, dos
 * lenguajes y dos despliegues distintos. La prueba abre la migración y la
 * lee, que es fea y es exactamente lo que hace falta.
 *
 * QUÉ SE ROMPE SI SE DESINCRONIZAN, Y POR QUÉ NO SE NOTA
 * `policy.ts` razona sobre cuántos intentos caben dentro del margen
 * (`REFRESH_MARGIN_MS / WORKER_PERIOD_MS >= 2`), y hay un aserto que lo
 * protege. Ese aserto es sobre la constante, no sobre lo que dispara: si
 * alguien baja el periodo a 2 minutos en TypeScript y deja el cron de la
 * 0015 en cinco, `policy.test.ts` sigue verde y la invariante ya no
 * protege nada.
 * En silencio, hasta el día que una sucursal se queda sin token.
 *
 * Si esta prueba se rompe, el arreglo es cambiar LOS DOS.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  REFRESH_MARGIN_MS,
  WORKER_PERIOD_MS,
} from '../../../../workers/src/token-refresh/index.ts';
import {
  attemptsInsideMargin,
  CRON_JOB_NAME,
  CRON_SCHEDULE,
  CronScheduleError,
  cronSchedule,
  FUNCTION_NAME,
  FUNCTION_PATH,
} from '../schedule.ts';

const MIGRACION = readFileSync(
  new URL('../../../migrations/0015_token_refresh_cron.sql', import.meta.url),
  'utf8',
);

test('EL CRON DE LA 0015 DISPARA CON EL PERIODO DE policy.ts', () => {
  assert.equal(CRON_SCHEDULE, '*/5 * * * *');
  assert.ok(
    MIGRACION.includes(`'${CRON_SCHEDULE}'`),
    `La 0015 no programa '${CRON_SCHEDULE}', que es lo que corresponde a ` +
      `WORKER_PERIOD_MS = ${WORKER_PERIOD_MS} ms. Cambia los dos o ninguno.`,
  );
});

test('la 0015 llama a la ruta de ESTA funcion', () => {
  // Renombrar el directorio cambia la URL que llama pg_net.
  assert.equal(FUNCTION_NAME, 'token-refresh');
  assert.equal(FUNCTION_PATH, '/functions/v1/token-refresh');
  assert.ok(MIGRACION.includes(`'${FUNCTION_PATH}'`), 'la 0015 apunta a otra ruta');
  assert.ok(MIGRACION.includes(`'${CRON_JOB_NAME}'`), 'la 0015 usa otro jobname');
});

test('con este cron caben DOS vueltas dentro del margen', () => {
  // El mismo aserto que `policy.test.ts`, pero sobre lo que de verdad
  // dispara. Una sola vuelta dentro del margen significa que un 500 de
  // Clover deja la sucursal sin token.
  assert.ok(
    attemptsInsideMargin() >= 2,
    `Solo cabe ${attemptsInsideMargin()} intento en el margen de ${REFRESH_MARGIN_MS} ms.`,
  );
});

test('solo se admiten periodos que cron sepa expresar sin deriva', () => {
  assert.equal(cronSchedule(60_000), '*/1 * * * *');
  assert.equal(cronSchedule(15 * 60_000), '*/15 * * * *');
  assert.equal(cronSchedule(60 * 60_000), '0 * * * *');

  // `*/7` salta de :56 a :00 — cuatro minutos, no siete.
  assert.throws(() => cronSchedule(7 * 60_000), CronScheduleError);
  // Más de una hora no cabe en `*/N` de minutos.
  assert.throws(() => cronSchedule(90 * 60_000), CronScheduleError);
  // Y nada más fino que el minuto.
  assert.throws(() => cronSchedule(30_000), CronScheduleError);
  assert.throws(() => cronSchedule(0), CronScheduleError);
});
