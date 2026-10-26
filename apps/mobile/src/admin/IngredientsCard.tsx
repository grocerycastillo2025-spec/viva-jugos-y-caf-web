/**
 * Panel · Menú · Ingredientes (0031).
 *
 * "Se acabó la naranja": se apaga el ingrediente y el panel pregunta qué
 * productos y opciones que lo usan apagar también (marcados por omisión).
 * Al prenderlo, propone reactivar los que ya tienen todo.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import {
  createIngredient,
  deleteIngredient,
  fetchIngredientImpact,
  fetchIngredients,
  setIngredientAvailable,
  type Ingredient,
  type IngredientImpact,
} from '../api/ingredients';
import { Button } from '../components/ui';
import type { BrandColors } from '../domain/branding';
import { defaultSelection, relevant, toggleId } from '../domain/ingredients';
import { useAsync } from '../hooks/use-async';
import { useColors } from '../state/branding-context';
import { radius, spacing, type as typography } from '../theme';
import { Card, Notice, createAdminStyles } from './ui';
import { adminStrings } from './strings';

const t = adminStrings.ingredients;

interface Pending {
  readonly ingredient: Ingredient;
  readonly turningOn: boolean;
  readonly impact: IngredientImpact;
  items: string[];
  modifiers: string[];
}

export function IngredientsCard({
  storeId,
  onChanged,
}: {
  readonly storeId: string;
  readonly onChanged: () => void;
}): ReactNode {
  const colors = useColors();
  const styles = useMemo(
    () => ({ ...createAdminStyles(colors), ...createStyles(colors) }),
    [colors],
  );
  const load = useCallback(() => fetchIngredients(storeId), [storeId]);
  const { data, refresh } = useAsync(load, [storeId]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  if (data === null || data === undefined) {
    // Base sin la 0031: la tarjeta no se ensena.
    return null;
  }

  const fail = (cause: unknown): void => {
    const message = cause instanceof Error ? cause.message : String(cause);
    setNotice({
      tone: 'error',
      text: message.includes('ingredient_exists')
        ? t.exists
        : `${adminStrings.saveFailed}: ${message}`,
    });
  };

  const startToggle = async (ingredient: Ingredient, value: boolean): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const impact = await fetchIngredientImpact(ingredient.id);
      const sel = defaultSelection(impact, value);
      const shown = relevant(impact.items, value).length + relevant(impact.modifiers, value).length;
      if (shown === 0) {
        // Nada que preguntar: solo el ingrediente.
        await setIngredientAvailable(ingredient.id, value, [], []);
        setNotice({
          tone: 'ok',
          text: value ? t.onDone(ingredient.name, 0) : t.offDone(ingredient.name, 0),
        });
        refresh();
        onChanged();
      } else {
        setPending({
          ingredient,
          turningOn: value,
          impact,
          items: sel.items,
          modifiers: sel.modifiers,
        });
      }
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (): Promise<void> => {
    if (pending === null) return;
    setBusy(true);
    try {
      await setIngredientAvailable(
        pending.ingredient.id,
        pending.turningOn,
        pending.items,
        pending.modifiers,
      );
      const n = pending.items.length + pending.modifiers.length;
      setNotice({
        tone: 'ok',
        text: pending.turningOn
          ? t.onDone(pending.ingredient.name, n)
          : t.offDone(pending.ingredient.name, n),
      });
      setPending(null);
      refresh();
      onChanged();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const add = (): void => {
    const name = newName.trim();
    if (name === '') return;
    setBusy(true);
    void createIngredient(storeId, name, (data[data.length - 1]?.sort_order ?? 0) + 1)
      .then(() => {
        setNewName('');
        refresh();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const off = data.filter((i) => !i.available);

  return (
    <Card title={t.title}>
      <Text style={styles.hint}>{t.hint}</Text>
      {off.length > 0 ? (
        <Text style={styles.offSummary}>{t.offNow(off.map((i) => i.name).join(', '))}</Text>
      ) : null}

      {pending !== null ? (
        <View style={[styles.ask, pending.turningOn ? styles.askOn : styles.askOff]}>
          <Text style={styles.askTitle}>
            {pending.turningOn
              ? t.askOn(pending.ingredient.name)
              : t.askOff(pending.ingredient.name)}
          </Text>
          {relevant(pending.impact.items, pending.turningOn).map((item) => {
            const checked = pending.items.includes(item.id);
            const blocked = pending.turningOn && item.other_missing.length > 0;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                onPress={() => setPending({ ...pending, items: toggleId(pending.items, item.id) })}
                style={styles.checkRow}
              >
                <Ionicons
                  name={checked ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={colors.primary}
                />
                <View style={styles.grow}>
                  <Text style={styles.checkText}>{item.name}</Text>
                  {blocked ? (
                    <Text style={styles.warn}>{t.stillMissing(item.other_missing.join(', '))}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
          {relevant(pending.impact.modifiers, pending.turningOn).map((m) => {
            const checked = pending.modifiers.includes(m.id);
            return (
              <Pressable
                key={m.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                onPress={() =>
                  setPending({ ...pending, modifiers: toggleId(pending.modifiers, m.id) })
                }
                style={styles.checkRow}
              >
                <Ionicons
                  name={checked ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={colors.primary}
                />
                <Text style={styles.checkText}>{t.option(m.name, m.group)}</Text>
              </Pressable>
            );
          })}
          <View style={styles.askButtons}>
            <Button
              label={
                pending.turningOn
                  ? t.confirmOn(pending.items.length + pending.modifiers.length)
                  : t.confirmOff(pending.items.length + pending.modifiers.length)
              }
              busy={busy}
              onPress={() => void confirm()}
            />
            <Button
              label={adminStrings.cancel}
              variant="outline"
              onPress={() => setPending(null)}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.grid}>
        {data.map((ing) => (
          <View key={ing.id} style={[styles.chip, !ing.available && styles.chipOff]}>
            <View style={styles.grow}>
              <Text
                style={[styles.chipName, !ing.available && styles.chipNameOff]}
                numberOfLines={1}
              >
                {ing.name}
              </Text>
              <Text style={styles.chipMeta}>{t.uses(ing.products, ing.options)}</Text>
            </View>
            {deleting === ing.id ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setDeleting(null);
                  void deleteIngredient(ing.id).then(refresh).catch(fail);
                }}
              >
                <Text style={styles.danger}>{adminStrings.confirmDelete}</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${adminStrings.confirmDelete} ${ing.name}`}
                onPress={() => setDeleting(ing.id)}
                hitSlop={6}
              >
                <Ionicons name="trash-outline" size={16} color={colors.textFaint} />
              </Pressable>
            )}
            <Switch
              value={ing.available}
              disabled={busy || pending !== null}
              onValueChange={(v) => void startToggle(ing, v)}
              accessibilityLabel={`${ing.name}: ${ing.available ? t.available : t.soldOut}`}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#FFFFFF"
              {...({ activeThumbColor: '#FFFFFF' } as object)}
            />
          </View>
        ))}
      </View>

      <View style={styles.addRow}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder={t.newPlaceholder}
          placeholderTextColor={colors.textFaint}
          onSubmitEditing={add}
          accessibilityLabel={t.newPlaceholder}
          style={[styles.input, styles.grow]}
        />
        <Button label={adminStrings.add} onPress={add} disabled={busy || newName.trim() === ''} />
      </View>

      {notice !== null ? <Notice tone={notice.tone} text={notice.text} /> : null}
    </Card>
  );
}

function createStyles(colors: BrandColors) {
  return StyleSheet.create({
    grow: { flex: 1, minWidth: 0 },
    offSummary: { color: colors.danger, fontWeight: '700', fontSize: typography.label.fontSize },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      flexBasis: 230,
      flexGrow: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipOff: { backgroundColor: '#FDEFEE', borderColor: colors.danger },
    chipName: { color: colors.text, fontWeight: '700', fontSize: typography.label.fontSize + 1 },
    chipNameOff: { color: colors.danger, textDecorationLine: 'line-through' },
    chipMeta: { color: colors.textMuted, fontSize: typography.caption.fontSize },
    danger: { color: colors.danger, fontWeight: '800', fontSize: typography.caption.fontSize },
    ask: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 2 },
    askOff: { borderColor: colors.danger, backgroundColor: '#FFF6F4' },
    askOn: { borderColor: colors.success, backgroundColor: '#EEF7F1' },
    askTitle: { color: colors.text, fontWeight: '800', fontSize: typography.body.fontSize },
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
    checkText: { color: colors.text, fontSize: typography.label.fontSize + 1, fontWeight: '600' },
    warn: { color: colors.textMuted, fontSize: typography.caption.fontSize },
    askButtons: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.xs },
    addRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  });
}
