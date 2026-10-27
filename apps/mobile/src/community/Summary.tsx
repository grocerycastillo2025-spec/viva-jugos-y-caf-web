/**
 * Piezas de resumen: el promedio con sus barras, los avisos del negocio y
 * el bloque de comunidad que sale en Inicio.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CommunitySummary, NoticeRow } from '../api/community';
import type { BrandColors } from '../domain/branding';
import { starBars } from '../domain/community';
import { useColors } from '../state/branding-context';
import { radius, spacing, type as typography } from '../theme';
import { PostCard } from './PostCard';
import { Stars, STAR_COLOR } from './Stars';
import { communityStrings as t } from './strings';

export function RatingSummary({ summary }: { readonly summary: CommunitySummary }): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createSummaryStyles(colors), [colors]);
  const avg = summary.avg_rating ?? 0;
  return (
    <View style={styles.rating}>
      <View style={styles.ratingLeft}>
        <Text style={styles.ratingBig}>{summary.reviews === 0 ? '–' : avg.toFixed(1)}</Text>
        <Stars value={avg} size={14} emptyColor={colors.border} />
        <Text style={styles.ratingCount}>
          {summary.reviews === 0 ? t.noReviewsYet : t.reviews(summary.reviews)}
        </Text>
      </View>
      <View style={styles.bars}>
        {starBars(summary.stars).map((bar) => (
          <View key={bar.stars} style={styles.barRow}>
            <Text style={styles.barLabel}>{bar.stars}</Text>
            <Ionicons name="star" size={10} color={STAR_COLOR} />
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${bar.pct}%` }]} />
            </View>
            <Text style={styles.barCount}>{bar.count}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function NoticeCard({ notice }: { readonly notice: NoticeRow }): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createSummaryStyles(colors), [colors]);
  return (
    <View style={styles.notice}>
      {notice.photo_url !== null ? (
        <Image source={notice.photo_url} style={styles.noticePhoto} contentFit="cover" />
      ) : null}
      <View style={styles.noticeBody}>
        <View style={styles.noticeHead}>
          <Ionicons name="megaphone" size={16} color={colors.accent} />
          <Text style={styles.noticeTitle}>{notice.title}</Text>
          {notice.pinned ? <Ionicons name="pin" size={14} color={colors.textMuted} /> : null}
        </View>
        {notice.body !== null && notice.body !== '' ? <Text style={styles.noticeText}>{notice.body}</Text> : null}
      </View>
    </View>
  );
}

/** En Inicio, arriba de los destacados: los avisos del negocio. */
export function NoticesTeaser({ summary }: { readonly summary: CommunitySummary | null }): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createSummaryStyles(colors), [colors]);
  if (summary === null || summary.notices.length === 0) return null;
  return (
    <View style={styles.teaser}>
      {summary.notices.slice(0, 2).map((notice) => (
        <NoticeCard key={notice.id} notice={notice} />
      ))}
    </View>
  );
}

/** En Inicio: estrellas y lo más reciente, sin tener que buscarlo. */
export function CommunityTeaser({ summary }: { readonly summary: CommunitySummary | null }): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createSummaryStyles(colors), [colors]);
  const router = useRouter();
  if (summary === null || (!summary.enabled && summary.reviews === 0)) return null;

  return (
    <View style={styles.teaser}>
      <View style={styles.teaserHead}>
        <Text style={styles.teaserTitle}>{t.homeTitle}</Text>
        {summary.reviews > 0 ? (
          <View style={styles.teaserRating}>
            <Ionicons name="star" size={14} color={STAR_COLOR} />
            <Text style={styles.teaserRatingText}>
              {(summary.avg_rating ?? 0).toFixed(1)} · {t.reviews(summary.reviews)}
            </Text>
          </View>
        ) : null}
      </View>
      {summary.latest.length === 0 ? (
        <Text style={styles.teaserEmpty}>{t.empty.all}</Text>
      ) : (
        summary.latest.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            compact
            onOpen={() => router.push({ pathname: '/comunidad/[id]', params: { id: post.id } })}
          />
        ))
      )}
      <View style={styles.teaserActions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/comunidad')}
          style={({ pressed }) => [styles.teaserButton, pressed && styles.pressed]}
        >
          <Text style={styles.teaserButtonText}>{t.seeAll}</Text>
        </Pressable>
        {summary.enabled ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/comunidad/nueva', params: { kind: 'review' } })}
            style={({ pressed }) => [styles.teaserButton, styles.teaserButtonPrimary, pressed && styles.pressed]}
          >
            <Ionicons name="create-outline" size={16} color={colors.onPrimary} />
            <Text style={[styles.teaserButtonText, styles.teaserButtonTextPrimary]}>{t.writeReview}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function createSummaryStyles(colors: BrandColors) {
  return StyleSheet.create({
    pressed: { opacity: 0.7 },
    rating: {
      flexDirection: 'row',
      gap: spacing.lg,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      alignItems: 'center',
    },
    ratingLeft: { alignItems: 'center', gap: 4, minWidth: 96 },
    ratingBig: { color: colors.text, fontSize: 40, fontWeight: '800', lineHeight: 44 },
    ratingCount: { color: colors.textMuted, fontSize: typography.caption.fontSize, textAlign: 'center' },
    bars: { flex: 1, gap: 4 },
    barRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    barLabel: { color: colors.textMuted, fontSize: 11, width: 10, textAlign: 'right' },
    barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
    barFill: { height: 8, borderRadius: 4, backgroundColor: STAR_COLOR },
    barCount: { color: colors.textMuted, fontSize: 11, minWidth: 20, textAlign: 'right' },

    notice: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.accent,
      overflow: 'hidden',
    },
    noticePhoto: { width: '100%', height: 150 },
    noticeBody: { padding: spacing.md, gap: 4 },
    noticeHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    noticeTitle: { flex: 1, color: colors.text, fontWeight: '800', fontSize: typography.body.fontSize },
    noticeText: { color: colors.textMuted, fontSize: typography.label.fontSize, lineHeight: 19 },

    teaser: { gap: spacing.sm },
    teaserHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.xs },
    teaserTitle: { color: colors.text, fontSize: typography.section.fontSize, fontWeight: '700', flexShrink: 1 },
    teaserRating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    teaserRatingText: { color: colors.text, fontWeight: '700', fontSize: typography.label.fontSize },
    teaserEmpty: { color: colors.textMuted, fontSize: typography.body.fontSize },
    teaserActions: { flexDirection: 'row', gap: spacing.sm },
    teaserButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    teaserButtonPrimary: { backgroundColor: colors.primary },
    teaserButtonText: { color: colors.primary, fontWeight: '700', fontSize: typography.label.fontSize },
    teaserButtonTextPrimary: { color: colors.onPrimary },
  });
}
