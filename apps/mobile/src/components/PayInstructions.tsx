/**
 * "Paga tu pedido" para transferencia y Mercado Pago (0026).
 *
 * El monto y el pedido se enseñan tal cual para que el cliente pague lo
 * exacto y el cajero lo encuentre. Cuando alguien del negocio marca el
 * pago como recibido, la tarjeta cambia a "Pago recibido".
 */

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { isMercadoPagoConnected, startMercadoPago } from '../api/mercadopago';

import type { OrderRow } from '../api/orders';
import type { StoreRow } from '../api/types';
import type { BrandColors } from '../domain/branding';
import { formatMoney } from '../domain/money';
import { formatClabe, needsPaymentConfirmation } from '../domain/payment-options';
import { useColors } from '../state/branding-context';
import { strings } from '../strings';
import { radius, spacing, type as typography } from '../theme';
import { Button } from './ui';

export function PayInstructions({
  order,
  store,
  amountCents,
}: {
  readonly order: OrderRow;
  readonly store: StoreRow | null;
  readonly amountCents: number;
}): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [copied, setCopied] = useState<string | null>(null);
  const [mpAuto, setMpAuto] = useState(false);
  const [opening, setOpening] = useState(false);
  const [mpError, setMpError] = useState<string | null>(null);
  const t = strings.payments;
  const storeId = store?.id ?? null;

  useEffect(() => {
    if (storeId === null || order.pay_with !== 'mercadopago') return;
    let alive = true;
    void isMercadoPagoConnected(storeId).then((value) => alive && setMpAuto(value));
    return () => {
      alive = false;
    };
  }, [storeId, order.pay_with]);

  if (!needsPaymentConfirmation(order.pay_with) || order.status === 'canceled') return null;

  const paid = order.paid_confirmed_at !== null && order.paid_confirmed_at !== undefined;
  const amount = formatMoney(amountCents);
  const orderNumber = `#${order.order_number}`;

  if (paid) {
    return (
      <View style={[styles.card, styles.cardPaid]}>
        <Ionicons name="checkmark-circle" size={26} color={colors.success} />
        <Text style={styles.title}>{t.confirmed}</Text>
      </View>
    );
  }
  if (order.status === 'completed') return null;

  const copy = (key: string, value: string): void => {
    void Clipboard.setStringAsync(value)
      .then(() => setCopied(key))
      .catch(() => setCopied(null));
  };

  const row = (key: string, label: string, value: string, copyValue?: string): ReactNode => (
    <View key={key} style={styles.row}>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} selectable>
          {value}
        </Text>
      </View>
      {copyValue !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t.copy} ${label}`}
          onPress={() => copy(key, copyValue)}
          style={styles.copy}
          hitSlop={8}
        >
          <Ionicons name={copied === key ? 'checkmark' : 'copy-outline'} size={16} color={colors.primary} />
          <Text style={styles.copyText}>{copied === key ? t.copied : t.copy}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const payAuto = async (): Promise<void> => {
    setOpening(true);
    setMpError(null);
    try {
      const url = await startMercadoPago(order.id);
      // En la web se va en la misma pestaña: Mercado Pago regresa solo
      // a la pantalla del pedido al terminar.
      if (Platform.OS === 'web') window.location.assign(url);
      else await Linking.openURL(url);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : '';
      setMpError(t.mpErrors[reason] ?? t.mpFailed);
      setOpening(false);
    }
  };

  const link = store?.mercadopago_link ?? null;
  const clabe = store?.transfer_clabe ?? null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name={order.pay_with === 'mercadopago' ? 'wallet-outline' : 'swap-horizontal-outline'} size={22} color={colors.primary} />
        <Text style={styles.title}>{t.payTitle}</Text>
      </View>

      {order.pay_with === 'mercadopago' && mpAuto ? (
        <>
          {row('amount', t.amount, amount)}
          <Button
            label={opening ? t.mpOpening : t.mpButton(amount)}
            busy={opening}
            onPress={() => void payAuto()}
          />
          {mpError !== null ? <Text style={styles.error}>{mpError}</Text> : null}
          <Text style={styles.hint}>{t.mpAutoSteps}</Text>
        </>
      ) : order.pay_with === 'mercadopago' ? (
        <>
          {row('amount', t.amount, amount, (amountCents / 100).toFixed(2))}
          {link !== null ? (
            <Button label={t.mpButton(amount)} onPress={() => void Linking.openURL(link)} />
          ) : null}
          <Text style={styles.hint}>{t.mpSteps(amount, orderNumber)}</Text>
        </>
      ) : (
        <>
          {store?.transfer_bank ? row('bank', t.bank, store.transfer_bank) : null}
          {store?.transfer_holder ? row('holder', t.holder, store.transfer_holder) : null}
          {clabe !== null ? row('clabe', t.clabe, formatClabe(clabe), clabe) : null}
          {row('amount', t.amount, amount, (amountCents / 100).toFixed(2))}
          {row('concept', t.concept, t.conceptValue(orderNumber), t.conceptValue(orderNumber))}
          {store?.transfer_info ? <Text style={styles.note}>{store.transfer_info}</Text> : null}
          <Text style={styles.hint}>{t.transferSteps}</Text>
        </>
      )}

      <View style={styles.pending}>
        <Ionicons name="time-outline" size={16} color={colors.textMuted} />
        <Text style={styles.pendingText}>
          {t.pending}. {mpAuto && order.pay_with === 'mercadopago' ? t.mpAutoPending : t.pendingHint}
        </Text>
      </View>
    </View>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 2,
      borderColor: colors.primary,
      padding: spacing.lg,
      gap: spacing.md,
    },
    cardPaid: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderColor: colors.border },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    title: { color: colors.text, fontSize: typography.section.fontSize, fontWeight: '800' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    rowLabel: { color: colors.textMuted, fontSize: typography.caption.fontSize, fontWeight: '700' },
    rowValue: { color: colors.text, fontSize: typography.body.fontSize + 1, fontWeight: '700' },
    copy: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    copyText: { color: colors.primary, fontSize: typography.caption.fontSize, fontWeight: '800' },
    note: { color: colors.text, fontSize: typography.label.fontSize },
    error: { color: colors.danger, fontSize: typography.label.fontSize, fontWeight: '600' },
    hint: { color: colors.textMuted, fontSize: typography.label.fontSize, lineHeight: 19 },
    pending: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    pendingText: { flex: 1, color: colors.textMuted, fontSize: typography.caption.fontSize, fontWeight: '600' },
  });
}
