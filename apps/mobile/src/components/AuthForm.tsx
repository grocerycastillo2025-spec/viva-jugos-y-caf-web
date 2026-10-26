/**
 * Alta y entrada por correo, y Google si esta configurado.
 *
 * Vive en un componente porque se usa en dos sitios: la pestana Profile y
 * la puerta del checkout, donde hay que identificarse antes de pedir.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { authErrorKey } from '../domain/auth-errors';
import { getSupabase } from '../supabase';

import type { BrandColors } from '../domain/branding';
import { useColors } from '../state/branding-context';
import { useSession } from '../state/session-context';
import { strings } from '../strings';
import { radius, spacing, type as typography } from '../theme';
import { Button } from './ui';

export function AuthForm({
  title,
  body,
  onSignedIn,
}: {
  readonly title?: string;
  readonly body?: string;
  readonly onSignedIn?: () => void;
}): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { signIn, signUp, signInWithGoogle, googleEnabled } = useSession();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  // En pantalla, no en Alert: Alert.alert no se ve en la web.
  const [feedback, setFeedback] = useState<{
    tone: 'ok' | 'error';
    text: string;
    resend: boolean;
  } | null>(null);

  const explain = (cause: unknown): { text: string; resend: boolean } => {
    const raw = cause instanceof Error ? cause.message : String(cause);
    const key = authErrorKey(raw);
    const text =
      key === 'other'
        ? `${strings.auth.errors['other'] ?? ''} (${raw})`
        : (strings.auth.errors[key] ?? raw);
    return { text, resend: key === 'email_not_confirmed' };
  };

  const resend = useCallback(async () => {
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.resend({ type: 'signup', email: email.trim() });
      if (error) throw new Error(error.message);
      setFeedback({ tone: 'ok', text: strings.auth.resent, resend: false });
    } catch (cause) {
      setFeedback({ tone: 'error', ...explain(cause) });
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const submit = useCallback(async () => {
    setBusy(true);
    setFeedback(null);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
        onSignedIn?.();
      } else {
        const needsConfirmation = await signUp(email, password, firstName);
        setPassword('');
        if (needsConfirmation) {
          setFeedback({ tone: 'ok', text: strings.auth.confirmSent(email.trim()), resend: true });
          setMode('signin');
        } else {
          onSignedIn?.();
        }
      }
    } catch (cause) {
      setFeedback({ tone: 'error', ...explain(cause) });
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, firstName, mode, onSignedIn, password, signIn, signUp]);

  const google = useCallback(async () => {
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
      onSignedIn?.();
    } catch (cause) {
      setFeedback({ tone: 'error', ...explain(cause) });
    } finally {
      setGoogleBusy(false);
    }
  }, [onSignedIn, signInWithGoogle]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {title ?? (mode === 'signin' ? strings.auth.signInTitle : strings.auth.signUpTitle)}
      </Text>
      <Text style={styles.body}>{body ?? strings.auth.body}</Text>

      {googleEnabled ? (
        <>
          <Button
            label={strings.auth.google}
            variant="outline"
            onPress={() => void google()}
            busy={googleBusy}
          />
          <Text style={styles.divider}>{strings.auth.orEmail}</Text>
        </>
      ) : null}

      {mode === 'signup' ? (
        <TextInput
          value={firstName}
          onChangeText={setFirstName}
          placeholder={strings.auth.firstName}
          placeholderTextColor={colors.textFaint}
          autoCapitalize="words"
          autoComplete="given-name"
          style={styles.input}
        />
      ) : null}

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder={strings.auth.email}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        style={styles.input}
      />

      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder={strings.auth.password}
        placeholderTextColor={colors.textFaint}
        secureTextEntry
        autoCapitalize="none"
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        style={styles.input}
      />

      {feedback !== null ? (
        <View
          style={[
            styles.feedback,
            feedback.tone === 'ok' ? styles.feedbackOk : styles.feedbackError,
          ]}
        >
          <Text style={styles.feedbackText}>{feedback.text}</Text>
          {feedback.resend && email.includes('@') ? (
            <Pressable accessibilityRole="button" onPress={() => void resend()} disabled={busy}>
              <Text style={styles.feedbackLink}>{strings.auth.resend}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Button
        label={mode === 'signin' ? strings.auth.signIn : strings.auth.signUp}
        onPress={() => void submit()}
        busy={busy}
        disabled={email.trim() === '' || password === ''}
      />

      <Button
        label={mode === 'signin' ? strings.auth.noAccount : strings.auth.haveAccount}
        variant="outline"
        onPress={() => {
          setFeedback(null);
          setMode(mode === 'signin' ? 'signup' : 'signin');
        }}
      />
    </View>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    feedback: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
    feedbackOk: { borderColor: colors.success, backgroundColor: '#EEF7F1' },
    feedbackError: { borderColor: colors.danger, backgroundColor: '#FDEFEE' },
    feedbackText: { color: colors.text, fontSize: typography.label.fontSize, lineHeight: 20 },
    feedbackLink: { color: colors.primary, fontSize: typography.label.fontSize, fontWeight: '800' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.md,
    },
    title: { color: colors.text, fontSize: typography.section.fontSize, fontWeight: '800' },
    body: { color: colors.textMuted, fontSize: typography.body.fontSize, lineHeight: 21 },
    divider: {
      color: colors.textFaint,
      fontSize: typography.caption.fontSize,
      textAlign: 'center',
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg,
      minHeight: 48,
      color: colors.text,
      fontSize: typography.body.fontSize,
    },
  });
}
