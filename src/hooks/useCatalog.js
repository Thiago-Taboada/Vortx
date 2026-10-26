import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { createElement } from 'react'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { EXERCISES, ROUTINE_TEMPLATE } from '../data/seedData'
import { localized } from '../lib/i18nContent'
import i18n from '../i18n'
import { BASE_ROUTINE_SLOTS } from '../lib/points'
import { applyTheme, DEFAULT_THEME } from '../lib/themes'

// Delete every doc in a user subcollection, in batches (Firestore caps at 500).
async function wipeSubcollection(uid, name) {
  const snap = await getDocs(collection(db, 'users', uid, name))
  const docs = snap.docs
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db)
    for (const d of docs.slice(i, i + 400)) batch.delete(d.ref)
    await batch.commit()
  }
}

// -----------------------------------------------------------------------------
// Catalog = single source of truth for exercises + routines. It merges:
//   - BASE catalog: the PDF exercises + template routine (local, read-only).
//   - USER data:   exercises & routines the user creates (Firestore, private).
//   - activeRoutineIds (users/{uid}.activeRoutineIds).
//
// Exposed through a Context so the Firestore subscriptions are opened ONCE for
// the whole app (not re-created on every client-side navigation, which was
// causing the loader to hang between pages).
// -----------------------------------------------------------------------------
const CatalogContext = createContext(null)

export function CatalogProvider({ children }) {
  const { user } = useAuth()
  const [userExercises, setUserExercises] = useState([])
  const [userRoutines, setUserRoutines] = useState([])
  // Base catalog lives in Firestore (/catalog). null = not loaded yet.
  const [baseExercises, setBaseExercises] = useState(null)
  const [baseRoutines, setBaseRoutines] = useState(null)
  const [activeRoutineIds, setActiveRoutineIds] = useState([])
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Keep latest activeRoutineIds for callbacks without re-creating them.
  const activeRef = useRef(activeRoutineIds)
  activeRef.current = activeRoutineIds

  useEffect(() => {
    if (!user) {
      // Signed out: reset to defaults and stop loading.
      setUserExercises([])
      setUserRoutines([])
      setActiveRoutineIds([])
      setProfile(null)
      setLoading(false)
      return
    }

    setLoading(true)
    // Safety net: never let the loader hang. Local seed data is enough to
    // render, so release the UI shortly even if a snapshot is slow.
    const releaseTimer = setTimeout(() => setLoading(false), 1500)
    const release = () => {
      clearTimeout(releaseTimer)
      setLoading(false)
    }

    const unsubExercises = onSnapshot(
      collection(db, 'users', user.uid, 'exercises'),
      (snap) => {
        setUserExercises(snap.docs.map((d) => ({ id: d.id, ...d.data(), isCustom: true })))
        release()
      },
      (err) => {
        console.error('userExercises', err)
        release()
      },
    )

    const unsubRoutines = onSnapshot(
      collection(db, 'users', user.uid, 'routines'),
      (snap) => setUserRoutines(snap.docs.map((d) => ({ id: d.id, ...d.data(), isCustom: true }))),
      (err) => console.error('userRoutines', err),
    )

    const unsubProfile = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        const data = snap.data()
        setActiveRoutineIds(data?.activeRoutineIds ?? [])
        setProfile(data ?? {})
        release()
      },
      (err) => {
        console.error('profile', err)
        release()
      },
    )

    // Global base catalog (admin-managed). Read-only for normal users.
    const unsubBaseEx = onSnapshot(
      collection(db, 'catalog', 'data', 'exercises'),
      (snap) => {
        setBaseExercises(snap.docs.map((d) => ({ id: d.id, ...d.data(), isCustom: false })))
        release()
      },
      (err) => {
        console.error('baseExercises', err)
        setBaseExercises([]) // fall back to seed
        release()
      },
    )

    const unsubBaseRt = onSnapshot(
      collection(db, 'catalog', 'data', 'routines'),
      (snap) => setBaseRoutines(snap.docs.map((d) => ({ id: d.id, ...d.data(), isCustom: false }))),
      (err) => {
        console.error('baseRoutines', err)
        setBaseRoutines([])
      },
    )

    return () => {
      clearTimeout(releaseTimer)
      unsubExercises()
      unsubRoutines()
      unsubProfile()
      unsubBaseEx()
      unsubBaseRt()
    }
  }, [user])

  // Base catalog: Firestore if populated, else the local seed as fallback.
  const resolvedBaseExercises = useMemo(
    () => (baseExercises && baseExercises.length > 0 ? baseExercises : EXERCISES.map((e) => ({ ...e, isCustom: false }))),
    [baseExercises],
  )
  const resolvedBaseRoutines = useMemo(
    () => (baseRoutines && baseRoutines.length > 0 ? baseRoutines : [{ ...ROUTINE_TEMPLATE, isCustom: false }]),
    [baseRoutines],
  )

  // Merged collections (base + custom)
  const exercises = useMemo(() => {
    const byId = new Map(resolvedBaseExercises.map((e) => [e.id, e]))
    for (const e of userExercises) byId.set(e.id, e) // custom overrides base
    return [...byId.values()]
  }, [resolvedBaseExercises, userExercises])

  const routines = useMemo(
    () => {
      const byId = new Map(resolvedBaseRoutines.map((r) => [r.id, r]))
      for (const r of userRoutines) byId.set(r.id, r)
      return [...byId.values()]
    },
    [resolvedBaseRoutines, userRoutines],
  )

  const activeRoutines = useMemo(
    () => routines.filter((r) => activeRoutineIds.includes(r.id)),
    [routines, activeRoutineIds],
  )

  // ---- mutations -----------------------------------------------------------

  const saveExercise = useCallback(
    async (exercise) => {
      if (!user) throw new Error('No autenticado')
      const id = exercise.id || slugify(localized(exercise.name)) + '-' + Date.now().toString(36)
      const { id: _omit, isCustom: _c, ...rest } = exercise
      await setDoc(
        doc(db, 'users', user.uid, 'exercises', id),
        { ...rest, updatedAt: serverTimestamp() },
        { merge: true },
      )
      return id
    },
    [user],
  )

  const deleteExercise = useCallback(
    async (id) => {
      if (!user) throw new Error('No autenticado')
      await deleteDoc(doc(db, 'users', user.uid, 'exercises', id))
    },
    [user],
  )

  const saveRoutine = useCallback(
    async (routine) => {
      if (!user) throw new Error('No autenticado')
      const id = routine.id || slugify(localized(routine.name)) + '-' + Date.now().toString(36)
      const { id: _omit, isCustom: _c, ...rest } = routine
      await setDoc(
        doc(db, 'users', user.uid, 'routines', id),
        { ...rest, isTemplate: false, updatedAt: serverTimestamp() },
        { merge: true },
      )
      return id
    },
    [user],
  )

  const setActiveRoutine = useCallback(
    async (routineId, active) => {
      if (!user) throw new Error('No autenticado')
      const current = activeRef.current
      const next = active
        ? [...new Set([...current, routineId])]
        : current.filter((id) => id !== routineId)
      setActiveRoutineIds(next) // optimistic
      await setDoc(
        doc(db, 'users', user.uid),
        { activeRoutineIds: next, updatedAt: serverTimestamp() },
        { merge: true },
      )
    },
    [user],
  )

  // Derived reward fields from the profile.
  const pointsSpent = profile?.pointsSpent ?? 0
  const routineSlots = profile?.routineSlots ?? BASE_ROUTINE_SLOTS
  const ownedThemes = profile?.ownedThemes?.length ? profile.ownedThemes : [DEFAULT_THEME]
  const activeTheme = profile?.theme ?? DEFAULT_THEME

  // Apply the active theme to the document whenever it changes.
  useEffect(() => {
    applyTheme(activeTheme)
  }, [activeTheme])

  // Buy a theme: spend points and add it to owned.
  const buyTheme = useCallback(
    async (themeId, cost) => {
      if (!user) throw new Error('No autenticado')
      const owned = [...new Set([...ownedThemes, themeId])]
      await setDoc(
        doc(db, 'users', user.uid),
        { pointsSpent: pointsSpent + cost, ownedThemes: owned, updatedAt: serverTimestamp() },
        { merge: true },
      )
    },
    [user, pointsSpent, ownedThemes],
  )

  // Activate an already-owned theme.
  const setTheme = useCallback(
    async (themeId) => {
      if (!user) throw new Error('No autenticado')
      applyTheme(themeId) // instant feedback
      await setDoc(
        doc(db, 'users', user.uid),
        { theme: themeId, updatedAt: serverTimestamp() },
        { merge: true },
      )
    },
    [user],
  )

  // Persist the preferred language on the profile (mirrors setTheme). Changing
  // the i18n language for instant feedback is done by the caller.
  const setLang = useCallback(
    async (lang) => {
      if (!user) return
      await setDoc(
        doc(db, 'users', user.uid),
        { lang, updatedAt: serverTimestamp() },
        { merge: true },
      )
    },
    [user],
  )

  // Apply the stored language preference on load: if the profile has a `lang`
  // and it differs from the active i18n language, switch to it. The stored
  // preference wins over the localStorage/navigator detection on login.
  useEffect(() => {
    const lang = profile?.lang
    if (lang && i18n.language?.split('-')[0] !== lang) {
      i18n.changeLanguage(lang)
    }
  }, [profile?.lang])

  // Persist the optional physical profile (height, birth date, sex) and the
  // body-composition feature toggle. Mirrors setTheme/setLang: a merged write
  // on the user doc. The caller passes only the fields it wants to change.
  const savePhysicalProfile = useCallback(
    async (fields) => {
      if (!user) throw new Error('No autenticado')
      await setDoc(
        doc(db, 'users', user.uid),
        { ...fields, updatedAt: serverTimestamp() },
        { merge: true },
      )
    },
    [user],
  )

  // Buy a routine slot: spend points and raise the slot limit by 1 (atomic-ish
  // merge write). The caller checks affordability.
  const buyRoutineSlot = useCallback(
    async (cost) => {
      if (!user) throw new Error('No autenticado')
      await setDoc(
        doc(db, 'users', user.uid),
        {
          pointsSpent: pointsSpent + cost,
          routineSlots: routineSlots + 1,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
    },
    [user, pointsSpent, routineSlots],
  )

  // ---- admin: base catalog mutations (require admin per Firestore rules) ----

  const saveBaseExercise = useCallback(async (exercise) => {
    const id = exercise.id || slugify(localized(exercise.name)) + '-' + Date.now().toString(36)
    const { id: _omit, isCustom: _c, ...rest } = exercise
    await setDoc(
      doc(db, 'catalog', 'data', 'exercises', id),
      { ...rest, updatedAt: serverTimestamp() },
      { merge: true },
    )
    return id
  }, [])

  const deleteBaseExercise = useCallback(async (id) => {
    await deleteDoc(doc(db, 'catalog', 'data', 'exercises', id))
  }, [])

  const saveBaseRoutine = useCallback(async (routine) => {
    const id = routine.id || slugify(localized(routine.name)) + '-' + Date.now().toString(36)
    const { id: _omit, isCustom: _c, ...rest } = routine
    await setDoc(
      doc(db, 'catalog', 'data', 'routines', id),
      { ...rest, isTemplate: true, updatedAt: serverTimestamp() },
      { merge: true },
    )
    return id
  }, [])

  const deleteBaseRoutine = useCallback(async (id) => {
    await deleteDoc(doc(db, 'catalog', 'data', 'routines', id))
  }, [])

  // One-time: populate the global catalog from the local seed data.
  const seedCatalog = useCallback(async () => {
    for (const ex of EXERCISES) {
      const { id, ...rest } = ex
      await setDoc(doc(db, 'catalog', 'data', 'exercises', id), rest)
    }
    const { id: rid, ...routineRest } = ROUTINE_TEMPLATE
    await setDoc(doc(db, 'catalog', 'data', 'routines', rid), { ...routineRest, isTemplate: true })
    return { exercises: EXERCISES.length, routines: 1 }
  }, [])

  // Is the base catalog already in Firestore?
  const catalogSeeded = (baseExercises?.length ?? 0) > 0

  const deleteRoutine = useCallback(
    async (id) => {
      if (!user) throw new Error('No autenticado')
      await deleteDoc(doc(db, 'users', user.uid, 'routines', id))
      await setActiveRoutine(id, false) // drop from active list
    },
    [user, setActiveRoutine],
  )

  // Restore custom exercises + routines from a backup: WIPES existing custom
  // data first, then writes exactly what's in the file. Active routine ids are
  // replaced by the file's value (defaulting to the template if empty).
  const importCatalog = useCallback(
    async ({ customExercises = [], customRoutines = [], activeRoutineIds: ids = [] }) => {
      if (!user) throw new Error('No autenticado')
      await wipeSubcollection(user.uid, 'exercises')
      await wipeSubcollection(user.uid, 'routines')
      for (const ex of customExercises) {
        if (!ex.id) continue
        const { id, isCustom: _c, ...rest } = ex
        await setDoc(doc(db, 'users', user.uid, 'exercises', id), {
          ...rest,
          updatedAt: serverTimestamp(),
        })
      }
      for (const r of customRoutines) {
        if (!r.id) continue
        const { id, isCustom: _c, ...rest } = r
        await setDoc(doc(db, 'users', user.uid, 'routines', id), {
          ...rest,
          isTemplate: false,
          updatedAt: serverTimestamp(),
        })
      }
      await setDoc(
        doc(db, 'users', user.uid),
        {
          activeRoutineIds: ids,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
      return { exercises: customExercises.length, routines: customRoutines.length }
    },
    [user],
  )

  const value = {
    loading,
    exercises,
    routines,
    activeRoutines,
    activeRoutineIds,
    saveExercise,
    deleteExercise,
    saveRoutine,
    deleteRoutine,
    setActiveRoutine,
    importCatalog,
    // rewards
    pointsSpent,
    routineSlots,
    buyRoutineSlot,
    ownedThemes,
    activeTheme,
    buyTheme,
    setTheme,
    // language preference
    lang: profile?.lang ?? null,
    setLang,
    // optional physical profile + body-composition toggle
    heightCm: profile?.heightCm ?? '',
    birthDate: profile?.birthDate ?? '',
    sex: profile?.sex ?? '',
    trackBodyComposition: profile?.trackBodyComposition ?? false,
    savePhysicalProfile,
    // admin / base catalog
    catalogSeeded,
    seedCatalog,
    saveBaseExercise,
    deleteBaseExercise,
    saveBaseRoutine,
    deleteBaseRoutine,
  }

  return createElement(CatalogContext.Provider, { value }, children)
}

export function useCatalog() {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog must be used within CatalogProvider')
  return ctx
}

export function slugify(str) {
  return (str || 'item')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
