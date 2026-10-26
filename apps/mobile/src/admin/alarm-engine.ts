/**
 * Motor de la alarma (navegador): WebAudio para los sonidos incluidos,
 * <audio> para el sonido propio, vibración y pantalla encendida.
 *
 * REGLAS DEL NAVEGADOR QUE NO SE PUEDEN SALTAR
 *  - No deja sonar nada hasta que la persona toca la página una vez. Por
 *    eso el panel enseña "Toca para activar la alarma" hasta que se toca.
 *  - Vibrar solo funciona en Android (Chrome). El iPhone no lo permite a
 *    páginas web.
 *  - Con la pantalla apagada el navegador duerme la página. "Mantener
 *    pantalla encendida" (Wake Lock) lo evita mientras el panel está
 *    abierto; es lo indicado para la tablet o el celular del mostrador.
 */

import { Platform } from 'react-native';

import { VIBRATION_PATTERN, type AlarmSound } from '../domain/alarm';

const web = Platform.OS === 'web' && typeof window !== 'undefined';

let ctx: AudioContext | null = null;
let unlocked = false;
let customEl: HTMLAudioElement | null = null;
let customSrc: string | null = null;
const listeners = new Set<(v: boolean) => void>();

function audioContext(): AudioContext | null {
  if (!web) return null;
  if (ctx !== null) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Ctor === undefined) return null;
  ctx = new Ctor();
  return ctx;
}

export function isAlarmUnlocked(): boolean {
  return unlocked;
}

export function onAlarmUnlock(fn: (v: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Llamar desde un toque: habilita el audio para el resto de la visita. */
export async function unlockAlarm(customUrl: string | null): Promise<void> {
  const c = audioContext();
  if (c === null) return;
  try {
    await c.resume();
    // Un sonido mudo de un instante "despierta" el audio en iPhone.
    const buffer = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(c.destination);
    src.start(0);
    if (customUrl !== null) {
      const el = customAudio(customUrl);
      el.muted = true;
      await el.play().catch(() => undefined);
      el.pause();
      el.muted = false;
      el.currentTime = 0;
    }
    unlocked = c.state === 'running';
  } catch {
    unlocked = false;
  }
  listeners.forEach((fn) => fn(unlocked));
}

function customAudio(url: string): HTMLAudioElement {
  if (customEl === null || customSrc !== url) {
    customEl = new Audio(url);
    customEl.preload = 'auto';
    customSrc = url;
  }
  return customEl;
}

function tone(
  c: AudioContext,
  freq: number,
  start: number,
  duration: number,
  volume: number,
  type: OscillatorType,
): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  osc.connect(gain);
  gain.connect(c.destination);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function playBuiltin(sound: Exclude<AlarmSound, 'custom'>, volume: number): void {
  const c = audioContext();
  if (c === null) return;
  const t0 = c.currentTime + 0.02;
  const v = 0.9 * volume;
  if (sound === 'campana') {
    // Tres campanadas brillantes.
    for (let i = 0; i < 3; i += 1) {
      tone(c, 1046, t0 + i * 0.45, 0.6, v, 'sine');
      tone(c, 1568, t0 + i * 0.45, 0.45, v * 0.5, 'sine');
    }
  } else if (sound === 'timbre') {
    // Ding-dong dos veces.
    for (let i = 0; i < 2; i += 1) {
      tone(c, 988, t0 + i * 1.0, 0.5, v, 'triangle');
      tone(c, 784, t0 + i * 1.0 + 0.45, 0.6, v, 'triangle');
    }
  } else {
    // Sirena: sube y baja, cuadrada (la que más se oye con ruido).
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'square';
    osc.connect(gain);
    gain.connect(c.destination);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * 0.35), t0 + 0.05);
    for (let i = 0; i < 4; i += 1) {
      osc.frequency.setValueAtTime(700, t0 + i * 0.5);
      osc.frequency.linearRampToValueAtTime(1300, t0 + i * 0.5 + 0.25);
      osc.frequency.linearRampToValueAtTime(700, t0 + i * 0.5 + 0.5);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.0);
    osc.start(t0);
    osc.stop(t0 + 2.05);
  }
}

/** Suena una vez (y vibra). */
export function ringOnce(
  sound: AlarmSound,
  volume: number,
  customUrl: string | null,
  vibrate: boolean,
): void {
  if (!web) return;
  try {
    if (sound === 'custom' && customUrl !== null) {
      const el = customAudio(customUrl);
      el.volume = Math.min(1, Math.max(0, volume));
      el.currentTime = 0;
      void el.play().catch(() => playBuiltin('campana', volume));
    } else if (sound !== 'custom') {
      playBuiltin(sound, volume);
    }
  } catch {
    // Sin audio el pedido igual se ve en pantalla.
  }
  if (vibrate && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([...VIBRATION_PATTERN]);
  }
}

export function canVibrate(): boolean {
  return web && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

// ---------------------------------------------------------------------
// Pantalla encendida
// ---------------------------------------------------------------------

interface Sentinel {
  release(): Promise<void>;
}
let sentinel: Sentinel | null = null;
let wantAwake = false;

async function acquire(): Promise<void> {
  const wl = (navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } })
    .wakeLock;
  if (wl === undefined || sentinel !== null) return;
  try {
    sentinel = await wl.request('screen');
    (
      sentinel as unknown as { addEventListener?: (e: string, f: () => void) => void }
    ).addEventListener?.('release', () => {
      sentinel = null;
    });
  } catch {
    sentinel = null;
  }
}

export function canKeepAwake(): boolean {
  return web && 'wakeLock' in navigator;
}

export function keepScreenAwake(on: boolean): void {
  if (!web) return;
  wantAwake = on;
  if (on) void acquire();
  else if (sentinel !== null) {
    void sentinel.release().catch(() => undefined);
    sentinel = null;
  }
}

if (web) {
  // Al volver a la pestaña el navegador suelta el bloqueo: se pide otra vez.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wantAwake) void acquire();
  });
}
