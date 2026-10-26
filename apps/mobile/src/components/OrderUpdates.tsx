/**
 * Avisos al cliente cuando el negocio cambia su pedido: "Ya estamos
 * preparando tu pedido", "¡Tu pedido está listo!". Con sonido y vibración.
 *
 * Funciona mientras la app está abierta (cualquier pantalla). Revisa cada
 * 10 s si hay pedidos en curso y cada 20 s si no.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ringOnce, unlockAlarm } from '../admin/alarm-engine';
import { fetchMyOrders } from '../api/orders';
import type { BrandColors } from '../domain/branding';
import { hasLiveOrders, statusChanges, type StatusChange } from '../domain/order-updates';
import { useColors } from '../state/branding-context';
import { useSession } from '../state/session-context';
import { strings } from '../strings';
import { radius, spacing, type as typography } from '../theme';

const web = Platform.OS === 'web' && typeof window !== 'undefined';

export function OrderUpdates(): ReactNode {
  const { user } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const previous = useRef<Map<string, string> | null>(null);
  const [toast, setToast] = useState<StatusChange | null>(null);
  const [live, setLive] = useState(false);

  // El audio se habilita con el primer toque del cliente en la app.
  useEffect(() => {
    if (!web) return undefined;
    const handler = (): void => void unlockAlarm(null);
    window.addEventListener('pointerdown', handler, { once: true });
    return () => window.removeEventListener('pointerdown', handler);
  }, []);

  const check = useCallback(async () => {
    if (user === null) return;
    if (web && document.visibilityState === 'hidden') return;
    try {
      const orders = await fetchMyOrders(8);
      const changes = statusChanges(previous.current, orders);
      previous.current = new Map(orders.map((o) => [o.id, o.status]));
      setLive(hasLiveOrders(orders));
      const latest = changes[changes.length - 1];
      if (latest !== undefined) {
        setToast(latest);
        ringOnce(latest.kind === 'ready' ? 'campana' : 'timbre', 0.9, null, true);
      }
    } catch {
      // sin red: se vuelve a intentar en la siguiente vuelta
    }
  }, [user]);

  useEffect(() => {
    previous.current = null;
    setToast(null);
    void check();
  }, [check]);

  useEffect(() => {
    if (user === null) return undefined;
    const id = setInterval(() => void check(), live ? 10_000 : 20_000);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void check();
    };
    if (web) document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      if (web) document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check, live, user]);

  // "Preparando" se va solo; "Listo" y "Cancelado" se quedan hasta tocarlos.
  useEffect(() => {
    if (toast === null || toast.kind !== 'preparing') return undefined;
    const id = setTimeout(() => setToast(null), 10_000);
    return () => clearTimeout(id);
  }, [toast]);

  if (toast === null) return null;
  const tone =
    toast.kind === 'ready'
      ? styles.ready
      : toast.kind === 'canceled'
        ? styles.canceled
        : styles.preparing;
  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="box-none">
      <Pressable
        accessibilityRole="alert"
        onPress={() => {
          setToast(null);
          router.push({ pathname: '/order/[id]', params: { id: toast.orderId } });
        }}
        style={[styles.toast, tone]}
      >
        <Text style={styles.emoji}>
          {toast.kind === 'ready' ? '🎉' : toast.kind === 'canceled' ? '⚠️' : '👩‍🍳'}
        </Text>
        <View style={styles.grow}>
          <Text style={styles.title}>
            {strings.orderUpdates.title[toast.kind](toast.orderNumber)}
          </Text>
          <Text style={styles.body}>{strings.orderUpdates.body[toast.kind]}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.common.close}
          onPress={() => setToast(null)}
          hitSlop={10}
        >
          <Ionicons name="close" size={20} color="#FFFFFF" />
        </Pressable>
      </Pressable>
    </View>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      zIndex: 1000,
    },
    toast: {
      width: '100%',
      maxWidth: 500,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radius.lg,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    preparing: { backgroundColor: colors.primary },
    ready: { backgroundColor: colors.success },
    canceled: { backgroundColor: colors.danger },
    emoji: { fontSize: 28 },
    grow: { flex: 1, minWidth: 0 },
    title: { color: '#FFFFFF', fontWeight: '800', fontSize: typography.body.fontSize + 1 },
    body: { color: '#FFFFFF', fontSize: typography.label.fontSize, opacity: 0.95, marginTop: 2 },
  });
}
