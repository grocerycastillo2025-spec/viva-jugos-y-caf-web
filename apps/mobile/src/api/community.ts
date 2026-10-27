/**
 * Comunidad (migración 0033). Todo pasa por funciones de la base: las
 * tablas no se leen directo, así la base decide qué ve cada quien.
 */

import {
  communityError,
  type AdminFilter,
  type CommunityError,
  type FeedFilter,
  type PostKind,
  type PostStatus,
  type ReportReason,
} from '../domain/community';
import { getSupabase } from '../supabase';
import { uploadImage } from './admin';

export class CommunityFailure extends Error {
  constructor(readonly kind: CommunityError, message: string) {
    super(message);
  }
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw new CommunityFailure(communityError(error.message, error.code), error.message);
  return data as T;
}

/** Igual que `rpc`, pero una base sin la 0033 devuelve `fallback`. */
async function rpcOr<T>(name: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  try {
    return (await rpc<T | null>(name, args)) ?? fallback;
  } catch (error) {
    if (error instanceof CommunityFailure && error.kind === 'missing') return fallback;
    throw error;
  }
}

export interface PostRow {
  readonly id: string;
  readonly kind: PostKind;
  readonly rating: number | null;
  readonly body: string;
  readonly photo_url: string | null;
  readonly item_id: string | null;
  readonly item_name: string | null;
  readonly store_id: string | null;
  readonly store_name: string | null;
  readonly author_name: string;
  readonly verified: boolean;
  readonly status: PostStatus;
  readonly hidden_reason: string | null;
  readonly helpful_count: number;
  readonly reply_count: number;
  readonly report_count: number | null;
  readonly rewarded_points: number | null;
  readonly mine: boolean;
  readonly i_found_helpful: boolean;
  readonly store_replied: boolean;
  readonly created_at: string;
}

export interface ReplyRow {
  readonly id: string;
  readonly body: string;
  readonly author_name: string;
  readonly is_store: boolean;
  readonly verified: boolean;
  readonly status: PostStatus;
  readonly hidden_reason: string | null;
  readonly mine: boolean;
  readonly created_at: string;
}

export interface PostDetail extends PostRow {
  readonly replies: readonly ReplyRow[];
}

export interface NoticeRow {
  readonly id: string;
  readonly title: string;
  readonly body: string | null;
  readonly photo_url: string | null;
  readonly event_at: string | null;
  readonly pinned: boolean;
  readonly created_at: string;
  readonly expires_at?: string | null;
}

export interface CommunitySummary {
  readonly enabled: boolean;
  readonly reviews: number;
  readonly avg_rating: number | null;
  readonly stars: Readonly<Record<string, number>> | null;
  readonly by_store: readonly { readonly store_id: string; readonly avg: number; readonly count: number }[];
  readonly latest: readonly PostRow[];
  readonly notices: readonly NoticeRow[];
}

export const EMPTY_SUMMARY: CommunitySummary = {
  enabled: false,
  reviews: 0,
  avg_rating: null,
  stars: null,
  by_store: [],
  latest: [],
  notices: [],
};

// ---------------------------------------------------------------------
// CLIENTE
// ---------------------------------------------------------------------

export function fetchCommunitySummary(restaurantId: string): Promise<CommunitySummary> {
  return rpcOr('community_summary', { p_restaurant_id: restaurantId }, EMPTY_SUMMARY);
}

export function fetchFeed(
  restaurantId: string,
  filter: FeedFilter,
  before: string | null = null,
): Promise<PostRow[]> {
  return rpcOr('community_feed', { p_restaurant_id: restaurantId, p_kind: filter, p_limit: 30, p_before: before }, []);
}

export function fetchPost(postId: string): Promise<PostDetail | null> {
  return rpcOr<PostDetail | null>('community_post', { p_post_id: postId }, null);
}

export interface NewPost {
  readonly restaurantId: string;
  readonly kind: PostKind;
  readonly body: string;
  readonly rating: number | null;
  readonly storeId: string | null;
  readonly photoUrl: string | null;
  readonly itemId: string | null;
}

export function createPost(input: NewPost): Promise<PostRow & { readonly points_earned: number }> {
  return rpc('community_create_post', {
    p_restaurant_id: input.restaurantId,
    p_kind: input.kind,
    p_body: input.body,
    p_rating: input.kind === 'review' ? input.rating : null,
    p_store_id: input.storeId,
    p_photo_url: input.photoUrl,
    p_item_id: input.itemId,
  });
}

export function replyToPost(postId: string, body: string): Promise<{ readonly id: string; readonly status: PostStatus }> {
  return rpc('community_reply', { p_post_id: postId, p_body: body });
}

export function toggleHelpful(postId: string): Promise<{ readonly on: boolean; readonly count: number }> {
  return rpc('community_toggle_helpful', { p_post_id: postId });
}

export function report(
  target: { readonly postId?: string; readonly replyId?: string },
  reason: ReportReason,
): Promise<{ readonly hidden: boolean }> {
  return rpc('community_report', {
    p_post_id: target.postId ?? null,
    p_reply_id: target.replyId ?? null,
    p_reason: reason,
  });
}

export function deleteOwn(target: { readonly postId?: string; readonly replyId?: string }): Promise<void> {
  return rpc('community_delete_own', { p_post_id: target.postId ?? null, p_reply_id: target.replyId ?? null });
}

export interface InboxItem {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly data: { readonly post_id?: string };
  readonly read_at: string | null;
  readonly created_at: string;
}

export function fetchInbox(): Promise<{ readonly unread: number; readonly items: readonly InboxItem[] }> {
  return rpcOr('my_community_inbox', { p_limit: 40 }, { unread: 0, items: [] });
}

export function markInboxRead(): Promise<void> {
  return rpcOr('mark_community_inbox_read', {}, undefined);
}

/** Foto de una publicación: bucket `community`, carpeta del usuario. */
export function uploadCommunityPhoto(userId: string, blob: Blob, extension: string): Promise<string> {
  return uploadImage('community', userId, blob, extension);
}

// ---------------------------------------------------------------------
// PANEL
// ---------------------------------------------------------------------

export interface AdminPost extends PostRow {
  readonly pending_replies: number;
  readonly reported_replies: number;
  readonly reports: readonly ReportReason[];
}

export interface AdminList {
  readonly counts: {
    readonly pending: number;
    readonly reported: number;
    readonly suggestion: number;
    readonly unanswered: number;
  };
  readonly posts: readonly AdminPost[];
}

export function fetchAdminList(restaurantId: string, filter: AdminFilter): Promise<AdminList | null> {
  return rpcOr<AdminList | null>('community_admin_list', { p_restaurant_id: restaurantId, p_filter: filter, p_limit: 150 }, null);
}

export function moderate(
  target: { readonly postId?: string; readonly replyId?: string },
  status: 'published' | 'hidden',
  reason: string | null,
): Promise<void> {
  return rpc('community_moderate', {
    p_post_id: target.postId ?? null,
    p_reply_id: target.replyId ?? null,
    p_status: status,
    p_reason: reason,
  });
}

export function rewardPost(postId: string, points: number): Promise<void> {
  return rpc('community_reward', { p_post_id: postId, p_points: points });
}

export interface CommunitySettings {
  readonly enabled: boolean;
  readonly auto_publish: boolean;
  readonly first_review_points: number;
}

export const DEFAULT_SETTINGS: CommunitySettings = { enabled: true, auto_publish: true, first_review_points: 0 };

export async function fetchCommunitySettings(restaurantId: string): Promise<CommunitySettings | null> {
  const { data, error } = await getSupabase()
    .from('community_settings')
    .select('enabled, auto_publish, first_review_points')
    .eq('restaurant_id', restaurantId)
    .maybeSingle<CommunitySettings>();
  if (error) {
    if (communityError(error.message, error.code) === 'missing') return null;
    throw new CommunityFailure('generic', error.message);
  }
  return data ?? DEFAULT_SETTINGS;
}

export function saveCommunitySettings(restaurantId: string, settings: CommunitySettings): Promise<CommunitySettings> {
  return rpc('set_community_settings', {
    p_restaurant_id: restaurantId,
    p_enabled: settings.enabled,
    p_auto_publish: settings.auto_publish,
    p_first_review_points: settings.first_review_points,
  });
}

export interface LogRow {
  readonly id: string;
  readonly action: string;
  readonly reason: string | null;
  readonly detail: string | null;
  readonly created_at: string;
  readonly post_id: string | null;
  readonly actor: string;
  readonly target: string;
}

export function fetchLog(restaurantId: string): Promise<LogRow[]> {
  return rpcOr('community_log_list', { p_restaurant_id: restaurantId, p_limit: 100 }, []);
}

export async function fetchNotices(restaurantId: string): Promise<NoticeRow[]> {
  const { data, error } = await getSupabase()
    .from('community_notices')
    .select('id, title, body, photo_url, event_at, pinned, created_at, expires_at')
    .eq('restaurant_id', restaurantId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<NoticeRow[]>();
  if (error) {
    if (communityError(error.message, error.code) === 'missing') return [];
    throw new CommunityFailure('generic', error.message);
  }
  return data ?? [];
}

export async function createNotice(
  restaurantId: string,
  input: {
    readonly title: string;
    readonly body: string | null;
    readonly photo_url: string | null;
    readonly pinned: boolean;
    readonly expires_at: string | null;
  },
): Promise<void> {
  const { error } = await getSupabase()
    .from('community_notices')
    .insert({ restaurant_id: restaurantId, ...input });
  if (error) throw new CommunityFailure(communityError(error.message, error.code), error.message);
}

export async function deleteNotice(id: string): Promise<void> {
  const { error } = await getSupabase().from('community_notices').delete().eq('id', id);
  if (error) throw new CommunityFailure('generic', error.message);
}
