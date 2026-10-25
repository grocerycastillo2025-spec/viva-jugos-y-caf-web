/** Historias (migracion 0022). */

import { dataError } from '../domain/errors';
import type { StoryDuration } from '../domain/stories';
import { expiresFor } from '../domain/stories';
import { getSupabase } from '../supabase';

export interface StoryRow {
  readonly id: string;
  readonly media_url: string;
  readonly media_type: 'image' | 'video';
  readonly caption: string | null;
  readonly item_id: string | null;
  readonly starts_at: string;
  readonly expires_at: string | null;
  readonly sort_order: number;
  readonly created_at: string;
}

const COLUMNS = 'id, media_url, media_type, caption, item_id, starts_at, expires_at, sort_order, created_at';

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw dataError(error.message, error.code);
}

/**
 * Vigentes, para el cliente. La RLS ya filtra las caducadas y las
 * programadas; aqui solo se ordena.
 */
export async function fetchStories(restaurantId: string): Promise<StoryRow[]> {
  const { data, error } = await getSupabase()
    .from('stories')
    .select(COLUMNS)
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .returns<StoryRow[]>();
  // Una base sin la 0022 no tiene historias: la fila no se pinta.
  if (error?.code === '42P01' || error?.code === 'PGRST205') return [];
  fail(error);
  return data ?? [];
}

/** Todas, para el panel (el dueño tambien ve las caducadas). */
export async function fetchAdminStories(restaurantId: string): Promise<StoryRow[]> {
  const { data, error } = await getSupabase()
    .from('stories')
    .select(COLUMNS)
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(60)
    .returns<StoryRow[]>();
  fail(error);
  return data ?? [];
}

export async function createStory(
  restaurantId: string,
  input: {
    media_url: string;
    media_type: 'image' | 'video';
    caption: string;
    item_id: string | null;
    duration: StoryDuration;
  },
): Promise<void> {
  const { error } = await getSupabase()
    .from('stories')
    .insert({
      restaurant_id: restaurantId,
      media_url: input.media_url,
      media_type: input.media_type,
      caption: input.caption.trim() === '' ? null : input.caption.trim(),
      item_id: input.item_id,
      expires_at: expiresFor(input.duration),
      // Lo nuevo va delante de las destacadas.
      sort_order: -Math.floor(Date.now() / 1000),
    });
  fail(error);
}

export async function setStoryDuration(storyId: string, duration: StoryDuration): Promise<void> {
  const { error } = await getSupabase()
    .from('stories')
    .update({ expires_at: expiresFor(duration), starts_at: new Date().toISOString() })
    .eq('id', storyId);
  fail(error);
}

export async function deleteStory(storyId: string): Promise<void> {
  const { error } = await getSupabase().from('stories').delete().eq('id', storyId);
  fail(error);
}
