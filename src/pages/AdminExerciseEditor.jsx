import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext.jsx'
import { useCatalog } from '../hooks/useCatalog'
import { CATEGORIES, MUSCLE_GROUPS, TRACKING_TYPES } from '../data/seedData'
import {
  toLangMap,
  toLangMapList,
  fromLangMap,
  fromLangMapList,
} from '../lib/i18nContent'
import LangTabs from '../components/LangTabs.jsx'
import Spinner from '../components/Spinner.jsx'

const EMPTY_MAP = { es: '', en: '', pt: '' }

const EMPTY = {
  name: { ...EMPTY_MAP },
  category: 'strength',
  tracking: 'reps',
  muscleGroups: [],
  equipment: { ...EMPTY_MAP },
  description: { ...EMPTY_MAP },
  cues: { ...EMPTY_MAP },
}

export default function AdminExerciseEditor() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { exerciseId } = useParams()
  const navigate = useNavigate()
  const { isAdmin, loading: authLoading } = useAuth()
  const { loading, exercises, saveBaseExercise, deleteBaseExercise } = useCatalog()
  const [form, setForm] = useState(EMPTY)
  const [draftLang, setDraftLang] = useState((i18n.language || 'es').split('-')[0])
  const [saving, setSaving] = useState(false)
  const [ready, setReady] = useState(false)

  const editing = Boolean(exerciseId)

  useEffect(() => {
    if (loading || ready) return
    if (editing) {
      const ex = exercises.find((e) => e.id === exerciseId)
      if (ex) {
        setForm({
          name: toLangMap(ex.name, lang),
          category: ex.category ?? 'strength',
          tracking: ex.tracking ?? 'reps',
          muscleGroups: ex.muscleGroups ?? [],
          equipment: toLangMapList(ex.equipment, ', ', lang),
          description: toLangMap(ex.description, lang),
          cues: toLangMapList(ex.cues, '\n', lang),
          id: ex.id,
        })
      }
    }
    setReady(true)
  }, [loading, ready, editing, exerciseId, exercises, lang])

  if (authLoading || loading) return <Spinner />
  if (!isAdmin) return <Navigate to="/" replace />

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: { ...f[field], [draftLang]: value } }))
  }

  function toggleMuscle(key) {
    setForm((f) => ({
      ...f,
      muscleGroups: f.muscleGroups.includes(key)
        ? f.muscleGroups.filter((m) => m !== key)
        : [...f.muscleGroups, key],
    }))
  }

  async function handleSave() {
    const name = fromLangMap(form.name)
    if (Object.keys(name).length === 0) {
      alert(t('admin.needName'))
      return
    }
    setSaving(true)
    try {
      await saveBaseExercise({
        id: editing ? exerciseId : undefined,
        name,
        category: form.category,
        tracking: form.tracking,
        muscleGroups: form.muscleGroups,
        equipment: fromLangMapList(form.equipment, ','),
        description: fromLangMap(form.description),
        cues: fromLangMapList(form.cues, '\n'),
      })
      navigate('/admin')
    } catch (err) {
      alert(t('admin.saveError') + (err?.message ?? t('admin.saveErrorFallback')))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(t('admin.confirmDeleteBase'))) return
    await deleteBaseExercise(exerciseId)
    navigate('/admin')
  }

  return (
    <div className="space-y-5">
      <Link to="/admin" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-400 hover:text-brand-300">
        <ChevronLeft /> {t('admin.back')}
      </Link>

      <h1 className="neon-title text-2xl text-brand-300">
        {editing ? t('admin.editBaseExercise') : t('admin.newBaseExerciseTitle')}
      </h1>
      <p className="-mt-3 text-xs text-neon-amber">{t('admin.affectsAll')}</p>

      <LangTabs value={draftLang} onChange={setDraftLang} label={t('editorLang.editingIn')} />

      <div className="card space-y-4 p-5">
        <div>
          <label className="label mb-1.5">{t('admin.name')}</label>
          <input value={form.name[draftLang]} maxLength={60} onChange={(e) => setField('name', e.target.value)} className="input" />
        </div>

        <div>
          <label className="label mb-1.5">{t('admin.category')}</label>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input">
            {Object.keys(CATEGORIES).map((k) => (
              <option key={k} value={k}>{t('categories.' + k)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label mb-1.5">{t('admin.howTracked')}</label>
          <select value={form.tracking} onChange={(e) => setForm({ ...form, tracking: e.target.value })} className="input">
            {Object.keys(TRACKING_TYPES).map((k) => (
              <option key={k} value={k}>{t('tracking.' + k)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label mb-2">{t('admin.muscleGroups')}</label>
          <div className="flex flex-wrap gap-2">
            {Object.keys(MUSCLE_GROUPS).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => toggleMuscle(k)}
                className={`chip border ${
                  form.muscleGroups.includes(k)
                    ? 'border-brand-400 bg-brand-500/20 text-brand-200 shadow-neon'
                    : 'border-slate-500/25 bg-ink-800/60 text-slate-400 hover:border-brand-400/40 hover:text-brand-200'
                }`}
              >
                {t('muscles.' + k)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label mb-1.5">{t('admin.equipment')}</label>
          <input value={form.equipment[draftLang]} maxLength={60} onChange={(e) => setField('equipment', e.target.value)} className="input" />
        </div>

        <div>
          <label className="label mb-1.5">{t('admin.description')}</label>
          <textarea value={form.description[draftLang]} maxLength={1000} onChange={(e) => setField('description', e.target.value)} rows={3} className="input resize-none" />
        </div>

        <div>
          <label className="label mb-1.5">{t('admin.cues')}</label>
          <textarea value={form.cues[draftLang]} maxLength={1000} onChange={(e) => setField('cues', e.target.value)} rows={3} className="input resize-none" />
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
          {saving ? t('admin.saving') : t('admin.save')}
        </button>
        {editing && (
          <button onClick={handleDelete} className="btn border border-neon-red/50 bg-neon-red/10 text-neon-red hover:bg-neon-red/20">
            {t('admin.deleteExercise')}
          </button>
        )}
      </div>
    </div>
  )
}

function ChevronLeft() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  )
}
