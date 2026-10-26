/**
 * Alarma de pedidos nuevos: ajustes y reglas. Módulo puro.
 */

export type BuiltinSound = 'campana' | 'timbre' | 'sirena';
export type AlarmSound = BuiltinSound | 'custom';

export interface AlarmSettings {
  readonly enabled: boolean;
  readonly sound: AlarmSound;
  /** 0.5 medio, 0.8 alto, 1 máximo. */
  readonly volume: number;
  /** Cada cuántos segundos vuelve a sonar mientras haya pedidos nuevos. */
  readonly everySeconds: number;
  readonly vibrate: boolean;
  readonly keepAwake: boolean;
}

export const DEFAULT_ALARM: AlarmSettings = {
  enabled: true,
  sound: 'campana',
  volume: 1,
  everySeconds: 8,
  vibrate: true,
  keepAwake: true,
};

export const VOLUMES = [0.5, 0.8, 1] as const;
export const INTERVALS = [5, 8, 15, 30] as const;

/** Lee ajustes guardados, ignorando lo que no tenga forma válida. */
export function parseAlarmSettings(raw: string | null): AlarmSettings {
  if (raw === null) return DEFAULT_ALARM;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof AlarmSettings, unknown>>;
    const sound = v.sound;
    return {
      enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_ALARM.enabled,
      sound: sound === 'campana' || sound === 'timbre' || sound === 'sirena' || sound === 'custom' ? sound : DEFAULT_ALARM.sound,
      volume: typeof v.volume === 'number' && v.volume > 0 && v.volume <= 1 ? v.volume : DEFAULT_ALARM.volume,
      everySeconds:
        typeof v.everySeconds === 'number' && v.everySeconds >= 3 && v.everySeconds <= 120 ? v.everySeconds : DEFAULT_ALARM.everySeconds,
      vibrate: typeof v.vibrate === 'boolean' ? v.vibrate : DEFAULT_ALARM.vibrate,
      keepAwake: typeof v.keepAwake === 'boolean' ? v.keepAwake : DEFAULT_ALARM.keepAwake,
    };
  } catch {
    return DEFAULT_ALARM;
  }
}

/** El sonido que de verdad se toca: "custom" sin archivo cae a la campana. */
export function effectiveSound(settings: AlarmSettings, customUrl: string | null): AlarmSound {
  return settings.sound === 'custom' && (customUrl === null || customUrl === '') ? 'campana' : settings.sound;
}

/** Pedidos que hacen sonar la alarma: los nuevos que nadie ha empezado. */
export function pendingNewOrders<T extends { readonly status: string }>(orders: readonly T[]): T[] {
  return orders.filter((o) => o.status === 'confirmed');
}

/** Patrón de vibración "fuerte": largo-corto-largo. */
export const VIBRATION_PATTERN: readonly number[] = [600, 150, 600, 150, 900];
