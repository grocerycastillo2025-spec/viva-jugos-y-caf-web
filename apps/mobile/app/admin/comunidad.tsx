/**
 * Panel → Comunidad.
 *
 *   Bandeja     por revisar, reportadas, sin responder, sugerencias...
 *               Publicar / Ocultar (con motivo), responder como VIVA,
 *               premiar con puntos, revisar las respuestas.
 *   Avisos      eventos y novedades que salen en Inicio.
 *   Ajustes     prender/apagar, publicar al momento o revisar antes,
 *               puntos por la primera reseña (solo el dueño).
 *   Bitácora    quién hizo qué y por qué.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  CommunityFailure,
  DEFAULT_SETTINGS,
  createNotice,
  deleteNotice,
  fetchAdminList,
  fetchCommunitySettings,
  fetchCommunitySummary,
  fetchLog,
  fetchNotices,
  fetchPost,
  moderate,
  replyToPost,
  rewardPost,
  saveCommunitySettings,
  uploadCommunityPhoto,
  type AdminPost,
  type CommunitySettings,
  type PostDetail,
} from '../../src/api/community';
import { useAdmin } from '../../src/admin/admin-context';
import { canPickImages, pickCommunityPhoto, type PickedImage } from '../../src/admin/pick-image';
import { AdminShell, Card, Field, Notice, Toggle } from '../../src/admin/ui';
import { Stars } from '../../src/community/Stars';
import { communityStrings } from '../../src/community/strings';
import { DataState } from '../../src/components/DataState';
import { Button } from '../../src/components/ui';
import type { BrandColors } from '../../src/domain/branding';
import { HIDE_REASONS, timeAgo, type AdminFilter } from '../../src/domain/community';
import { useAsync } from '../../src/hooks/use-async';
import { useColors } from '../../src/state/branding-context';
import { useSession } from '../../src/state/session-context';
import { radius, spacing, type as typography } from '../../src/theme';

const t = communityStrings.admin;
const FILTERS: readonly AdminFilter[] = [
  'pending',
  'reported',
  'unanswered',
  'suggestion',
  'all',
  'review',
  'question',
  'hidden',
];
type Section = 'inbox' | 'notices' | 'settings' | 'log';

function failText(error: unknown): string {
  return error instanceof CommunityFailure ? communityStrings.errors[error.kind] : communityStrings.errors.generic;
}

export default function AdminCommunityScreen(): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { restaurantId, isOwner } = useAdmin();
  const [section, setSection] = useState<Section>('inbox');

  const sections: { key: Section; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'inbox', label: t.inbox, icon: 'chatbubbles-outline' },
    { key: 'notices', label: t.notices, icon: 'megaphone-outline' },
    ...(isOwner ? [{ key: 'settings' as const, label: t.settings, icon: 'settings-outline' as const }] : []),
    { key: 'log', label: t.log, icon: 'document-text-outline' },
  ];

  return (
    <AdminShell>
      <View style={styles.sectionRow}>
        {sections.map((s) => (
          <Pressable
            key={s.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: section === s.key }}
            onPress={() => setSection(s.key)}
            style={({ pressed }) => [styles.sectionTab, section === s.key && styles.sectionTabOn, pressed && styles.pressed]}
          >
            <Ionicons name={s.icon} size={16} color={section === s.key ? colors.onPrimary : colors.primary} />
            <Text style={[styles.sectionTabText, section === s.key && styles.sectionTabTextOn]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
      {section === 'inbox' ? <Inbox restaurantId={restaurantId} isOwner={isOwner} /> : null}
      {section === 'notices' ? <Notices restaurantId={restaurantId} /> : null}
      {section === 'settings' && isOwner ? <Settings restaurantId={restaurantId} /> : null}
      {section === 'log' ? <Log restaurantId={restaurantId} /> : null}
    </AdminShell>
  );
}

// ---------------------------------------------------------------------
// BANDEJA
// ---------------------------------------------------------------------
function Inbox({ restaurantId, isOwner }: { readonly restaurantId: string; readonly isOwner: boolean }): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [filter, setFilter] = useState<AdminFilter>('pending');
  const load = useCallback(
    async () => {
      const [list, summary] = await Promise.all([
        fetchAdminList(restaurantId, filter),
        fetchCommunitySummary(restaurantId),
      ]);
      return { list, summary };
    },
    [restaurantId, filter],
  );
  const { data, loading, error, reload } = useAsync(load, [restaurantId, filter]);

  // Si no hay nada por revisar al entrar, se abre "Sin responder".
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto || data == null || data.list === null) return;
    setAuto(false);
    if (filter === 'pending' && data.list.counts.pending === 0) setFilter('unanswered');
  }, [auto, data, filter]);

  if (data != null && data.list === null) {
    return <Notice tone="error" text={communityStrings.errors.missing} />;
  }
  const counts = data?.list?.counts;
  const countFor = (f: AdminFilter): number | null =>
    counts === undefined
      ? null
      : f === 'pending'
        ? counts.pending
        : f === 'reported'
          ? counts.reported
          : f === 'unanswered'
            ? counts.unanswered
            : f === 'suggestion'
              ? counts.suggestion
              : null;

  return (
    <View style={styles.stack}>
      {data?.summary !== undefined && data.summary.reviews > 0 ? (
        <Text style={styles.summary}>
          {t.summary((data.summary.avg_rating ?? 0).toFixed(1), data.summary.reviews)}
        </Text>
      ) : null}
      <View style={styles.chips}>
        {FILTERS.map((f) => {
          const n = countFor(f);
          const on = filter === f;
          return (
            <Pressable
              key={f}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setFilter(f)}
              style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{t.filters[f]}</Text>
              {n !== null && n > 0 ? (
                <View style={[styles.count, (f === 'pending' || f === 'reported') && styles.countAlert]}>
                  <Text style={styles.countText}>{n}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <DataState
        loading={loading && data == null}
        error={error}
        empty={!loading && (data?.list?.posts.length ?? 0) === 0}
        emptyTitle={t.empty}
        onRetry={reload}
      >
        {(data?.list?.posts ?? []).map((post) => (
          <AdminPostCard key={post.id} post={post} isOwner={isOwner} onChanged={reload} />
        ))}
      </DataState>
    </View>
  );
}

function AdminPostCard({
  post,
  isOwner,
  onChanged,
}: {
  readonly post: AdminPost;
  readonly isOwner: boolean;
  readonly onChanged: () => void;
}): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [mode, setMode] = useState<'none' | 'hide' | 'reply' | 'reward'>('none');
  const [reason, setReason] = useState('');
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const hasReplyWork = post.pending_replies > 0 || post.reported_replies > 0;

  const openReplies = useCallback(async () => {
    try {
      setDetail(await fetchPost(post.id));
    } catch (e) {
      setMessage({ tone: 'error', text: failText(e) });
    }
  }, [post.id]);

  // Si hay respuestas por revisar, se enseñan de una vez.
  useEffect(() => {
    if (hasReplyWork) void openReplies();
  }, [hasReplyWork, openReplies]);

  const run = async (action: () => Promise<unknown>, ok?: string): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMode('none');
      if (ok !== undefined) setMessage({ tone: 'ok', text: ok });
      onChanged();
      if (detail !== null) void openReplies();
    } catch (e) {
      setMessage({ tone: 'error', text: failText(e) });
    } finally {
      setBusy(false);
    }
  };

  const statusStyle =
    post.status === 'published' ? styles.statusOk : post.status === 'pending' ? styles.statusWarn : styles.statusOff;

  return (
    <View style={[styles.card, post.status === 'pending' && styles.cardPending]}>
      <View style={styles.cardHead}>
        <View style={styles.grow}>
          <View style={styles.row}>
            <Text style={styles.author}>{post.author_name}</Text>
            {post.verified ? <Ionicons name="checkmark-circle" size={14} color={colors.success} /> : null}
            <Text style={styles.meta}>
              · {communityStrings.kinds[post.kind]} · {timeAgo(post.created_at)}
              {post.store_name !== null ? ` · ${post.store_name}` : ''}
            </Text>
          </View>
          {post.rating !== null ? <Stars value={post.rating} size={16} emptyColor={colors.border} /> : null}
        </View>
        <View style={[styles.status, statusStyle]}>
          <Text style={styles.statusText}>{t.status[post.status]}</Text>
        </View>
      </View>

      <Text style={styles.body}>{post.body}</Text>
      {post.item_name !== null ? <Text style={styles.meta}>{communityStrings.about(post.item_name)}</Text> : null}
      {post.photo_url !== null ? <Image source={post.photo_url} style={styles.photo} contentFit="cover" /> : null}

      <View style={styles.tags}>
        {post.report_count !== null && post.report_count > 0 ? (
          <Text style={[styles.tag, styles.tagAlert]}>
            ⚑ {t.reports(post.report_count)}: {post.reports.map((r) => communityStrings.reasons[r]).join(', ')}
          </Text>
        ) : null}
        {post.status === 'hidden' && post.hidden_reason !== null ? (
          <Text style={styles.tag}>Motivo: {post.hidden_reason}</Text>
        ) : null}
        {post.pending_replies > 0 ? <Text style={[styles.tag, styles.tagAlert]}>{t.pendingReplies(post.pending_replies)}</Text> : null}
        {post.store_replied ? <Text style={[styles.tag, styles.tagOk]}>✓ {communityStrings.storeReplied}</Text> : null}
        {post.rewarded_points !== null ? <Text style={[styles.tag, styles.tagOk]}>{t.rewarded(post.rewarded_points)}</Text> : null}
        {post.helpful_count > 0 ? <Text style={styles.tag}>👍 {post.helpful_count}</Text> : null}
      </View>

      <View style={styles.actions}>
        {post.status !== 'published' ? (
          <ActionButton icon="eye-outline" label={t.publish} tone="ok" disabled={busy}
            onPress={() => void run(() => moderate({ postId: post.id }, 'published', null))} />
        ) : null}
        {post.status !== 'hidden' ? (
          <ActionButton icon="eye-off-outline" label={t.hide} tone="danger" disabled={busy}
            onPress={() => setMode(mode === 'hide' ? 'none' : 'hide')} />
        ) : null}
        <ActionButton icon="chatbubble-outline" label={t.reply} disabled={busy}
          onPress={() => setMode(mode === 'reply' ? 'none' : 'reply')} />
        {isOwner && post.rewarded_points === null ? (
          <ActionButton icon="gift-outline" label={t.reward} disabled={busy}
            onPress={() => setMode(mode === 'reward' ? 'none' : 'reward')} />
        ) : null}
        {post.reply_count > 0 || hasReplyWork ? (
          <ActionButton
            icon={detail === null ? 'chevron-down' : 'chevron-up'}
            label={detail === null ? `${t.showReplies} (${post.reply_count + post.pending_replies})` : t.hideReplies}
            onPress={() => (detail === null ? void openReplies() : setDetail(null))}
          />
        ) : null}
      </View>

      {mode === 'hide' ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{t.hideTitle}</Text>
          <View style={styles.chips}>
            {HIDE_REASONS.map((r) => (
              <Pressable key={r} onPress={() => setReason(r)} style={[styles.chip, reason === r && styles.chipOn]}>
                <Text style={[styles.chipText, reason === r && styles.chipTextOn]}>{r}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput value={reason} onChangeText={setReason} placeholder={t.otherReason}
            placeholderTextColor={colors.textFaint} style={styles.input} maxLength={200} />
          <Text style={styles.meta}>{t.hideNote}</Text>
          <Button label={t.hide} busy={busy} disabled={reason.trim() === ''}
            onPress={() => void run(() => moderate({ postId: post.id }, 'hidden', reason.trim()))} />
        </View>
      ) : null}

      {mode === 'reply' ? (
        <View style={styles.panel}>
          <TextInput value={replyText} onChangeText={setReplyText} placeholder={t.replyPlaceholder}
            placeholderTextColor={colors.textFaint} style={[styles.input, styles.inputMulti]} multiline maxLength={500} />
          <Button label={communityStrings.reply.send} busy={busy} disabled={replyText.trim() === ''}
            onPress={() =>
              void run(async () => {
                await replyToPost(post.id, replyText.trim());
                setReplyText('');
                await openReplies();
              })
            } />
        </View>
      ) : null}

      {mode === 'reward' ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{t.rewardTitle}</Text>
          <View style={styles.chips}>
            {[5, 10, 20, 50].map((n) => (
              <Pressable key={n} disabled={busy} onPress={() => void run(() => rewardPost(post.id, n), t.rewarded(n))}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                <Text style={styles.chipText}>+{n}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {detail !== null ? (
        <View style={styles.replies}>
          {detail.replies.map((r) => (
            <View key={r.id} style={[styles.reply, r.is_store && styles.replyStore]}>
              <View style={styles.row}>
                <Text style={styles.author}>{r.author_name}</Text>
                <Text style={styles.meta}>· {timeAgo(r.created_at)}</Text>
                <View style={styles.grow} />
                {r.status !== 'published' ? (
                  <View style={[styles.status, r.status === 'pending' ? styles.statusWarn : styles.statusOff]}>
                    <Text style={styles.statusText}>{t.status[r.status]}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.body}>{r.body}</Text>
              {!r.is_store ? (
                <View style={styles.actions}>
                  {r.status !== 'published' ? (
                    <ActionButton icon="eye-outline" label={t.publish} tone="ok" disabled={busy}
                      onPress={() => void run(() => moderate({ replyId: r.id }, 'published', null))} />
                  ) : null}
                  {r.status !== 'hidden' ? (
                    <ActionButton icon="eye-off-outline" label={t.hide} tone="danger" disabled={busy}
                      onPress={() => {
                        const why = HIDE_REASONS[0] ?? 'Lenguaje ofensivo';
                        const input = typeof window !== 'undefined' && typeof window.prompt === 'function'
                          ? window.prompt(t.hideTitle, why)
                          : why;
                        if (input !== null && input.trim() !== '') {
                          void run(() => moderate({ replyId: r.id }, 'hidden', input.trim()));
                        }
                      }} />
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {message !== null ? <Notice tone={message.tone} text={message.text} /> : null}
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  tone = 'default',
  disabled = false,
}: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: 'default' | 'ok' | 'danger';
  readonly disabled?: boolean;
}): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const color = tone === 'danger' ? colors.danger : tone === 'ok' ? colors.success : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.action, { borderColor: color }, (pressed || disabled) && styles.pressed]}
    >
      <Ionicons name={icon} size={15} color={color} />
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------
// AVISOS
// ---------------------------------------------------------------------
function Notices({ restaurantId }: { readonly restaurantId: string }): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useSession();
  const load = useCallback(() => fetchNotices(restaurantId), [restaurantId]);
  const { data, loading, error, reload } = useAsync(load, [restaurantId]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [days, setDays] = useState(7);
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const add = async (): Promise<void> => {
    if (title.trim().length < 2 || user === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const photoUrl = photo === null ? null : await uploadCommunityPhoto(user.id, photo.blob, photo.extension);
      await createNotice(restaurantId, {
        title: title.trim(),
        body: body.trim() === '' ? null : body.trim(),
        photo_url: photoUrl,
        pinned,
        expires_at: days === 0 ? null : new Date(Date.now() + days * 86_400_000).toISOString(),
      });
      setTitle('');
      setBody('');
      setPhoto(null);
      setPinned(false);
      setMessage({ tone: 'ok', text: t.noticeAdded });
      reload();
    } catch (e) {
      setMessage({ tone: 'error', text: failText(e) });
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  return (
    <View style={styles.stack}>
      <Card title={t.notices}>
        <Text style={styles.meta}>{t.noticesHint}</Text>
        <Field label={t.noticeTitle} value={title} onChangeText={setTitle} placeholder="Ej. Degustación gratis este sábado" />
        <Field label={t.noticeBody} value={body} onChangeText={setBody} multiline />
        {canPickImages ? (
          <Pressable
            onPress={() => void pickCommunityPhoto().then((p) => p !== null && setPhoto(p)).catch(() => undefined)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Ionicons name="image-outline" size={18} color={colors.primary} />
            <Text style={styles.link}>{photo === null ? communityStrings.composer.photo : communityStrings.composer.changePhoto}</Text>
          </Pressable>
        ) : null}
        {photo !== null ? <Image source={photo.previewUrl} style={styles.photo} contentFit="cover" /> : null}
        <Toggle label={t.noticePin} value={pinned} onValueChange={setPinned} />
        <Text style={styles.panelTitle}>{t.noticeDays}</Text>
        <View style={styles.chips}>
          {t.noticeDaysOptions.map((o) => (
            <Pressable key={o.days} onPress={() => setDays(o.days)} style={[styles.chip, days === o.days && styles.chipOn]}>
              <Text style={[styles.chipText, days === o.days && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
        <Button label={t.addNotice} busy={busy} disabled={title.trim().length < 2} onPress={() => void add()} />
        {message !== null ? <Notice tone={message.tone} text={message.text} /> : null}
      </Card>
      <DataState loading={loading && data == null} error={error} empty={!loading && (data ?? []).length === 0}
        emptyTitle={t.noNotices} onRetry={reload}>
        {(data ?? []).map((n) => {
          const expired = n.expires_at != null && new Date(n.expires_at).getTime() < now;
          return (
            <View key={n.id} style={[styles.card, expired && styles.dim]}>
              <View style={styles.row}>
                <Ionicons name={n.pinned ? 'pin' : 'megaphone-outline'} size={16} color={colors.accent} />
                <Text style={[styles.author, styles.grow]}>{n.title}</Text>
                {expired ? <Text style={styles.meta}>{t.expired}</Text> : null}
                <Pressable accessibilityLabel={t.deleteNotice} hitSlop={8}
                  onPress={() => void deleteNotice(n.id).then(reload).catch(() => undefined)}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
              {n.body !== null ? <Text style={styles.body}>{n.body}</Text> : null}
              {n.photo_url !== null ? <Image source={n.photo_url} style={styles.photo} contentFit="cover" /> : null}
              <Text style={styles.meta}>{timeAgo(n.created_at)}</Text>
            </View>
          );
        })}
      </DataState>
    </View>
  );
}

// ---------------------------------------------------------------------
// AJUSTES
// ---------------------------------------------------------------------
function Settings({ restaurantId }: { readonly restaurantId: string }): ReactNode {
  const load = useCallback(() => fetchCommunitySettings(restaurantId), [restaurantId]);
  const { data, loading, error, reload } = useAsync(load, [restaurantId]);
  const [draft, setDraft] = useState<CommunitySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (data != null) setDraft(data);
  }, [data]);

  if (data === null) return <Notice tone="error" text={communityStrings.errors.missing} />;
  const s = draft ?? data ?? DEFAULT_SETTINGS;

  const save = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      setDraft(await saveCommunitySettings(restaurantId, s));
      setMessage({ tone: 'ok', text: t.saved });
    } catch (e) {
      setMessage({ tone: 'error', text: failText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DataState loading={loading && data === undefined} error={error} empty={false} emptyTitle="" onRetry={reload}>
      <Card title={t.settings}>
        <Toggle label={t.enabled} hint={t.enabledHint} value={s.enabled}
          onValueChange={(v) => setDraft({ ...s, enabled: v })} />
        <Toggle label={t.autoPublish} hint={t.autoPublishHint} value={s.auto_publish}
          onValueChange={(v) => setDraft({ ...s, auto_publish: v })} />
        <Field
          label={t.firstReviewPoints}
          hint={t.firstReviewHint}
          keyboardType="number-pad"
          value={String(s.first_review_points)}
          onChangeText={(v) => setDraft({ ...s, first_review_points: Math.min(1000, Number(v.replace(/\D/g, '')) || 0) })}
        />
        <Button label={t.save} busy={busy} onPress={() => void save()} />
        {message !== null ? <Notice tone={message.tone} text={message.text} /> : null}
      </Card>
    </DataState>
  );
}

// ---------------------------------------------------------------------
// BITÁCORA
// ---------------------------------------------------------------------
function Log({ restaurantId }: { readonly restaurantId: string }): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const load = useCallback(() => fetchLog(restaurantId), [restaurantId]);
  const { data, loading, error, reload } = useAsync(load, [restaurantId]);
  return (
    <Card title={t.log}>
      <DataState loading={loading && data == null} error={error} empty={!loading && (data ?? []).length === 0}
        emptyTitle={t.logEmpty} onRetry={reload}>
        {(data ?? []).map((l) => (
          <View key={l.id} style={styles.logRow}>
            <Text style={styles.author}>
              {l.actor} · {t.actions[l.action] ?? l.action}
              <Text style={styles.meta}> · {timeAgo(l.created_at)}</Text>
            </Text>
            {l.target !== '' ? <Text style={styles.meta} numberOfLines={1}>“{l.target}”</Text> : null}
            {l.reason !== null ? <Text style={[styles.meta, styles.tagAlert]}>Motivo: {l.reason}</Text> : null}
            {l.detail !== null && l.action !== 'hide' && l.action !== 'publish' ? (
              <Text style={styles.meta}>{l.detail}</Text>
            ) : null}
          </View>
        ))}
      </DataState>
    </Card>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    pressed: { opacity: 0.6 },
    dim: { opacity: 0.5 },
    grow: { flex: 1, minWidth: 0 },
    stack: { gap: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    sectionRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.md },
    sectionTab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    sectionTabOn: { backgroundColor: colors.primary },
    sectionTabText: { color: colors.primary, fontWeight: '700', fontSize: typography.label.fontSize },
    sectionTabTextOn: { color: colors.onPrimary },
    summary: { color: colors.text, fontWeight: '700', fontSize: typography.body.fontSize },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.text, fontWeight: '600', fontSize: typography.label.fontSize },
    chipTextOn: { color: colors.onPrimary },
    count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
    countAlert: { backgroundColor: colors.danger },
    countText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    cardPending: { borderColor: '#E0A100', borderLeftWidth: 4 },
    cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    author: { color: colors.text, fontWeight: '700', fontSize: typography.label.fontSize + 1 },
    meta: { color: colors.textMuted, fontSize: typography.caption.fontSize },
    body: { color: colors.text, fontSize: typography.body.fontSize, lineHeight: 21 },
    photo: { width: '100%', maxWidth: 360, aspectRatio: 4 / 3, borderRadius: radius.md },
    status: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
    statusOk: { backgroundColor: '#E6F6EE' },
    statusWarn: { backgroundColor: '#FFF4D6' },
    statusOff: { backgroundColor: '#ECECEC' },
    statusText: { color: colors.text, fontSize: 11, fontWeight: '700' },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    tag: {
      fontSize: typography.caption.fontSize,
      color: colors.textMuted,
      backgroundColor: colors.background,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      overflow: 'hidden',
    },
    tagAlert: { color: colors.danger, fontWeight: '700' },
    tagOk: { color: colors.success, fontWeight: '700' },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    actionText: { fontWeight: '700', fontSize: typography.label.fontSize },
    panel: {
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.background,
    },
    panelTitle: { color: colors.text, fontWeight: '700', fontSize: typography.label.fontSize },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.text,
      fontSize: typography.body.fontSize,
    },
    inputMulti: { minHeight: 80, textAlignVertical: 'top' },
    replies: { gap: spacing.sm, marginTop: spacing.xs },
    reply: {
      marginLeft: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.background,
      gap: 4,
    },
    replyStore: { borderLeftWidth: 3, borderLeftColor: colors.primary },
    link: { color: colors.primary, fontWeight: '700' },
    logRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  });
}
