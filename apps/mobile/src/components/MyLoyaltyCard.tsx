/**
 * "Mi tarjeta": el QR personal del cliente para que el cajero lo escanee
 * (0029). Cambia cada 2 minutos; se pide uno nuevo solo al caducar.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { qrDataUrl } from '../admin/qr';
import { fetchMyLoyaltyQr, type MyLoyaltyQr } from '../api/loyalty';
import type { BrandColors } from '../domain/branding';
import { useColors } from '../state/branding-context';
import { strings } from '../strings';
import { radius, spacing, type as typography } from '../theme';

export function MyLoyaltyCard({ name }: { readonly name: string }): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [qr, setQr] = useState<MyLoyaltyQr | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    fetchMyLoyaltyQr()
      .then((next) => {
        setQr(next);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const expiresAt = qr === null ? null : Date.parse(qr.expires_at);
  const seconds = expiresAt === null ? 0 : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  useEffect(() => {
    if (qr !== null && seconds === 0) load();
  }, [qr, seconds, load]);

  if (failed && qr === null) return <Text style={styles.error}>{strings.rewards.qrError}</Text>;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{strings.rewards.myCard}</Text>
      <View style={styles.qrBox}>
        {qr === null ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Image
            source={{ uri: qrDataUrl(qr.payload, 8) }}
            style={styles.qr}
            resizeMode="contain"
            accessibilityLabel={strings.rewards.myCard}
          />
        )}
      </View>
      <Text style={styles.name}>{qr?.name ?? name}</Text>
      <Text style={styles.hint}>{strings.rewards.myCardHint}</Text>
      {qr !== null ? <Text style={styles.timer}>{strings.rewards.qrRefresh(seconds)}</Text> : null}
    </View>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    card: {
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.lg,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.primary,
    },
    title: { color: colors.text, fontSize: typography.section.fontSize, fontWeight: '800' },
    qrBox: {
      width: 220,
      height: 220,
      padding: 10,
      backgroundColor: '#FFFFFF',
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    qr: { width: '100%', height: '100%' },
    name: { color: colors.text, fontSize: typography.body.fontSize + 1, fontWeight: '800' },
    hint: { color: colors.textMuted, fontSize: typography.label.fontSize, textAlign: 'center', lineHeight: 19 },
    timer: { color: colors.textFaint, fontSize: typography.caption.fontSize },
    error: { color: colors.danger, fontSize: typography.label.fontSize },
  });
}
