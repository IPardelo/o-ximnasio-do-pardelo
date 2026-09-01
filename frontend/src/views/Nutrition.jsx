import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { isoOf, fmtDate, fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { MEALS, calorieBudget, dailyTotals, unitLabel } from '../lib/nutrition.js'
import { mealLabel, allFoods, removeLogEntry, addFoodSheet, recipesSheet, editGoalsSheet, editBurnSheet } from '../nutrition-sheets.jsx'
import Icon from '../components/Icon.jsx'

const MACRO_COLOR = { protein: 'var(--sky)', carbs: 'var(--orange)', fat: 'var(--violet)' }
const MACRO_LABEL = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' }

// Nutrition tab = today's calorie/macro budget + what's logged, one day at a time — the same
// "what to do now, at a glance" role Home plays for training. Everything reads from the synced
// state (S.foods/S.recipes/S.foodLog/S.dailyBurn/S.nutritionGoals); all the actual logging
// happens in sheets (nutrition-sheets.jsx), this view just lays out the day and opens them.
export default function Nutrition() {
  const S = useStore(s => s.S)
  const [offset, setOffset] = useState(0)
  const isToday = offset === 0
  const d = new Date(); d.setDate(d.getDate() + offset)
  const date = isoOf(d)

  const budget = calorieBudget(S, date)
  const totals = dailyTotals(S, date)
  const goals = S.nutritionGoals || {}
  const consumedPct = budget.goal ? Math.min(100, Math.max(0, (budget.consumed / budget.goal) * 100)) : 0
  const over = budget.remaining < 0

  const foodById = new Map(allFoods(S).map(f => [f.id, f]))
  const recipeById = new Map(S.recipes.map(r => [r.id, r]))
  const entries = S.foodLog?.[date] || []
  const forMeal = m => entries.filter(e => e.meal === m).sort((a, b) => (a.ts || 0) - (b.ts || 0))

  const entryTitle = e => e.recipeId ? (recipeById.get(e.recipeId)?.name || t('(deleted)')) : (foodById.get(e.foodId)?.name || t('(deleted)'))
  const entrySub = e => {
    if (e.recipeId) return t('Recipe') + ' · ' + fmtNum(e.kcal) + ' kcal'
    const f = foodById.get(e.foodId)
    return `${fmtNum(e.qty)} ${unitLabel(f || {}, e.unit)} · ${fmtNum(e.kcal)} kcal`
  }

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Nutrition')}</h1><div className="sub">{fmtDate(date, true)}</div></div>
      <button className="iconbtn" onClick={editGoalsSheet} aria-label={t('Daily goal')}><Icon name="target" /></button>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setOffset(o => o - 1)} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{isToday ? t('Today') : fmtDate(date, true)}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setOffset(o => o + 1)} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
      </div>

      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        <div className="big" style={over ? { color: 'var(--red)' } : undefined}>{fmtNum(budget.remaining)} <span className="muted" style={{ fontSize: '1rem' }}>kcal</span></div>
        <span className="dim small" style={{ marginLeft: 'auto' }}>{over ? t('over your goal') : t('remaining')}</span>
      </div>
      <div className={'nutr-cal-bar' + (over ? ' over' : '')}><i style={{ width: consumedPct + '%' }} /></div>
      <div className="row between small muted" style={{ marginTop: 8 }}>
        <span>{t('Goal')} {fmtNum(budget.goal)}</span>
        <span>{t('Consumed')} {fmtNum(budget.consumed)}</span>
      </div>

      <div className="today-row" onClick={() => editBurnSheet(date)}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: 'var(--orange)' }}><Icon name="flame" /></span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Burned (exercise)')}</div>
            <div className="ttl">{fmtNum(budget.burned)} kcal</div>
          </div>
        </div>
        <Icon name="pencil" className="chev" />
      </div>
    </div>

    <div className="card">
      <h2 style={{ margin: '0 0 6px' }}>{t('Macros')}</h2>
      {['protein', 'carbs', 'fat'].map(k => {
        const val = totals[k] || 0, goal = goals[k] || 0
        const pct = goal ? Math.min(100, (val / goal) * 100) : 0
        return <div className="nutr-macro" key={k}>
          <div className="row between"><span className="small">{t(MACRO_LABEL[k])}</span><span className="small muted">{fmtNum(val)} / {fmtNum(goal)} g</span></div>
          <div className="nutr-macro-bar"><i style={{ width: pct + '%', background: MACRO_COLOR[k] }} /></div>
        </div>
      })}
    </div>

    {MEALS.map(m => {
      const list = forMeal(m)
      const sub = list.reduce((s, e) => s + (e.kcal || 0), 0)
      return <div className="meal-sec" key={m}>
        <div className="row between">
          <h2>{mealLabel(m)}{list.length ? ' · ' + fmtNum(sub) + ' kcal' : ''}</h2>
          <div className="row" style={{ gap: 2 }}>
            <button className="iconbtn" onClick={() => recipesSheet(date, m)} aria-label={t('My recipes')}><Icon name="clipboard" /></button>
            <button className="iconbtn" onClick={() => addFoodSheet(date, m)} aria-label={t('Add food')}><Icon name="plus" /></button>
          </div>
        </div>
        <div className="list">
          {list.map(e => (
            <div key={e.id} className="item">
              <div className="thumb thumb-x"><Icon name="apple" /></div>
              <div className="grow">
                <div className="tt">{entryTitle(e)}</div>
                <div className="ss">{entrySub(e)}</div>
              </div>
              <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => removeLogEntry(date, e.id)} aria-label={t('Delete')}><Icon name="trash" /></button>
            </div>
          ))}
          {!list.length && <div className="empty" style={{ padding: '18px 10px', fontSize: 14 }}>{t('Nothing logged yet')}</div>}
        </div>
      </div>
    })}
  </div>
}
