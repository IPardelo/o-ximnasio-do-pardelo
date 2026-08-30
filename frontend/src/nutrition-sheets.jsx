// Sheets for the Nutrition tab — kept in their own file rather than folded into the (already
// 900+ line) sheets.jsx, so the feature stays easy to review or lift out as one unit. Follows
// the same conventions as sheets.jsx: openSheet(render) from useUI, direct `update(s => {...})`
// mutations on the store (no dedicated action methods — same pattern bodyweight/routines use),
// and a `close` passed to every sheet body by the opener.
import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { uid, todayISO, fmtDate } from './lib/format.js'
import { t } from './lib/i18n.js'
import {
  MEAL_LABEL, unitsFor, unitLabel, macrosFor, macrosForRecipe,
  searchFoods, foodByBarcode, recentFoods, frequentFoods, STARTER_FOODS,
} from './lib/nutrition.js'
import Icon from './components/Icon.jsx'
import { Button, TextField, NumberField, SearchField, Segmented, Row } from './components/ui.jsx'
import BarcodeScanner from './components/BarcodeScanner.jsx'

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)

export const mealLabel = m => t(MEAL_LABEL[m] || m)

// Every food available to search: the user's own library plus the small starter list, own
// foods first so a custom food with the same name as a starter one wins.
export function allFoods(st) {
  const ownNames = new Set(st.foods.map(f => f.name.toLowerCase()))
  return [...st.foods, ...STARTER_FOODS.filter(f => !ownNames.has(f.name.toLowerCase()))]
}

function logEntry(date, meal, food, qty, unit) {
  const m = macrosFor(food, qty, unit)
  update(s => {
    if (!s.foodLog[date]) s.foodLog[date] = []
    s.foodLog[date].push({ id: uid(), meal, foodId: food.id, qty, unit, ...m, ts: Date.now() })
  })
  toast(t('{0} added', food.name))
}

function logRecipe(date, meal, recipe) {
  const m = macrosForRecipe(recipe, S())
  update(s => {
    if (!s.foodLog[date]) s.foodLog[date] = []
    s.foodLog[date].push({ id: uid(), meal, recipeId: recipe.id, qty: 1, unit: 'serving', ...m, ts: Date.now() })
  })
  toast(t('{0} added', recipe.name))
}

export function removeLogEntry(date, id) {
  update(s => { s.foodLog[date] = (s.foodLog[date] || []).filter(e => e.id !== id) })
}

/* ============================ quantity / unit ============================ */

function QuantityUnit({ food, date, meal, close }) {
  const opts = unitsFor(food)
  const [unit, setUnit] = useState(opts[0])
  const [qty, setQty] = useState(unit === 'unit' ? 1 : (food.servingGrams ? food.servingGrams : 100))
  const m = macrosFor(food, qty, unit)
  const changeUnit = u => { setUnit(u); setQty(u === 'unit' ? 1 : u === 'serving' ? 1 : 100) }
  const save = () => {
    if (!qty || qty <= 0) { toast(t('Enter a quantity')); return }
    logEntry(date, meal, food, qty, unit)
    close()
  }
  return <>
    <h3>{food.name}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{mealLabel(meal)} · {fmtDate(date, true)}</div>

    <div className="row" style={{ gap: 10, marginBottom: 14 }}>
      <NumberField value={qty} onChange={setQty} className="field" style={{ flex: 1 }} />
      {opts.length > 1
        ? <Segmented options={opts.map(o => ({ value: o, label: unitLabel(food, o) }))} value={unit} onChange={changeUnit} />
        : <span className="tag">{unitLabel(food, unit)}</span>}
    </div>

    <div className="card" style={{ marginBottom: 0 }}>
      <div className="row between"><span className="muted small">{t('Calories')}</span><b>{m.kcal} kcal</b></div>
      <div className="row between" style={{ marginTop: 6 }}><span className="muted small">{t('Protein')}</span><span>{m.protein} g</span></div>
      <div className="row between" style={{ marginTop: 4 }}><span className="muted small">{t('Carbs')}</span><span>{m.carbs} g</span></div>
      <div className="row between" style={{ marginTop: 4 }}><span className="muted small">{t('Fat')}</span><span>{m.fat} g</span></div>
    </div>

    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Add to {0}', mealLabel(meal))}</Button>
  </>
}
function quantityUnitSheet(food, date, meal) {
  return ui().openSheet(close => <QuantityUnit food={food} date={date} meal={meal} close={close} />)
}

/* ============================ create / edit a food ============================ */

function CreateFood({ prefillName, prefillBarcode, onCreated, close }) {
  const [mode, setMode] = useState('weight')
  const [name, setName] = useState(prefillName || '')
  const [brand, setBrand] = useState('')
  const [barcode, setBarcode] = useState(prefillBarcode || '')
  const [kcal, setKcal] = useState(null)
  const [protein, setProtein] = useState(null)
  const [carbs, setCarbs] = useState(null)
  const [fat, setFat] = useState(null)
  const [unitLbl, setUnitLbl] = useState('')
  const [servingGrams, setServingGrams] = useState(null)
  const [servingLabel, setServingLabel] = useState('')

  const save = () => {
    if (!name.trim()) { toast(t('Enter a name')); return }
    if (mode === 'unit' && !unitLbl.trim()) { toast(t('Enter a unit name, e.g. "egg"')); return }
    const macros = { kcal: kcal || 0, protein: protein || 0, carbs: carbs || 0, fat: fat || 0 }
    const food = {
      id: uid(), name: name.trim(), brand: brand.trim(), barcode: barcode.trim(),
      mode,
      per100: mode === 'weight' ? macros : null,
      perUnit: mode === 'unit' ? macros : null,
      unitLabel: mode === 'unit' ? unitLbl.trim() : '',
      servingGrams: mode === 'weight' && servingGrams ? servingGrams : null,
      servingLabel: mode === 'weight' && servingGrams ? servingLabel.trim() : '',
    }
    update(s => { s.foods.push(food) })
    close()
    toast(t('Food created'))
    if (onCreated) onCreated(food)
  }

  return <>
    <h3>{t('Create food')}</h3>
    <TextField placeholder={t('Name')} value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 10 }} />
    <TextField placeholder={t('Brand (optional)')} value={brand} onChange={e => setBrand(e.target.value)} style={{ marginBottom: 10 }} />
    <TextField placeholder={t('Barcode (optional)')} value={barcode} onChange={e => setBarcode(e.target.value)} style={{ marginBottom: 14 }} />

    <h4 className="sec">{t('How is it measured?')}</h4>
    <Segmented
      options={[{ value: 'weight', label: t('By weight') }, { value: 'unit', label: t('By unit') }]}
      value={mode} onChange={setMode}
    />
    <div style={{ height: 12 }} />

    {mode === 'unit' && (
      <TextField placeholder={t('Unit name, e.g. "egg", "slice"')} value={unitLbl} onChange={e => setUnitLbl(e.target.value)} style={{ marginBottom: 12 }} />
    )}

    <h4 className="sec">{mode === 'weight' ? t('Per 100 g / 100 ml') : t('Per unit')}</h4>
    <div className="grid2" style={{ marginBottom: 10 }}>
      <Row title={t('Calories')} children={<NumberField value={kcal} onChange={setKcal} decimal={false} className="field" style={{ width: 80, textAlign: 'right' }} />} />
      <Row title={t('Protein (g)')} children={<NumberField value={protein} onChange={setProtein} className="field" style={{ width: 80, textAlign: 'right' }} />} />
    </div>
    <div className="grid2" style={{ marginBottom: 14 }}>
      <Row title={t('Carbs (g)')} children={<NumberField value={carbs} onChange={setCarbs} className="field" style={{ width: 80, textAlign: 'right' }} />} />
      <Row title={t('Fat (g)')} children={<NumberField value={fat} onChange={setFat} className="field" style={{ width: 80, textAlign: 'right' }} />} />
    </div>

    {mode === 'weight' && <>
      <h4 className="sec">{t('Standard serving (optional)')}</h4>
      <div className="row" style={{ gap: 10, marginBottom: 14 }}>
        <NumberField placeholder={t('Grams')} value={servingGrams} onChange={setServingGrams} decimal={false} className="field" style={{ flex: 1 }} />
        <TextField placeholder={t('Name, e.g. "1 cup"')} value={servingLabel} onChange={e => setServingLabel(e.target.value)} style={{ flex: 1 }} />
      </div>
    </>}

    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export function createFoodSheet(opts = {}) {
  return ui().openSheet(close => <CreateFood {...opts} close={close} />)
}

/* ============================ barcode scan ============================ */

function BarcodeSheet({ date, meal, close }) {
  const onDetect = code => {
    close()
    const food = foodByBarcode(allFoods(S()), code)
    if (food) { quantityUnitSheet(food, date, meal); return }
    toast(t('No food saved with this barcode yet'))
    createFoodSheet({ prefillBarcode: code, onCreated: f => quantityUnitSheet(f, date, meal) })
  }
  return <BarcodeScanner onDetect={onDetect} close={close} />
}
function barcodeSheet(date, meal) {
  return ui().openSheet(close => <BarcodeSheet date={date} meal={meal} close={close} />)
}

/* ============================ add food (search + recent/frequent) ============================ */

function AddFood({ date, meal, close }) {
  const st = useStore(s => s.S)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('recent')
  const results = q.trim() ? searchFoods(allFoods(st), q) : []
  const recent = recentFoods(st)
  const frequent = frequentFoods(st)
  const shown = q.trim() ? results : (tab === 'recent' ? recent : frequent)

  const pick = food => { close(); quantityUnitSheet(food, date, meal) }

  return <>
    <h3>{t('Add food')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{mealLabel(meal)} · {fmtDate(date, true)}</div>
    <SearchField placeholder={t('Search foods…')} value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} />
    <div style={{ height: 10 }} />
    <div className="row" style={{ gap: 8, marginBottom: 10 }}>
      <Button variant="tinted" icon="barcode" onClick={() => { close(); barcodeSheet(date, meal) }}>{t('Scan barcode')}</Button>
      <Button variant="tinted" icon="plus" onClick={() => { close(); createFoodSheet({ prefillName: q.trim(), onCreated: f => quantityUnitSheet(f, date, meal) }) }}>{t('Create food')}</Button>
    </div>

    {!q.trim() && (
      <Segmented
        options={[{ value: 'recent', label: t('Recent') }, { value: 'frequent', label: t('Frequent') }]}
        value={tab} onChange={setTab} className="grid2" style={{ marginBottom: 10 }}
      />
    )}

    <div className="list">
      {shown.map(f => (
        <div key={f.id} className="item" onClick={() => pick(f)}>
          <div className="thumb thumb-x"><Icon name="apple" /></div>
          <div className="grow">
            <div className="tt">{f.name}</div>
            <div className="ss">{f.brand ? f.brand + ' · ' : ''}{f.mode === 'unit' ? t('per {0}', f.unitLabel || t('unit')) : t('per 100 g')}</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>
      ))}
      {q.trim() && !shown.length && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No match')}</div>}
      {!q.trim() && !shown.length && <div className="empty"><div className="ico"><Icon name="apple" /></div>{t('Nothing here yet — log a few foods and they\'ll show up for quick re-adding.')}</div>}
    </div>
  </>
}
export function addFoodSheet(date, meal) {
  return ui().openSheet(close => <AddFood date={date} meal={meal} close={close} />)
}

/* ============================ recipes ============================ */

function RecipeIngredients({ items, setItems }) {
  const st = S()
  const [q, setQ] = useState('')
  const results = q.trim() ? searchFoods(allFoods(st), q) : []
  const add = f => { setItems([...items, { foodId: f.id, qty: f.mode === 'unit' ? 1 : 100, unit: unitsFor(f)[0] }]); setQ('') }
  const remove = i => setItems(items.filter((_, idx) => idx !== i))
  const byId = new Map(allFoods(st).map(f => [f.id, f]))

  return <>
    <SearchField placeholder={t('Add ingredient…')} value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} />
    {q.trim() && (
      <div className="list" style={{ marginTop: 8 }}>
        {results.slice(0, 8).map(f => (
          <div key={f.id} className="item" onClick={() => add(f)}>
            <div className="grow"><div className="tt">{f.name}</div></div>
            <Icon name="plus" className="chev" />
          </div>
        ))}
        {!results.length && <div className="empty" style={{ padding: 16 }}>{t('No match')}</div>}
      </div>
    )}
    {items.length > 0 && <div className="sect-b" style={{ marginTop: 10 }}>
      {items.map((it, i) => {
        const f = byId.get(it.foodId)
        return <Row key={i} title={f ? f.name : t('(deleted)')} subtitle={it.qty + ' ' + unitLabel(f || {}, it.unit)}
          children={<button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => remove(i)}><Icon name="trash" /></button>} />
      })}
    </div>}
  </>
}

function CreateRecipe({ close }) {
  const [name, setName] = useState('')
  const [items, setItems] = useState([])
  const save = () => {
    if (!name.trim()) { toast(t('Enter a name')); return }
    if (!items.length) { toast(t('Add at least one ingredient')); return }
    update(s => { s.recipes.push({ id: uid(), name: name.trim(), items }) })
    close()
    toast(t('Recipe created'))
  }
  return <>
    <h3>{t('Create recipe')}</h3>
    <TextField placeholder={t('Recipe name')} value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 14 }} />
    <h4 className="sec">{t('Ingredients')}</h4>
    <RecipeIngredients items={items} setItems={setItems} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save recipe')}</Button>
  </>
}
export function createRecipeSheet() {
  return ui().openSheet(close => <CreateRecipe close={close} />)
}

function Recipes({ date, meal, close }) {
  const st = useStore(s => s.S)
  const del = id => update(s => { s.recipes = s.recipes.filter(r => r.id !== id) })
  return <>
    <h3>{t('My recipes')}</h3>
    <Button icon="plus" onClick={() => { close(); createRecipeSheet() }} style={{ marginBottom: 12 }}>{t('Create recipe')}</Button>
    <div className="list">
      {st.recipes.map(r => {
        const m = macrosForRecipe(r, st)
        return <div key={r.id} className="item">
          <div className="thumb thumb-x"><Icon name="clipboard" /></div>
          <div className="grow" onClick={() => { if (date && meal) { close(); logRecipe(date, meal, r) } }} style={{ cursor: date && meal ? 'pointer' : 'default' }}>
            <div className="tt">{r.name}</div>
            <div className="ss">{m.kcal} kcal · {r.items.length} {t('ingredients')}</div>
          </div>
          {date && meal && <Button size="sm" variant="tinted" icon="plus" onClick={() => { close(); logRecipe(date, meal, r) }}>{t('Log')}</Button>}
          <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => del(r.id)}><Icon name="trash" /></button>
        </div>
      })}
      {!st.recipes.length && <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No recipes yet — group foods you eat often into a recipe you can log in one tap.')}</div>}
    </div>
  </>
}
export function recipesSheet(date, meal) {
  return ui().openSheet(close => <Recipes date={date} meal={meal} close={close} />)
}

/* ============================ goals & exercise calories burned ============================ */

function EditGoals({ close }) {
  const g = S().nutritionGoals
  const [kcal, setKcal] = useState(g.kcal)
  const [protein, setProtein] = useState(g.protein)
  const [carbs, setCarbs] = useState(g.carbs)
  const [fat, setFat] = useState(g.fat)
  const save = () => {
    update(s => { s.nutritionGoals = { kcal: kcal || 0, protein: protein || 0, carbs: carbs || 0, fat: fat || 0 } })
    close()
  }
  return <>
    <h3>{t('Daily goal')}</h3>
    <Row title={t('Calories')} children={<NumberField value={kcal} onChange={setKcal} decimal={false} className="field" style={{ width: 80, textAlign: 'right' }} />} />
    <Row title={t('Protein (g)')} children={<NumberField value={protein} onChange={setProtein} className="field" style={{ width: 80, textAlign: 'right' }} />} />
    <Row title={t('Carbs (g)')} children={<NumberField value={carbs} onChange={setCarbs} className="field" style={{ width: 80, textAlign: 'right' }} />} />
    <Row title={t('Fat (g)')} children={<NumberField value={fat} onChange={setFat} className="field" style={{ width: 80, textAlign: 'right' }} />} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export function editGoalsSheet() {
  return ui().openSheet(close => <EditGoals close={close} />)
}

function EditBurn({ date, close }) {
  const [v, setV] = useState(S().dailyBurn?.[date] || 0)
  const save = () => { update(s => { s.dailyBurn[date] = v || 0 }); close() }
  return <>
    <h3>{t('Calories burned (exercise)')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{fmtDate(date, true)}</div>
    <NumberField value={v} onChange={setV} decimal={false} className="field" />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export function editBurnSheet(date) {
  return ui().openSheet(close => <EditBurn date={date} close={close} />)
}
