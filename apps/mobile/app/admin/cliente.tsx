/**
 * Mostrador: escanear el QR personal del cliente (0029).
 *
 * El cajero ve nombre y puntos, suma la visita y, si ya alcanza, entrega
 * la recompensa. Todo lo valida la base (QR vigente, horas entre visitas,
 * puntos suficientes); aquí solo se muestra y se pide.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  staffAddVisit,
  staffGiveReward,
  staffScanCustomer,
  type CustomerCard,
} from '../../src/api/loyalty';
import { useAdmin } from '../../src/admin/admin-context';
import { adminStrings } from '../../src/admin/strings';
import { AdminShell, Card, Notice, createAdminStyles } from '../../src/admin/ui';
import { QrScanner } from '../../src/components/QrScanner';
import { Button } from '../../src/components/ui';
import type { BrandColors } from '../../src/domain/branding';
import {
  isCustomerQr,
  progressTo,
  reachableRewards,
  staffErrorKey,
} from '../../src/domain/loyalty-card';
import { moneyDefaults } from '../../src/domain/money';
import { useColors } from '../../src/state/branding-context';
import { radius, spacing, type as typography } from '../../src/theme';

const t = adminStrings.loyalty;

function whenText(iso: string | null): string {
  if (iso === null) return '';
  return new Date(iso).toLocaleString(moneyDefaults().locale, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ScanCustomerScreen(): ReactNode {
  const { store } = useAdmin();
  const colors = useColors();
  const styles = useMemo(
    () => ({ ...createAdminStyles(colors), ...createStyles(colors) }),
    [colors],
  );
  const [payload, setPayload] = useState<string | null>(null);
  const [card, setCard] = useState<CustomerCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const explain = (cause: unknown): string => {
    const message = cause instanceof Error ? cause.message : String(cause);
    return t.staffErrors[staffErrorKey(message)] ?? t.staffErrors['other'] ?? message;
  };

  const run = async (
    work: () => Promise<CustomerCard>,
    ok: (c: CustomerCard) => string | null,
  ): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const next = await work();
      setCard(next);
      const text = ok(next);
      if (text !== null) setNotice({ tone: 'ok', text });
    } catch (cause) {
      setNotice({ tone: 'error', text: explain(cause) });
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const onResult = useCallback(
    (text: string): boolean => {
      if (!isCustomerQr(text)) {
        setNotice({ tone: 'error', text: t.notCustomerQr });
        return false;
      }
      const value = text.trim();
      setPayload(value);
      void run(
        () => staffScanCustomer(store.id, value),
        () => null,
      );
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.id],
  );

  const reset = (): void => {
    setPayload(null);
    setCard(null);
    setNotice(null);
    setConfirming(null);
  };

  const ready = card === null ? [] : reachableRewards(card.points, card.rewards);

  return (
    <AdminShell>
      <View style={styles.wrap}>
        {payload === null ? (
          <Card title={t.scanTitle}>
            <Text style={styles.hint}>{t.scanHint}</Text>
            <View style={styles.scanner}>
              <QrScanner onResult={onResult} />
            </View>
            {notice !== null ? <Notice tone={notice.tone} text={notice.text} /> : null}
          </Card>
        ) : (
          <Card>
            {card === null ? (
              notice !== null ? (
                <Notice tone={notice.tone} text={notice.text} />
              ) : (
                <Text style={styles.hint}>…</Text>
              )
            ) : (
              <View style={styles.cardBody}>
                <View style={styles.head}>
                  <View style={styles.avatar}>
                    <Ionicons name="person" size={28} color={colors.onPrimary} />
                  </View>
                  <View style={styles.headText}>
                    <Text style={styles.name}>{card.name}</Text>
                    {card.email !== null ? <Text style={styles.email}>{card.email}</Text> : null}
                    <Text style={styles.hint}>{t.lifetime(card.lifetime_points)}</Text>
                  </View>
                  <View style={styles.pointsPill}>
                    <Text style={styles.pointsValue}>{card.points}</Text>
                    <Text style={styles.pointsLabel}>pts</Text>
                  </View>
                </View>

                {notice !== null ? <Notice tone={notice.tone} text={notice.text} /> : null}

                {ready[0] !== undefined ? (
                  <View style={styles.readyBanner}>
                    <Text style={styles.readyText}>🎉 {t.canRedeem(card.name, ready[0].name)}</Text>
                  </View>
                ) : null}

                {card.can_visit ? (
                  <Button
                    label={t.addVisit(card.points_per_visit)}
                    busy={busy}
                    disabled={!card.program_enabled}
                    onPress={() =>
                      void run(
                        () => staffAddVisit(store.id, payload),
                        (c) => t.visitAdded(c.added ?? card.points_per_visit, c.name),
                      )
                    }
                  />
                ) : (
                  <Text style={styles.hint}>{t.alreadyVisited(whenText(card.next_visit_at))}</Text>
                )}
                {!card.program_enabled ? (
                  <Notice tone="error" text={t.staffErrors['disabled'] ?? ''} />
                ) : null}

                <View style={styles.rewards}>
                  {card.rewards.map((reward) => {
                    const progress = progressTo(card.points, reward.cost_points);
                    return (
                      <View
                        key={reward.id}
                        style={[styles.reward, reward.eligible && styles.rewardReady]}
                      >
                        <View style={styles.rewardHead}>
                          <Text style={styles.rewardName}>{reward.name}</Text>
                          <Text style={styles.rewardCost}>{t.points(reward.cost_points)}</Text>
                        </View>
                        <View style={styles.track}>
                          <View
                            style={[
                              styles.fill,
                              { width: `${Math.round(progress * 100)}%` },
                              reward.eligible && styles.fillReady,
                            ]}
                          />
                        </View>
                        {reward.eligible ? (
                          confirming === reward.id ? (
                            <View style={styles.confirmRow}>
                              <Text style={styles.hint}>
                                {t.confirmGive(reward.name, reward.cost_points)}
                              </Text>
                              <Button
                                label={t.yesGive}
                                busy={busy}
                                onPress={() =>
                                  void run(
                                    () => staffGiveReward(store.id, payload, reward.id),
                                    (c) => t.given(reward.name, c.name),
                                  )
                                }
                              />
                              <Button
                                label={adminStrings.cancel}
                                variant="outline"
                                onPress={() => setConfirming(null)}
                              />
                            </View>
                          ) : (
                            <Button
                              label={t.give(reward.name)}
                              variant="accent"
                              disabled={busy}
                              onPress={() => setConfirming(reward.id)}
                              style={styles.giveButton}
                            />
                          )
                        ) : (
                          <Text style={styles.hint}>
                            {t.missingFor(reward.cost_points - card.points, reward.name)}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
            <Button label={t.scanAnother} variant="outline" onPress={reset} />
          </Card>
        )}
      </View>
    </AdminShell>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    wrap: { maxWidth: 560, width: '100%', alignSelf: 'center' },
    scanner: { borderRadius: radius.lg, overflow: 'hidden', minHeight: 320 },
    cardBody: { gap: spacing.md },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    avatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headText: { flex: 1, minWidth: 0, gap: 2 },
    name: { color: colors.text, fontSize: typography.section.fontSize + 2, fontWeight: '800' },
    email: { color: colors.text, fontSize: typography.label.fontSize, fontWeight: '600' },
    pointsPill: { alignItems: 'center' },
    pointsValue: { color: colors.primary, fontSize: 34, fontWeight: '800', lineHeight: 38 },
    pointsLabel: {
      color: colors.textMuted,
      fontSize: typography.caption.fontSize,
      fontWeight: '700',
    },
    readyBanner: { backgroundColor: colors.success, borderRadius: radius.md, padding: spacing.md },
    readyText: { color: '#FFFFFF', fontSize: typography.body.fontSize + 1, fontWeight: '800' },
    rewards: { gap: spacing.sm },
    reward: {
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rewardReady: { borderColor: colors.success, borderWidth: 2 },
    rewardHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
    rewardName: {
      color: colors.text,
      fontSize: typography.body.fontSize,
      fontWeight: '800',
      flex: 1,
    },
    rewardCost: { color: colors.textMuted, fontSize: typography.label.fontSize, fontWeight: '700' },
    track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
    fillReady: { backgroundColor: colors.success },
    giveButton: { alignSelf: 'flex-start', minHeight: 40 },
    confirmRow: { gap: spacing.sm },
  });
}
