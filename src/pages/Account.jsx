import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useCatalog } from '../hooks/useCatalog'
import { useLogs } from '../hooks/useLogs'
import { exportUserData, parseImportFile } from '../lib/exportData'
import { fromISODate, formatMedium, toISODate, weekId as weekIdOf } from '../lib/dates'
import { useTranslation } from 'react-i18next'
import { computeStreak } from '../lib/streak'
import { THEMES } from '../lib/themes'
import { sanitizeDecimal, WEIGHT_LIMIT, COMP_LIMITS } from '../lib/validation'
import { LANGUAGES } from '../i18n'
import AchievementCard from '../components/AchievementCard.jsx'
import Spinner from '../components/Spinner.jsx'
import { FlameIcon, CheckIcon } from '../components/icons.jsx'

export default function Account() {
  const { user, signOut, providerLabel, isPasswordUser, updateDisplayName, deleteAccount, error, clearError } = useAuth()
  const { t, i18n } = useTranslation()
  const { exercises, routines, activeRoutines, activeRoutineIds, loading, importCatalog, ownedThemes, activeTheme, setTheme, setLang, heightCm, birthDate, sex, trackBodyComposition, savePhysicalProfile } = useCatalog()
  const { logs, weights, loading: logsLoading, importLogsAndWeights, saveWeight, deleteWeight } = useLogs()
  const navigate = useNavigate()

  const stats = useMemo(() => computeStats(logs), [logs])
  const streak = useMemo(() => computeStreak(logs, activeRoutines), [logs, activeRoutines])

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reauthNeeded, setReauthNeeded] = useState(false)
  const [reauthPassword, setReauthPassword] = useState('')
  const [importPreview, setImportPreview] = useState(null)
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importDone, setImportDone] = useState(false)
  const fileInputRef = useRef(null)

  if (loading || logsLoading) return <Spinner />

  function handleExport() {
    exportUserData({
      user,
      logs,
      weights,
      customExercises: exercises.filter((e) => e.isCustom),
      customRoutines: routines.filter((r) => r.isCustom),
      activeRoutineIds,
    })
  }

  async function handleFileChosen(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setImportError('')
    setImportDone(false)
    setImportPreview(null)
    try {
      const payload = await parseImportFile(file)
      setImportPreview(payload)
    } catch (err) {
      setImportError(err?.message ?? t('account.readFileError'))
    }
  }

  async function runImport() {
    if (!importPreview) return
    setImporting(true)
    setImportError('')
    try {
      await importLogsAndWeights(importPreview.logs, importPreview.weights)
      await importCatalog({
        customExercises: importPreview.customExercises,
        customRoutines: importPreview.customRoutines,
        activeRoutineIds: importPreview.activeRoutineIds,
      })
      setImportPreview(null)
      setImportDone(true)
    } catch (err) {
      setImportError(err?.message ?? t('account.importError'))
    } finally {
      setImporting(false)
    }
  }

  function cancelImport() {
    setImportPreview(null)
    setImportError('')
  }

  function startEdit() {
    setName(user?.displayName ?? '')
    setEditing(true)
  }

  async function saveName() {
    if (!name.trim()) return
    setSavingName(true)
    const ok = await updateDisplayName(name)
    setSavingName(false)
    if (ok) setEditing(false)
  }

  async function handleDelete() {
    setDeleting(true)
    // Pass the reauth password only when email account + reauth is being asked.
    const res = await deleteAccount(isPasswordUser ? reauthPassword : undefined)
    setDeleting(false)
    if (res.ok) {
      navigate('/') // signed out automatically after deletion
    } else if (res.needsReauth) {
      // Google reauth happens via popup inside deleteAccount; if it still needs
      // reauth it means the popup was cancelled or the password is required.
      setReauthNeeded(true)
    }
  }

  function cancelDelete() {
    setConfirmDelete(false)
    setReauthNeeded(false)
    setReauthPassword('')
    clearError()
  }

  const initial = (user?.displayName ?? user?.email ?? '?').charAt(0).toUpperCase()

  return (
    <div className="space-y-5">
      <h1 className="neon-title text-2xl text-brand-300">{t('account.title')}</h1>

      {/* Identity */}
      <div className="card flex items-center gap-4 p-5">
        {user?.photoURL ? (
          <img src={user.photoURL} alt="" className="h-16 w-16 shrink-0 rounded-full border border-brand-400/50 shadow-neon" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-brand-400/50 bg-ink-800 text-2xl font-bold text-brand-300 shadow-neon">
            {initial}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-col gap-2">
              <input
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('account.namePlaceholder')}
                className="input py-2"
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={saveName} disabled={savingName || !name.trim()} className="btn-primary px-3 py-1.5 text-xs">
                  {savingName ? t('account.saving') : t('account.save')}
                </button>
                <button onClick={() => setEditing(false)} className="btn-ghost px-3 py-1.5 text-xs">
                  {t('account.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <p className="truncate text-lg font-bold text-slate-100">{user?.displayName || t('account.defaultAthlete')}</p>
                <button onClick={startEdit} title={t('account.editName')} className="shrink-0 text-slate-500 hover:text-brand-300">
                  <PencilIcon />
                </button>
              </div>
              <p className="truncate text-sm text-slate-400">{user?.email}</p>
              {providerLabel && (
                <p className="mt-1 font-mono text-xs uppercase tracking-widest text-neon-pink">
                  {providerLabel}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Streak */}
      <div className="card flex items-center gap-4 p-5">
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border ${streak.current > 0 ? 'border-neon-amber/50 text-neon-amber shadow-[0_0_18px_rgba(255,176,32,0.3)]' : 'border-slate-500/30 text-slate-500'}`}>
          <FlameIcon active={streak.current > 0} />
        </div>
        <div className="flex-1">
          <p className="label">{t('account.currentStreak')}</p>
          <p className={`font-display text-3xl font-extrabold ${streak.current > 0 ? 'text-neon-amber' : 'text-slate-400'}`}>
            {streak.current} <span className="text-base font-semibold text-slate-500">{streak.current === 1 ? t('common.day') : t('common.days')}</span>
          </p>
          <p className="text-xs text-slate-500">
            {t('account.bestStreakDays', { count: streak.best })}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('account.trainings')} value={stats.total} tone="brand" />
        <Stat label={t('account.totalMinutes')} value={stats.totalMinutes} tone="pink" />
        <Stat label={t('account.activeRoutines')} value={activeRoutines.length} tone="brand" />
        <Stat label={t('account.ownExercises')} value={exercises.filter((e) => e.isCustom).length} tone="pink" />
      </div>

      {/* Achievements */}
      <AchievementCard />

      {/* Theme selector (only themes you own) */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold uppercase tracking-wide text-slate-100">{t('account.theme')}</h2>
          <Link to="/store" className="text-xs font-semibold text-brand-400 hover:text-brand-300">
            {t('account.moreThemes')}
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {THEMES.filter((th) => ownedThemes.includes(th.id)).map((th) => {
            const active = th.id === activeTheme
            return (
              <button
                key={th.id}
                onClick={() => th.id !== activeTheme && setTheme(th.id)}
                title={t('themes.' + th.id)}
                className={`relative h-10 w-10 rounded-full transition ${active ? 'ring-2 ring-offset-2 ring-offset-ink-850' : 'opacity-80 hover:opacity-100'}`}
                style={{ background: th.swatch, boxShadow: active ? `0 0 14px ${th.swatch}99` : 'none', '--tw-ring-color': th.swatch }}
              >
                {active && (
                  <span className="absolute inset-0 flex items-center justify-center text-ink-950">
                    <CheckIcon className="h-4 w-4" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Language */}
      <div className="card p-5">
        <h2 className="mb-3 font-display font-bold uppercase tracking-wide text-slate-100">{t('account.language')}</h2>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((lng) => {
            const active = i18n.language?.startsWith(lng.code)
            return (
              <button
                key={lng.code}
                onClick={() => { i18n.changeLanguage(lng.code); setLang(lng.code) }}
                className={`chip border px-3 py-1.5 ${
                  active
                    ? 'border-brand-400 bg-brand-500/15 text-brand-300'
                    : 'border-slate-500/25 bg-ink-800/60 text-slate-400 hover:border-brand-400/40 hover:text-brand-200'
                }`}
              >
                {lng.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Physical profile (optional) */}
      <PhysicalProfile
        heightCm={heightCm}
        birthDate={birthDate}
        sex={sex}
        trackBodyComposition={trackBodyComposition}
        save={savePhysicalProfile}
      />

      {/* Body weight: register/view/edit current and past weeks */}
      <BodyWeightSection
        weights={weights}
        trackBodyComposition={trackBodyComposition}
        saveWeight={saveWeight}
        deleteWeight={deleteWeight}
      />

      {/* Activity summary */}
      <div className="card p-5">
        <h2 className="mb-3 font-display font-bold uppercase tracking-wide text-slate-100">{t('account.activity')}</h2>
        <Row label={t('account.firstLog')} value={stats.firstDate ?? '—'} />
        <Row label={t('account.lastWorkout')} value={stats.lastDate ?? '—'} />
        <Row label={t('account.avgPerSession')} value={stats.avgMinutes ? `${stats.avgMinutes} min` : '—'} last />
      </div>

      {/* Actions */}
      <div className="card p-1.5">
        <ActionRow onClick={handleExport} icon={<DownloadIcon />} label={t('account.exportData')} />
        <div className="mx-3 border-t border-brand-500/15" />
        <ActionRow onClick={() => fileInputRef.current?.click()} icon={<UploadIcon />} label={t('account.restoreBackup')} />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleFileChosen}
      />

      {/* Import confirmation */}
      {importPreview && (
        <div className="card border-neon-red/40 p-5">
          <h2 className="font-display font-bold uppercase tracking-wide text-neon-red">{t('account.restoreTitle')}</h2>

          <div className="mt-3 rounded-lg border border-neon-red/40 bg-neon-red/10 p-3 text-sm text-neon-red">
            <p className="font-semibold">{t('account.restoreWarnTitle')}</p>
            <p className="mt-1 text-neon-red/90">
              {t('account.restoreWarnBody')}
            </p>
          </div>

          <p className="mt-3 text-sm text-slate-400">{t('account.backupContains')}</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            <li>{t('account.backupLogs', { count: importPreview.logs.length })}</li>
            <li>{t('account.backupWeights', { count: importPreview.weights.length })}</li>
            <li>{t('account.backupRoutines', { count: importPreview.customRoutines.length })}</li>
            <li>{t('account.backupExercises', { count: importPreview.customExercises.length })}</li>
          </ul>
          <p className="mt-3 text-xs text-neon-amber">
            {t('account.backupTip')}
          </p>
          <p className="mt-2 text-xs text-slate-500">{t('account.backupNoPII')}</p>

          {importError && (
            <p className="mt-3 rounded-lg border border-neon-red/40 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">
              {importError}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={runImport}
              disabled={importing}
              className="btn flex-1 border border-neon-red/60 bg-neon-red/20 text-neon-red hover:bg-neon-red/30"
            >
              {importing ? t('account.restoring') : t('account.replaceAll')}
            </button>
            <button onClick={cancelImport} className="btn-ghost flex-1">{t('account.cancel')}</button>
          </div>
        </div>
      )}
      {importError && !importPreview && (
        <p className="rounded-lg border border-neon-red/40 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">
          {importError}
        </p>
      )}
      {importDone && (
        <p className="rounded-lg border border-brand-400/40 bg-brand-500/10 px-3 py-2 text-sm text-brand-300">
          {t('account.backupRestored')}
        </p>
      )}

      <button
        onClick={signOut}
        className="btn w-full border border-slate-500/30 bg-ink-700/50 text-slate-300 hover:border-brand-400/40 hover:text-brand-200"
      >
        <LogoutIcon /> {t('account.signOut')}
      </button>

      {/* Danger zone */}
      <div className="card border-neon-red/30 p-5">
        <h2 className="font-display font-bold uppercase tracking-wide text-neon-red">{t('account.dangerZone')}</h2>
        <p className="mt-1 text-sm text-slate-400">
          {t('account.deleteWarning')}
        </p>

        {error && (
          <p className="mt-3 rounded-lg border border-neon-red/40 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">
            {error}
          </p>
        )}

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="btn mt-4 w-full border border-neon-red/50 bg-neon-red/10 text-neon-red hover:bg-neon-red/20"
          >
            <TrashIcon /> {t('account.deleteAccount')}
          </button>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm font-semibold text-slate-200">{t('account.confirmDeleteQuestion')}</p>

            {/* Reauth prompt: only for email accounts when the session is stale */}
            {reauthNeeded && isPasswordUser && (
              <div>
                <label className="label mb-1.5">{t('account.confirmPassword')}</label>
                <input
                  type="password"
                  value={reauthPassword}
                  onChange={(e) => setReauthPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input"
                  autoFocus
                />
              </div>
            )}
            {reauthNeeded && !isPasswordUser && (
              <p className="text-xs text-neon-amber">
                {t('account.confirmGoogle')}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={deleting || (reauthNeeded && isPasswordUser && !reauthPassword)}
                className="btn flex-1 border border-neon-red/60 bg-neon-red/20 text-neon-red hover:bg-neon-red/30"
              >
                {deleting ? t('account.deleting') : reauthNeeded ? t('account.confirmAndDelete') : t('account.yesDelete')}
              </button>
              <button onClick={cancelDelete} className="btn-ghost flex-1">
                {t('account.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-600">
        Vortx · v0.1.0
      </p>
    </div>
  )
}

function computeStats(logs) {
  const trained = logs.filter((l) => l.trained)
  const total = trained.length
  const totalMinutes = trained.reduce((a, l) => a + (Number(l.durationMinutes) || 0), 0)
  const withDuration = trained.filter((l) => Number(l.durationMinutes) > 0)
  const avgMinutes = withDuration.length
    ? Math.round(totalMinutes / withDuration.length)
    : 0

  const dates = trained.map((l) => l.date).sort()
  const firstDate = dates[0] ? fmt(dates[0]) : null
  const lastDate = dates.at(-1) ? fmt(dates.at(-1)) : null

  return {
    total,
    totalMinutes,
    avgMinutes,
    firstDate,
    lastDate,
  }
}

function fmt(iso) {
  return formatMedium(fromISODate(iso))
}

// Optional physical profile: height/birth date/sex + the body-composition
// toggle. All fields are optional; nothing here is required to use the app.
// Height feeds BMI in Analysis; the toggle reveals extra scale metrics when
// logging weight. Edits go to a local draft and only persist on explicit Save,
// so the user gets clear feedback (no silent auto-save).
function PhysicalProfile({ heightCm, birthDate, sex, trackBodyComposition, save }) {
  const { t } = useTranslation()

  // Normalize props into a comparable draft shape. Height is kept as a string
  // for the controlled input; '' means cleared.
  const propHeight = heightCm === '' || heightCm == null ? '' : String(heightCm)
  const propBirth = birthDate ?? ''
  const propSex = sex ?? ''

  const [draft, setDraft] = useState({
    height: propHeight,
    birth: propBirth,
    sex: propSex,
    track: !!trackBodyComposition,
  })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Keep the draft in sync with incoming props unless the user has pending
  // edits (don't clobber active edits mid-typing).
  useEffect(() => {
    if (dirty) return
    setDraft({ height: propHeight, birth: propBirth, sex: propSex, track: !!trackBodyComposition })
  }, [propHeight, propBirth, propSex, trackBodyComposition, dirty])

  function update(patch) {
    setDraft((d) => ({ ...d, ...patch }))
    setDirty(true)
    setSaved(false)
  }

  const hasChanges =
    draft.height !== propHeight ||
    draft.birth !== propBirth ||
    draft.sex !== propSex ||
    draft.track !== !!trackBodyComposition

  // Height is capped at 3 digits and a max of 230 cm. Reject keystrokes that
  // would exceed either so the input can't hold an out-of-range value.
  function updateHeight(raw) {
    if (raw === '') return update({ height: '' })
    if (!/^\d{1,3}$/.test(raw)) return // only up to 3 digits, no decimals/sign
    if (Number(raw) > 230) return
    update({ height: raw })
  }

  async function handleSave() {
    const n = Number(draft.height)
    const nextHeight =
      draft.height !== '' && Number.isFinite(n) && n > 0 ? Math.min(n, 230) : ''
    setSaving(true)
    try {
      await save({
        heightCm: nextHeight,
        birthDate: draft.birth,
        sex: draft.sex,
        trackBodyComposition: draft.track,
      })
      // Reflect the coerced height back into the draft so a cleared/invalid
      // value doesn't leave a stale string in the input after save.
      setDraft((d) => ({ ...d, height: nextHeight === '' ? '' : String(nextHeight) }))
      setDirty(false)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const SEX_OPTIONS = [
    { value: 'male', label: t('account.sexMale') },
    { value: 'female', label: t('account.sexFemale') },
    { value: '', label: t('account.sexUnset') },
  ]

  return (
    <div className="card p-5">
      <h2 className="font-display font-bold uppercase tracking-wide text-slate-100">{t('account.physicalProfile')}</h2>
      <p className="mt-0.5 text-xs text-slate-400">{t('account.physicalProfileHint')}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label mb-1.5 block">{t('account.height')}</label>
          <div className="relative">
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="230"
              step="1"
              value={draft.height}
              onChange={(e) => updateHeight(e.target.value)}
              placeholder={t('account.heightPlaceholder')}
              className="input pr-10"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">cm</span>
          </div>
        </div>

        <div>
          <label className="label mb-1.5 block">{t('account.birthDate')}</label>
          <input
            type="date"
            value={draft.birth}
            onChange={(e) => update({ birth: e.target.value })}
            className="input"
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="label mb-1.5 block">{t('account.sex')}</label>
        <div className="flex flex-wrap gap-2">
          {SEX_OPTIONS.map((opt) => {
            const active = draft.sex === opt.value
            return (
              <button
                key={opt.value || 'unset'}
                onClick={() => !active && update({ sex: opt.value })}
                className={`chip border px-3 py-1.5 ${
                  active
                    ? 'border-brand-400 bg-brand-500/15 text-brand-300'
                    : 'border-slate-500/25 bg-ink-800/60 text-slate-400 hover:border-brand-400/40 hover:text-brand-200'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-4 flex items-start justify-between gap-3 border-t border-brand-500/10 pt-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-200">{t('account.trackBodyComposition')}</p>
          <p className="mt-0.5 text-xs text-slate-400">{t('account.trackBodyCompositionHint')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={draft.track}
          onClick={() => update({ track: !draft.track })}
          className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition ${
            draft.track
              ? 'border-brand-400 bg-brand-500/30'
              : 'border-slate-500/30 bg-ink-700/60'
          }`}
        >
          <span
            className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition ${
              draft.track ? 'left-6 bg-brand-300 shadow-neon' : 'left-1 bg-slate-400'
            }`}
          />
        </button>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={handleSave} disabled={saving || !hasChanges} className="btn-primary px-4">
          {saving ? t('account.saving') : t('account.save')}
        </button>
        {saved && !hasChanges && (
          <span className="text-xs font-semibold text-brand-300">{t('account.savedConfirm')}</span>
        )}
      </div>
    </div>
  )
}

// A reusable weight + optional body-composition input group, shared by the
// current-week form and the per-entry editor below. Composition inputs render
// only when `showComposition` is true.
function WeightFields({ fields, onChange, showComposition }) {
  const { t } = useTranslation()
  const set = (key, limit) => (v) => onChange({ ...fields, [key]: sanitizeDecimal(v, limit) })
  return (
    <div className="space-y-3">
      <div>
        <label className="label mb-1 block">{t('weight.weightLabel')}</label>
        <div className="relative">
          <input
            type="text"
            inputMode="decimal"
            value={fields.weightKg}
            onChange={(e) => set('weightKg', WEIGHT_LIMIT)(e.target.value)}
            placeholder={t('weight.placeholder')}
            className="input pr-10"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">kg</span>
        </div>
      </div>
      {showComposition && (
        <div className="grid grid-cols-2 gap-2">
          <MetricField label={t('weight.bodyFat')} unit="%" value={fields.bodyFatPct} onChange={set('bodyFatPct', COMP_LIMITS.bodyFatPct)} />
          <MetricField label={t('weight.muscleMass')} unit="kg" value={fields.muscleMassKg} onChange={set('muscleMassKg', COMP_LIMITS.muscleMassKg)} />
          <MetricField label={t('weight.visceralFat')} unit={t('weight.unitLevel')} value={fields.visceralFat} onChange={set('visceralFat', COMP_LIMITS.visceralFat)} />
          <MetricField label={t('weight.bmr')} unit="kcal" value={fields.bmrKcal} onChange={set('bmrKcal', COMP_LIMITS.bmrKcal)} />
        </div>
      )}
    </div>
  )
}

function MetricField({ label, unit, value, onChange }) {
  return (
    <div>
      <label className="label mb-1 block">{label}</label>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input pr-12"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{unit}</span>
      </div>
    </div>
  )
}

// Build the editable form shape from a stored weight entry (numbers → strings,
// missing optional fields → '').
function entryToFields(entry) {
  const s = (v) => (v == null ? '' : String(v))
  return {
    weightKg: s(entry?.weightKg),
    bodyFatPct: s(entry?.bodyFatPct),
    muscleMassKg: s(entry?.muscleMassKg),
    visceralFat: s(entry?.visceralFat),
    bmrKcal: s(entry?.bmrKcal),
  }
}

const EMPTY_FIELDS = { weightKg: '', bodyFatPct: '', muscleMassKg: '', visceralFat: '', bmrKcal: '' }

// Blank optional fields must pass as undefined so saveWeight omits them.
const opt = (v) => (v === '' || v == null ? undefined : v)

// "Peso y cuerpo": register/edit the current week's entry and view/edit/delete
// every past entry. One doc per ISO week, so editing a past week is an upsert
// on its weekId (never a new doc).
function BodyWeightSection({ weights, trackBodyComposition, saveWeight, deleteWeight }) {
  const { t } = useTranslation()
  const currentWeek = weekIdOf(new Date())
  const currentEntry = weights.find((w) => w.weekId === currentWeek)

  const [fields, setFields] = useState(EMPTY_FIELDS)
  const [savingCurrent, setSavingCurrent] = useState(false)
  const [editingWeek, setEditingWeek] = useState(null)

  // Pre-fill the current-week form from its existing entry (so it edits rather
  // than duplicates); keep it in sync as the snapshot changes.
  useEffect(() => {
    setFields(currentEntry ? entryToFields(currentEntry) : EMPTY_FIELDS)
  }, [currentEntry?.weekId, currentEntry?.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCurrent() {
    const n = Number(fields.weightKg)
    if (!n || n <= 0) return
    setSavingCurrent(true)
    try {
      await saveWeight({
        weekId: currentWeek,
        date: currentEntry?.date ?? toISODate(new Date()),
        weightKg: n,
        bodyFatPct: opt(fields.bodyFatPct),
        muscleMassKg: opt(fields.muscleMassKg),
        visceralFat: opt(fields.visceralFat),
        bmrKcal: opt(fields.bmrKcal),
      })
    } finally {
      setSavingCurrent(false)
    }
  }

  // Past entries (exclude current week), newest first. The array arrives sorted
  // by weekId asc, so reverse for display.
  const past = weights.filter((w) => w.weekId !== currentWeek).slice().reverse()

  return (
    <div className="card p-5">
      <h2 className="font-display font-bold uppercase tracking-wide text-slate-100">{t('account.bodyWeight')}</h2>
      <p className="mt-0.5 text-xs text-slate-400">{t('account.bodyWeightHint')}</p>

      {/* Current week */}
      <div className="mt-4 rounded-xl border border-brand-500/15 bg-ink-800/40 p-4">
        <p className="label mb-3">{t('account.currentWeekEntry')}</p>
        <WeightFields fields={fields} onChange={setFields} showComposition={trackBodyComposition} />
        <button
          onClick={saveCurrent}
          disabled={savingCurrent || !fields.weightKg}
          className="btn-primary mt-3 px-4"
        >
          {savingCurrent ? t('account.saving') : currentEntry ? t('account.updateEntry') : t('account.save')}
        </button>
      </div>

      {/* History */}
      <div className="mt-5">
        <p className="label mb-2">{t('account.weightHistory')}</p>
        {past.length === 0 ? (
          <p className="text-sm text-slate-500">{t('account.noWeightHistory')}</p>
        ) : (
          <ul className="space-y-2">
            {past.map((entry) =>
              editingWeek === entry.weekId ? (
                <li key={entry.weekId}>
                  <WeightEntryEditor
                    entry={entry}
                    trackBodyComposition={trackBodyComposition}
                    saveWeight={saveWeight}
                    onClose={() => setEditingWeek(null)}
                  />
                </li>
              ) : (
                <li
                  key={entry.weekId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-brand-500/10 bg-ink-800/40 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-200">
                      {entry.weightKg} kg
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {entry.date ? formatMedium(fromISODate(entry.date)) : entry.weekId}
                      </span>
                    </p>
                    <WeightEntryExtras entry={entry} />
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => setEditingWeek(entry.weekId)}
                      title={t('common.edit')}
                      className="rounded-lg p-2 text-slate-500 transition hover:bg-brand-500/10 hover:text-brand-300"
                    >
                      <PencilIcon />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(t('account.confirmDeleteWeight'))) deleteWeight(entry.weekId)
                      }}
                      title={t('common.delete')}
                      className="rounded-lg p-2 text-slate-500 transition hover:bg-neon-red/10 hover:text-neon-red"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

// Read-only summary of an entry's composition fields (always shown if present,
// even when the toggle is off, so data is never hidden).
function WeightEntryExtras({ entry }) {
  const { t } = useTranslation()
  const parts = []
  if (entry.bodyFatPct != null) parts.push(`${t('weight.bodyFat')} ${entry.bodyFatPct}%`)
  if (entry.muscleMassKg != null) parts.push(`${t('weight.muscleMass')} ${entry.muscleMassKg} kg`)
  if (entry.visceralFat != null) parts.push(`${t('weight.visceralFat')} ${entry.visceralFat}`)
  if (entry.bmrKcal != null) parts.push(`${t('weight.bmr')} ${entry.bmrKcal} kcal`)
  if (parts.length === 0) return null
  return <p className="mt-0.5 truncate text-xs text-slate-500">{parts.join(' · ')}</p>
}

// Inline editor for a past entry: upsert on the same weekId (keeps the model of
// one entry per week) and keeps the original date.
function WeightEntryEditor({ entry, trackBodyComposition, saveWeight, onClose }) {
  const { t } = useTranslation()
  const [fields, setFields] = useState(entryToFields(entry))
  const [saving, setSaving] = useState(false)
  // Show composition inputs if the toggle is on OR the entry already has data.
  const hasComposition =
    entry.bodyFatPct != null ||
    entry.muscleMassKg != null ||
    entry.visceralFat != null ||
    entry.bmrKcal != null
  const showComposition = trackBodyComposition || hasComposition

  async function handleSave() {
    const n = Number(fields.weightKg)
    if (!n || n <= 0) return
    setSaving(true)
    try {
      await saveWeight({
        weekId: entry.weekId,
        date: entry.date ?? toISODate(new Date()),
        weightKg: n,
        bodyFatPct: opt(fields.bodyFatPct),
        muscleMassKg: opt(fields.muscleMassKg),
        visceralFat: opt(fields.visceralFat),
        bmrKcal: opt(fields.bmrKcal),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-brand-500/25 bg-ink-800/60 p-3">
      <p className="label mb-3">
        {entry.date ? formatMedium(fromISODate(entry.date)) : entry.weekId}
      </p>
      <WeightFields fields={fields} onChange={setFields} showComposition={showComposition} />
      <div className="mt-3 flex gap-2">
        <button onClick={handleSave} disabled={saving || !fields.weightKg} className="btn-primary px-4">
          {saving ? t('account.saving') : t('account.save')}
        </button>
        <button onClick={onClose} className="btn-ghost px-4">{t('account.cancel')}</button>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }) {
  const color = tone === 'pink' ? 'text-neon-pink neon-text-pink' : 'text-brand-300 neon-text'
  return (
    <div className="card p-4">
      <p className={`font-display text-3xl font-extrabold ${color}`}>{value}</p>
      <p className="mt-0.5 text-xs text-slate-400">{label}</p>
    </div>
  )
}

function Row({ label, value, last }) {
  return (
    <div className={`flex items-center justify-between py-2.5 ${last ? '' : 'border-b border-brand-500/10'}`}>
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-semibold text-slate-200">{value}</span>
    </div>
  )
}

function ActionRow({ onClick, icon, label, sub }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition hover:bg-brand-500/10">
      <span className="text-brand-300">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-200">{label}</span>
        {sub && <span className="block text-xs text-slate-400">{sub}</span>}
      </span>
    </button>
  )
}

function DownloadIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0 4-4m-4 4-4-4M5 20h14" />
    </svg>
  )
}
function UploadIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20V8m0 0 4 4m-4-4-4 4M5 4h14" />
    </svg>
  )
}
function LogoutIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H3m0 0 4-4m-4 4 4 4M13 4h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-6" />
    </svg>
  )
}
function PencilIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  )
}
