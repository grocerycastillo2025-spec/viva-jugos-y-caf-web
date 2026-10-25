/**
 * Crear y cobrar un pedido contra Clover.
 *
 * Empezar por `docs/PEDIDOS-COBRO.md` y despues por `maquina.ts`, que es
 * donde el orden de operaciones esta escrito como un tipo. La regla que
 * gobierna todo: la orden se crea ANTES de cobrar, y si el cobro falla se
 * anula.
 */
export * from './flujo.ts';
export * from './maquina.ts';
export * from './ports.ts';
export * from './postgres.ts';
