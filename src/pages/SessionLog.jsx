import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useCatalog } from '../hooks/useCatalog'
import { useLogs } from '../hooks/useLogs'
import { localized } from '../lib/i18nContent'
import { sessionForDay, metaFor } from '../lib/sessions'
import { formatLong, fromISODate, toISODate } from '../lib/dates'
import { sanitizeDecimal, sanitizeInteger } from '../lib/validation'
import Spinner from '../components/Spinner.jsx'
import { StatusDot } from '../components/icons.jsx'

// Session fatigue options (global feeling of the session).
const FATIGUE = [
  { value: 'fresh', tone: 'fresh', labelKey: 'sessionLog.fatigueFresh' },
  { value: 'ok', tone: 'ok', labelKey: 'sessionLog.fatigueOk' },
  { value: 'spent', tone: 'spent', labelKey: 'sessionLog.fatigueSpent' },
]

// Per-set effort (replaces the old numeric RIR). Qualitative, easier to judge.
const EFFORT = [
  { value: 'max', tone: 'spent', labelKey: 'sessionLog.effortMax', hintKey: 'sessionLog.effortMaxHint' },
  { value: 'hard', tone: 'ok', labelKey: 'sessionLog.effortHard', hintKey: 'sessionLog.effortHardHint' },
  { value: 'easy', tone: 'fresh', labelKey: 'sessionLog.effortEasy', hintKey: 'sessionLog.effortEasyHint' },
]

function emptySet() {
  return { reps: '', weightKg: '', timeSeconds: '', effort: '', toFailure: false, done: false }
}

// On mobile the numeric keyboard shows a "Go/Enter" key. We don't want it to
// submit anything; pressing it just blurs the field, which hides the keyboard.
function blurOnEnter(e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    e.currentTarget.blur()
  }
}

// Build an empty entries array from a routine day's blocks.
function buildEntries(day) {
  if (!day) return []
  return day.blocks.map((b) => ({
    exerciseId: b.exerciseId,
    sets: Array.from({ length: b.sets || 1 }, emptySet),
  }))
}

export default function SessionLog() {
  const { t } = useTranslation()
  const { weekday } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { exercises, activeRoutines, loading } = useCatalog()
  const { logs, loading: logsLoading, saveLog, deleteLog } = useLogs()

  // Resolve the date: ?date=YYYY-MM-DD or the next occurrence of this weekday.
  const dateISO = params.get('date') ?? resolveDateForWeekday(weekday)

  const day = useMemo(
    () => sessionForDay(activeRoutines, weekday),
    [activeRoutines, weekday],
  )

  const existing = logs.find((l) => l.date === dateISO)
  const draftKey = `vortx-draft-${dateISO}-${weekday}`

  const [trained, setTrained] = useState(true)
  const [duration, setDuration] = useState('')
  const [fatigue, setFatigue] = useState('ok')
  const [notes, setNotes] = useState('')
  const [entries, setEntries] = useState([])
  const [saving, setSaving] = useState(false)
  const [initialized, setInitialized] = useState(false)

  // Initialize form: a saved draft (in-progress edit) wins; otherwise the
  // existing log; otherwise the empty template.
  useEffect(() => {
    if (loading || logsLoading || initialized || !day) return

    const draft = readDraft(draftKey)
    if (draft) {
      setTrained(draft.trained ?? true)
      setDuration(draft.duration ?? '')
      setFatigue(draft.fatigue ?? 'ok')
      setNotes(draft.notes ?? '')
      // Reconcile the draft entries over the current template structure.
      const base = buildEntries(day)
      if (draft.entries?.length) {
        for (const saved of draft.entries) {
          const idx = base.findIndex((e) => e.exerciseId === saved.exerciseId)
          if (idx >= 0) base[idx] = saved
          else base.push(saved)
        }
      }
      setEntries(base)
      setInitialized(true)
      return
    }

    if (existing) {
      setTrained(existing.trained ?? true)
      setDuration(existing.durationMinutes ?? '')
      setFatigue(existing.sessionFatigue ?? 'ok')
      setNotes(existing.notes ?? '')
      // Merge saved entries over the template structure so new blocks appear.
      const base = buildEntries(day)
      if (existing.entries?.length) {
        for (const saved of existing.entries) {
          const idx = base.findIndex((e) => e.exerciseId === saved.exerciseId)
          if (idx >= 0) base[idx] = saved
          else base.push(saved)
        }
      }
      setEntries(base)
    } else {
      setEntries(buildEntries(day))
    }
    setInitialized(true)
  }, [loading, logsLoading, day, existing, initialized, draftKey])

  // Persist the in-progress form to localStorage on every change (after init),
  // so a reload or navigating away and back keeps what the user was typing.
  useEffect(() => {
    if (!initialized) return
    writeDraft(draftKey, { trained, duration, fatigue, notes, entries })
  }, [initialized, draftKey, trained, duration, fatigue, notes, entries])

  if (loading || logsLoading) return <Spinner />
  if (!day) {
    return (
      <div className="card p-8 text-center">
        <p className="text-slate-500">{t('sessionLog.dayNotFound')}</p>
        <Link to="/schedule" className="btn-primary mt-4">{t('sessionLog.backToSchedule')}</Link>
      </div>
    )
  }

  const meta = metaFor(day.sessionType)
  const isRest = day.sessionType === 'rest' || day.blocks.length === 0

  function updateSet(entryIdx, setIdx, field, value) {
    setEntries((prev) => {
      const next = structuredClone(prev)
      next[entryIdx].sets[setIdx][field] = value
      return next
    })
  }

  function addSet(entryIdx) {
    setEntries((prev) => {
      const next = structuredClone(prev)
      const last = next[entryIdx].sets.at(-1) ?? emptySet()
      // carry over weight but reset per-set reps/effort/failure/done
      next[entryIdx].sets.push({ ...last, reps: '', effort: '', toFailure: false, done: false })
      return next
    })
  }

  function removeSet(entryIdx, setIdx) {
    setEntries((prev) => {
      const next = structuredClone(prev)
      if (next[entryIdx].sets.length > 1) next[entryIdx].sets.splice(setIdx, 1)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      // Clean entries: numbers where possible, drop fully-empty sets.
      const num = (v) => (v === '' || v == null ? null : Number(v))
      const cleanEntries = entries
        .map((e) => ({
          exerciseId: e.exerciseId,
          sets: e.sets
            .filter(
              (s) =>
                s.reps !== '' ||
                s.weightKg !== '' ||
                s.timeSeconds !== '' ||
                s.effort !== '' ||
                s.toFailure ||
                s.done,
            )
            .map((s) => ({
              reps: num(s.reps),
              weightKg: num(s.weightKg),
              timeSeconds: num(s.timeSeconds),
              effort: s.effort || null,
              toFailure: !!s.toFailure,
              done: !!s.done,
            })),
        }))
        .filter((e) => e.sets.length > 0)

      await saveLog({
        date: dateISO,
        routineIds: activeRoutines.map((r) => r.id),
        weekday,
        dayLabel: day.label,
        sessionType: day.sessionType,
        trained,
        durationMinutes: duration === '' ? null : Number(duration),
        sessionFatigue: fatigue,
        notes: notes.trim(),
        entries: trained ? cleanEntries : [],
        // Hour of day the session was saved (local), for time-based achievements.
        // Only set when training; preserved on edits of an existing trained log.
        loggedHour: trained ? (existing?.loggedHour ?? new Date().getHours()) : null,
      })
      clearDraft(draftKey)
      navigate('/schedule')
    } catch (err) {
      console.error(err)
      alert(t('sessionLog.saveError') + (err?.message ?? t('sessionLog.unknownError')))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!existing) return
    if (!confirm(t('sessionLog.confirmDelete'))) return
    await deleteLog(existing.id)
    clearDraft(draftKey)
    navigate('/schedule')
  }

  return (
    <div className="space-y-5">
      <Link to="/schedule" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-400 hover:text-brand-300">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        {t('sessionLog.back')}
      </Link>

      <div className="card overflow-hidden">
        <div className={`${meta.color} px-5 py-2 text-xs font-bold uppercase tracking-widest text-ink-950`}>
          {t('weekdays.' + weekday)} · {t('sessionTypes.' + day.sessionType)}
        </div>
        <div className="p-5">
          <h1 className="text-xl font-bold">{day.label}</h1>
          <p className="text-sm text-slate-500">{formatLong(fromISODate(dateISO))}</p>
          <p className="mt-1 text-sm text-slate-500">{day.content}</p>
        </div>
      </div>

      {/* Trained toggle */}
      <div className="card flex items-center justify-between p-4">
        <div>
          <p className="font-semibold">{t('sessionLog.trainedQuestion')}</p>
          <p className="text-sm text-slate-500">{t('sessionLog.trainedHint')}</p>
        </div>
        <button
          onClick={() => setTrained((t) => !t)}
          className={`relative h-7 w-12 rounded-full transition ${trained ? 'bg-brand-500 shadow-neon' : 'bg-ink-600'}`}
        >
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${trained ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      {trained && (
        <>
          {/* Duration + fatigue */}
          <div className="card space-y-4 p-5">
            <div>
              <label className="label mb-1.5">{t('sessionLog.durationLabel')}</label>
              <input
                type="text"
                inputMode="numeric"
                value={duration}
                onChange={(e) => setDuration(e.target.value.replace(/\D/g, '').slice(0, 3))}
                onKeyDown={blurOnEnter}
                placeholder={t('sessionLog.durationPlaceholder')}
                className="input"
              />
            </div>
            <div>
              <label className="label mb-1.5">{t('sessionLog.howEnded')}</label>
              <div className="grid grid-cols-3 gap-2">
                {FATIGUE.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setFatigue(f.value)}
                    className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-semibold transition ${
                      fatigue === f.value
                        ? 'border-brand-400 bg-brand-500/15 text-brand-300 shadow-neon'
                        : 'border-slate-500/25 text-slate-400 hover:border-brand-400/40 hover:text-brand-200'
                    }`}
                  >
                    <StatusDot tone={f.tone} className="mb-0.5" />
                    {t(f.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Exercises */}
          {!isRest && (
            <div className="space-y-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">
                {t('sessionLog.exercises', { count: entries.length })}
              </h2>
              {entries.map((entry, ei) => (
                <ExerciseEntry
                  key={entry.exerciseId + ei}
                  entry={entry}
                  exercise={exercises.find((e) => e.id === entry.exerciseId)}
                  block={day.blocks.find((b) => b.exerciseId === entry.exerciseId)}
                  onUpdateSet={(si, field, value) => updateSet(ei, si, field, value)}
                  onAddSet={() => addSet(ei)}
                  onRemoveSet={(si) => removeSet(ei, si)}
                />
              ))}
            </div>
          )}

          {/* Notes */}
          <div className="card p-5">
            <label className="label mb-1.5">{t('sessionLog.notes')}</label>
            <textarea
              value={notes}
              maxLength={1000}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={t('sessionLog.notesPlaceholder')}
              className="input resize-none"
            />
          </div>
        </>
      )}

      {/* Actions */}
      <div className="sticky bottom-20 z-10 flex gap-3 md:bottom-4">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 shadow-lg">
          {saving ? t('sessionLog.saving') : existing ? t('sessionLog.update') : t('sessionLog.saveSession')}
        </button>
        {existing && (
          <button onClick={handleDelete} className="btn border border-neon-red/50 bg-neon-red/10 text-neon-red hover:bg-neon-red/20">
            {t('sessionLog.delete')}
          </button>
        )}
      </div>
    </div>
  )
}

// Renders one exercise with its set rows, adapted to the exercise's tracking
// type: reps (reps + optional weight), time (seconds), or check (done toggle).
function ExerciseEntry({ entry, exercise, block, onUpdateSet, onAddSet, onRemoveSet }) {
  const { t, i18n } = useTranslation()
  const tracking = exercise?.tracking ?? 'reps'

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <Link to={`/library/${entry.exerciseId}`} className="font-semibold text-slate-200 hover:text-brand-300">
            {exercise ? localized(exercise.name, i18n.language) : t('sessionLog.deletedExercise')}
          </Link>
          {block && (
            <p className="text-xs text-slate-400">
              {t('sessionLog.target')}: {block.sets}×{block.repsText}
              {block.perSide ? ' ' + t('sessionLog.perSide') : ''}
              {block.restText && block.restText !== '—' ? ` · ${t('sessionLog.rest')} ${block.restText}` : ''}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {/* Column headers depend on tracking type */}
        {tracking === 'reps' && (
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <span className="w-5 shrink-0">#</span>
            <span className="w-0 flex-1 text-center">{t('sessionLog.reps')}</span>
            <span className="w-0 flex-1 text-center">{t('sessionLog.weightKg')}</span>
            <span className="shrink-0 text-center" style={{ width: '7.75rem' }}>{t('sessionLog.effort')}</span>
            <span className="w-8 shrink-0 text-center">{t('sessionLog.failure')}</span>
            <span className="w-7 shrink-0" />
          </div>
        )}
        {tracking === 'time' && (
          <div className="grid grid-cols-[28px_1fr_auto] items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <span>#</span>
            <span>{t('sessionLog.time')}</span>
            <span className="text-center">{t('sessionLog.remove')}</span>
          </div>
        )}

        {entry.sets.map((set, si) => (
          <SetRow
            key={si}
            index={si}
            set={set}
            tracking={tracking}
            onUpdate={(field, value) => onUpdateSet(si, field, value)}
            onRemove={() => onRemoveSet(si)}
          />
        ))}
      </div>

      {tracking === 'reps' && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
          <span className="font-semibold uppercase tracking-wide">{t('sessionLog.effortLabel')}</span>
          {EFFORT.map((opt) => (
            <span key={opt.value} className="inline-flex items-center gap-1">
              <StatusDot tone={opt.tone} className="!h-2.5 !w-2.5" />
              {t(opt.labelKey)}
            </span>
          ))}
        </div>
      )}

      <button onClick={onAddSet} className="mt-3 text-xs font-semibold text-brand-400 hover:text-brand-300">
        {t('sessionLog.addSet')}
      </button>
    </div>
  )
}

function SetRow({ index, set, tracking, onUpdate, onRemove }) {
  const { t } = useTranslation()
  const removeBtn = (
    <button
      onClick={onRemove}
      className="flex h-8 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-ink-700 hover:text-neon-red"
      title={t('sessionLog.removeSet')}
    >
      ×
    </button>
  )

  if (tracking === 'check') {
    return (
      <div className="flex items-center gap-3">
        <span className="w-7 text-sm font-semibold text-slate-400">{index + 1}</span>
        <button
          onClick={() => onUpdate('done', !set.done)}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-sm font-semibold transition ${
            set.done
              ? 'border-brand-400 bg-brand-500/15 text-brand-300 shadow-neon'
              : 'border-slate-500/25 text-slate-400 hover:border-brand-400/40'
          }`}
        >
          {set.done ? t('sessionLog.done') : t('sessionLog.markDone')}
        </button>
        {removeBtn}
      </div>
    )
  }

  if (tracking === 'time') {
    return (
      <div className="grid grid-cols-[28px_1fr_auto] items-center gap-2">
        <span className="text-sm font-semibold text-slate-400">{index + 1}</span>
        <input
          type="text"
          inputMode="numeric"
          value={set.timeSeconds}
          onChange={(e) => onUpdate('timeSeconds', sanitizeInteger(e.target.value, { maxDigits: 4, max: 9999 }))}
          onKeyDown={blurOnEnter}
          placeholder="—"
          className="input px-2 py-1.5 text-center"
        />
        <div className="flex justify-center">{removeBtn}</div>
      </div>
    )
  }

  // tracking === 'reps'
  return (
    <div className="flex items-center gap-2">
      <span className="w-5 shrink-0 text-sm font-semibold text-slate-400">{index + 1}</span>
      <input
        type="text"
        inputMode="numeric"
        value={set.reps}
        onChange={(e) => onUpdate('reps', sanitizeInteger(e.target.value, { maxDigits: 3, max: 999 }))}
        onKeyDown={blurOnEnter}
        placeholder={t('sessionLog.repsPlaceholder')}
        className="input w-0 flex-1 px-2 py-1.5 text-center"
      />
      <input
        type="text"
        inputMode="decimal"
        value={set.weightKg}
        onChange={(e) => onUpdate('weightKg', sanitizeDecimal(e.target.value, { maxIntDigits: 3, maxDecimals: 3, max: 500 }))}
        onKeyDown={blurOnEnter}
        placeholder="kg"
        title={t('sessionLog.weightTitle')}
        className="input w-0 flex-1 px-2 py-1.5 text-center"
      />
      {/* Effort selector */}
      <div className="flex shrink-0 items-center gap-1">
        {EFFORT.map((opt) => {
          const active = set.effort === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => onUpdate('effort', active ? '' : opt.value)}
              title={`${t(opt.labelKey)} — ${t(opt.hintKey)}`}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${
                active
                  ? 'border-current bg-ink-700'
                  : 'border-slate-500/25 hover:border-slate-400/50'
              }`}
            >
              <StatusDot tone={opt.tone} className={active ? '' : 'opacity-40'} />
            </button>
          )
        })}
      </div>
      {/* Reached failure */}
      <button
        onClick={() => onUpdate('toFailure', !set.toFailure)}
        title={t('sessionLog.failureTitle')}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold transition ${
          set.toFailure ? 'bg-neon-red text-white shadow-neon-pink' : 'bg-ink-700 text-slate-400'
        }`}
      >
        F
      </button>
      {removeBtn}
    </div>
  )
}

// --- Draft persistence (localStorage) -------------------------------------
// Keeps the in-progress form across reloads and navigation until the user
// saves or deletes the session.
function readDraft(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeDraft(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    /* storage full or unavailable — ignore */
  }
}

function clearDraft(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

// Returns the ISO date of the given weekday within the current week.
function resolveDateForWeekday(weekday) {
  const keys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  const target = keys.indexOf(weekday)
  const now = new Date()
  const curr = (now.getDay() + 6) % 7
  const diff = target - curr
  const d = new Date(now)
  d.setDate(now.getDate() + diff)
  return toISODate(d)
}
