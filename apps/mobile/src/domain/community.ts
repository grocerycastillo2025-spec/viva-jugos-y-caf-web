/**
 * Comunidad (0033): reglas puras que la app comparte con la base.
 *
 * La base es la que manda (bloquea datos personales aunque la app no lo
 * haga); aquí se revisa ANTES de mandar para avisar al momento y no
 * después de un viaje al servidor.
 */

export type PostKind = 'review' | 'question' | 'suggestion';
export type PostStatus = 'published' | 'pending' | 'hidden';
export type FeedFilter = 'all' | 'review' | 'question' | 'mine';
export type AdminFilter =
  | 'all'
  | 'pending'
  | 'reported'
  | 'unanswered'
  | 'review'
  | 'question'
  | 'suggestion'
  | 'hidden';
export type ReportReason = 'ofensivo' | 'spam' | 'datos_personales' | 'falso' | 'otro';

export const REPORT_REASONS: readonly ReportReason[] = [
  'ofensivo',
  'spam',
  'datos_personales',
  'falso',
  'otro',
];

/** Motivos rápidos para ocultar desde el panel. */
export const HIDE_REASONS: readonly string[] = [
  'Lenguaje ofensivo',
  'Datos personales',
  'Spam o publicidad',
  'No es sobre VIVA',
  'Información falsa',
];

export const MAX_POST = 600;
export const MAX_REPLY = 500;

/** Correo, teléfono (8+ dígitos con espacios o guiones), CLABE o tarjeta. */
export function hasPersonalData(text: string): boolean {
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) return true;
  return /[0-9]{8,}/.test(text.replace(/[\s().+-]/g, ''));
}

export type PostProblem = 'rating' | 'short' | 'long' | 'personal';

export function validatePost(kind: PostKind, body: string, rating: number | null): PostProblem | null {
  const text = body.trim();
  if (kind === 'review' && (rating === null || rating < 1 || rating > 5)) return 'rating';
  if (text.length < 3) return 'short';
  if (text.length > MAX_POST) return 'long';
  if (hasPersonalData(text)) return 'personal';
  return null;
}

/** "hace 5 min", "hace 3 h", "ayer", "12 oct". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return 'ahora';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const label = `${then.getDate()} ${months[then.getMonth()]}`;
  return then.getFullYear() === now.getFullYear() ? label : `${label} ${then.getFullYear()}`;
}

/** Barras de 5 a 1 estrellas, con el porcentaje de cada una. */
export function starBars(
  stars: Readonly<Record<string, number>> | null | undefined,
): { readonly stars: number; readonly count: number; readonly pct: number }[] {
  const total = Object.values(stars ?? {}).reduce((a, b) => a + b, 0);
  return [5, 4, 3, 2, 1].map((s) => {
    const count = stars?.[String(s)] ?? 0;
    return { stars: s, count, pct: total === 0 ? 0 : Math.round((count / total) * 100) };
  });
}

/** Errores de la base -> clave de mensaje para el cliente. */
export type CommunityError =
  | 'login'
  | 'personal'
  | 'rating'
  | 'short'
  | 'long'
  | 'tooMany'
  | 'off'
  | 'notFound'
  | 'reason'
  | 'already'
  | 'missing'
  | 'generic';

export function communityError(message: string | null | undefined, code?: string | null): CommunityError {
  const m = message ?? '';
  if (code === 'PGRST202' || code === '42883' || code === 'PGRST205' || code === '42P01') return 'missing';
  if (m.includes('login_required')) return 'login';
  if (m.includes('personal_data')) return 'personal';
  if (m.includes('rating_required')) return 'rating';
  if (m.includes('too_short')) return 'short';
  if (m.includes('too_long')) return 'long';
  if (m.includes('too_many')) return 'tooMany';
  if (m.includes('community_off')) return 'off';
  if (m.includes('not_found')) return 'notFound';
  if (m.includes('reason_required')) return 'reason';
  if (m.includes('already_rewarded')) return 'already';
  return 'generic';
}
