/**
 * Errores de Supabase Auth (en inglés) → clave para un mensaje en español.
 */
export type AuthErrorKey =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'already_registered'
  | 'rate_limit'
  | 'weak_password'
  | 'invalid_email'
  | 'signups_disabled'
  | 'network'
  | 'other';

export function authErrorKey(message: string): AuthErrorKey {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'invalid_credentials';
  if (m.includes('email not confirmed')) return 'email_not_confirmed';
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('user already exists')) {
    return 'already_registered';
  }
  if (m.includes('rate limit') || m.includes('too many requests') || m.includes('security purposes')) return 'rate_limit';
  if (m.includes('password')) return 'weak_password';
  if (m.includes('invalid format') || m.includes('email address') || m.includes('invalid email')) return 'invalid_email';
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'signups_disabled';
  if (m.includes('failed to fetch') || m.includes('network')) return 'network';
  return 'other';
}
