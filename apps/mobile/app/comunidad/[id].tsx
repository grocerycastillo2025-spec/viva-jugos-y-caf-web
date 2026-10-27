/**
 * Una publicación con su conversación: la tienda y otros clientes
 * responden. Las respuestas también se pueden reportar o borrar.
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  CommunityFailure,
  deleteOwn,
  fetchPost,
  replyToPost,
  report,
  type ReplyRow,
} from '../../src/api/community';
import { BackRow } from '../../src/community/BackRow';
import { PostCard } from '../../src/community/PostCard';
import { communityStrings as t } from '../../src/community/strings';
import { DataState } from '../../src/components/DataState';
import { Screen } from '../../src/components/Screen';
import type { BrandColors } from '../../src/domain/branding';
import { MAX_REPLY, REPORT_REASONS, hasPersonalData, timeAgo, type ReportReason } from '../../src/domain/community';
import { useAsync } from '../../src/hooks/use-async';
import { useColors } from '../../src/state/branding-context';
import { useSession } from '../../src/state/session-context';
import { radius, spacing, type as typography } from '../../src/theme';

export default function PostScreen(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { user } = useSession();
  const load = useCallback(() => fetchPost(String(id)), [id]);
  const { data, loading, error, refresh, refreshing, reload } = useAsync(load, [id]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const send = async (): Promise<void> => {
    if (user === null) {
      router.push('/profile');
      return;
    }
    const body = text.trim();
    if (body === '') return;
    if (hasPersonalData(body)) {
      setMessage(t.errors.personal);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await replyToPost(String(id), body);
      setText('');
      if (result.status !== 'published') setMessage(t.reply.pending);
      reload();
    } catch (e) {
      setMessage(e instanceof CommunityFailure ? t.errors[e.kind] : t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  if (data === null || data === undefined) {
    return (
      <Screen scroll={false} contentStyle={styles.content}>
        <BackRow />
        <DataState
          loading={loading}
          error={error}
          empty={!loading && data === null}
          emptyTitle={t.notFound}
          onRetry={reload}
        >
          {null}
        </DataState>
      </Screen>
    );
  }

  const canReply = data.status === 'published' || data.mine;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} contentStyle={styles.content}>
      <BackRow />
      <PostCard key={data.id} post={data} onChanged={() => (router.canGoBack() ? router.back() : router.replace('/comunidad'))} />

      <Text style={styles.section}>{t.replies(data.replies.length)}</Text>
      {data.replies.length === 0 ? <Text style={styles.empty}>{t.reply.none}</Text> : null}
      {data.replies.map((reply) => (
        <Reply key={reply.id} reply={reply} onChanged={reload} />
      ))}

      {canReply ? (
        <View style={styles.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={user === null ? t.composer.loginBody : t.reply.placeholder}
            placeholderTextColor={colors.textFaint}
            multiline
            maxLength={MAX_REPLY}
            editable={user !== null}
            accessibilityLabel={t.reply.placeholder}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.reply.send}
            onPress={() => void send()}
            disabled={busy}
            style={({ pressed }) => [styles.send, (pressed || busy) && styles.pressed]}
          >
            <Ionicons name={user === null ? 'log-in-outline' : 'send'} size={20} color={colors.onPrimary} />
          </Pressable>
        </View>
      ) : null}
      {message !== null ? <Text style={styles.message}>{message}</Text> : null}
    </Screen>
  );
}

function Reply({ reply, onChanged }: { readonly reply: ReplyRow; readonly onChanged: () => void }): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { user } = useSession();
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const onReport = async (reason: ReportReason): Promise<void> => {
    setReporting(false);
    try {
      const r = await report({ replyId: reply.id }, reason);
      setNote(r.hidden ? t.reportHidden : t.reportThanks);
      if (r.hidden) onChanged();
    } catch {
      setNote(t.errors.generic);
    }
  };

  return (
    <View style={[styles.reply, reply.is_store && styles.replyStore]}>
      <View style={styles.replyHead}>
        {reply.is_store ? <Ionicons name="storefront" size={14} color={colors.primary} /> : null}
        <Text style={[styles.replyName, reply.is_store && styles.replyNameStore]}>{reply.author_name}</Text>
        {reply.verified ? <Ionicons name="checkmark-circle" size={13} color={colors.success} /> : null}
        <Text style={styles.replyTime}>· {timeAgo(reply.created_at)}</Text>
        <View style={styles.grow} />
        {reply.mine ? (
          <Pressable
            onPress={() => void deleteOwn({ replyId: reply.id }).then(onChanged).catch(() => setNote(t.errors.generic))}
            hitSlop={8}
          >
            <Text style={styles.deleteLink}>{t.delete}</Text>
          </Pressable>
        ) : !reply.is_store && reply.status === 'published' ? (
          <Pressable
            accessibilityLabel={t.report}
            onPress={() => (user === null ? router.push('/profile') : setReporting((v) => !v))}
            hitSlop={8}
          >
            <Ionicons name="flag-outline" size={14} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.replyBody}>{reply.body}</Text>
      {reply.mine && reply.status === 'pending' ? <Text style={styles.note}>{t.reply.pending}</Text> : null}
      {reply.mine && reply.status === 'hidden' ? (
        <Text style={styles.note}>{t.hiddenMine(reply.hidden_reason)}</Text>
      ) : null}
      {reporting ? (
        <View style={styles.reportBox}>
          <Text style={styles.replyName}>{t.reportTitle}</Text>
          {REPORT_REASONS.map((reason) => (
            <Pressable key={reason} onPress={() => void onReport(reason)} style={styles.reportOption}>
              <Text style={styles.replyBody}>{t.reasons[reason]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {note !== null ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    content: { padding: spacing.lg, gap: spacing.md },
    pressed: { opacity: 0.6 },
    grow: { flex: 1 },
    section: { color: colors.text, fontWeight: '700', fontSize: typography.section.fontSize, marginTop: spacing.sm },
    empty: { color: colors.textMuted },
    reply: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: 4,
      marginLeft: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    replyStore: { borderColor: colors.primary, borderLeftWidth: 4 },
    replyHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    replyName: { color: colors.text, fontWeight: '700', fontSize: typography.label.fontSize },
    replyNameStore: { color: colors.primary },
    replyTime: { color: colors.textMuted, fontSize: typography.caption.fontSize },
    replyBody: { color: colors.text, fontSize: typography.body.fontSize, lineHeight: 20 },
    deleteLink: { color: colors.danger, fontSize: typography.caption.fontSize, fontWeight: '600' },
    note: { color: colors.textMuted, fontSize: typography.caption.fontSize },
    reportBox: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: 4 },
    reportOption: { paddingVertical: 6 },
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
    input: {
      flex: 1,
      minHeight: 48,
      maxHeight: 140,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.text,
      fontSize: typography.body.fontSize,
    },
    send: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    message: { color: colors.textMuted, fontSize: typography.label.fontSize },
  });
}
