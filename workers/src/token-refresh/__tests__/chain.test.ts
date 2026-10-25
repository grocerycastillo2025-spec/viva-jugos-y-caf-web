/**
 * La cadena de recuperacion. Estas pruebas son la regla.
 *
 * Cada una corresponde a una linea de la tabla de
 * `docs/CLOVER-ENDPOINTS.md` y a un aviso escrito en las migraciones 0012
 * y 0016. Si alguna se cae, no es que "falle un test": es que la conexion
 * de un merchant se queda sin red justo despues del susto en el que se
 * uso.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chainViolation,
  CONSERVAR_TOKEN_RECUPERACION_DESPLAZADO,
  planChain,
  secretosObsoletos,
  type ChainInput,
  type ChainState,
} from '../chain.ts';
import { RECOVERY_WINDOW_MS } from '../policy.ts';

const AHORA = new Date('2026-09-03T12:00:00.000Z');

// Los ids son los de la documentacion: A el refresh vigente, B el que
// Clover acaba de emitir, Z el de recuperacion anterior.
const A = 'secreto-A';
const B = 'secreto-B';
const C = 'secreto-C';
const Z = 'secreto-Z';

test('REFRESCO A->B: el de recuperacion pasa a ser A, y la ventana empieza', () => {
  const plan = planChain({
    path: 'refresh',
    before: {
      refreshTokenSecretId: A,
      recoveryTokenSecretId: Z,
      recoveryTokenExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
    },
    sentSecretId: A, // se mando A
    newRefreshSecretId: B,
    now: AHORA,
  });

  assert.equal(plan.recovery.kind, 'apuntar');
  assert.equal(plan.recovery.kind === 'apuntar' && plan.recovery.secretId, A);
  assert.equal(
    plan.recovery.kind === 'apuntar' && plan.recovery.expiresAt.getTime(),
    AHORA.getTime() + RECOVERY_WINDOW_MS,
  );
});

test('REFRESCO A->B: NO se borra A. Es la red que se acaba de crear', () => {
  // El reflejo natural al rotar es limpiar el secreto anterior, y hacerlo
  // aqui destruye la red en el mismo instante en que se crea.
  const plan = planChain({
    path: 'refresh',
    before: {
      refreshTokenSecretId: A,
      recoveryTokenSecretId: Z,
      recoveryTokenExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
    },
    sentSecretId: A,
    newRefreshSecretId: B,
    now: AHORA,
  });

  assert.ok(!plan.obsoleteSecretIds.includes(A), 'se borro el token de recuperacion');
});

// ── LAS DOS REGLAS DE CLOVER, UNA POR RUTA (aclarado 2026-09-16) ────
//
// Durante unos dias parecio que Clover se habia contradicho. No: las dos
// respuestas hablaban de ENDPOINTS DISTINTOS. Estas tres pruebas dicen
// cada regla con las palabras de la aclaracion, en vez de una sola que
// las mezclaba.
//
//   "Persist the most recently consumed refresh token during standard
//    daily refreshes. Only retain Token A as the recovery token when a
//    recovery flow is specifically triggered."

test('/refresh: la recuperacion pasa a ser EL MAS RECIENTEMENTE CONSUMIDO', () => {
  // Una llamada que triunfa CONSUME lo que mando, asi que "el que se
  // mando" y "el mas recientemente consumido" son el mismo token. Aqui se
  // manda A y se recibe B: la recuperacion queda en A, no en B.
  const plan = planChain({
    path: 'refresh',
    before: { refreshTokenSecretId: A, recoveryTokenSecretId: Z, recoveryTokenExpiresAt: AHORA },
    sentSecretId: A,
    newRefreshSecretId: B,
    now: AHORA,
  });

  assert.equal(plan.recovery.kind === 'apuntar' && plan.recovery.secretId, A);
  assert.notEqual(plan.recovery.kind === 'apuntar' && plan.recovery.secretId, B);
  // Y NO se queda en Z, que es lo que diria "no tocar la recuperacion".
  assert.notEqual(plan.recovery.kind === 'apuntar' && plan.recovery.secretId, Z);
});

test('/recovery: el Token A ORIGINAL sigue siendo el de recuperacion', () => {
  // "Only retain Token A ... when a recovery flow is specifically
  // triggered". La fila viene de perder el par B; se recupera con A y
  // sale C. La recuperacion sigue en A, y B muere.
  const plan = planChain({
    path: 'recovery',
    before: { refreshTokenSecretId: B, recoveryTokenSecretId: A, recoveryTokenExpiresAt: AHORA },
    sentSecretId: A,
    newRefreshSecretId: C,
    now: AHORA,
  });

  assert.equal(plan.recovery.kind === 'apuntar' && plan.recovery.secretId, A);
  // Y no pasa a ser C, que seria aplicar la regla de /refresh en la ruta
  // equivocada — el error que la aclaracion deshace.
  assert.notEqual(plan.recovery.kind === 'apuntar' && plan.recovery.secretId, C);
});

test('/recovery: en esa ruta NO EXISTE un token distinto de A que llegue aqui', () => {
  // Es lo que hace que una sola linea valga para las dos reglas, y hay
  // que tenerlo presente antes de tocar `planChain`: el endpoint de
  // recuperacion solo acepta el Token A, asi que cualquier otro candidato
  // se lleva un 401 y no llega a escribirse nada (ver el bucle de
  // candidatos en `worker.ts`).
  //
  // Dicho de otro modo: `sentSecretId` en la ruta de recuperacion ES A,
  // venga de `recovery_token_secret_id` o del que teniamos por vigente.
  // Las dos formas en que puede llegar dan el mismo resultado.
  const desdeElApuntado = planChain({
    path: 'recovery',
    before: { refreshTokenSecretId: B, recoveryTokenSecretId: A, recoveryTokenExpiresAt: AHORA },
    sentSecretId: A,
    newRefreshSecretId: C,
    now: AHORA,
  });
  const desdeElVigente = planChain({
    path: 'recovery',
    // El accidente: mandamos A a /refresh, Clover emitio B y nos caimos
    // antes de guardarlo. La fila sigue diciendo vigente = A.
    before: { refreshTokenSecretId: A, recoveryTokenSecretId: Z, recoveryTokenExpiresAt: AHORA },
    sentSecretId: A,
    newRefreshSecretId: C,
    now: AHORA,
  });

  for (const plan of [desdeElApuntado, desdeElVigente]) {
    assert.equal(plan.recovery.kind === 'apuntar' && plan.recovery.secretId, A);
  }
});

test('LA VENTANA se reancla al par nuevo POR LAS DOS RUTAS', () => {
  // En /refresh porque nace un par; en /recovery porque la aclaracion lo
  // dice con esas palabras: "la ventana de dos semanas se reancla a la
  // creacion de C".
  for (const path of ['refresh', 'recovery'] as const) {
    const plan = planChain({
      path,
      before: {
        refreshTokenSecretId: B,
        recoveryTokenSecretId: A,
        // Una ventana vieja, de hace una semana.
        recoveryTokenExpiresAt: new Date(AHORA.getTime() - 7 * 24 * 60 * 60_000),
      },
      sentSecretId: A,
      newRefreshSecretId: C,
      now: AHORA,
    });
    assert.equal(
      plan.recovery.kind === 'apuntar' && plan.recovery.expiresAt.getTime(),
      AHORA.getTime() + RECOVERY_WINDOW_MS,
      `${path} no reanclo la ventana`,
    );
  }
});

// ── EL SEGURO TEMPORAL ──────────────────────────────────────────────

test('EL SEGURO: el token de recuperacion desplazado NO se borra', () => {
  // Z se queda huerfano en Vault en vez de destruirse. Ojo al motivo: ya
  // no es "Clover no ha aclarado" —lo aclaro el 2026-09-16 y el borrado
  // ES correcto— sino que `/oauth/v2/recovery` no se ha ejercido nunca de
  // verdad. El costo de equivocarse no es simetrico: un huerfano se
  // limpia con un barrido; un borrado de mas se arregla reconectando
  // merchants uno por uno.
  assert.equal(CONSERVAR_TOKEN_RECUPERACION_DESPLAZADO, true);

  const plan = planChain({
    path: 'refresh',
    before: {
      refreshTokenSecretId: A,
      recoveryTokenSecretId: Z,
      recoveryTokenExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
    },
    sentSecretId: A,
    newRefreshSecretId: B,
    now: AHORA,
  });

  assert.deepEqual(plan.obsoleteSecretIds, [], 'se borro el desplazado con el seguro puesto');
});

test('EL SEGURO no salva a B: ahi las dos respuestas de Clover coinciden', () => {
  // En una recuperacion A->C, B es el refresh del par que se perdio. Las
  // dos respuestas dicen que queda invalido, asi que no hay nada que
  // decidir y guardarlo seria basura sin contrapartida.
  const plan = planChain({
    path: 'recovery',
    before: { refreshTokenSecretId: B, recoveryTokenSecretId: A, recoveryTokenExpiresAt: AHORA },
    sentSecretId: A,
    newRefreshSecretId: C,
    now: AHORA,
  });

  assert.deepEqual(plan.obsoleteSecretIds, [B]);
});

test('AL REVERTIR: con el seguro quitado, el desplazado se vuelve a borrar', () => {
  // Esta prueba es para el dia que llegue la aclaracion. Poner la
  // constante a `false` es toda la reversion, y esto fija que el camino
  // que vuelve sigue siendo el correcto: asi nadie estrena un camino sin
  // probar tres meses despues.
  const antes: ChainState = {
    refreshTokenSecretId: A,
    recoveryTokenSecretId: Z,
    recoveryTokenExpiresAt: AHORA,
  };

  assert.deepEqual(secretosObsoletos(antes, A, B, false), [Z]);
  assert.deepEqual(secretosObsoletos(antes, A, B, true), []);
  // Y en los dos casos, lo que se acaba de mandar sigue a salvo.
  for (const seguro of [true, false]) {
    assert.ok(!secretosObsoletos(antes, A, B, seguro).includes(A));
  }
});

test('RECUPERACION A->C con A apuntado: el de recuperacion SIGUE siendo A', () => {
  // El caso literal de la documentacion: "Token A remains the recovery
  // token for Token C, and Token B becomes invalid".
  const plan = planChain({
    path: 'recovery',
    before: {
      refreshTokenSecretId: B, // el par que se perdio
      recoveryTokenSecretId: A,
      recoveryTokenExpiresAt: new Date('2026-09-10T00:00:00.000Z'),
    },
    sentSecretId: A, // se recupero con A
    newRefreshSecretId: C,
    now: AHORA,
  });

  assert.equal(plan.recovery.kind, 'apuntar');
  assert.equal(plan.recovery.kind === 'apuntar' && plan.recovery.secretId, A);
  // Y B muere.
  assert.deepEqual(plan.obsoleteSecretIds, [B]);
});

test('RECUPERACION: la ventana SE REANCLA al par nuevo', () => {
  // Esto era exactamente al reves hasta la 0016, y no por descuido: la
  // documentacion publica admite las dos lecturas y se tomo la pesimista
  // porque no se podia medir. Developer Relations de Clover confirmo que
  // la ventana se ancla a la hora de creacion de cada par nuevo, venga
  // del endpoint que venga.
  //
  // Lo que costaba la lectura vieja: una conexion que vive de
  // recuperaciones encadenadas arrastraba una fecha cada vez mas vieja,
  // el SaaS la ensenaba vencida, y el operador llamaba al restaurante a
  // rehacer un OAuth que no hacia falta.
  const ventanaVieja = new Date('2026-09-05T00:00:00.000Z'); // quedaban 2 dias
  const plan = planChain({
    path: 'recovery',
    before: {
      refreshTokenSecretId: B,
      recoveryTokenSecretId: A,
      recoveryTokenExpiresAt: ventanaVieja,
    },
    sentSecretId: A,
    newRefreshSecretId: C,
    now: AHORA,
  });

  assert.equal(plan.recovery.kind, 'apuntar');
  assert.equal(
    plan.recovery.kind === 'apuntar' && plan.recovery.expiresAt.getTime(),
    AHORA.getTime() + RECOVERY_WINDOW_MS,
  );
  // El puntero no se movio, la fecha si. Son dos reglas distintas y esta
  // prueba es la unica que las separa.
  assert.equal(plan.recovery.kind === 'apuntar' && plan.recovery.secretId, A);
});

test('RECUPERACION con el VIGENTE: repunta al que se mando', () => {
  // El accidente real: mandamos A a /refresh, Clover emitio B y nos
  // caimos antes de guardarlo. La fila sigue diciendo vigente = A,
  // recuperacion = Z (muerto). Se recupera con A, que es lo que Clover
  // tiene como token de recuperacion.
  const antes: ChainState = {
    refreshTokenSecretId: A,
    recoveryTokenSecretId: Z,
    recoveryTokenExpiresAt: new Date('2026-09-06T00:00:00.000Z'),
  };

  const plan = planChain({
    path: 'recovery',
    before: antes,
    sentSecretId: A,
    newRefreshSecretId: C,
    now: AHORA,
  });

  // El de recuperacion es el que se mando: A. "El que acabo de sustituir"
  // habria escrito B, que en este camino ni siquiera llegamos a tener.
  assert.equal(plan.recovery.kind, 'apuntar');
  assert.equal(plan.recovery.kind === 'apuntar' && plan.recovery.secretId, A);
  assert.equal(
    plan.recovery.kind === 'apuntar' && plan.recovery.expiresAt.getTime(),
    AHORA.getTime() + RECOVERY_WINDOW_MS,
  );
  // Z ya no lo referencia nadie, pero NO se borra: es el token de
  // recuperacion desplazado, y el seguro del CLOVER-PENDING lo conserva
  // hasta que Clover aclare la contradiccion.
  assert.deepEqual(plan.obsoleteSecretIds, []);
  assert.deepEqual(secretosObsoletos(antes, A, C, false), [Z], 'al revertir, Z se borraria');
});

test('RECUPERACION sin ventana previa: se estrena una entera', () => {
  // Pasa en una conexion recien autorizada, que no tiene token anterior.
  // Antes de la 0016 aqui se declaraba CERO margen, porque heredar una
  // fecha que no existe no se podia. Ahora no hay nada que heredar: la
  // ventana cuelga del par nuevo, y el par nuevo acaba de nacer.
  const plan = planChain({
    path: 'recovery',
    before: {
      refreshTokenSecretId: A,
      recoveryTokenSecretId: null,
      recoveryTokenExpiresAt: null,
    },
    sentSecretId: A,
    newRefreshSecretId: C,
    now: AHORA,
  });

  assert.equal(plan.recovery.kind, 'apuntar');
  assert.equal(plan.recovery.kind === 'apuntar' && plan.recovery.secretId, A);
  assert.equal(
    plan.recovery.kind === 'apuntar' && plan.recovery.expiresAt.getTime(),
    AHORA.getTime() + RECOVERY_WINDOW_MS,
  );
  // Nada que borrar: A sigue referenciado como token de recuperacion.
  assert.deepEqual(plan.obsoleteSecretIds, []);
});

test('la PRIMERA rotacion de una conexion sin red no borra nada', () => {
  const plan = planChain({
    path: 'refresh',
    before: {
      refreshTokenSecretId: A,
      recoveryTokenSecretId: null,
      recoveryTokenExpiresAt: null,
    },
    sentSecretId: A,
    newRefreshSecretId: B,
    now: AHORA,
  });

  assert.equal(plan.recovery.kind, 'apuntar');
  assert.deepEqual(plan.obsoleteSecretIds, []);
});

test('EL SECRETO QUE SE ACABA DE MANDAR NO SE BORRA NUNCA, por ningun camino', () => {
  // La invariante que resume las anteriores, comprobada sobre todas las
  // combinaciones que se pueden dar. Y de paso: el puntero de
  // recuperacion nunca acaba en el par recien emitido, que es el fallo de
  // la familia de `applyInitialTokens`.
  const estados: ChainState[] = [
    { refreshTokenSecretId: A, recoveryTokenSecretId: null, recoveryTokenExpiresAt: null },
    { refreshTokenSecretId: A, recoveryTokenSecretId: Z, recoveryTokenExpiresAt: AHORA },
    { refreshTokenSecretId: B, recoveryTokenSecretId: A, recoveryTokenExpiresAt: AHORA },
  ];

  for (const antes of estados) {
    for (const path of ['refresh', 'recovery'] as const) {
      const enviables = [antes.refreshTokenSecretId, antes.recoveryTokenSecretId].filter(
        (id): id is string => id !== null,
      );
      for (const sentSecretId of enviables) {
        const entrada: ChainInput = {
          path,
          before: antes,
          sentSecretId,
          newRefreshSecretId: C,
          now: AHORA,
        };
        const plan = planChain(entrada);
        assert.ok(
          !plan.obsoleteSecretIds.includes(sentSecretId),
          `${path} con ${sentSecretId} borro el token que acababa de mandar`,
        );
        // Con el seguro quitado tambien: la invariante no depende de el.
        assert.ok(
          !secretosObsoletos(antes, sentSecretId, C, false).includes(sentSecretId),
          `${path} con ${sentSecretId} lo borraria al revertir el seguro`,
        );
        assert.equal(
          chainViolation(entrada, plan),
          null,
          `${path} con ${sentSecretId} rompio la cadena`,
        );
      }
    }
  }
});

test('el secreto nuevo nunca sale en la lista de borrado', () => {
  // Un fallo de aritmetica de conjuntos aqui borraria el token recien
  // creado, o sea la conexion, justo despues de guardarla.
  for (const path of ['refresh', 'recovery'] as const) {
    const plan = planChain({
      path,
      before: { refreshTokenSecretId: A, recoveryTokenSecretId: Z, recoveryTokenExpiresAt: AHORA },
      sentSecretId: A,
      newRefreshSecretId: B,
      now: AHORA,
    });
    assert.ok(!plan.obsoleteSecretIds.includes(B));
  }
});

test('chainViolation nombra las dos formas de romper la cadena', () => {
  // Ya no hay trigger detras (la 0016 quito el de la 0012), asi que esto
  // es lo unico que queda entre un plan mal calculado y la fila.
  const entrada: ChainInput = {
    path: 'recovery',
    before: { refreshTokenSecretId: B, recoveryTokenSecretId: A, recoveryTokenExpiresAt: AHORA },
    sentSecretId: A,
    newRefreshSecretId: C,
    now: AHORA,
  };

  assert.equal(chainViolation(entrada, planChain(entrada)), null);

  // Apuntar la recuperacion al par que se acaba de emitir: la fila
  // prometeria una red que Clover no reconoce.
  assert.equal(
    chainViolation(entrada, {
      path: 'recovery',
      recovery: { kind: 'apuntar', secretId: C, expiresAt: AHORA },
      obsoleteSecretIds: [],
    }),
    'recuperacion-apunta-al-par-nuevo',
  );

  // Borrar en Vault el secreto que acaba de convertirse en la red.
  assert.equal(
    chainViolation(entrada, {
      path: 'recovery',
      recovery: { kind: 'apuntar', secretId: A, expiresAt: AHORA },
      obsoleteSecretIds: [A],
    }),
    'se-borra-el-token-que-se-mando',
  );
});
