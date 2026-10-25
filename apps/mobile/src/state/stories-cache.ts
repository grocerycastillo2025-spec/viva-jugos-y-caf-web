/**
 * Historias ya bajadas, compartidas entre Inicio y el visor: al tocar una
 * el visor abre al instante con la lista que ya está en memoria, sin
 * volver a pedirla, y las fotos ya vienen precargadas.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchStories, type StoryRow } from '../api/stories';
import { autoOpenStart, localDay } from '../domain/stories';
import { loadSeenStories } from './seen-stories';
import { preloadImages } from './preload';

let cached: StoryRow[] | null = null;

export function cachedStories(): StoryRow[] | null {
  return cached;
}

/** Cuántas fotos se precargan al abrir la app (las primeras de la fila). */
const PRELOAD_FIRST = 4;

export async function loadStories(restaurantId: string): Promise<StoryRow[]> {
  const list = await fetchStories(restaurantId);
  cached = list;
  preloadImages(list.filter((s) => s.media_type === 'image').slice(0, PRELOAD_FIRST).map((s) => s.media_url));
  return list;
}

export function preloadStory(story: StoryRow | undefined): void {
  if (story?.media_type === 'image') preloadImages([story.media_url]);
}

// ---------------------------------------------------------------------
// Abrir solas al cargar la app
// ---------------------------------------------------------------------

const AUTO_KEY = 'viva.stories.autoOpenDay.v1';
let autoOpenedThisSession = false;

/**
 * Id de la historia con la que abrir el visor solo, o null. Una vez por
 * visita a la app; ver `autoOpenStart` para la regla.
 */
export async function takeAutoOpen(stories: readonly StoryRow[], now = new Date()): Promise<string | null> {
  if (autoOpenedThisSession) return null;
  autoOpenedThisSession = true;
  const [seen, lastDay] = await Promise.all([
    loadSeenStories(),
    AsyncStorage.getItem(AUTO_KEY).catch(() => null),
  ]);
  const today = localDay(now);
  const start = autoOpenStart(stories, seen, lastDay, today);
  if (start !== null) void AsyncStorage.setItem(AUTO_KEY, today).catch(() => undefined);
  return start;
}
