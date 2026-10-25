/**
 * Rewards. El programa de lealtad esta en la base (`loyalty_programs`,
 * seed: 1 punto por dolar, 100 puntos para canjear) y el saldo en
 * `loyalty_accounts`, que RLS solo deja leer al propio usuario.
 */

import { useCallback, useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fetchLoyaltyAccount, fetchLoyaltyProgram, fetchRewards } from '../../src/api/account';
import type { LoyaltyAccountRow, LoyaltyProgramRow, RewardRow } from '../../src/api/types';
import { DataState } from '../../src/components/DataState';
import { Screen } from '../../src/components/Screen';
import { SectionTitle } from '../../src/components/ui';
import type { BrandColors } from '../../src/domain/branding';
import { useAsync } from '../../src/hooks/use-async';
import { useBranding, useColors } from '../../src/state/branding-context';
import { useSession } from '../../src/state/session-context';
import { useStores } from '../../src/state/store-context';
import { radius, spacing, type as typography } from '../../src/theme';
import { strings } from '../../src/strings';

interface RewardsData {
  readonly program: LoyaltyProgramRow | null;
  readonly account: LoyaltyAccountRow | null;
  readonly rewards: readonly RewardRow[];
}

export default function RewardsScreen(): ReactNode {
  const { user } = useSession();
  const colors = useColors();
  const { displayName } = useBranding();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { selectedStore } = useStores();

  const restaurantId = selectedStore?.restaurant_id ?? null;

  const load = useCallback(async (): Promise<RewardsData> => {
    if (restaurantId === null) return { program: null, account: null, rewards: [] };
    const [program, rewards, account] = await Promise.all([
      fetchLoyaltyProgram(restaurantId),
      fetchRewards(restaurantId),
      user === null ? Promise.resolve(null) : fetchLoyaltyAccount(),
    ]);
    return { program, account, rewards };
  }, [restaurantId, user]);

  const { data, error, loading, refreshing, refresh, reload } = useAsync(load, [
    restaurantId,
    user?.id,
  ]);

  if (loading || error !== null) {
    return (
      <Screen withTabBar scroll={false}>
        <DataState loading={loading} error={error} empty={false} onRetry={reload} emptyTitle="">
          {null}
        </DataState>
      </Screen>
    );
  }

  const program = data?.program ?? null;
  const points = data?.account?.points_balance ?? 0;

  return (
    <Screen withTabBar refreshing={refreshing} onRefresh={refresh} contentStyle={styles.content}>
      <Text style={styles.title}>{strings.rewards.title}</Text>

      <View style={styles.pointsCard}>
        <Text style={styles.pointsLabel}>{strings.rewards.yourPoints}</Text>
        <Text style={styles.pointsValue}>{user === null ? '—' : points}</Text>
        <Text style={styles.pointsHelp}>
          {user === null
            ? strings.rewards.signInPrompt
            : program === null || !program.enabled
              ? strings.rewards.inactive(displayName)
              : strings.rewards.earnRate(program.points_per_dollar, program.min_points_to_redeem)}
        </Text>
      </View>

      <View style={styles.section}>
        <SectionTitle>{strings.rewards.catalog}</SectionTitle>
        {(data?.rewards ?? []).length === 0 ? (
          <Text style={styles.empty}>{strings.rewards.empty}</Text>
        ) : (
          (data?.rewards ?? []).map((reward) => (
            <View key={reward.id} style={styles.reward}>
              <View style={styles.rewardBody}>
                <Text style={styles.rewardName}>{reward.name}</Text>
                {reward.description !== null ? (
                  <Text style={styles.rewardDescription}>{reward.description}</Text>
                ) : null}
              </View>
              <Text style={styles.rewardCost}>{strings.rewards.points(reward.cost_points)}</Text>
            </View>
          ))
        )}
      </View>

      <Text style={styles.footnote}>{strings.rewards.footnote}</Text>
    </Screen>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    content: { padding: spacing.lg, gap: spacing.xl },
    title: {
      color: colors.text,
      fontSize: typography.display.fontSize,
      fontWeight: '800',
    },
    pointsCard: {
      backgroundColor: colors.primary,
      borderRadius: radius.lg,
      padding: spacing.xl,
      gap: spacing.xs,
    },
    pointsLabel: {
      color: colors.accent,
      fontSize: typography.caption.fontSize,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    pointsValue: {
      color: colors.onPrimary,
      fontSize: 44,
      fontWeight: '800',
    },
    pointsHelp: {
      color: colors.onPrimary,
      opacity: 0.85,
      fontSize: typography.body.fontSize,
      lineHeight: 21,
    },

    section: { gap: spacing.sm },
    empty: { color: colors.textMuted, fontSize: typography.body.fontSize },

    reward: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      marginBottom: spacing.sm,
    },
    rewardBody: { flex: 1, gap: 2 },
    rewardName: {
      color: colors.text,
      fontSize: typography.body.fontSize + 1,
      fontWeight: '700',
    },
    rewardDescription: {
      color: colors.textMuted,
      fontSize: typography.caption.fontSize + 1,
    },
    rewardCost: {
      color: colors.accent,
      fontSize: typography.body.fontSize,
      fontWeight: '800',
    },

    footnote: {
      color: colors.textFaint,
      fontSize: typography.caption.fontSize,
      lineHeight: 18,
    },
  });
}
