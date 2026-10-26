/**
 * Alarma de pedidos nuevos del panel.
 *
 * Suena (y vibra) en cuanto entra un pedido y vuelve a sonar cada N
 * segundos mientras haya pedidos "Nuevos" que nadie ha empezado. Se calla
 * sola cuando todos pasan a "En preparación" (o con "Silenciar 1 min").
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchAlertSound, setAlertSound, uploadImage } from '../api/admin';
import type { BrandColors } from '../domain/branding';
import {
  DEFAULT_ALARM,
  effectiveSound,
  INTERVALS,
  parseAlarmSettings,
  VOLUMES,
  type AlarmSettings,
  type AlarmSound,
} from '../domain/alarm';
import { useColors } from '../state/branding-context';
import { radius, spacing, type as typography } from '../theme';
import {
  canKeepAwake,
  canVibrate,
  isAlarmUnlocked,
  keepScreenAwake,
  onAlarmUnlock,
  ringOnce,
  unlockAlarm,
} from './alarm-engine';
import { pickAlarmSound } from './pick-image';
import { adminStrings } from './strings';
import { Card, Notice, Toggle } from './ui';

const t = adminStrings.alarm;
const KEY = 'viva.alarm.v1';
const web = Platform.OS === 'web' && typeof window !== 'undefined';

function readSettings(): AlarmSettings {
  try {
    return parseAlarmSettings(web ? window.localStorage.getItem(KEY) : null);
  } catch {
    return DEFAULT_ALARM;
  }
}
function writeSettings(s: AlarmSettings): void {
  try {
    if (web) window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // modo privado: solo dura esta visita
  }
}

export interface OrderAlarm {
  readonly settings: AlarmSettings;
  readonly setSettings: (next: AlarmSettings) => void;
  readonly unlocked: boolean;
  readonly customUrl: string | null;
  readonly setCustomUrl: (url: string | null) => void;
  readonly silencedUntil: number;
  readonly silence: (ms: number) => void;
  readonly test: () => void;
}

/** `pending`: números de los pedidos nuevos sin empezar. */
export function useOrderAlarm(storeId: string, pending: readonly number[]): OrderAlarm {
  const [settings, setSettingsState] = useState<AlarmSettings>(readSettings);
  const [unlocked, setUnlocked] = useState(isAlarmUnlocked());
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  const [silencedUntil, setSilencedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void fetchAlertSound(storeId).then(setCustomUrl);
  }, [storeId]);

  // Primer toque en cualquier parte de la página = alarma habilitada.
  useEffect(() => {
    const off = onAlarmUnlock(setUnlocked);
    if (!web) return off;
    const handler = (): void => void unlockAlarm(customUrl);
    window.addEventListener('pointerdown', handler, { once: true });
    window.addEventListener('keydown', handler, { once: true });
    return () => {
      off();
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
    };
  }, [customUrl]);

  useEffect(() => {
    keepScreenAwake(settings.enabled && settings.keepAwake);
    return () => keepScreenAwake(false);
  }, [settings.enabled, settings.keepAwake]);

  const setSettings = useCallback((next: AlarmSettings) => {
    setSettingsState(next);
    writeSettings(next);
  }, []);

  const sound: AlarmSound = effectiveSound(settings, customUrl);
  const key = pending.join(',');
  const silenced = silencedUntil > now;

  // Mientras haya pedidos nuevos: suena ya y luego cada N segundos.
  useEffect(() => {
    if (pending.length === 0 || !settings.enabled || !unlocked || silenced) return undefined;
    ringOnce(sound, settings.volume, customUrl, settings.vibrate);
    const id = setInterval(
      () => ringOnce(sound, settings.volume, customUrl, settings.vibrate),
      settings.everySeconds * 1000,
    );
    return () => clearInterval(id);
    // `key` cambia cuando llega otro pedido: vuelve a sonar al instante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, settings, unlocked, silenced, sound, customUrl]);

  // Título de la pestaña parpadeando, para verlo aunque esté en otra pestaña.
  useEffect(() => {
    if (!web) return undefined;
    const base = document.title;
    if (pending.length === 0) return undefined;
    let on = false;
    const id = setInterval(() => {
      on = !on;
      document.title = on ? t.tabTitle(pending.length) : base;
    }, 1000);
    return () => {
      clearInterval(id);
      document.title = base;
    };
  }, [key, pending.length]);

  // Reloj para que "Silenciar 1 min" se levante solo.
  useEffect(() => {
    if (silencedUntil <= Date.now()) return undefined;
    const id = setTimeout(() => setNow(Date.now()), silencedUntil - Date.now() + 50);
    return () => clearTimeout(id);
  }, [silencedUntil]);

  return {
    settings,
    setSettings,
    unlocked,
    customUrl,
    setCustomUrl,
    silencedUntil,
    silence: (ms) => {
      setSilencedUntil(Date.now() + ms);
      setNow(Date.now());
    },
    test: () => {
      void unlockAlarm(customUrl).then(() =>
        ringOnce(sound, settings.volume, customUrl, settings.vibrate),
      );
    },
  };
}

/** Barra para habilitar el sonido y banner de pedidos nuevos. */
export function AlarmBanner({
  alarm,
  pending,
}: {
  readonly alarm: OrderAlarm;
  readonly pending: readonly number[];
}): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const blink = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (pending.length === 0) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, {
          toValue: 0.45,
          duration: 450,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(blink, {
          toValue: 1,
          duration: 450,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink, pending.length]);

  return (
    <>
      {alarm.settings.enabled && !alarm.unlocked ? (
        <Pressable accessibilityRole="button" onPress={alarm.test} style={styles.unlock}>
          <Ionicons name="volume-high" size={22} color={colors.onPrimary} />
          <Text style={styles.unlockText}>{t.unlock}</Text>
        </Pressable>
      ) : null}
      {pending.length > 0 ? (
        <Animated.View style={[styles.alert, { opacity: blink }]}>
          <Ionicons name="notifications" size={26} color="#FFFFFF" />
          <View style={styles.grow}>
            <Text style={styles.alertTitle}>{t.newOrders(pending)}</Text>
            <Text style={styles.alertBody}>{t.howToStop}</Text>
          </View>
          {alarm.silencedUntil > Date.now() ? (
            <Text style={styles.alertBody}>{t.silenced}</Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => alarm.silence(60_000)}
              style={styles.silence}
            >
              <Ionicons name="volume-mute" size={16} color="#FFFFFF" />
              <Text style={styles.silenceText}>{t.silence}</Text>
            </Pressable>
          )}
        </Animated.View>
      ) : null}
    </>
  );
}

/** Ajustes de la alarma (por dispositivo) y sonido propio (del negocio). */
export function AlarmSettingsCard({
  alarm,
  storeId,
  restaurantId,
  isOwner,
}: {
  readonly alarm: OrderAlarm;
  readonly storeId: string;
  readonly restaurantId: string;
  readonly isOwner: boolean;
}): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const s = alarm.settings;
  const set = (patch: Partial<AlarmSettings>): void => alarm.setSettings({ ...s, ...patch });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const chip = (on: boolean, label: string, onPress: () => void, key: string): ReactNode => (
    <Pressable
      key={key}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[styles.chip, on && styles.chipOn]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );

  const upload = async (): Promise<void> => {
    setNotice(null);
    try {
      const picked = await pickAlarmSound();
      if (picked === null) return;
      setBusy(true);
      const url = await uploadImage('sounds', restaurantId, picked.blob, picked.extension);
      await setAlertSound(storeId, url);
      alarm.setCustomUrl(url);
      set({ sound: 'custom' });
      setNotice({ tone: 'ok', text: t.uploaded(picked.name) });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setNotice({
        tone: 'error',
        text: message === 'too_big' ? t.tooBig : `${adminStrings.saveFailed}: ${message}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t.title}>
      <Toggle
        label={t.enabled}
        hint={t.enabledHint}
        value={s.enabled}
        onValueChange={(v) => set({ enabled: v })}
      />

      <Text style={styles.label}>{t.sound}</Text>
      <View style={styles.row}>
        {(['campana', 'timbre', 'sirena'] as const).map((k) =>
          chip(s.sound === k, t.sounds[k] ?? k, () => set({ sound: k }), k),
        )}
        {alarm.customUrl !== null
          ? chip(s.sound === 'custom', t.mySound, () => set({ sound: 'custom' }), 'custom')
          : null}
      </View>
      {isOwner ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void upload()}
          disabled={busy}
          style={styles.link}
        >
          <Ionicons name="cloud-upload-outline" size={16} color={colors.primary} />
          <Text style={styles.linkText}>
            {busy ? t.uploading : alarm.customUrl === null ? t.upload : t.replace}
          </Text>
        </Pressable>
      ) : null}

      <Text style={styles.label}>{t.volume}</Text>
      <View style={styles.row}>
        {VOLUMES.map((v) =>
          chip(
            s.volume === v,
            t.volumes[String(v)] ?? String(v),
            () => set({ volume: v }),
            String(v),
          ),
        )}
      </View>

      <Text style={styles.label}>{t.every}</Text>
      <View style={styles.row}>
        {INTERVALS.map((n) =>
          chip(s.everySeconds === n, t.seconds(n), () => set({ everySeconds: n }), String(n)),
        )}
      </View>

      <Toggle
        label={t.vibrate}
        hint={canVibrate() ? t.vibrateHint : t.vibrateNo}
        value={s.vibrate}
        onValueChange={(v) => set({ vibrate: v })}
      />
      <Toggle
        label={t.keepAwake}
        hint={canKeepAwake() ? t.keepAwakeHint : t.keepAwakeNo}
        value={s.keepAwake}
        onValueChange={(v) => set({ keepAwake: v })}
      />

      <Pressable accessibilityRole="button" onPress={alarm.test} style={styles.test}>
        <Ionicons name="play" size={18} color={colors.onPrimary} />
        <Text style={styles.testText}>{t.test}</Text>
      </Pressable>
      <Text style={styles.hint}>{t.deviceNote}</Text>
      {notice !== null ? <Notice tone={notice.tone} text={notice.text} /> : null}
    </Card>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    grow: { flex: 1, minWidth: 0 },
    unlock: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.primary,
      borderRadius: radius.lg,
      padding: spacing.lg,
    },
    unlockText: {
      color: colors.onPrimary,
      fontWeight: '800',
      fontSize: typography.body.fontSize + 1,
      flexShrink: 1,
    },
    alert: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.danger,
      borderRadius: radius.lg,
      padding: spacing.lg,
    },
    alertTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: typography.section.fontSize + 2 },
    alertBody: { color: '#FFFFFF', fontSize: typography.label.fontSize, opacity: 0.95 },
    silence: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1.5,
      borderColor: '#FFFFFF',
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
    },
    silenceText: { color: '#FFFFFF', fontWeight: '800', fontSize: typography.caption.fontSize + 1 },
    label: {
      color: colors.text,
      fontWeight: '800',
      fontSize: typography.label.fontSize,
      marginTop: spacing.xs,
    },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.text, fontWeight: '700', fontSize: typography.label.fontSize },
    chipTextOn: { color: colors.onPrimary },
    link: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingVertical: 4,
    },
    linkText: { color: colors.primary, fontWeight: '800', fontSize: typography.label.fontSize },
    test: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.primary,
      borderRadius: radius.pill,
      paddingVertical: spacing.md,
      marginTop: spacing.sm,
    },
    testText: { color: colors.onPrimary, fontWeight: '800', fontSize: typography.body.fontSize },
    hint: { color: colors.textMuted, fontSize: typography.caption.fontSize + 1, lineHeight: 18 },
  });
}
