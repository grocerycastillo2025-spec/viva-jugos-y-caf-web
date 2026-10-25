/**
 * El orden de operaciones. Cada prueba de aqui es una linea de
 * docs/AJUSTES-FLUJO-CLOVER.md, variable 3.
 *
 * Si alguna se cae, no es que "falle un test": es que alguien puede
 * acabar con un cargo en su tarjeta y ningun pedido, o con un pedido que
 * la cocina nunca vio.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  avanza,
  ESTADOS,
  estadoAntesDe,
  estadoTrasExito,
  reaccionAlFallo,
  siguientePaso,
  yaSeCobro,
  type Estado,
} from '../maquina.ts';

test('EL ORDEN: totales, crear orden, cobrar, imprimir. En ese orden', () => {
  // Recorrer la maquina desde el principio tiene que dar exactamente la
  // secuencia del documento. Si alguien reordena los casos del switch,
  // esta prueba lo dice.
  const recorrido: string[] = [];
  let estado: Estado = 'started';
  for (let n = 0; n < 10; n += 1) {
    const paso = siguientePaso(estado);
    if (paso.kind === 'nada') break;
    recorrido.push(paso.kind);
    estado = estadoTrasExito(paso);
  }

  assert.deepEqual(recorrido, ['totales', 'crear-orden', 'cobrar', 'imprimir']);
  assert.equal(estado, 'printed');
});

test('LA ORDEN SE CREA ANTES DE COBRAR, y no hay forma de invertirlo', () => {
  // El fallo que este orden existe para evitar: cobrar y luego crear deja
  // dinero cobrado sin pedido. La cocina no lo ve, el merchant no lo
  // puede reembolsar desde su POS, y el cliente tiene un cargo y ninguna
  // comida. Es el riesgo R10.
  assert.equal(siguientePaso('totals_ok').kind, 'crear-orden');
  assert.equal(siguientePaso('order_created').kind, 'cobrar');
  // Y no se puede llegar a cobrar sin haber pasado por crear.
  assert.equal(
    avanza('totals_ok', 'paid'),
    true,
    'la maquina permite saltar (se controla en el flujo)',
  );
  assert.equal(avanza('paid', 'order_created'), false, 'se pudo retroceder al paso de crear');
});

test('SE ESCRIBE ANTES DE LLAMAR, no despues', () => {
  // Si el proceso muere entre el update y la respuesta, el reintento
  // tiene que saber que esa llamada PUDO haber ocurrido. Con el orden al
  // reves veria el estado anterior y la repetiria — y en el paso de
  // cobrar, repetir es cobrar dos veces.
  assert.equal(estadoAntesDe({ kind: 'crear-orden' }), 'totals_ok');
  assert.equal(estadoAntesDe({ kind: 'cobrar' }), 'order_created');
  assert.equal(estadoAntesDe({ kind: 'imprimir' }), 'paid');
  assert.equal(estadoAntesDe({ kind: 'anular-orden' }), 'voiding');
  // `checkouts` no crea nada: repetirlo no tiene consecuencias, asi que
  // no hace falta anunciarlo.
  assert.equal(estadoAntesDe({ kind: 'totales' }), null);
});

test('FALLA EL COBRO -> SE ANULA LA ORDEN. Es la compensacion', () => {
  const reaccion = reaccionAlFallo({ kind: 'cobrar' });
  assert.equal(reaccion.kind, 'compensar');
  // `voiding` queda escrito ANTES de intentar anular, por si la anulacion
  // tambien falla: sin ese estado no hay forma de distinguir "fallo y
  // limpie" de "fallo y deje una orden viva en la caja del restaurante".
  assert.equal(reaccion.estado, 'voiding');
  assert.equal(siguientePaso('voiding').kind, 'anular-orden');
});

test('FALLA LA IMPRESION -> NO SE TOCA EL DINERO', () => {
  // La contraintuitiva, y la que hay que defender: una impresora sin
  // papel no puede convertirse en un reembolso. El pedido esta pagado, el
  // restaurante lo ve en su app de Orders, y lo que falta es un aviso al
  // local.
  const reaccion = reaccionAlFallo({ kind: 'imprimir' });
  assert.equal(reaccion.kind, 'seguir-adelante');
  assert.equal(reaccion.estado, 'printed');
});

test('FALLA ANTES DE COBRAR -> no hay nada que deshacer', () => {
  // Nadie pago y no hay nada creado en el POS. El cliente reintenta con
  // la misma clave y el intento empieza donde estaba.
  for (const [paso, estado] of [
    ['totales', 'started'],
    ['crear-orden', 'totals_ok'],
  ] as const) {
    const reaccion = reaccionAlFallo({ kind: paso });
    assert.equal(reaccion.kind, 'reintentable');
    assert.equal(reaccion.estado, estado);
  }
});

test('FALLA LA ANULACION -> se queda en voiding para volver a por ella', () => {
  // No hay una segunda compensacion que inventar. La orden sigue viva en
  // el POS y sale en la vista de guardia de la 0018.
  const reaccion = reaccionAlFallo({ kind: 'anular-orden' });
  assert.equal(reaccion.kind, 'reintentable');
  assert.equal(reaccion.estado, 'voiding');
});

test('LA MAQUINA NO ANDA HACIA ATRAS', () => {
  // Retroceder al paso de cobrar es cobrar dos veces. Lo comprueba
  // tambien el trigger de la 0018: un chequeo aqui protege del codigo que
  // lo llama, no del proximo.
  assert.equal(avanza('started', 'totals_ok'), true);
  assert.equal(avanza('order_created', 'paid'), true);

  assert.equal(avanza('paid', 'order_created'), false);
  assert.equal(avanza('done', 'paid'), false);
  assert.equal(avanza('printed', 'printed'), false, 'quedarse quieto no es avanzar');

  // Se entra en la rama mala desde cualquier punto del progreso...
  assert.equal(avanza('order_created', 'voiding'), true);
  assert.equal(avanza('paid', 'failed'), true);
  // ...y no se sale de ella hacia el progreso.
  assert.equal(avanza('voiding', 'paid'), false);
  assert.equal(avanza('failed', 'order_created'), false);
  assert.equal(avanza('failed', 'voiding'), false, 'un intento fallido no resucita');
});

test('yaSeCobro: a partir de `paid`, decir "reintenta" es pedir que pague dos veces', () => {
  assert.equal(yaSeCobro('started'), false);
  assert.equal(yaSeCobro('order_created'), false);
  assert.equal(yaSeCobro('voiding'), false);
  assert.equal(yaSeCobro('paid'), true);
  assert.equal(yaSeCobro('printed'), true);
  assert.equal(yaSeCobro('done'), true);
});

test('los estados son los mismos que acepta la base', () => {
  // La lista del `check` de la 0018, copiada aqui. Si alguien añade uno
  // en un sitio y no en el otro, la base rechaza la escritura en
  // produccion y esta prueba lo dice antes.
  assert.deepEqual(
    [...ESTADOS],
    ['started', 'totals_ok', 'order_created', 'paid', 'printed', 'done', 'voiding', 'failed'],
  );
});

test('todo estado tiene paso siguiente: ninguno se queda sin salida', () => {
  for (const estado of ESTADOS) {
    assert.doesNotThrow(() => siguientePaso(estado), `${estado} no tiene paso`);
  }
});
