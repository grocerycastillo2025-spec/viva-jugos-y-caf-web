/**
 * Ubicar la tienda en el mapa, como al pedir un Uber: el pin se queda fijo
 * en el centro y se mueve el mapa hasta dejarlo sobre la puerta.
 *
 * Leaflet + OpenStreetMap, cargados desde cdnjs solo cuando se abre esta
 * tarjeta (no pesa en la app del cliente ni agrega dependencias nativas).
 * La búsqueda por dirección usa Nominatim (OpenStreetMap), limitada a
 * México. "Usar mi ubicación" usa el GPS del navegador.
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BrandColors } from '../domain/branding';
import { useColors } from '../state/branding-context';
import { radius, spacing, type as typography } from '../theme';
import type { MapPickerProps } from './MapPicker';
import { adminStrings } from './strings';

export type { MapPickerProps } from './MapPicker';

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
/** Querétaro centro, si la tienda no tiene punto todavía. */
const DEFAULT_CENTER: [number, number] = [20.5888, -100.3899];

interface LeafletMap {
  setView(center: [number, number], zoom: number): LeafletMap;
  getCenter(): { lat: number; lng: number };
  on(event: string, fn: () => void): void;
  remove(): void;
  invalidateSize(): void;
}
interface Leaflet {
  map(el: HTMLElement, options?: Record<string, unknown>): LeafletMap;
  tileLayer(url: string, options: Record<string, unknown>): { addTo(map: LeafletMap): void };
}

let loading: Promise<Leaflet> | null = null;
function loadLeaflet(): Promise<Leaflet> {
  const w = window as unknown as { L?: Leaflet };
  if (w.L !== undefined) return Promise.resolve(w.L);
  if (loading !== null) return loading;
  loading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = LEAFLET_CSS;
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = LEAFLET_JS;
    js.async = true;
    js.onload = () => (w.L === undefined ? reject(new Error('leaflet')) : resolve(w.L));
    js.onerror = () => {
      loading = null;
      reject(new Error('leaflet'));
    };
    document.head.appendChild(js);
  });
  return loading;
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export function MapPicker({ latitude, longitude, address, onChange }: MapPickerProps): ReactNode {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const holder = useRef<View | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadLeaflet()
      .then((L) => {
        const el = holder.current as unknown as HTMLElement | null;
        if (!alive || el === null) return;
        const hasPoint = latitude !== null && longitude !== null;
        const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(
          hasPoint ? [latitude, longitude] : DEFAULT_CENTER,
          hasPoint ? 18 : 13,
        );
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap',
        }).addTo(map);
        map.on('moveend', () => {
          const c = map.getCenter();
          onChangeRef.current(round6(c.lat), round6(c.lng));
        });
        mapRef.current = map;
        setStatus('ready');
        setTimeout(() => map.invalidateSize(), 200);
      })
      .catch(() => alive && setStatus('failed'));
    return () => {
      alive = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Solo al montar: luego manda el mapa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = async (): Promise<void> => {
    if (address.trim() === '' || mapRef.current === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=mx&q=${encodeURIComponent(address)}`;
      const res = await fetch(url, { headers: { 'accept-language': 'es' } });
      const rows = (await res.json()) as { lat: string; lon: string }[];
      const hit = rows[0];
      if (hit === undefined) {
        setMessage(adminStrings.map.notFound);
      } else {
        mapRef.current.setView([Number(hit.lat), Number(hit.lon)], 18);
        setMessage(adminStrings.map.foundHint);
      }
    } catch {
      setMessage(adminStrings.map.searchFailed);
    } finally {
      setBusy(false);
    }
  };

  const locate = (): void => {
    if (!('geolocation' in navigator) || mapRef.current === null) {
      setMessage(adminStrings.map.noGps);
      return;
    }
    setBusy(true);
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 18);
        setBusy(false);
      },
      () => {
        setMessage(adminStrings.map.noGps);
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>{adminStrings.map.hint}</Text>
      <View style={styles.frame}>
        <View ref={holder} style={styles.map} />
        {status === 'ready' ? (
          <View style={styles.pin} pointerEvents="none">
            <Ionicons name="location" size={44} color={colors.primary} />
          </View>
        ) : (
          <View style={styles.overlay}>
            <Text style={styles.hint}>
              {status === 'loading' ? adminStrings.map.loading : adminStrings.map.failed}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void search()}
          disabled={busy || status !== 'ready'}
          style={styles.action}
        >
          <Ionicons name="search" size={16} color={colors.primary} />
          <Text style={styles.actionText}>{adminStrings.map.search}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={locate}
          disabled={busy || status !== 'ready'}
          style={styles.action}
        >
          <Ionicons name="locate" size={16} color={colors.primary} />
          <Text style={styles.actionText}>{adminStrings.map.myLocation}</Text>
        </Pressable>
      </View>
      {message !== null ? <Text style={styles.hint}>{message}</Text> : null}
      <Text style={styles.coords}>
        {latitude === null || longitude === null
          ? adminStrings.map.noPoint
          : adminStrings.map.coords(latitude, longitude)}
      </Text>
    </View>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    wrap: { gap: spacing.sm },
    hint: { color: colors.textMuted, fontSize: typography.label.fontSize, lineHeight: 19 },
    frame: {
      height: 280,
      borderRadius: radius.lg,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    map: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#e8e4dc' },
    // La punta del pin queda justo en el centro del mapa.
    pin: {
      position: 'absolute',
      left: '50%',
      top: '50%',
      marginLeft: -22,
      marginTop: -42,
      zIndex: 1000,
    },
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    actionText: { color: colors.primary, fontWeight: '700', fontSize: typography.label.fontSize },
    coords: { color: colors.textFaint, fontSize: typography.caption.fontSize },
  });
}
