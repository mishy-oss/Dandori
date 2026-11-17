import { useEffect } from 'react'
import { useDataStore } from '../../store/data'
import { resumeGoogleLogin, syncAccount, syncCalendar, useAccountStore } from './accountStore'

export function useAccountSync(): void {
  useEffect(() => {
    let checking = false
    const check = async () => {
      if (checking || document.visibilityState === 'hidden') return
      checking = true
      try { await resumeGoogleLogin() } finally { checking = false }
    }
    const interval = setInterval(() => void check(), 3000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(interval); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) }
  }, [])
  const ready = useDataStore(state => state.ready)
  const authenticated = useAccountStore(state => state.authenticated)
  const calendarId = useAccountStore(state => state.calendar?.id)
  useEffect(() => {
    if (!ready || !authenticated || !calendarId) return
    const sync = () => { if (navigator.onLine && document.visibilityState !== 'hidden' && !useAccountStore.getState().busy) void syncCalendar() }
    const interval = setInterval(sync, 180_000)
    window.addEventListener('online', sync)
    sync()
    return () => { clearInterval(interval); window.removeEventListener('online', sync) }
  }, [ready, authenticated, calendarId])
  useEffect(() => {
    if (!ready || !authenticated) return
    let timer: ReturnType<typeof setTimeout>
    let previous = ''
    const sync = () => { if (navigator.onLine && document.visibilityState !== 'hidden') void syncAccount() }
    const unsubscribe = useDataStore.subscribe(state => {
      const current = JSON.stringify([state.issues, state.recurrenceRules, state.settings, state.monthlySnapshots])
      if (current === previous) return
      previous = current
      clearTimeout(timer)
      timer = setTimeout(sync, 1000)
    })
    const interval = setInterval(sync, 30_000)
    window.addEventListener('online', sync)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => { unsubscribe(); clearTimeout(timer); clearInterval(interval); window.removeEventListener('online', sync); window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync) }
  }, [ready, authenticated])
}
