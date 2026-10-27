/** La campana: quién te respondió, a quién le sirvió, qué ocultó la tienda. */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchInbox, markInboxRead, type InboxItem } from '../../src/api/community';
import { BackRow } from '../../src/community/BackRow';
import { communityStrings as t } from '../../src/community/strings';
import { DataState } from '../../src/components/DataState';
import { Screen } from '../../src/components/Screen';
import type { BrandColors } from '../../src/domain/branding';
import { timeAgo } from '../../src/domain/community';
import { useAsync } from '../../src/hooks/use-async';
import { useColors } from '../../src/state/branding-context';
import { radius, spacing, type as typography } from '../../src/theme';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  community_store_reply: 'storefront',
  community_reply: 'chatbubble-ellipses',
  community_helpful: 'thumbs-up',
  community_hidden: 'eye-off',
  community_published: 'checkmark-circle',
  community_reward: 'gift',
};

export default function InboxScreen(): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const load = useCallback(() => fetchInbox(), []);
  const { data, loading, error, reload, refresh, refreshing } = useAsync(load, []);

  // Abrir la campana los marca como leídos (se ven resaltados esta vez).
  useEffect(() => {
    if (data !== null && data !== undefined && data.unread > 0) void markInboxRead().catch(() => undefined);
  }, [data]);

  const items: readonly InboxItem[] = data?.items ?? [];

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} contentStyle={styles.content}>
      <BackRow />
      <Text style={styles.title}>{t.inbox.title}</Text>
      <DataState
        loading={loading && data == null}
        error={error}
        empty={!loading && items.length === 0}
        emptyTitle={t.inbox.empty}
        onRetry={reload}
      >
        {items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            disabled={item.data.post_id === undefined}
            onPress={() =>
              item.data.post_id !== undefined &&
              router.push({ pathname: '/comunidad/[id]', params: { id: item.data.post_id } })
            }
            style={({ pressed }) => [styles.item, item.read_at === null && styles.unread, pressed && styles.pressed]}
          >
            <View style={styles.icon}>
              <Ionicons name={ICONS[item.type] ?? 'notifications'} size={18} color={colors.primary} />
            </View>
            <View style={styles.grow}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text style={styles.itemBody} numberOfLines={2}>
                {item.body}
              </Text>
              <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
            </View>
          </Pressable>
        ))}
      </DataState>
    </Screen>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    content: { padding: spacing.lg, gap: spacing.sm },
    title: { color: colors.text, fontSize: typography.title.fontSize, fontWeight: '800', marginBottom: spacing.sm },
    pressed: { opacity: 0.7 },
    grow: { flex: 1, minWidth: 0, gap: 2 },
    item: {
      flexDirection: 'row',
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    unread: { borderColor: colors.primary, borderLeftWidth: 4 },
    icon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemTitle: { color: colors.text, fontWeight: '700', fontSize: typography.body.fontSize },
    itemBody: { color: colors.textMuted, fontSize: typography.label.fontSize },
    time: { color: colors.textFaint, fontSize: typography.caption.fontSize },
  });
}
