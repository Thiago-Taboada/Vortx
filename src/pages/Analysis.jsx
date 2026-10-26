import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useTranslation } from 'react-i18next'
import { useCatalog } from '../hooks/useCatalog'
import { useLogs } from '../hooks/useLogs'
import { WEEKDAYS } from '../data/seedData'
import { localized } from '../lib/i18nContent'
import { sessionForDay } from '../lib/sessions'
import { addDays, fromISODate, startOfWeek, toISODate, weekId, formatShort } from '../lib/dates'
import { themeAccent } from '../lib/themes'
import Spinner from '../components/Spinner.jsx'
import { ChartIcon } from '../components/icons.jsx'

const FATIGUE_SCORE = { fresh: 1, ok: 2, spent: 3 }
const FATIGUE_LABEL_KEY = { 1: 'analysis.fatigueFresh', 2: 'analysis.fatigueOk', 3: 'analysis.fatigueSpent' }

// Shared dark tooltip styling for all Recharts tooltips.
const TOOLTIP = {
  contentStyle: {
    background: '#0f1424',
    border: '1px solid rgba(0,240,255,0.3)',
    borderRadius: 10,
    color: '#e2e8f0',
    fontSize: 12,
    boxShadow: '0 0 20px rgba(0,240,255,0.15)',
  },
  labelStyle: { color: '#94a3b8' },
  itemStyle: { color: '#e2e8f0' },
}

export default function Analysis() {
  const { t } = useTranslation()
  const { exercises, activeRoutines, activeTheme, heightCm, loading } = useCatalog()
  const { logs, weights, loading: logsLoading } = useLogs()
  const accent = themeAccent(activeTheme)

  const plannedPerWeek = WEEKDAYS.filter(
    (w) => sessionForDay(activeRoutines, w.key).sessionType !== 'rest',
  ).length

  const trainedLogs = useMemo(() => logs.filter((l) => l.trained), [logs])

  // Exercises that actually appear in logs, for the evolution selector.
  const loggedExerciseIds = useMemo(() => {
    const set = new Set()
    for (const l of trainedLogs) for (const e of l.entries ?? []) set.add(e.exerciseId)
    return [...set]
  }, [trainedLogs])

  const [selectedEx, setSelectedEx] = useState('')
  const activeEx = selectedEx || loggedExerciseIds[0] || ''

  if (loading || logsLoading) return <Spinner />

  if (trainedLogs.length === 0 && weights.length === 0) {
    return (
      <div className="space-y-5">
        <Header />
        <div className="card p-10 text-center">
          <ChartIcon className="mx-auto h-12 w-12 text-brand-400/80" />
          <p className="mt-3 font-semibold text-slate-200">{t('analysis.noDataTitle')}</p>
          <p className="mt-1 text-sm text-slate-400">
            {t('analysis.noDataHint')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Header />

      {/* Wide chart: needs horizontal room */}
      <BodyWeight weights={weights} logs={trainedLogs} accent={accent} heightCm={heightCm} />

      {/* Optional body-composition charts (smart-scale users). Each renders
          only when that metric has at least one logged value. */}
      <BodyComposition weights={weights} accent={accent} />

      {/* Compact charts: two columns on large screens */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ConstancyHeatmap logs={trainedLogs} />
        <WeeklyAdherence logs={trainedLogs} plannedPerWeek={plannedPerWeek} accent={accent} />
      </div>

      {/* Wide chart: time series with selector */}
      <ExerciseEvolution
        logs={trainedLogs}
        exercises={exercises}
        loggedExerciseIds={loggedExerciseIds}
        activeEx={activeEx}
        onChange={setSelectedEx}
        accent={accent}
      />

      {/* Compact charts: two columns on large screens */}
      <div className="grid gap-5 lg:grid-cols-2">
        <MuscleVolume logs={trainedLogs} exercises={exercises} accent={accent} />
        <EffortDistribution logs={trainedLogs} />
      </div>

      <EffortFatigue logs={trainedLogs} />
    </div>
  )
}

function Header() {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className="neon-title text-2xl text-brand-300">{t('analysis.title')}</h1>
      <p className="text-sm text-slate-500">{t('analysis.subtitle')}</p>
    </div>
  )
}

function Section({ title, hint, children }) {
  return (
    <section className="card p-5">
      <h2 className="font-display font-bold uppercase tracking-wide text-slate-100">{title}</h2>
      {hint && <p className="mb-4 mt-0.5 text-xs text-slate-400">{hint}</p>}
      {children}
    </section>
  )
}

// BMI category from value, as an i18n key.
function bmiCategoryKey(bmi) {
  if (bmi < 18.5) return 'analysis.bmiUnderweight'
  if (bmi < 25) return 'analysis.bmiNormal'
  if (bmi < 30) return 'analysis.bmiOverweight'
  return 'analysis.bmiObese'
}

// 0. Body weight over time + weekly sessions (to relate weight to training load)
function BodyWeight({ weights, logs, accent, heightCm }) {
  const { t } = useTranslation()
  const sorted = useMemo(
    () => [...weights].sort((a, b) => (a.weekId > b.weekId ? 1 : -1)),
    [weights],
  )

  // Sessions per weekId, to overlay as bars.
  const sessionsByWeek = useMemo(() => {
    const m = {}
    for (const l of logs) {
      const id = weekId(fromISODate(l.date))
      m[id] = (m[id] ?? 0) + 1
    }
    return m
  }, [logs])

  const data = sorted.map((w) => ({
    label: formatShort(fromISODate(w.date)),
    peso: w.weightKg,
    sesiones: sessionsByWeek[w.weekId] ?? 0,
  }))

  // Summary stats
  const latest = sorted.at(-1)?.weightKg ?? null
  const first = sorted[0]?.weightKg ?? null
  const delta = latest != null && first != null ? +(latest - first).toFixed(1) : null

  // BMI from the latest weight + profile height. Only shown when both exist.
  const height = Number(heightCm)
  const bmi =
    latest != null && Number.isFinite(height) && height > 0
      ? +(latest / (height / 100) ** 2).toFixed(1)
      : null

  if (weights.length === 0) {
    return (
      <Section title={t('analysis.bodyWeight')} hint={t('analysis.bodyWeightHintStart')}>
        <p className="py-6 text-center text-sm text-slate-400">
          {t('analysis.bodyWeightNone')}
        </p>
      </Section>
    )
  }

  return (
    <Section title={t('analysis.bodyWeight')} hint={t('analysis.bodyWeightHint')}>
      <div className="mb-4 flex flex-wrap gap-4">
        <Metric label={t('analysis.current')} value={latest != null ? `${latest} kg` : '—'} tone="brand" />
        {delta != null && (
          <Metric
            label={t('analysis.totalChange')}
            value={`${delta > 0 ? '+' : ''}${delta} kg`}
            tone={delta > 0 ? 'pink' : 'brand'}
          />
        )}
        {bmi != null && (
          <Metric label={t('analysis.bmi')} value={`${bmi} · ${t(bmiCategoryKey(bmi))}`} tone="brand" />
        )}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1c2743" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} stroke="#2a3761" />
          <YAxis yAxisId="w" tick={{ fontSize: 11, fill: '#64748b' }} stroke="#2a3761" domain={['dataMin - 1', 'dataMax + 1']} />
          <YAxis yAxisId="s" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: '#334155' }} stroke="#1c2743" />
          <Tooltip {...TOOLTIP} cursor={{ fill: 'rgba(0,240,255,0.06)' }} />
          <Bar yAxisId="s" dataKey="sesiones" name={t('analysis.sessionsSeries')} fill="#1c2743" radius={[4, 4, 0, 0]} />
          <Line yAxisId="w" type="monotone" dataKey="peso" name={t('analysis.weightKg')} stroke={accent} strokeWidth={2.5} dot={{ r: 3, fill: accent }} />
        </ComposedChart>
      </ResponsiveContainer>
    </Section>
  )
}

function Metric({ label, value, tone }) {
  const color = tone === 'pink' ? 'text-neon-pink neon-text-pink' : 'text-brand-300 neon-text'
  return (
    <div>
      <p className="label">{label}</p>
      <p className={`font-display text-2xl font-extrabold ${color}`}>{value}</p>
    </div>
  )
}

// Optional body-composition metrics from a smart scale. One evolution line per
// metric, rendered only when at least one weight entry has that field.
const COMPOSITION_META = [
  { field: 'bodyFatPct', titleKey: 'analysis.bodyFat', hintKey: 'analysis.bodyFatHint' },
  { field: 'muscleMassKg', titleKey: 'analysis.muscleMass', hintKey: 'analysis.muscleMassHint' },
  { field: 'visceralFat', titleKey: 'analysis.visceralFat', hintKey: 'analysis.visceralFatHint' },
  { field: 'bmrKcal', titleKey: 'analysis.bmr', hintKey: 'analysis.bmrHint' },
]

function BodyComposition({ weights, accent }) {
  const sorted = useMemo(
    () => [...weights].sort((a, b) => (a.weekId > b.weekId ? 1 : -1)),
    [weights],
  )
  const charts = COMPOSITION_META.filter((m) =>
    sorted.some((w) => Number.isFinite(Number(w[m.field]))),
  )
  if (charts.length === 0) return null

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {charts.map((m) => (
        <CompositionChart key={m.field} meta={m} weights={sorted} accent={accent} />
      ))}
    </div>
  )
}

function CompositionChart({ meta, weights, accent }) {
  const { t } = useTranslation()
  const data = weights
    .filter((w) => Number.isFinite(Number(w[meta.field])))
    .map((w) => ({ date: formatShort(fromISODate(w.date)), valor: Number(w[meta.field]) }))

  return (
    <Section title={t(meta.titleKey)} hint={t(meta.hintKey)}>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1c2743" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} stroke="#2a3761" />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} stroke="#2a3761" domain={['dataMin - 1', 'dataMax + 1']} />
          <Tooltip {...TOOLTIP} />
          <Line type="monotone" dataKey="valor" name={t(meta.titleKey)} stroke={accent} strokeWidth={2.5} dot={{ r: 3, fill: accent }} />
        </LineChart>
      </ResponsiveContainer>
    </Section>
  )
}

// 1. Constancy heatmap (last ~12 weeks, GitHub-style)
function ConstancyHeatmap({ logs }) {
  const { t } = useTranslation()
  const byDate = useMemo(() => {
    const m = {}
    for (const l of logs) m[l.date] = l
    return m
  }, [logs])

  const weeks = 12
  const start = startOfWeek(addDays(new Date(), -7 * (weeks - 1)))
  const columns = Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => toISODate(addDays(start, w * 7 + d))),
  )
  const todayISO = toISODate(new Date())

  const color = (iso) => {
    const log = byDate[iso]
    if (!log) return 'bg-ink-700/70'
    if (log.sessionType === 'strength') return 'bg-brand-500 shadow-neon'
    if (log.sessionType === 'flexibility') return 'bg-neon-pink'
    if (log.sessionType === 'mobility') return 'bg-neon-amber'
    return 'bg-ink-600'
  }

  return (
    <Section title={t('analysis.constancy')} hint={t('analysis.constancyHint')}>
      <div className="flex gap-1.5">
        {columns.map((col, i) => (
          <div key={i} className="flex flex-1 flex-col gap-1.5">
            {col.map((iso) => (
              <div
                key={iso}
                title={iso}
                className={`aspect-square w-full rounded-sm ${color(iso)} ${iso === todayISO ? 'ring-1 ring-brand-300' : ''} ${
                  iso > todayISO ? 'opacity-40' : ''
                }`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <Legend className="bg-brand-500" label={t('analysis.strength')} />
        <Legend className="bg-neon-pink" label={t('analysis.flexibility')} />
        <Legend className="bg-neon-amber" label={t('analysis.mobility')} />
        <Legend className="bg-ink-700" label={t('analysis.notTrained')} />
      </div>
    </Section>
  )
}

function Legend({ className, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded-sm ${className}`} />
      {label}
    </span>
  )
}

// 2. Weekly adherence (sessions per week vs planned)
function WeeklyAdherence({ logs, plannedPerWeek, accent }) {
  const { t } = useTranslation()
  const planned = plannedPerWeek || 1

  const data = useMemo(() => {
    const map = {}
    for (const l of logs) {
      const id = weekId(l.date)
      map[id] = (map[id] ?? 0) + 1
    }
    // last 8 weeks
    const out = []
    for (let i = 7; i >= 0; i--) {
      const ref = addDays(new Date(), -7 * i)
      const id = weekId(ref)
      const label = formatShort(startOfWeek(ref))
      out.push({ week: label, sesiones: map[id] ?? 0 })
    }
    return out
  }, [logs])

  return (
    <Section title={t('analysis.weeklyAdherence')} hint={t('analysis.weeklyAdherenceHint', { planned })}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1c2743" />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#64748b' }} stroke="#2a3761" />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} stroke="#2a3761" />
          <Tooltip {...TOOLTIP} cursor={{ fill: 'rgba(0,240,255,0.06)' }} />
          <Bar dataKey="sesiones" radius={[6, 6, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.sesiones >= planned ? accent : '#9d4bff'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Section>
  )
}

// 3. Exercise evolution (total reps & volume over time)
function ExerciseEvolution({ logs, exercises, loggedExerciseIds, activeEx, onChange, accent }) {
  const { t, i18n } = useTranslation()
  const data = useMemo(() => {
    const points = []
    for (const l of [...logs].sort((a, b) => a.date.localeCompare(b.date))) {
      const entry = (l.entries ?? []).find((e) => e.exerciseId === activeEx)
      if (!entry) continue
      let totalReps = 0
      let volume = 0
      let maxWeight = 0
      for (const s of entry.sets) {
        const reps = s.reps ?? 0
        const w = s.weightKg ?? 0
        totalReps += reps
        volume += reps * w
        if (w > maxWeight) maxWeight = w
      }
      points.push({
        date: l.date.slice(5),
        reps: totalReps,
        volumen: Math.round(volume),
        pesoMax: maxWeight,
      })
    }
    return points
  }, [logs, activeEx])

  const hasWeight = data.some((d) => d.volumen > 0)

  return (
    <Section title={t('analysis.exerciseEvolution')} hint={t('analysis.exerciseEvolutionHint')}>
      <select
        value={activeEx}
        onChange={(e) => onChange(e.target.value)}
        className="input mb-4"
      >
        {loggedExerciseIds.map((id) => (
          <option key={id} value={id}>
            {localized(exercises.find((e) => e.id === id)?.name, i18n.language) || id}
          </option>
        ))}
      </select>

      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">{t('analysis.noExerciseLogs')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1c2743" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} stroke="#2a3761" />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} stroke="#2a3761" />
            <Tooltip {...TOOLTIP} />
            <Line type="monotone" dataKey="reps" name={t('analysis.totalReps')} stroke={accent} strokeWidth={2.5} dot={{ r: 3, fill: accent }} />
            {hasWeight && (
              <Line type="monotone" dataKey="volumen" name={t('analysis.volumeKg')} stroke="#ff2bd6" strokeWidth={2.5} dot={{ r: 3, fill: '#ff2bd6' }} />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </Section>
  )
}

// 4. Volume by muscle group (balance check)
function MuscleVolume({ logs, exercises, accent }) {
  const { t } = useTranslation()
  const data = useMemo(() => {
    const map = {}
    for (const l of logs) {
      for (const entry of l.entries ?? []) {
        const ex = exercises.find((e) => e.id === entry.exerciseId)
        const groups = ex?.muscleGroups ?? []
        // Count each logged set as 1 unit of volume for every muscle it works.
        const sets = (entry.sets ?? []).length
        for (const g of groups) map[g] = (map[g] ?? 0) + sets
      }
    }
    return Object.entries(map)
      .map(([g, series]) => ({ grupo: t('muscles.' + g), series }))
      .sort((a, b) => b.series - a.series)
  }, [logs, exercises, t])

  if (data.length === 0) return null

  return (
    <Section title={t('analysis.muscleVolume')} hint={t('analysis.muscleVolumeHint')}>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 34)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1c2743" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} stroke="#2a3761" />
          <YAxis type="category" dataKey="grupo" width={70} tick={{ fontSize: 11, fill: '#94a3b8' }} stroke="#2a3761" />
          <Tooltip {...TOOLTIP} cursor={{ fill: 'rgba(0,240,255,0.06)' }} formatter={(v) => [t('analysis.seriesWithCount', { count: v }), t('analysis.volume')]} />
          <Bar dataKey="series" name={t('analysis.series')} fill={accent} radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Section>
  )
}

// 5. Effort vs fatigue over time
function EffortFatigue({ logs }) {
  const { t } = useTranslation()
  const data = useMemo(() => {
    return [...logs]
      .filter((l) => l.sessionFatigue)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((l) => {
        // total volume as a proxy for "effort/load"
        let volume = 0
        let reps = 0
        for (const e of l.entries ?? [])
          for (const s of e.sets) {
            reps += s.reps ?? 0
            volume += (s.reps ?? 0) * (s.weightKg ?? 0)
          }
        return {
          date: l.date.slice(5),
          fatiga: FATIGUE_SCORE[l.sessionFatigue] ?? 2,
          carga: volume || reps, // fall back to reps if bodyweight
        }
      })
  }, [logs])

  return (
    <Section title={t('analysis.effortFatigue')} hint={t('analysis.effortFatigueHint')}>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="fat" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ff2bd6" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#ff2bd6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1c2743" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} stroke="#2a3761" />
          <YAxis
            domain={[0, 3]}
            ticks={[1, 2, 3]}
            tickFormatter={(v) => (FATIGUE_LABEL_KEY[v] ? t(FATIGUE_LABEL_KEY[v]) : '')}
            width={70}
            tick={{ fontSize: 10, fill: '#64748b' }}
            stroke="#2a3761"
          />
          <Tooltip {...TOOLTIP} formatter={(v) => (FATIGUE_LABEL_KEY[v] ? t(FATIGUE_LABEL_KEY[v]) : v)} />
          <Area type="monotone" dataKey="fatiga" stroke="#ff2bd6" strokeWidth={2.5} fill="url(#fat)" />
        </AreaChart>
      </ResponsiveContainer>
    </Section>
  )
}

// 6. Effort distribution: how many logged sets fell in each effort level.
const EFFORT_META = [
  { key: 'max', labelKey: 'analysis.effortMax', color: '#ff3b5c' },
  { key: 'hard', labelKey: 'analysis.effortHard', color: '#ffb020' },
  { key: 'easy', labelKey: 'analysis.effortEasy', color: '#00f0ff' },
]

function EffortDistribution({ logs }) {
  const { t } = useTranslation()
  const { data, total } = useMemo(() => {
    const counts = { max: 0, hard: 0, easy: 0 }
    for (const l of logs)
      for (const e of l.entries ?? [])
        for (const s of e.sets ?? []) {
          if (s.effort && counts[s.effort] != null) counts[s.effort]++
        }
    const tot = counts.max + counts.hard + counts.easy
    const d = EFFORT_META.map((m) => ({ nivel: t(m.labelKey), series: counts[m.key], color: m.color }))
    return { data: d, total: tot }
  }, [logs, t])

  if (total === 0) {
    return (
      <Section title={t('analysis.effortDistribution')} hint={t('analysis.effortDistributionHintCount')}>
        <p className="py-6 text-center text-sm text-slate-400">
          {t('analysis.effortDistributionHintEmpty')}
        </p>
      </Section>
    )
  }

  return (
    <Section title={t('analysis.effortDistribution')} hint={t('analysis.effortDistributionHint')}>
      <ResponsiveContainer width="100%" height={Math.max(140, data.length * 44)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1c2743" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} stroke="#2a3761" />
          <YAxis type="category" dataKey="nivel" width={70} tick={{ fontSize: 11, fill: '#94a3b8' }} stroke="#2a3761" />
          <Tooltip {...TOOLTIP} cursor={{ fill: 'rgba(0,240,255,0.06)' }} formatter={(v) => [t('analysis.seriesWithCount', { count: v }), t('analysis.series')]} />
          <Bar dataKey="series" name={t('analysis.series')} radius={[0, 6, 6, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Section>
  )
}
