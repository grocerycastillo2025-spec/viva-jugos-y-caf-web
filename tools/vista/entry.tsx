import { createRoot } from 'react-dom/client';
import { emularYoga } from './yoga';

// ANTES de que ningun componente cree sus estilos.
if (new URLSearchParams(location.search).get('yoga') !== '0') emularYoga();

import { I18nManager, Text, View } from 'react-native';
import { MenuItemCard } from '../../apps/mobile/src/components/MenuItemCard';
import { Image as Img } from './stubs/image';
import { HEADER_HEIGHT } from '../../apps/mobile/src/domain/card-metrics';
import { defaultBranding } from '../../apps/mobile/src/domain/branding';
import { Button } from '../../apps/mobile/src/components/ui';
import { gridColumns, radius, spacing, type as typography } from '../../apps/mobile/src/theme';

const colors = defaultBranding.colors;
const item = (id: string, name: string, description: string | null, price: number) => ({
  id, store_id: 's', clover_item_id: 'SEED-' + id, name, description,
  price_cents: price, category_id: 'c', category_name: 'Bowls', category_sort: 60,
  image_url: null, featured: false, sort_order: 10, badge: null,
  is_available: true, unavailable_reason: null,
});
const BOWLS = [
  { ...item('1', 'Acai Bowl', 'Acai, blueberries, strawberries, banana, granola', 1295), badge: 'Popular' },
  { ...item('1b', 'Tropical Green Acai Bowl', 'Acai, blueberries, strawberries, banana, granola', 1295), badge: 'Best seller of the week' },
  item('2', 'Pitaya Bowl', 'Pitaya, granola, mango, blueberry, papaya', 1295),
  { ...item('3', 'Green Bowl', 'Spinach, kiwi, banana, chia, honey', 1195), badge: '   ' },
];

function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 1) return items.map((i) => [i]);
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

// Copia EXACTA del renderItem de app/(tabs)/menu.tsx.
// Copia EXACTA del renderItem nuevo: una sola forma, sin ramas.
function Fila({ row }: { row: ReturnType<typeof item>[] }) {
  return <MenuItemCard item={row[0] as never} onQuickAdd={() => undefined} />;
}

function Panel({ titulo, ancho }: { titulo: string; ancho: number }) {
  const columns = 1;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ font: '13px monospace', background: '#222', color: '#fff', padding: 4, width: ancho }}>
        {titulo} · ancho {ancho}dp
      </div>
      <View style={{ width: ancho, backgroundColor: colors.background, paddingHorizontal: spacing.lg }}>
        <View style={{ height: HEADER_HEIGHT, justifyContent: 'flex-end', paddingBottom: spacing.sm }}>
          <Text style={{ color: colors.text, fontSize: typography.title.fontSize, fontWeight: '800' }}>Bowls</Text>
        </View>
        {chunk(BOWLS, columns).map((row, i) => <Fila key={i} row={row} />)}
      </View>
    </div>
  );
}

// La cabecera de la Home, con logo y sin logo: son el mismo hueco.
function Cabecera({ ancho, logo }: { ancho: number; logo: string | null }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ font: '13px monospace', background: '#222', color: '#fff', padding: 4, width: ancho }}>
        HOME · cabecera · {logo === null ? 'sin logo en la base (texto de reserva)' : 'con logo'} · {ancho}dp
      </div>
      <View style={{ width: ancho, backgroundColor: colors.background, padding: spacing.lg }}>
        <View style={{ backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.sm }}>
          {logo === null ? (
            <Text style={{ color: colors.accent, fontSize: typography.caption.fontSize, fontWeight: '800',
              letterSpacing: 1.2, textTransform: 'uppercase', alignSelf: 'center', textAlign: 'center',
              marginBottom: spacing.xs }}>Viva Juice and Coffee</Text>
          ) : (
            <Img source={logo} style={{ width: '62%', aspectRatio: 1036 / 630, alignSelf: 'center', marginBottom: spacing.sm }}
              contentFit="contain" contentPosition="center" />
          )}
          <Text style={{ color: colors.onPrimary, fontSize: typography.display.fontSize, fontWeight: '800', lineHeight: 34 }}>
            Fresh, made to order
          </Text>
          <Text style={{ color: colors.onPrimary, opacity: 0.85, fontSize: typography.body.fontSize, lineHeight: 21 }}>
            Cold-pressed juices, bowls and specialty coffee. Order ahead and pick it up at the counter.
          </Text>
          <Button label="See the menu" variant="accent" onPress={() => undefined} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }} />
        </View>
      </View>
    </div>
  );
}

// Los destacados de la Home: rejilla de dos, tal como los pinta index.tsx.
function Destacados({ ancho }: { ancho: number }) {
  const columnas = 2;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ font: '13px monospace', background: '#222', color: '#fff', padding: 4, width: ancho }}>
        HOME · destacados · ancho {ancho}dp
      </div>
      <View style={{ width: ancho, backgroundColor: colors.background, padding: spacing.lg }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs }}>
          {BOWLS.map((p) => (
            <View key={p.id} style={{ width: `${100 / columnas}%`, padding: spacing.xs }}>
              <MenuItemCard item={p as never} layout="tile" onQuickAdd={() => undefined} />
            </View>
          ))}
        </View>
      </View>
    </div>
  );
}

const rtl = new URLSearchParams(location.search).get('rtl') === '1';
if (rtl) { I18nManager.allowRTL(true); I18nManager.forceRTL(true); document.documentElement.dir = 'rtl'; }

createRoot(document.getElementById('root')!).render(
  <div>
    <Panel titulo="MENU · vertical estrecho" ancho={340} />
    <Panel titulo="MENU · vertical normal" ancho={412} />
    <Panel titulo="MENU · horizontal" ancho={780} />
    <Destacados ancho={412} />
  </div>,
);
