/**
 * @juicebar/clover-client
 *
 * Cliente tipado de Clover, aislado del backend a proposito: permite
 * testear la integracion contra el sandbox sin levantar Supabase, y es la
 * frontera que habra que cruzar el dia que entre un segundo POS.
 *
 * Lo que este paquete garantiza, por construccion y no por disciplina:
 *
 *   - ninguna peticion se salta el rate limiter compartido de la app;
 *   - ningun POST no idempotente se reintenta;
 *   - ningun error saca un token en el mensaje;
 *   - ninguna url se escribe a mano en el codigo de negocio;
 *   - no hay un solo metodo que escriba catalogo, ni que cobre fuera de
 *     una orden.
 *
 * Cada endpoint esta contrastado con la documentacion oficial y anotado en
 * `docs/CLOVER-ENDPOINTS.md`, con su fuente y lo que queda por confirmar
 * contra el sandbox. Lo que no pude verificar NO esta implementado.
 */
export * from './rate-limit.ts';
export * from './environments.ts';
export * from './errors.ts';
export * from './pagination.ts';
export * from './surcharge.ts';
export * from './onboarding.ts';
export * from './types.ts';
export * from './http.ts';
export * from './client.ts';
export { CloverOAuth, type AuthorizeUrlParams } from './endpoints/oauth.ts';
export { CloverMerchants } from './endpoints/merchants.ts';
export { CloverInventory, type ListOptions } from './endpoints/inventory.ts';
export {
  CloverOrders,
  type CartLineItem,
  type CartModification,
  type OrderCart,
} from './endpoints/orders.ts';
export { CloverEcommerce } from './endpoints/ecommerce.ts';
