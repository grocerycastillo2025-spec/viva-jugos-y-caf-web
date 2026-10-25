/**
 * @juicebar/workers
 *
 * Los trabajos que no caben en una Edge Function porque necesitan
 * durabilidad, backoff y exclusion mutua (§6 de la arquitectura). Los
 * dispara pg_cron; aqui vive la logica, no el cableado.
 *
 *   token-refresh   rota los tokens de OAuth antes de que caduquen, y
 *                   sabe volver de un par perdido con el token de
 *                   recuperacion de Clover.
 *   catalog-sync    espeja el catalogo de Clover, bajo demanda. Clover
 *                   manda; nosotros no escribimos catalogo nunca.
 *   checkout        crea el pedido en Clover y lo cobra, en ese orden y
 *                   bajo una sola idempotencia. Si el cobro falla, anula
 *                   la orden: lo contrario deja dinero cobrado sin pedido.
 */
export * from './catalog-sync/index.ts';
export * from './checkout/index.ts';
export * from './token-refresh/index.ts';
