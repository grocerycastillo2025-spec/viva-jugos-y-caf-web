/**
 * Sincronización de catálogo Clover -> Supabase.
 *
 * Empezar por `docs/SINCRONIZACION-CATALOGO.md`, que es el contrato del
 * mapeo, y después por `sweep.ts`. La regla que gobierna todo:
 * `app_item_overrides` no se nombra en ningún sitio de este directorio.
 */
export * from './mapping.ts';
export * from './ports.ts';
export * from './postgres.ts';
export * from './report.ts';
export * from './sweep.ts';
