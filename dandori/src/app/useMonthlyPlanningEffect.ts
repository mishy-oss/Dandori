import { useEffect } from 'react'
import { todayStr } from '../lib/date'
import { useDataStore } from '../store/data'

export function useMonthlyPlanningEffect() {
  const ready = useDataStore((state) => state.ready)
  useEffect(() => {
    if (!ready) return
    let observedDay = todayStr()
    let running = false
    async function refresh(force = false) {
      const today = todayStr()
      if (running || (!force && today === observedDay)) return
      running = true
      const previous = observedDay
      try {
        const state = useDataStore.getState()
        if (previous.slice(0, 7) !== today.slice(0, 7) && state.selectedMonth === previous.slice(0, 7)) await state.selectMonth(today.slice(0, 7))
        else await state.refreshPlanning()
        observedDay = today
      } catch {
        // 保存に失敗した場合も、次の時刻更新や画面復帰で再試行する。
      } finally { running = false }
    }
    function onVisible() { if (document.visibilityState === 'visible') void refresh(true) }
    function onFocus() { void refresh(true) }
    const timer = window.setInterval(() => void refresh(), 60_000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onFocus) }
  }, [ready])
}
