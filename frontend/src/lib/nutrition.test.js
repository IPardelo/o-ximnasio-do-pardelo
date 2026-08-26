import { describe, it, expect } from 'vitest'
import { macrosFor, macrosForRecipe, calorieBudget, recentFoods, frequentFoods, searchFoods, unitsFor } from './nutrition.js'

const chicken = { id: 'f1', name: 'Pechuga de pollo', mode: 'weight', per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 } }
const egg = { id: 'f2', name: 'Huevo', mode: 'unit', unitLabel: 'huevo', perUnit: { kcal: 78, protein: 6.3, carbs: 0.6, fat: 5.3 } }
const shake = { id: 'f3', name: 'Batido', mode: 'weight', per100: { kcal: 200, protein: 20, carbs: 10, fat: 5 }, servingGrams: 300, servingLabel: 'vaso' }

describe('macrosFor', () => {
  it('scales a weight food by grams', () => {
    expect(macrosFor(chicken, 200, 'g')).toEqual({ kcal: 330, protein: 62, carbs: 0, fat: 7.2 })
  })
  it('converts oz to grams before scaling', () => {
    // 4 oz ≈ 113.4 g → 165 * 1.134 ≈ 187
    expect(macrosFor(chicken, 4, 'oz').kcal).toBe(187)
  })
  it('scales a unit food by count, ignoring grams entirely', () => {
    expect(macrosFor(egg, 2, 'unit')).toEqual({ kcal: 156, protein: 12.6, carbs: 1.2, fat: 10.6 })
  })
  it('uses the food\'s own serving size for the "serving" unit', () => {
    // 1 serving = 300 g of a 200 kcal/100g food → 600 kcal
    expect(macrosFor(shake, 1, 'serving').kcal).toBe(600)
  })
  it('never returns negative macros for negative input', () => {
    expect(macrosFor(chicken, -50, 'g')).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 })
  })
})

describe('unitsFor', () => {
  it('offers only "unit" for a unit-mode food', () => {
    expect(unitsFor(egg)).toEqual(['unit'])
  })
  it('appends "serving" only when the food defines one', () => {
    expect(unitsFor(chicken)).not.toContain('serving')
    expect(unitsFor(shake)).toContain('serving')
  })
})

describe('macrosForRecipe', () => {
  it('sums each ingredient at current food data', () => {
    const S = { foods: [chicken, egg] }
    const recipe = { items: [{ foodId: 'f1', qty: 100, unit: 'g' }, { foodId: 'f2', qty: 2, unit: 'unit' }] }
    const m = macrosForRecipe(recipe, S)
    expect(m.kcal).toBe(165 + 156)
    expect(m.protein).toBe(31 + 12.6)
  })
  it('skips an ingredient whose food was deleted since', () => {
    const S = { foods: [chicken] }
    const recipe = { items: [{ foodId: 'f1', qty: 100, unit: 'g' }, { foodId: 'gone', qty: 1, unit: 'unit' }] }
    expect(macrosForRecipe(recipe, S).kcal).toBe(165)
  })
})

describe('calorieBudget', () => {
  it('is goal - consumed + burned', () => {
    const S = {
      nutritionGoals: { kcal: 2000 },
      foodLog: { '2026-01-01': [{ kcal: 500 }, { kcal: 300 }] },
      dailyBurn: { '2026-01-01': 250 },
    }
    const b = calorieBudget(S, '2026-01-01')
    expect(b).toEqual({ goal: 2000, consumed: 800, burned: 250, remaining: 1450 })
  })
  it('defaults burned to 0 and handles a day with nothing logged', () => {
    const S = { nutritionGoals: { kcal: 2000 }, foodLog: {}, dailyBurn: {} }
    expect(calorieBudget(S, '2026-01-02')).toEqual({ goal: 2000, consumed: 0, burned: 0, remaining: 2000 })
  })
})

describe('recentFoods / frequentFoods', () => {
  const S = {
    foods: [chicken, egg],
    foodLog: {
      '2026-01-01': [{ foodId: 'f1', ts: 1 }, { foodId: 'f2', ts: 2 }],
      '2026-01-02': [{ foodId: 'f1', ts: 3 }],
    },
  }
  it('recentFoods orders by most recently logged, de-duplicated', () => {
    expect(recentFoods(S).map(f => f.id)).toEqual(['f1', 'f2'])
  })
  it('frequentFoods orders by how many times logged', () => {
    expect(frequentFoods(S).map(f => f.id)).toEqual(['f1', 'f2'])
  })
  it('both skip an id whose food no longer exists', () => {
    const S2 = { foods: [chicken], foodLog: S.foodLog }
    expect(recentFoods(S2).map(f => f.id)).toEqual(['f1'])
    expect(frequentFoods(S2).map(f => f.id)).toEqual(['f1'])
  })
})

describe('searchFoods', () => {
  const foods = [chicken, egg, { id: 'f4', name: 'Ensalada de pollo', mode: 'weight', per100: {} }]
  it('ranks a name-prefix match above a mid-word match', () => {
    expect(searchFoods(foods, 'poll').map(f => f.id)).toEqual(['f1', 'f4'])
  })
  it('returns nothing for a blank query', () => {
    expect(searchFoods(foods, '  ')).toEqual([])
  })
})
