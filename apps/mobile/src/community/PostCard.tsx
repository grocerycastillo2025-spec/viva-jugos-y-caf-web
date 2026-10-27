/**
 * Una publicación de la comunidad: autor (nombre e inicial), sello de
 * cliente verificado, estrellas, foto, "Me sirvió", respuestas y
 * "Reportar". Se usa en el muro, en Inicio y en el detalle.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CommunityFailure, deleteOwn, report, toggleHelpful, type PostRow } from '../api/community';
import type { BrandColors } from '../domain/branding';
import { REPORT_REASONS, timeAgo, type ReportReason } from '../domain/community';
import { useColors } from '../state/branding-context';
import { useSession } from '../state/session-context';
import { radius, spacing, type as typography } from '../theme';
import { Stars } from './Stars';
import { communityStrings as t } from './strings';

export function PostCard({
  post,
  compact = false,
  onOpen,
  onChanged,
}: {
  readonly post: PostRow;
  /** En Inicio: texto recortado, sin acciones. */
  readonly compact?: boolean;
  readonly onOpen?: () => void;
  /** Se borró o se ocultó: la lista se recarga. */
  readonly onChanged?: () => void;
}): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createPostStyles(colors), [colors]);
  const router = useRouter();
  const { user } = useSession();
  const [helpful, setHelpful] = useState({ on: post.i_found_helpful, count: post.helpful_count });
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needLogin = (): boolean => {
    if (user !== null) return false;
    router.push('/profile');
    return true;
  };

  const onHelpful = async (): Promise<void> => {
    if (needLogin() || post.mine || busy) return;
    setBusy(true);
    // Se ve al momento; si falla, se regresa.
    const before = helpful;
    setHelpful({ on: !before.on, count: before.count + (before.on ? -1 : 1) });
    try {
      setHelpful(await toggleHelpful(post.id));
    } catch {
      setHelpful(before);
    } finally {
      setBusy(false);
    }
  };

  const onReport = async (reason: ReportReason): Promise<void> => {
    setReporting(false);
    try {
      const result = await report({ postId: post.id }, reason);
      setNotice(result.hidden ? t.reportHidden : t.reportThanks);
      if (result.hidden) onChanged?.();
    } catch (error) {
      setNotice(error instanceof CommunityFailure ? t.errors[error.kind] : t.errors.generic);
    }
  };

  const onDelete = async (): Promise<void> => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t.deleteConfirm)) {
      return;
    }
    try {
      await deleteOwn({ postId: post.id });
      onChanged?.();
    } catch {
      setNotice(t.errors.generic);
    }
  };

  const isPublic = post.status === 'published' && post.kind !== 'suggestion';

  return (
    <Pressable
      accessibilityRole={onOpen ? 'button' : undefined}
      disabled={onOpen === undefined}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, compact && styles.cardCompact, pressed && styles.pressed]}
    >
      <View style={styles.head}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{post.author_name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.grow}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {post.author_name}
            </Text>
            {post.verified ? (
              <View style={styles.verified} accessibilityLabel={t.verifiedHint}>
                <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                <Text style={styles.verifiedText}>{t.verified}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {t.kinds[post.kind]} · {timeAgo(post.created_at)}
            {post.store_name !== null ? ` · ${post.store_name}` : ''}
          </Text>
        </View>
      </View>

      {post.rating !== null ? <Stars value={post.rating} size={16} emptyColor={colors.border} /> : null}

      <Text style={styles.body} numberOfLines={compact ? 3 : undefined}>
        {post.body}
      </Text>

      {post.item_name !== null ? (
        <Text style={styles.about} numberOfLines={1}>
          {t.about(post.item_name)}
        </Text>
      ) : null}

      {post.photo_url !== null ? (
        <Image
          source={post.photo_url}
          style={compact ? styles.photoCompact : styles.photo}
          contentFit="cover"
          transition={150}
          accessibilityLabel="Foto de la publicación"
        />
      ) : null}

      {post.mine && post.status === 'pending' ? <Text style={styles.flag}>{t.pendingMine}</Text> : null}
      {post.mine && post.status === 'hidden' ? (
        <Text style={[styles.flag, styles.flagDanger]}>{t.hiddenMine(post.hidden_reason)}</Text>
      ) : null}
      {post.mine && post.kind === 'suggestion' ? <Text style={styles.flag}>{t.privateSuggestion}</Text> : null}
      {post.mine && post.rewarded_points !== null ? (
        <Text style={[styles.flag, styles.flagOk]}>{t.rewarded(post.rewarded_points)}</Text>
      ) : null}

      {compact ? (
        post.store_replied ? (
          <Text style={styles.storeReplied}>
            <Ionicons name="chatbubble-ellipses" size={12} color={colors.primary} /> {t.storeReplied}
          </Text>
        ) : null
      ) : (
        <View style={styles.actions}>
          {isPublic ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: helpful.on, disabled: post.mine }}
              onPress={() => void onHelpful()}
              disabled={post.mine}
              style={({ pressed }) => [styles.action, helpful.on && styles.actionOn, pressed && styles.pressed]}
            >
              <Ionicons
                name={helpful.on ? 'thumbs-up' : 'thumbs-up-outline'}
                size={16}
                color={helpful.on ? colors.onPrimary : colors.textMuted}
              />
              <Text style={[styles.actionText, helpful.on && styles.actionTextOn]}>{t.helpfulCount(helpful.count)}</Text>
            </Pressable>
          ) : null}
          {onOpen !== undefined ? (
            <Pressable
              accessibilityRole="button"
              onPress={onOpen}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Ionicons name="chatbubble-outline" size={16} color={colors.textMuted} />
              <Text style={styles.actionText}>{t.replies(post.reply_count)}</Text>
            </Pressable>
          ) : null}
          {post.store_replied ? (
            <View style={styles.storeTag}>
              <Ionicons name="storefront" size={12} color={colors.primary} />
              <Text style={styles.storeTagText}>{t.storeReplied}</Text>
            </View>
          ) : null}
          <View style={styles.grow} />
          {post.mine ? (
            <Pressable accessibilityRole="button" onPress={() => void onDelete()} hitSlop={8}>
              <Text style={styles.link}>{t.delete}</Text>
            </Pressable>
          ) : isPublic ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.report}
              onPress={() => {
                if (!needLogin()) setReporting((v) => !v);
              }}
              hitSlop={8}
            >
              <Ionicons name="flag-outline" size={16} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
      )}

      {reporting ? (
        <View style={styles.reportBox}>
          <Text style={styles.reportTitle}>{t.reportTitle}</Text>
          {REPORT_REASONS.map((reason) => (
            <Pressable
              key={reason}
              accessibilityRole="button"
              onPress={() => void onReport(reason)}
              style={({ pressed }) => [styles.reportOption, pressed && styles.pressed]}
            >
              <Text style={styles.reportText}>{t.reasons[reason]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {notice !== null ? <Text style={styles.flag}>{notice}</Text> : null}
    </Pressable>
  );
}

export function createPostStyles(colors: BrandColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    cardCompact: { padding: spacing.md },
    pressed: { opacity: 0.7 },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.onPrimary, fontWeight: '800', fontSize: 16 },
    grow: { flex: 1, minWidth: 0 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
    name: { color: colors.text, fontWeight: '700', fontSize: typography.body.fontSize, flexShrink: 1 },
    verified: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    verifiedText: { color: colors.success, fontSize: 11, fontWeight: '700' },
    meta: { color: colors.textMuted, fontSize: typography.caption.fontSize },
    body: { color: colors.text, fontSize: typography.body.fontSize, lineHeight: 21 },
    about: { color: colors.textMuted, fontSize: typography.caption.fontSize, fontWeight: '600' },
    photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.border },
    photoCompact: { width: '100%', height: 140, borderRadius: radius.md, backgroundColor: colors.border },
    flag: {
      color: colors.textMuted,
      fontSize: typography.caption.fontSize,
      backgroundColor: colors.background,
      borderRadius: radius.sm,
      padding: spacing.sm,
    },
    flagDanger: { color: colors.danger },
    flagOk: { color: colors.success, fontWeight: '700' },
    actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.xs },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    actionOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    actionText: { color: colors.textMuted, fontSize: typography.label.fontSize, fontWeight: '600' },
    actionTextOn: { color: colors.onPrimary },
    storeTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    storeTagText: { color: colors.primary, fontSize: typography.caption.fontSize, fontWeight: '700' },
    storeReplied: { color: colors.primary, fontSize: typography.caption.fontSize, fontWeight: '700' },
    link: { color: colors.danger, fontSize: typography.label.fontSize, fontWeight: '600' },
    reportBox: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: spacing.sm,
      gap: 2,
    },
    reportTitle: { color: colors.text, fontWeight: '700', fontSize: typography.label.fontSize, marginBottom: 4 },
    reportOption: { paddingVertical: spacing.sm },
    reportText: { color: colors.text, fontSize: typography.body.fontSize },
  });
}
