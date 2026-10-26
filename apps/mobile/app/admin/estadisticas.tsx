/**
 * Panel · Estadísticas (v2).
 *
 * Pensada para leerse de un vistazo, de arriba abajo:
 *   1. Una frase: cuánto vendiste y cómo vas contra el periodo anterior.
 *   2. Cuatro números grandes con su flecha ▲▼ contra el periodo anterior.
 *   3. Ventas por día (barras con guías y el mejor día resaltado).
 *   4. ¿A qué hora te compran? y ¿Qué días se vende más? — con la
 *      conclusión escrita arriba ("Tu hora pico: 9 a 10 am").
 *   5. ¿Cómo pagan? (barra apilada con porcentajes) y clientes nuevos vs.
 *      los que regresan, con los mejores clientes.
 *   6. Lo más vendido, lo más consultado y las historias más vistas.
 *
 * Datos: `business_stats` (0023) para este periodo y el anterior, y
 * `business_insights` (0030). Si la base aún no tiene la 0030, las
 * secciones 4 y 5 no se muestran y lo demás funciona igual.
 *
 * Color: una serie = el color de la marca; el máximo va sólido y el resto
 * más claro. Formas de pago usa 4 tonos validados para daltonismo, siempre
 * con su etiqueta y porcentaje al lado. Los números van en tinta de texto.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAdmin } from '../../src/admin/admin-context';
import { adminStrings } from '../../src/admin/strings';
import { AdminShell, Card, Notice, createAdminStyles } from '../../src/admin/ui';
import { DataState } from '../../src/components/DataState';
import type { BrandColors } from '../../src/domain/branding';
import { dataError } from '../../src/domain/errors';
import { formatMoney, moneyDefaults } from '../../src/domain/money';
import { dayKey } from '../../src/domain/pickup';
import {
  activeHours,
  hourRange,
  hourTick,
  pctChange,
  peak,
  shares,
  WEEK_ORDER,
} from '../../src/domain/stats';
import { useAsync } from '../../src/hooks/use-async';
import { useColors } from '../../src/state/branding-context';
import { strings } from '../../src/strings';
import { getSupabase } from '../../src/supabase';
import { radius, spacing, type as typography } from '../../src/theme';

const t = adminStrings.stats;

/** Formas de pago: tonos validados (CVD) en orden fijo; nunca solos, siempre con etiqueta. */
const PAY_COLORS: Record<string, string> = {
  cash: '#2a78d6',
  card_counter: '#eb6834',
  transfer: '#1baf7a',
  mercadopago: '#eda100',
};
const PAY_ORDER = ['cash', 'card_counter', 'transfer', 'mercadopago'];

interface Stats {
  orders: number;
  revenue_cents: number;
  customers: number;
  loyalty_visits: number;
  item_views: number;
  story_views: number;
  by_day: { day: string; orders: number; revenue_cents: number }[];
  top_sold: { name: string; quantity: number; revenue_cents: number }[];
  top_viewed: { name: string; views: number }[];
  top_stories: { id: string; name: string; media_url: string; media_type: string; views: number }[];
}

interface Insights {
  by_hour: { hour: number; orders: number }[];
  by_weekday: { dow: number; orders: number; revenue_cents: number }[];
  by_pay: { method: string; orders: number; revenue_cents: number }[];
  top_customers: { name: string; orders: number; revenue_cents: number }[];
  new_customers: number;
  returning_customers: number;
  rewards_given: number;
}

interface Loaded {
  readonly now: Stats;
  readonly before: Stats | null;
  readonly insights: Insights | null;
}

function shiftDay(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shortDay(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(moneyDefaults().locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** $12,300 -> "$12.3k" para las guías del eje. */
function compactMoney(cents: number): string {
  const pesos = cents / 100;
  if (pesos >= 1000) return `$${(pesos / 1000).toFixed(pesos >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(pesos)}`;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw dataError(error.message, error.code);
  return data as T;
}

export default function AdminStatsScreen(): ReactNode {
  const { restaurantId, store, isOwner } = useAdmin();
  const colors = useColors();
  const styles = useMemo(
    () => ({ ...createAdminStyles(colors), ...createStyles(colors) }),
    [colors],
  );
  const [range, setRange] = useState<'7' | '30' | '90'>('7');

  const load = useCallback(async (): Promise<Loaded> => {
    const days = Number(range);
    const to = dayKey(new Date(), store.timezone);
    const from = shiftDay(to, -(days - 1));
    const prevTo = shiftDay(from, -1);
    const prevFrom = shiftDay(prevTo, -(days - 1));
    const args = (f: string, tt: string) => ({
      p_restaurant_id: restaurantId,
      p_from: f,
      p_to: tt,
    });
    const [now, before, insights] = await Promise.all([
      rpc<Stats>('business_stats', args(from, to)),
      rpc<Stats>('business_stats', args(prevFrom, prevTo)).catch(() => null),
      // Base sin la 0030: sin estas secciones.
      rpc<Insights>('business_insights', args(from, to)).catch(() => null),
    ]);
    return { now, before, insights };
  }, [range, restaurantId, store.timezone]);

  const { data, error, loading, reload } = useAsync(load, [range, restaurantId]);

  if (!isOwner) {
    return (
      <AdminShell>
        <Notice tone="error" text={adminStrings.ownerOnly} />
      </AdminShell>
    );
  }

  const ranges = (
    <View style={styles.rangeRow}>
      {(['7', '30', '90'] as const).map((r) => (
        <Pressable
          key={r}
          accessibilityRole="radio"
          accessibilityState={{ checked: range === r }}
          onPress={() => setRange(r)}
          style={[styles.rangeChip, range === r && styles.rangeChipOn]}
        >
          <Text style={[styles.rangeText, range === r && styles.rangeTextOn]}>{t.range[r]}</Text>
        </Pressable>
      ))}
    </View>
  );

  if (data === null) {
    return (
      <AdminShell scroll={false}>
        {ranges}
        <DataState loading={loading} error={error} empty={false} onRetry={reload} emptyTitle="">
          {null}
        </DataState>
      </AdminShell>
    );
  }

  const { now, before, insights } = data;
  const ticket = now.orders === 0 ? 0 : Math.round(now.revenue_cents / now.orders);
  const ticketBefore =
    before === null || before.orders === 0 ? 0 : Math.round(before.revenue_cents / before.orders);
  const revenueDelta = before === null ? null : pctChange(now.revenue_cents, before.revenue_cents);

  return (
    <AdminShell>
      {ranges}

      {/* 1. La frase */}
      <View style={styles.hero}>
        <Text style={styles.heroKicker}>{t.lastDays(Number(range))}</Text>
        <Text style={styles.heroValue}>{formatMoney(now.revenue_cents)}</Text>
        <Text style={styles.heroText}>
          {t.heroSentence(now.orders, now.customers)}
          {revenueDelta === null ? '' : ` ${t.vsBefore(revenueDelta)}`}
        </Text>
      </View>

      {/* 2. Números grandes */}
      <View style={styles.kpis}>
        <Kpi
          icon="cash-outline"
          label={t.revenue}
          value={formatMoney(now.revenue_cents)}
          delta={before === null ? null : pctChange(now.revenue_cents, before.revenue_cents)}
          colors={colors}
        />
        <Kpi
          icon="receipt-outline"
          label={t.orders}
          value={String(now.orders)}
          delta={before === null ? null : pctChange(now.orders, before.orders)}
          colors={colors}
        />
        <Kpi
          icon="pricetag-outline"
          label={t.ticket}
          value={formatMoney(ticket)}
          delta={before === null ? null : pctChange(ticket, ticketBefore)}
          colors={colors}
        />
        <Kpi
          icon="people-outline"
          label={t.customers}
          value={String(now.customers)}
          delta={before === null ? null : pctChange(now.customers, before.customers)}
          colors={colors}
        />
      </View>
      <View style={styles.minis}>
        <Mini icon="qr-code-outline" label={t.visits} value={now.loyalty_visits} colors={colors} />
        {insights !== null ? (
          <Mini
            icon="gift-outline"
            label={t.rewardsGiven}
            value={insights.rewards_given}
            colors={colors}
          />
        ) : null}
        <Mini icon="eye-outline" label={t.itemViews} value={now.item_views} colors={colors} />
        <Mini icon="images-outline" label={t.storyViews} value={now.story_views} colors={colors} />
      </View>

      {/* 3. Ventas por día */}
      <Card title={t.salesByDay}>
        <SalesChart days={now.by_day} colors={colors} />
      </Card>

      {/* 4. Horas y días */}
      {insights !== null ? (
        <View style={styles.columns}>
          <View style={styles.column}>
            <Card title={t.byHour}>
              <HoursChart rows={insights.by_hour} colors={colors} />
            </Card>
          </View>
          <View style={styles.column}>
            <Card title={t.byWeekday}>
              <WeekChart rows={insights.by_weekday} colors={colors} />
            </Card>
          </View>
        </View>
      ) : null}

      {/* 5. Pagos y clientes */}
      {insights !== null ? (
        <View style={styles.columns}>
          <View style={styles.column}>
            <Card title={t.byPay}>
              <PayChart rows={insights.by_pay} colors={colors} />
            </Card>
          </View>
          <View style={styles.column}>
            <Card title={t.customersTitle}>
              <CustomersBlock insights={insights} colors={colors} />
            </Card>
          </View>
        </View>
      ) : null}

      {/* 6. Productos e historias */}
      <View style={styles.columns}>
        <View style={styles.column}>
          <Card title={t.topSold}>
            <BarList
              rows={now.top_sold.map((r) => ({
                key: r.name,
                label: r.name,
                value: r.quantity,
                detail: `${t.units(r.quantity)} · ${formatMoney(r.revenue_cents)}`,
              }))}
              colors={colors}
            />
          </Card>
        </View>
        <View style={styles.column}>
          <Card title={t.topViewed}>
            <BarList
              rows={now.top_viewed.map((r) => ({
                key: r.name,
                label: r.name,
                value: r.views,
                detail: t.views(r.views),
              }))}
              colors={colors}
            />
          </Card>
        </View>
      </View>

      <Card title={t.topStories}>
        {now.top_stories.length === 0 ? <Text style={styles.empty}>{t.noData}</Text> : null}
        <View style={styles.storyRow}>
          {now.top_stories.map((s, i) => (
            <View key={s.id} style={styles.storyCard}>
              <View style={styles.storyThumb}>
                {s.media_type === 'image' ? (
                  <Image source={{ uri: s.media_url }} style={styles.fill} contentFit="cover" />
                ) : (
                  <View style={[styles.fill, styles.videoThumb]}>
                    <Ionicons name="play-circle" size={30} color="#fff" />
                  </View>
                )}
                <View style={styles.rank}>
                  <Text style={styles.rankText}>{i + 1}</Text>
                </View>
              </View>
              <Text style={styles.storyName} numberOfLines={2}>
                {s.name}
              </Text>
              <Text style={styles.storyViews}>{t.views(s.views)}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Text style={styles.hint}>{t.note}</Text>
    </AdminShell>
  );
}

// ---------------------------------------------------------------------

function Delta({
  value,
  colors,
}: {
  readonly value: number | null;
  readonly colors: BrandColors;
}): ReactNode {
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (value === null) return <Text style={styles.deltaNone}>{t.noPrevious}</Text>;
  const up = value >= 0;
  return (
    <View style={[styles.delta, { backgroundColor: up ? '#E6F4EC' : '#FDECEA' }]}>
      <Ionicons
        name={up ? 'arrow-up' : 'arrow-down'}
        size={12}
        color={up ? colors.success : colors.danger}
      />
      <Text style={[styles.deltaText, { color: up ? colors.success : colors.danger }]}>
        {Math.abs(value)} %
      </Text>
    </View>
  );
}

function Kpi({
  icon,
  label,
  value,
  delta,
  colors,
}: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly value: string;
  readonly delta: number | null;
  readonly colors: BrandColors;
}): ReactNode {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.kpi}>
      <View style={styles.kpiTop}>
        <View style={styles.kpiIcon}>
          <Ionicons name={icon} size={18} color={colors.primary} />
        </View>
        <Delta value={delta} colors={colors} />
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function Mini({
  icon,
  label,
  value,
  colors,
}: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly value: number;
  readonly colors: BrandColors;
}): ReactNode {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.mini}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.miniValue}>{value}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}

/** Insight en negritas arriba de cada gráfica. */
function Takeaway({
  text,
  colors,
}: {
  readonly text: string;
  readonly colors: BrandColors;
}): ReactNode {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.takeaway}>
      <Ionicons name="bulb-outline" size={16} color={colors.primary} />
      <Text style={styles.takeawayText}>{text}</Text>
    </View>
  );
}

function SalesChart({
  days,
  colors,
}: {
  readonly days: Stats['by_day'];
  readonly colors: BrandColors;
}): ReactNode {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.revenue_cents), 0);
  if (max === 0) return <Text style={styles.empty}>{t.noData}</Text>;

  const bestIndex = days.reduce(
    (a, b, i) => (b.revenue_cents > (days[a]?.revenue_cents ?? 0) ? i : a),
    0,
  );
  const best = days[bestIndex];
  const shown = hover ?? bestIndex;
  const point = days[shown];
  const guides = [1, 0.5];

  return (
    <View style={styles.chart}>
      {best !== undefined ? (
        <Takeaway
          text={t.bestDay(shortDay(best.day), formatMoney(best.revenue_cents))}
          colors={colors}
        />
      ) : null}
      {point !== undefined ? (
        <Text style={styles.readout}>
          {shortDay(point.day)} · {formatMoney(point.revenue_cents)} · {t.ordersCount(point.orders)}
        </Text>
      ) : null}
      <View style={styles.plotRow}>
        <View style={styles.yAxis}>
          {guides.map((g) => (
            <Text key={g} style={[styles.yTick, { top: `${(1 - g) * 100}%` }]}>
              {compactMoney(max * g)}
            </Text>
          ))}
        </View>
        <View style={styles.plot}>
          {guides.map((g) => (
            <View key={g} style={[styles.guide, { top: `${(1 - g) * 100}%` }]} />
          ))}
          {days.map((d, i) => {
            const h = d.revenue_cents === 0 ? 0 : Math.max(3, (d.revenue_cents / max) * 100);
            return (
              <Pressable
                key={d.day}
                accessibilityLabel={`${shortDay(d.day)}: ${formatMoney(d.revenue_cents)}`}
                onHoverIn={() => setHover(i)}
                onHoverOut={() => setHover(null)}
                onPress={() => setHover(i)}
                style={styles.slot}
              >
                <View
                  style={[
                    styles.bar,
                    { height: `${h}%`, backgroundColor: colors.primary },
                    shown === i ? styles.barOn : styles.barOff,
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      </View>
      {/* Solo primera, media y última fecha: caben también en el teléfono. */}
      <View style={[styles.xAxisEnds, styles.xAxisOffset]}>
        {[days[0], days[Math.floor((days.length - 1) / 2)], days[days.length - 1]].map((d, i) =>
          d === undefined ? null : (
            <Text key={`${d.day}-${i}`} style={styles.xEnd}>
              {shortDay(d.day)}
            </Text>
          ),
        )}
      </View>
    </View>
  );
}

function HoursChart({
  rows,
  colors,
}: {
  readonly rows: Insights['by_hour'];
  readonly colors: BrandColors;
}): ReactNode {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const best = peak(rows, (r) => r.orders);
  if (best === null) return <Text style={styles.empty}>{t.noData}</Text>;
  const { from, to } = activeHours(rows);
  const shown = rows.filter((r) => r.hour >= from && r.hour <= to);
  const max = best.orders;
  return (
    <View style={styles.chart}>
      <Takeaway text={t.peakHour(hourRange(best.hour))} colors={colors} />
      <View style={styles.plotBox}>
        {shown.map((r) => (
          <View
            key={r.hour}
            style={styles.slot}
            accessibilityLabel={`${hourRange(r.hour)}: ${r.orders}`}
          >
            {r.orders > 0 ? <Text style={styles.barValue}>{r.orders}</Text> : null}
            <View
              style={[
                styles.bar,
                {
                  height: `${r.orders === 0 ? 0 : Math.max(4, (r.orders / max) * 82)}%`,
                  backgroundColor: colors.primary,
                },
                r.hour === best.hour ? styles.barOn : styles.barOff,
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.xAxis}>
        {shown.map((r) => (
          <Text key={r.hour} style={styles.xTick}>
            {r.hour % 2 === 0 ? hourTick(r.hour) : ''}
          </Text>
        ))}
      </View>
      <Text style={styles.axisNote}>{t.hoursNote}</Text>
    </View>
  );
}

function WeekChart({
  rows,
  colors,
}: {
  readonly rows: Insights['by_weekday'];
  readonly colors: BrandColors;
}): ReactNode {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const ordered = WEEK_ORDER.map(
    (dow) => rows.find((r) => r.dow === dow) ?? { dow, orders: 0, revenue_cents: 0 },
  );
  const best = peak(ordered, (r) => r.revenue_cents);
  if (best === null) return <Text style={styles.empty}>{t.noData}</Text>;
  const max = best.revenue_cents;
  return (
    <View style={styles.chart}>
      <Takeaway text={t.bestWeekday(t.weekdays[best.dow] ?? '')} colors={colors} />
      <View style={styles.plotBox}>
        {ordered.map((r) => (
          <View
            key={r.dow}
            style={styles.slot}
            accessibilityLabel={`${t.weekdays[r.dow] ?? ''}: ${formatMoney(r.revenue_cents)}`}
          >
            {r.revenue_cents > 0 ? (
              <Text style={styles.barValue}>{compactMoney(r.revenue_cents)}</Text>
            ) : null}
            <View
              style={[
                styles.bar,
                {
                  height: `${r.revenue_cents === 0 ? 0 : Math.max(4, (r.revenue_cents / max) * 80)}%`,
                  backgroundColor: colors.primary,
                },
                r.dow === best.dow ? styles.barOn : styles.barOff,
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.xAxis}>
        {ordered.map((r) => (
          <Text key={r.dow} style={styles.xTick}>
            {(t.weekdays[r.dow] ?? '').slice(0, 3)}
          </Text>
        ))}
      </View>
    </View>
  );
}

function PayChart({
  rows,
  colors,
}: {
  readonly rows: Insights['by_pay'];
  readonly colors: BrandColors;
}): ReactNode {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const ordered = PAY_ORDER.map((m) => rows.find((r) => r.method === m)).filter(
    (r): r is Insights['by_pay'][number] => r !== undefined && r.orders > 0,
  );
  if (ordered.length === 0) return <Text style={styles.empty}>{t.noData}</Text>;
  const pct = shares(ordered.map((r) => r.orders));
  const top = ordered.reduce((a, b) => (b.orders > a.orders ? b : a));
  const topPct = pct[ordered.indexOf(top)] ?? 0;
  return (
    <View style={styles.chart}>
      <Takeaway
        text={t.payTakeaway(strings.payments.methods[top.method] ?? top.method, topPct)}
        colors={colors}
      />
      <View style={styles.stack}>
        {ordered.map((r, i) =>
          (pct[i] ?? 0) > 0 ? (
            <View
              key={r.method}
              style={{ flex: pct[i] ?? 0, backgroundColor: PAY_COLORS[r.method] ?? colors.primary }}
            />
          ) : null,
        )}
      </View>
      <View style={styles.legend}>
        {ordered.map((r, i) => (
          <View key={r.method} style={styles.legendRow}>
            <View
              style={[styles.swatch, { backgroundColor: PAY_COLORS[r.method] ?? colors.primary }]}
            />
            <Text style={styles.legendName}>{strings.payments.methods[r.method] ?? r.method}</Text>
            <Text style={styles.legendPct}>{pct[i] ?? 0} %</Text>
            <Text style={styles.legendDetail}>
              {t.ordersCount(r.orders)} · {formatMoney(r.revenue_cents)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CustomersBlock({
  insights,
  colors,
}: {
  readonly insights: Insights;
  readonly colors: BrandColors;
}): ReactNode {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const total = insights.new_customers + insights.returning_customers;
  if (total === 0) return <Text style={styles.empty}>{t.noData}</Text>;
  const [pNew, pBack] = shares([insights.new_customers, insights.returning_customers]);
  return (
    <View style={styles.chart}>
      <Takeaway
        text={insights.returning_customers === 0 ? t.allNew : t.returningTakeaway(pBack ?? 0)}
        colors={colors}
      />
      <View style={styles.stack}>
        {(pNew ?? 0) > 0 ? (
          <View style={{ flex: pNew ?? 0, backgroundColor: PAY_COLORS['cash'] }} />
        ) : null}
        {(pBack ?? 0) > 0 ? (
          <View style={{ flex: pBack ?? 0, backgroundColor: PAY_COLORS['card_counter'] }} />
        ) : null}
      </View>
      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <View style={[styles.swatch, { backgroundColor: PAY_COLORS['cash'] }]} />
          <Text style={styles.legendName}>{t.newCustomers}</Text>
          <Text style={styles.legendPct}>{insights.new_customers}</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.swatch, { backgroundColor: PAY_COLORS['card_counter'] }]} />
          <Text style={styles.legendName}>{t.returningCustomers}</Text>
          <Text style={styles.legendPct}>{insights.returning_customers}</Text>
        </View>
      </View>
      {insights.top_customers.length > 0 ? (
        <View style={styles.topCustomers}>
          <Text style={styles.subTitle}>{t.topCustomers}</Text>
          {insights.top_customers.map((c, i) => (
            <View key={`${c.name}-${i}`} style={styles.customerRow}>
              <Text style={styles.medal}>{['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`}</Text>
              <Text style={styles.customerName} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={styles.legendDetail}>
                {t.ordersCount(c.orders)} · {formatMoney(c.revenue_cents)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function BarList({
  rows,
  colors,
}: {
  readonly rows: { key: string; label: string; value: number; detail: string }[];
  readonly colors: BrandColors;
}): ReactNode {
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (rows.length === 0) return <Text style={styles.empty}>{t.noData}</Text>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <View style={styles.barList}>
      {rows.map((row, i) => (
        <View key={row.key} style={styles.barRow}>
          <View style={styles.barHead}>
            <Text style={styles.barRank}>{i + 1}</Text>
            <Text style={styles.barLabel} numberOfLines={1}>
              {row.label}
            </Text>
            <Text style={styles.barDetail}>{row.detail}</Text>
          </View>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${(row.value / max) * 100}%`,
                  backgroundColor: colors.primary,
                  opacity: i === 0 ? 1 : 0.6,
                },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    rangeRow: { flexDirection: 'row', gap: spacing.sm },
    rangeChip: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    rangeChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    rangeText: { color: colors.text, fontWeight: '700', fontSize: typography.label.fontSize },
    rangeTextOn: { color: colors.onPrimary },

    hero: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.xl, gap: 4 },
    heroKicker: {
      color: colors.onPrimary,
      opacity: 0.85,
      fontWeight: '800',
      fontSize: typography.caption.fontSize,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    heroValue: { color: colors.onPrimary, fontSize: 40, fontWeight: '800' },
    heroText: { color: colors.onPrimary, fontSize: typography.body.fontSize, lineHeight: 22 },

    kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    kpi: {
      flexGrow: 1,
      flexBasis: 160,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: 4,
    },
    kpiTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    kpiIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    kpiValue: { color: colors.text, fontSize: 26, fontWeight: '800', marginTop: 4 },
    kpiLabel: { color: colors.textMuted, fontSize: typography.label.fontSize, fontWeight: '600' },
    delta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.pill,
    },
    deltaText: { fontSize: typography.caption.fontSize, fontWeight: '800' },
    deltaNone: { color: colors.textFaint, fontSize: typography.caption.fontSize },

    minis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    mini: {
      flexGrow: 1,
      flexBasis: 130,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    miniValue: { color: colors.text, fontWeight: '800', fontSize: typography.body.fontSize + 2 },
    miniLabel: {
      color: colors.textMuted,
      fontSize: typography.caption.fontSize + 1,
      flexShrink: 1,
    },

    chart: { gap: spacing.sm },
    takeaway: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    takeawayText: {
      color: colors.text,
      fontWeight: '800',
      fontSize: typography.body.fontSize,
      flexShrink: 1,
    },
    readout: { color: colors.textMuted, fontSize: typography.label.fontSize, fontWeight: '600' },
    plotRow: { flexDirection: 'row', gap: 6 },
    yAxis: { width: 44, height: 190 },
    yTick: { position: 'absolute', right: 0, marginTop: -7, color: colors.textFaint, fontSize: 10 },
    plot: {
      flex: 1,
      height: 190,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 3,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    plotBox: {
      width: '100%',
      height: 150,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 3,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    guide: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: colors.border,
      opacity: 0.7,
    },
    slot: {
      flex: 1,
      height: '100%',
      justifyContent: 'flex-end',
      alignItems: 'center',
      minWidth: 0,
    },
    bar: { width: '100%', maxWidth: 34, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    barOn: { opacity: 1 },
    barOff: { opacity: 0.45 },
    barValue: { color: colors.textMuted, fontSize: 10, fontWeight: '700', marginBottom: 2 },
    xAxis: { flexDirection: 'row', gap: 3 },
    xAxisOffset: { marginLeft: 50 },
    xAxisEnds: { flexDirection: 'row', justifyContent: 'space-between' },
    xEnd: { color: colors.textFaint, fontSize: 11 },
    xTick: { flex: 1, minWidth: 0, color: colors.textFaint, fontSize: 10, textAlign: 'center' },
    axisNote: { color: colors.textFaint, fontSize: typography.caption.fontSize },
    empty: {
      color: colors.textFaint,
      fontSize: typography.label.fontSize,
      paddingVertical: spacing.md,
    },

    stack: { flexDirection: 'row', height: 22, borderRadius: 6, overflow: 'hidden', gap: 2 },
    legend: { gap: 6 },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    swatch: { width: 12, height: 12, borderRadius: 3 },
    legendName: {
      color: colors.text,
      fontWeight: '700',
      fontSize: typography.label.fontSize,
      flexGrow: 1,
    },
    legendPct: {
      color: colors.text,
      fontWeight: '800',
      fontSize: typography.label.fontSize,
      minWidth: 40,
      textAlign: 'right',
    },
    legendDetail: { color: colors.textMuted, fontSize: typography.caption.fontSize },
    topCustomers: { gap: 6, marginTop: spacing.sm },
    subTitle: { color: colors.text, fontWeight: '800', fontSize: typography.label.fontSize + 1 },
    customerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    medal: { width: 24, fontSize: 16 },
    customerName: {
      flex: 1,
      minWidth: 0,
      color: colors.text,
      fontWeight: '700',
      fontSize: typography.label.fontSize,
    },

    columns: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'stretch' },
    column: { flexGrow: 1, flexBasis: 320, minWidth: 0 },
    barList: { gap: spacing.md },
    barRow: { gap: 4 },
    barHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    barRank: {
      width: 18,
      color: colors.textFaint,
      fontWeight: '800',
      fontSize: typography.label.fontSize,
    },
    barLabel: {
      flex: 1,
      minWidth: 0,
      color: colors.text,
      fontWeight: '700',
      fontSize: typography.label.fontSize + 1,
    },
    barDetail: { color: colors.textMuted, fontSize: typography.caption.fontSize, flexShrink: 0 },
    barTrack: {
      height: 10,
      marginLeft: 26,
      borderRadius: 5,
      backgroundColor: colors.background,
      overflow: 'hidden',
    },
    barFill: { height: 10, borderRadius: 5 },

    storyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    storyCard: { width: 110, gap: 4 },
    storyThumb: {
      width: 110,
      height: 170,
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    fill: { width: '100%', height: '100%' },
    videoThumb: { backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
    rank: {
      position: 'absolute',
      top: 6,
      left: 6,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rankText: { color: colors.onPrimary, fontWeight: '800', fontSize: 12 },
    storyName: { color: colors.text, fontSize: typography.caption.fontSize + 1, fontWeight: '600' },
    storyViews: { color: colors.textMuted, fontSize: typography.caption.fontSize },
  });
}
