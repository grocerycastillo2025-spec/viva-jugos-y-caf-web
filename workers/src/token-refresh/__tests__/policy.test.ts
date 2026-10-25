/**
 * Los numeros del refresco. Parecen constantes sueltas y son una
 * decision: cuanto margen se deja antes de que una sucursal se quede sin
 * token.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCESS_TOKEN_TTL_MS,
  LEASE_MS,
  PER_CONNECTION_BUDGET_MS,
  REFRESH_MARGIN_MS,
  WORKER_PERIOD_MS,
  accessTokenExpiryFrom,
  attemptsInsideMargin,
  failureBackoffMs,
  isDue,
  recoveryWindowLooksClosed,
  refreshDueBefore,
  refreshTokenExpiryFrom,
} from '../policy.ts';

const AHORA = new Date('2026-09-03T12:00:00.000Z');

test('EN EL MARGEN CABE MAS DE UN INTENTO. Esto es la razon de ser del worker', () => {
  // Si solo cupiera uno, una sola ejecucion fallida —un despliegue, un
  // 500 de Clover, un timeout— dejaria la sucursal sin token. Bajar el
  // margen o subir el periodo hasta romper esto es una decision que hay
  // que tomar a sabiendas, no de refilon.
  assert.ok(
    attemptsInsideMargin() >= 2,
    `solo caben ${attemptsInsideMargin()} intentos dentro del margen`,
  );
  // Y el margen tiene que seguir siendo una fraccion de la vida del
  // token: un margen igual a la vida es refrescar en cada vuelta.
  assert.ok(REFRESH_MARGIN_MS < ACCESS_TOKEN_TTL_MS / 2);
  assert.ok(WORKER_PERIOD_MS < REFRESH_MARGIN_MS);
});

test('en el arriendo cabe al menos una conexion entera', () => {
  // Si no cupiera, el lote se cortaria siempre en la primera fila y el
  // worker no avanzaria nunca.
  assert.ok(LEASE_MS >= PER_CONNECTION_BUDGET_MS * 2);
});

test('se refresca ANTES de caducar, no al caducar', () => {
  const caducaEn = (ms: number): Date => new Date(AHORA.getTime() + ms);

  assert.equal(isDue(caducaEn(30 * 60_000), AHORA), false, 'recien rotado');
  assert.equal(isDue(caducaEn(11 * 60_000), AHORA), false, 'fuera del margen por poco');
  assert.equal(isDue(caducaEn(9 * 60_000), AHORA), true, 'dentro del margen');
  assert.equal(isDue(caducaEn(-60_000), AHORA), true, 'ya caducado');
  assert.equal(refreshDueBefore(AHORA).getTime(), AHORA.getTime() + REFRESH_MARGIN_MS);
});

test('sin fecha de caducidad se refresca: no saber es tratarlo como vencido', () => {
  // Un refresco de mas gasta una llamada. Uno de menos deja la sucursal
  // sin token.
  assert.equal(isDue(null, AHORA), true);
});

test('la caducidad la dice Clover, salvo que diga una imposible', () => {
  const enUnaHora = Math.floor((AHORA.getTime() + 3_600_000) / 1000);
  assert.equal(accessTokenExpiryFrom(enUnaHora, AHORA).getTime(), enUnaHora * 1000);

  // Sin campo: la vida documentada.
  assert.equal(
    accessTokenExpiryFrom(undefined, AHORA).getTime(),
    AHORA.getTime() + ACCESS_TOKEN_TTL_MS,
  );

  // Una fecha ya pasada haria que el worker refrescase en cada vuelta,
  // con un token que en realidad sirve: un bucle contra Clover.
  const haceUnaHora = Math.floor((AHORA.getTime() - 3_600_000) / 1000);
  assert.equal(
    accessTokenExpiryFrom(haceUnaHora, AHORA).getTime(),
    AHORA.getTime() + ACCESS_TOKEN_TTL_MS,
  );
});

test('la caducidad del refresh no se inventa si no viene', () => {
  assert.equal(refreshTokenExpiryFrom(undefined), null);
  assert.equal(refreshTokenExpiryFrom(1_800_000_000)?.getTime(), 1_800_000_000_000);
});

test('el backoff crece y tiene techo', () => {
  assert.equal(failureBackoffMs(1), 60_000);
  assert.equal(failureBackoffMs(2), 120_000);
  assert.equal(failureBackoffMs(3), 240_000);
  // El techo importa: sin el, una conexion rota una semana volveria a
  // intentarlo dentro de un mes, y el merchant que la arregla no veria
  // nada moverse.
  assert.equal(failureBackoffMs(50), 30 * 60_000);
  assert.equal(failureBackoffMs(0), 60_000);
});

test('la ventana vencida solo AVISA: quien decide es la cabecera', () => {
  // Esta funcion no decide nada. Se comprueba lo que informa, y en
  // `worker.test.ts` se comprueba que con la ventana vencida el worker
  // intenta la recuperacion igualmente.
  assert.equal(recoveryWindowLooksClosed(null, AHORA), true);
  assert.equal(recoveryWindowLooksClosed(new Date(AHORA.getTime() - 1), AHORA), true);
  assert.equal(recoveryWindowLooksClosed(new Date(AHORA.getTime() + 60_000), AHORA), false);
});
