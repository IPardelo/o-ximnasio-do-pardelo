// Pure helpers for the Nutrition tab — food math, unit conversion and the client-side
// "recent / frequent" lists. No network calls: this MVP works entirely off S.foods (the
// user's own food library, seeded with a small starter list) and S.foodLog. It is built so a
// real nutrition API (Edamam, FatSecret…) can be dropped in later as an additional source for
// the search sheet, without touching how a food, once picked, is logged or displayed — see the
// comment on `searchFoods`.

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks']
export const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' }

// Weight/volume units a quantity can be logged in. `toGrams` is a flat conversion — cup/tbsp/tsp
// use a generic water-density approximation (1 ml ≈ 1 g), same simplification most food-logging
// apps make for a food that doesn't carry its own density. Good enough for tracking, not a lab.
export const UNITS = {
  g: { label: 'g', toGrams: n => n },
  oz: { label: 'oz', toGrams: n => n * 28.3495 },
  ml: { label: 'ml', toGrams: n => n },
  cup: { label: 'cup', toGrams: n => n * 240 },
  tbsp: { label: 'tbsp', toGrams: n => n * 15 },
  tsp: { label: 'tsp', toGrams: n => n * 5 },
}
// Units offered for a weight/volume food — "serving" (the food's own defined portion) is
// appended only when the food has one (see unitsFor).
export const WEIGHT_UNITS = ['g', 'oz', 'ml', 'cup', 'tbsp', 'tsp']

export const emptyMacros = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 })

// Unit options valid for this food — 'unit' mode (e.g. "1 egg") only ever logs by count.
export function unitsFor(food) {
  if (food.mode === 'unit') return ['unit']
  return food.servingGrams ? [...WEIGHT_UNITS, 'serving'] : WEIGHT_UNITS
}

export function unitLabel(food, unit) {
  if (unit === 'unit') return food.unitLabel || 'unit'
  if (unit === 'serving') return food.servingLabel || 'serving'
  return UNITS[unit]?.label || unit
}

// The core recompute: qty + unit + food → { kcal, protein, carbs, fat }, rounded to whole
// grams/kcal and one decimal of protein/carbs/fat. This is what runs every time a quantity or
// unit changes in the log sheet, and again once when an entry is saved (the result is snapshotted
// onto the log entry, so editing or deleting the food later never rewrites logged history).
export function macrosFor(food, qty, unit) {
  const n = Math.max(0, +qty || 0)
  if (!food) return emptyMacros()
  if (food.mode === 'unit') {
    const per = food.perUnit || emptyMacros()
    return scale(per, n)
  }
  const per100 = food.per100 || emptyMacros()
  const grams = unit === 'serving' ? n * (food.servingGrams || 100) : (UNITS[unit]?.toGrams(n) ?? n)
  return scale(per100, grams / 100)
}
const round1 = n => Math.round(n * 10) / 10
function scale(m, factor) {
  return {
    kcal: Math.round((m.kcal || 0) * factor),
    protein: round1((m.protein || 0) * factor),
    carbs: round1((m.carbs || 0) * factor),
    fat: round1((m.fat || 0) * factor),
  }
}

// Sum of a recipe's ingredients at today's food data — used both for the recipe editor's live
// preview and to snapshot a recipe log entry (macrosForRecipe(recipe, S) at the moment it's
// logged; after that the entry carries its own numbers, same as any other logged food).
export function macrosForRecipe(recipe, S) {
  const byId = new Map(S.foods.map(f => [f.id, f]))
  return (recipe.items || []).reduce((sum, it) => {
    const f = byId.get(it.foodId)
    if (!f) return sum
    const m = macrosFor(f, it.qty, it.unit)
    sum.kcal += m.kcal; sum.protein += m.protein; sum.carbs += m.carbs; sum.fat += m.fat
    return sum
  }, emptyMacros())
}

// Client-side search over the food library — name, then brand. Ranked so a prefix match
// ("chic" → "Chicken breast") sorts above a mid-word match ("...chicken salad"). This is the
// seam a real API plugs into later: a hosted instance with Edamam/FatSecret keys would merge
// remote results in here (own foods first, remote results after), everything downstream
// (macrosFor, logging, recent/frequent) is unaffected either way.
export function searchFoods(foods, q) {
  const s = (q || '').trim().toLowerCase()
  if (!s) return []
  const score = f => {
    const n = f.name.toLowerCase(), b = (f.brand || '').toLowerCase()
    if (n.startsWith(s)) return 0
    if (n.includes(s)) return 1
    if (b.startsWith(s)) return 2
    if (b.includes(s)) return 3
    return -1
  }
  // Same tier: the match nearer the start of the name wins, then alphabetical.
  const pos = f => { const i = f.name.toLowerCase().indexOf(s); return i < 0 ? Infinity : i }
  return foods.map(f => [f, score(f)]).filter(([, sc]) => sc >= 0)
    .sort((a, b) => a[1] - b[1] || pos(a[0]) - pos(b[0]) || a[0].name.localeCompare(b[0].name))
    .map(([f]) => f)
}

export function foodByBarcode(foods, code) {
  return foods.find(f => f.barcode && f.barcode === code) || null
}

// All log entries for one date, flattened across meals — the shape the dashboard sums.
export function entriesFor(S, date) {
  return S.foodLog?.[date] || []
}

export function dailyTotals(S, date) {
  return entriesFor(S, date).reduce((sum, e) => {
    sum.kcal += e.kcal || 0; sum.protein += e.protein || 0; sum.carbs += e.carbs || 0; sum.fat += e.fat || 0
    return sum
  }, emptyMacros())
}

// Calorías consumidas − quemadas = restantes, contra el objetivo diario.
export function calorieBudget(S, date) {
  const goal = S.nutritionGoals?.kcal || 0
  const consumed = dailyTotals(S, date).kcal
  const burned = S.dailyBurn?.[date] || 0
  const remaining = goal - consumed + burned
  return { goal, consumed, burned, remaining }
}

// Most-recently-logged foods first, de-duplicated — skips ids whose food was since deleted.
export function recentFoods(S, limit = 12) {
  const byId = new Map(S.foods.map(f => [f.id, f]))
  const seen = new Set()
  const out = []
  const dates = Object.keys(S.foodLog || {}).sort().reverse()
  for (const d of dates) {
    const entries = [...(S.foodLog[d] || [])].sort((a, b) => (b.ts || 0) - (a.ts || 0))
    for (const e of entries) {
      if (!e.foodId || seen.has(e.foodId)) continue
      const f = byId.get(e.foodId)
      if (!f) continue
      seen.add(e.foodId); out.push(f)
      if (out.length >= limit) return out
    }
  }
  return out
}

// Most-often-logged foods, all time — ties broken by most recent.
export function frequentFoods(S, limit = 12) {
  const byId = new Map(S.foods.map(f => [f.id, f]))
  const count = new Map(), lastTs = new Map()
  for (const d of Object.keys(S.foodLog || {})) {
    for (const e of S.foodLog[d] || []) {
      if (!e.foodId || !byId.has(e.foodId)) continue
      count.set(e.foodId, (count.get(e.foodId) || 0) + 1)
      lastTs.set(e.foodId, Math.max(lastTs.get(e.foodId) || 0, e.ts || 0))
    }
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || (lastTs.get(b[0]) || 0) - (lastTs.get(a[0]) || 0))
    .slice(0, limit)
    .map(([id]) => byId.get(id))
    .filter(Boolean)
}

// A small starter library so the tab is useful before anyone has typed a single food in —
// common items, per 100 g/ml. Anything not here is a `+ Create food` away, and stays in
// S.foods (synced like everything else) once added.
export const STARTER_FOODS = [
  { name: 'Pechuga de pollo', kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  { name: 'Arroz blanco cocido', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  { name: 'Arroz integral cocido', kcal: 123, protein: 2.7, carbs: 26, fat: 1 },
  { name: 'Pasta cocida', kcal: 131, protein: 5, carbs: 25, fat: 1.1 },
  { name: 'Patata cocida', kcal: 87, protein: 1.9, carbs: 20, fat: 0.1 },
  { name: 'Pan blanco', kcal: 265, protein: 9, carbs: 49, fat: 3.2 },
  { name: 'Avena', kcal: 389, protein: 16.9, carbs: 66, fat: 6.9 },
  { name: 'Leche entera', kcal: 61, protein: 3.2, carbs: 4.8, fat: 3.3 },
  { name: 'Yogur natural', kcal: 61, protein: 3.5, carbs: 4.7, fat: 3.3 },
  { name: 'Queso fresco', kcal: 98, protein: 11, carbs: 3.4, fat: 4.3 },
  { name: 'Atún al natural', kcal: 116, protein: 26, carbs: 0, fat: 1 },
  { name: 'Salmón', kcal: 208, protein: 20, carbs: 0, fat: 13 },
  { name: 'Ternera magra', kcal: 187, protein: 26, carbs: 0, fat: 9 },
  { name: 'Lentejas cocidas', kcal: 116, protein: 9, carbs: 20, fat: 0.4 },
  { name: 'Garbanzos cocidos', kcal: 164, protein: 8.9, carbs: 27, fat: 2.6 },
  { name: 'Brócoli', kcal: 34, protein: 2.8, carbs: 7, fat: 0.4 },
  { name: 'Espinacas', kcal: 23, protein: 2.9, carbs: 3.6, fat: 0.4 },
  { name: 'Tomate', kcal: 18, protein: 0.9, carbs: 3.9, fat: 0.2 },
  { name: 'Manzana', kcal: 52, protein: 0.3, carbs: 14, fat: 0.2 },
  { name: 'Plátano', kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 },
  { name: 'Almendras', kcal: 579, protein: 21, carbs: 22, fat: 50 },
  { name: 'Aceite de oliva', kcal: 884, protein: 0, carbs: 0, fat: 100 },
  { name: 'Aguacate', kcal: 160, protein: 2, carbs: 9, fat: 15 },
  { name: 'Proteína en polvo (whey)', kcal: 380, protein: 78, carbs: 6, fat: 5 },
].map((f, i) => ({
  id: 'starter-' + i,
  name: f.name,
  brand: '',
  barcode: '',
  mode: 'weight',
  per100: { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat },
  servingGrams: null,
  servingLabel: '',
  unitLabel: '',
}))
