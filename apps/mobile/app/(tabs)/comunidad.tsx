/**
 * Comunidad VIVA: reseñas con estrellas, preguntas que contestan otros
 * clientes o la tienda, y los avisos del negocio.
 */

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  fetchCommunitySummary,
  fetchFeed,
  fetchInbox,
  type CommunitySummary,
  type PostRow,
} from '../../src/api/community';
import { PostCard } from '../../src/community/PostCard';
import { communityStrings as t } from '../../src/community/strings';
import { NoticeCard, RatingSummary } from '../../src/community/Summary';
import { DataState } from '../../src/components/DataState';
import { Screen } from '../../src/components/Screen';
import type { BrandColors } from '../../src/domain/branding';
import type { FeedFilter } from '../../src/domain/community';
import { readEnv } from '../../src/env';
import { useColors } from '../../src/state/branding-context';
import { useSession } from '../../src/state/session-context';
import { radius, spacing, type as typography } from '../../src/theme';

const FILTERS: readonly FeedFilter[] = ['all', 'review', 'question', 'mine'];

interface Loaded {
  readonly summary: CommunitySummary;
  readonly posts: readonly PostRow[];
  readonly unread: number;
}

export default function CommunityScreen(): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { user } = useSession();
  const restaurantId = readEnv().restaurantId;
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState<{ busy: boolean; done: boolean }>({ busy: false, done: false });

  const load = useCallback(
    async (mode: 'first' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      try {
        const [summary, posts, inbox] = await Promise.all([
          fetchCommunitySummary(restaurantId),
          fetchFeed(restaurantId, filter === 'mine' && user === null ? 'all' : filter),
          user === null ? Promise.resolve({ unread: 0 }) : fetchInbox().catch(() => ({ unread: 0 })),
        ]);
        setData({ summary, posts, unread: inbox.unread });
        setMore({ busy: false, done: posts.length < 30 });
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filter, restaurantId, user],
  );

  // Al volver a la pestaña (p. ej. después de publicar) se actualiza.
  useFocusEffect(
    useCallback(() => {
      void load(data === null ? 'first' : 'refresh');
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  const loadMore = async (): Promise<void> => {
    if (data === null || more.busy || more.done) return;
    const last = data.posts[data.posts.length - 1];
    if (last === undefined) return;
    setMore({ busy: true, done: false });
    try {
      const next = await fetchFeed(restaurantId, filter, last.created_at);
      setData({ ...data, posts: [...data.posts, ...next] });
      setMore({ busy: false, done: next.length < 30 });
    } catch {
      setMore({ busy: false, done: false });
    }
  };

  const write = (): void => {
    if (user === null) {
      router.push('/profile');
      return;
    }
    router.push('/comunidad/nueva');
  };

  if (data === null) {
    return (
      <Screen scroll={false} withTabBar>
        <DataState loading={loading} error={error} empty={false} emptyTitle="" onRetry={() => void load('first')}>
          {null}
        </DataState>
      </Screen>
    );
  }

  const { summary, posts, unread } = data;

  return (
    <View style={styles.fill}>
      <Screen withTabBar refreshing={refreshing} onRefresh={() => void load('refresh')} contentStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.grow}>
            <Text style={styles.title}>{t.title}</Text>
            <Text style={styles.subtitle}>{t.subtitle}</Text>
          </View>
          {user !== null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.inbox.open}
              onPress={() => router.push('/comunidad/avisos')}
              style={({ pressed }) => [styles.bell, pressed && styles.pressed]}
            >
              <Ionicons name={unread > 0 ? 'notifications' : 'notifications-outline'} size={22} color={colors.text} />
              {unread > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}
        </View>

        <RatingSummary summary={summary} />

        {summary.notices.map((notice) => (
          <NoticeCard key={notice.id} notice={notice} />
        ))}

        {!summary.enabled ? <Text style={styles.off}>{t.off}</Text> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.filter((f) => f !== 'mine' || user !== null).map((f) => (
            <Pressable
              key={f}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === f }}
              onPress={() => setFilter(f)}
              style={({ pressed }) => [styles.chip, filter === f && styles.chipOn, pressed && styles.pressed]}
            >
              <Text style={[styles.chipText, filter === f && styles.chipTextOn]}>{t.filters[f]}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {posts.length === 0 ? (
          <Text style={styles.empty}>{t.empty[filter]}</Text>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onOpen={() => router.push({ pathname: '/comunidad/[id]', params: { id: post.id } })}
              onChanged={() => void load('refresh')}
            />
          ))
        )}

        {!more.done && posts.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadMore()}
            style={({ pressed }) => [styles.more, pressed && styles.pressed]}
          >
            <Text style={styles.moreText}>{more.busy ? '…' : t.loadMore}</Text>
          </Pressable>
        ) : null}
        <View style={styles.spacer} />
      </Screen>

      {summary.enabled ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.write}
          onPress={write}
          style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
        >
          <Ionicons name="create-outline" size={20} color={colors.onPrimary} />
          <Text style={styles.fabText}>{t.write}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    fill: { flex: 1 },
    content: { padding: spacing.lg, gap: spacing.md },
    pressed: { opacity: 0.7 },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    grow: { flex: 1, minWidth: 0 },
    title: { color: colors.text, fontSize: typography.title.fontSize, fontWeight: '800' },
    subtitle: { color: colors.textMuted, fontSize: typography.label.fontSize, marginTop: 2 },
    bell: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badge: {
      position: 'absolute',
      top: 4,
      right: 4,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.danger,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
    off: {
      color: colors.textMuted,
      backgroundColor: colors.surface,
      padding: spacing.md,
      borderRadius: radius.md,
      textAlign: 'center',
    },
    chips: { gap: spacing.sm, paddingVertical: 2 },
    chip: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.text, fontWeight: '600', fontSize: typography.label.fontSize },
    chipTextOn: { color: colors.onPrimary },
    empty: { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xl },
    more: { alignSelf: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
    moreText: { color: colors.primary, fontWeight: '700' },
    spacer: { height: 64 },
    fab: {
      position: 'absolute',
      right: spacing.lg,
      bottom: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: radius.pill,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 6,
    },
    fabText: { color: colors.onPrimary, fontWeight: '800', fontSize: typography.body.fontSize },
  });
}
