import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'

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

// Realtime subscription to the current user's session logs.
// Doc id == ISO date (one session per day), which makes a day's check-in a
// simple upsert. Exposed via Context so the subscription is opened once for
// the whole app instead of per client-side navigation.
const LogsContext = createContext(null)

export function LogsProvider({ children }) {
  const { user } = useAuth()
  const [logs, setLogs] = useState([])
  const [weights, setWeights] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setLogs([])
      setWeights([])
      setLoading(false)
      return
    }

    setLoading(true)
    const releaseTimer = setTimeout(() => setLoading(false), 1500)
    const release = () => {
      clearTimeout(releaseTimer)
      setLoading(false)
    }

    const q = query(collection(db, 'users', user.uid, 'logs'), orderBy('date', 'desc'))
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        release()
      },
      (err) => {
        console.error('useLogs', err)
        release()
      },
    )

    // Body-weight log, one entry per week (doc id == weekId).
    const unsubWeights = onSnapshot(
      query(collection(db, 'users', user.uid, 'weights'), orderBy('weekId', 'asc')),
      (snap) => setWeights(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('useWeights', err),
    )

    return () => {
      clearTimeout(releaseTimer)
      unsub()
      unsubWeights()
    }
  }, [user])

  const saveLog = useCallback(
    async (log) => {
      if (!user) throw new Error('No autenticado')
      const id = log.id ?? log.date // date-keyed
      await setDoc(
        doc(db, 'users', user.uid, 'logs', id),
        { ...log, id, updatedAt: Date.now() },
        { merge: true },
      )
      return id
    },
    [user],
  )

  const deleteLog = useCallback(
    async (id) => {
      if (!user) throw new Error('No autenticado')
      await deleteDoc(doc(db, 'users', user.uid, 'logs', id))
    },
    [user],
  )

  // Save the body weight for a given week (one entry per weekId). The four
  // body-composition fields (smart-scale users) are optional: only the ones
  // actually provided as a finite positive number are written, so Analysis'
  // "has data?" checks stay accurate and blanks never persist as null/0.
  const saveWeight = useCallback(
    async ({ weekId, date, weightKg, bodyFatPct, muscleMassKg, visceralFat, bmrKcal }) => {
      if (!user) throw new Error('No autenticado')
      const payload = { weekId, date, weightKg: Number(weightKg), updatedAt: Date.now() }
      const optional = { bodyFatPct, muscleMassKg, visceralFat, bmrKcal }
      for (const [key, raw] of Object.entries(optional)) {
        const n = Number(raw)
        if (Number.isFinite(n) && n > 0) payload[key] = n
      }
      await setDoc(doc(db, 'users', user.uid, 'weights', weekId), payload, { merge: true })
    },
    [user],
  )

  const deleteWeight = useCallback(
    async (weekId) => {
      if (!user) throw new Error('No autenticado')
      await deleteDoc(doc(db, 'users', user.uid, 'weights', weekId))
    },
    [user],
  )

  // Restore logs + weights from a backup: WIPES existing data first, then
  // writes exactly what's in the file. Returns counts.
  const importLogsAndWeights = useCallback(
    async (importedLogs = [], importedWeights = []) => {
      if (!user) throw new Error('No autenticado')
      await wipeSubcollection(user.uid, 'logs')
      await wipeSubcollection(user.uid, 'weights')
      for (const log of importedLogs) {
        const id = log.id ?? log.date
        if (!id) continue
        const { id: _omit, ...rest } = log
        await setDoc(
          doc(db, 'users', user.uid, 'logs', id),
          { ...rest, id, updatedAt: Date.now() },
          { merge: true },
        )
      }
      for (const w of importedWeights) {
        if (!w.weekId) continue
        await setDoc(
          doc(db, 'users', user.uid, 'weights', w.weekId),
          { ...w, updatedAt: Date.now() },
          { merge: true },
        )
      }
      return { logs: importedLogs.length, weights: importedWeights.length }
    },
    [user],
  )

  const value = { logs, weights, loading, saveLog, deleteLog, saveWeight, deleteWeight, importLogsAndWeights }
  return createElement(LogsContext.Provider, { value }, children)
}

export function useLogs() {
  const ctx = useContext(LogsContext)
  if (!ctx) throw new Error('useLogs must be used within LogsProvider')
  return ctx
}
