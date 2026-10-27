/**
 * Publicar en la comunidad: reseña (con estrellas), pregunta o sugerencia
 * privada. Con foto opcional.
 *
 * Parámetros: ?kind=review|question|suggestion, ?store=<id>, ?item=<id>.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { canPickImages, pickCommunityPhoto, type PickedImage } from '../../src/admin/pick-image';
import { CommunityFailure, createPost, uploadCommunityPhoto } from '../../src/api/community';
import { BackRow } from '../../src/community/BackRow';
import { Stars } from '../../src/community/Stars';
import { communityStrings as t } from '../../src/community/strings';
import { AuthForm } from '../../src/components/AuthForm';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/ui';
import type { BrandColors } from '../../src/domain/branding';
import { MAX_POST, validatePost, type PostKind } from '../../src/domain/community';
import { readEnv } from '../../src/env';
import { useColors } from '../../src/state/branding-context';
import { useSession } from '../../src/state/session-context';
import { useStores } from '../../src/state/store-context';
import { radius, spacing, type as typography } from '../../src/theme';

const KINDS: readonly PostKind[] = ['review', 'question', 'suggestion'];

function asKind(value: unknown): PostKind {
  return value === 'question' || value === 'suggestion' ? value : 'review';
}

export default function NewPostScreen(): ReactNode {
  const params = useLocalSearchParams<{ kind?: string; store?: string; item?: string }>();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { user } = useSession();
  const { stores, selectedStoreId } = useStores();

  const [kind, setKind] = useState<PostKind>(asKind(params.kind));
  const [rating, setRating] = useState<number | null>(null);
  const [body, setBody] = useState('');
  const [storeId, setStoreId] = useState<string | null>(
    typeof params.store === 'string' ? params.store : selectedStoreId,
  );
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [done, setDone] = useState(false);

  if (user === null) {
    return (
      <Screen contentStyle={styles.content}>
        <BackRow />
        <AuthForm title={t.composer.loginTitle} body={t.composer.loginBody} />
      </Screen>
    );
  }

  const choosePhoto = async (): Promise<void> => {
    try {
      const picked = await pickCommunityPhoto();
      if (picked !== null) setPhoto(picked);
    } catch {
      setMessage({ tone: 'error', text: t.errors.generic });
    }
  };

  const publish = async (): Promise<void> => {
    const problem = validatePost(kind, body, rating);
    if (problem !== null) {
      setMessage({ tone: 'error', text: t.errors[problem === 'personal' ? 'personal' : problem] });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const photoUrl = photo === null ? null : await uploadCommunityPhoto(user.id, photo.blob, photo.extension);
      const post = await createPost({
        restaurantId: readEnv().restaurantId,
        kind,
        body: body.trim(),
        rating,
        storeId,
        photoUrl,
        itemId: typeof params.item === 'string' ? params.item : null,
      });
      const lines: string[] = [post.status === 'published' ? t.composer.published : t.composer.pending];
      if (post.points_earned > 0) lines.push(t.composer.points(post.points_earned));
      setMessage({ tone: 'ok', text: lines.join(' ') });
      setDone(true);
      setTimeout(() => {
        if (router.canGoBack()) router.back();
        else router.replace('/comunidad');
      }, 1800);
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof CommunityFailure ? t.errors[error.kind] : t.errors.generic,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen contentStyle={styles.content}>
      <BackRow />
      <Text style={styles.title}>{t.composer.title}</Text>

      <Text style={styles.label}>{t.composer.kind}</Text>
      <View style={styles.kinds}>
        {KINDS.map((k) => (
          <Pressable
            key={k}
            accessibilityRole="radio"
            accessibilityState={{ selected: kind === k }}
            onPress={() => setKind(k)}
            style={({ pressed }) => [styles.kind, kind === k && styles.kindOn, pressed && styles.pressed]}
          >
            <Ionicons
              name={k === 'review' ? 'star' : k === 'question' ? 'help-circle' : 'bulb'}
              size={18}
              color={kind === k ? colors.onPrimary : colors.primary}
            />
            <Text style={[styles.kindText, kind === k && styles.kindTextOn]}>{t.kinds[k]}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>{t.kindHints[kind]}</Text>

      {kind === 'review' ? (
        <View style={styles.ratingBox}>
          <Text style={styles.label}>{t.composer.rating}</Text>
          <Stars value={rating ?? 0} size={36} onChange={setRating} emptyColor={colors.border} />
          <Text style={styles.ratingLabel}>{rating === null ? ' ' : t.composer.ratingLabels[rating]}</Text>
        </View>
      ) : null}

      {stores.length > 1 ? (
        <View style={styles.kinds}>
          {stores.map((s) => (
            <Pressable
              key={s.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: storeId === s.id }}
              onPress={() => setStoreId(s.id)}
              style={({ pressed }) => [styles.storeChip, storeId === s.id && styles.kindOn, pressed && styles.pressed]}
            >
              <Text style={[styles.kindText, storeId === s.id && styles.kindTextOn]}>{s.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View>
        <Text style={styles.label}>{t.composer.body}</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={MAX_POST}
          placeholder={t.placeholders[kind]}
          placeholderTextColor={colors.textFaint}
          accessibilityLabel={t.composer.body}
          style={styles.input}
        />
        <Text style={styles.counter}>{t.composer.counter(body.length, MAX_POST)}</Text>
      </View>

      {canPickImages ? (
        photo === null ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void choosePhoto()}
            style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]}
          >
            <Ionicons name="camera-outline" size={20} color={colors.primary} />
            <Text style={styles.photoButtonText}>{t.composer.photo}</Text>
          </Pressable>
        ) : (
          <View style={styles.photoBox}>
            <Image source={photo.previewUrl} style={styles.photo} contentFit="cover" />
            <View style={styles.photoActions}>
              <Pressable onPress={() => void choosePhoto()} hitSlop={6}>
                <Text style={styles.photoLink}>{t.composer.changePhoto}</Text>
              </Pressable>
              <Pressable onPress={() => setPhoto(null)} hitSlop={6}>
                <Text style={[styles.photoLink, styles.danger]}>{t.composer.removePhoto}</Text>
              </Pressable>
            </View>
          </View>
        )
      ) : null}

      <View style={styles.safety}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.success} />
        <Text style={styles.safetyText}>{t.composer.safety}</Text>
      </View>

      {message !== null ? (
        <Text style={[styles.message, message.tone === 'error' ? styles.messageError : styles.messageOk]}>
          {message.text}
        </Text>
      ) : null}

      <Button label={t.composer.publish} onPress={() => void publish()} busy={busy} disabled={done} />
    </Screen>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    content: { padding: spacing.lg, gap: spacing.md },
    pressed: { opacity: 0.7 },
    title: { color: colors.text, fontSize: typography.title.fontSize, fontWeight: '800' },
    label: { color: colors.text, fontWeight: '700', fontSize: typography.label.fontSize, marginBottom: spacing.xs },
    hint: { color: colors.textMuted, fontSize: typography.caption.fontSize + 1, marginTop: -spacing.xs },
    kinds: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    kind: {
      flexGrow: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    storeChip: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    kindOn: { backgroundColor: colors.primary },
    kindText: { color: colors.primary, fontWeight: '700', fontSize: typography.label.fontSize },
    kindTextOn: { color: colors.onPrimary },
    ratingBox: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
    ratingLabel: { color: colors.text, fontWeight: '700', fontSize: typography.body.fontSize },
    input: {
      minHeight: 130,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      padding: spacing.md,
      color: colors.text,
      fontSize: typography.body.fontSize,
      textAlignVertical: 'top',
    },
    counter: { color: colors.textFaint, fontSize: 11, textAlign: 'right', marginTop: 4 },
    photoButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.primary,
    },
    photoButtonText: { color: colors.primary, fontWeight: '700' },
    photoBox: { gap: spacing.sm },
    photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md },
    photoActions: { flexDirection: 'row', gap: spacing.lg },
    photoLink: { color: colors.primary, fontWeight: '700' },
    danger: { color: colors.danger },
    safety: {
      flexDirection: 'row',
      gap: spacing.sm,
      alignItems: 'flex-start',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    safetyText: { flex: 1, color: colors.textMuted, fontSize: typography.caption.fontSize + 1, lineHeight: 18 },
    message: { padding: spacing.md, borderRadius: radius.md, fontWeight: '600', overflow: 'hidden' },
    messageOk: { backgroundColor: '#E6F6EE', color: '#11683F' },
    messageError: { backgroundColor: '#FDECEC', color: '#A11D1D' },
  });
}
