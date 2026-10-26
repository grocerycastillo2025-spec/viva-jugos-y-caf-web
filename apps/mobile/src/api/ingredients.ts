/** Ingredientes (0031). */

import { dataError } from '../domain/errors';
import { getSupabase } from '../supabase';

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw dataError(error.message, error.code);
}

export interface Ingredient {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
  readonly sort_order: number;
  readonly products: number;
  readonly options: number;
}

/** null = la base aún no tiene la 0031. */
export async function fetchIngredients(storeId: string): Promise<Ingredient[] | null> {
  const { data, error } = await getSupabase()
    .from('ingredients')
    .select('id, name, available, sort_order, item_ingredients(count), catalog_modifiers(count)')
    .eq('store_id', storeId)
    .order('sort_order')
    .order('name')
    .returns<
      {
        id: string;
        name: string;
        available: boolean;
        sort_order: number;
        item_ingredients: { count: number }[];
        catalog_modifiers: { count: number }[];
      }[]
    >();
  if (error?.code === '42P01' || error?.code === 'PGRST205') return null;
  fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    available: row.available,
    sort_order: row.sort_order,
    products: row.item_ingredients[0]?.count ?? 0,
    options: row.catalog_modifiers[0]?.count ?? 0,
  }));
}

export async function createIngredient(storeId: string, name: string, sortOrder: number): Promise<void> {
  const { error } = await getSupabase()
    .from('ingredients')
    .insert({ store_id: storeId, name: name.trim(), sort_order: sortOrder });
  if (error?.code === '23505') throw dataError('ingredient_exists', error.code);
  fail(error);
}

export async function deleteIngredient(id: string): Promise<void> {
  const { error } = await getSupabase().from('ingredients').delete().eq('id', id);
  fail(error);
}

export interface ImpactItem {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
  readonly other_missing: readonly string[];
}
export interface ImpactModifier {
  readonly id: string;
  readonly name: string;
  readonly group: string;
  readonly available: boolean;
}
export interface IngredientImpact {
  readonly ingredient: { id: string; name: string; available: boolean };
  readonly items: readonly ImpactItem[];
  readonly modifiers: readonly ImpactModifier[];
}

export async function fetchIngredientImpact(id: string): Promise<IngredientImpact> {
  const { data, error } = await getSupabase().rpc('ingredient_impact', { p_ingredient_id: id });
  fail(error);
  return data as IngredientImpact;
}

export async function setIngredientAvailable(
  id: string,
  available: boolean,
  itemIds: readonly string[],
  modifierIds: readonly string[],
): Promise<void> {
  const { error } = await getSupabase().rpc('set_ingredient_available', {
    p_ingredient_id: id,
    p_available: available,
    p_item_ids: itemIds,
    p_modifier_ids: modifierIds,
  });
  fail(error);
}

/** Ingredientes de un producto. null = base sin la 0031. */
export async function fetchItemIngredientIds(itemId: string): Promise<string[] | null> {
  const { data, error } = await getSupabase()
    .from('item_ingredients')
    .select('ingredient_id')
    .eq('item_id', itemId)
    .returns<{ ingredient_id: string }[]>();
  if (error?.code === '42P01' || error?.code === 'PGRST205') return null;
  fail(error);
  return (data ?? []).map((r) => r.ingredient_id);
}

export async function setItemIngredients(itemId: string, ingredientIds: readonly string[]): Promise<void> {
  const supabase = getSupabase();
  const removed = await supabase.from('item_ingredients').delete().eq('item_id', itemId);
  fail(removed.error);
  if (ingredientIds.length === 0) return;
  const { error } = await supabase
    .from('item_ingredients')
    .insert(ingredientIds.map((ingredient_id) => ({ item_id: itemId, ingredient_id })));
  fail(error);
}
