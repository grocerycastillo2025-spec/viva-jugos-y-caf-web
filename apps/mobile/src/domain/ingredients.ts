/**
 * Qué productos y opciones proponer al apagar o prender un ingrediente.
 * Módulo puro.
 */

export interface ImpactLike {
  readonly items: readonly { id: string; available: boolean; other_missing: readonly string[] }[];
  readonly modifiers: readonly { id: string; available: boolean }[];
}

/**
 * Al apagar: se proponen (marcados) los que hoy están disponibles.
 * Al prender: los que están apagados y ya no les falta ningún otro
 * ingrediente; los que aún esperan otro se muestran sin marcar.
 */
export function defaultSelection(impact: ImpactLike, turningOn: boolean): { items: string[]; modifiers: string[] } {
  if (!turningOn) {
    return {
      items: impact.items.filter((i) => i.available).map((i) => i.id),
      modifiers: impact.modifiers.filter((m) => m.available).map((m) => m.id),
    };
  }
  return {
    items: impact.items.filter((i) => !i.available && i.other_missing.length === 0).map((i) => i.id),
    modifiers: impact.modifiers.filter((m) => !m.available).map((m) => m.id),
  };
}

/** Los que vale la pena enseñar: al apagar, los disponibles; al prender, los apagados. */
export function relevant<T extends { available: boolean }>(rows: readonly T[], turningOn: boolean): T[] {
  return rows.filter((r) => (turningOn ? !r.available : r.available));
}

export function toggleId(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}
