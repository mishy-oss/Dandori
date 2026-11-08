import { useEffect } from 'react'
import { todayStr } from '../lib/date'
import { useDataStore } from '../store/data'

/** 日付変更と画面復帰時に月の繰り越し・当日実績を更新する。月をまたいだ場合、今月を見ていた画面だけを新しい月へ進める。 */
export function useMonthlyPlanningEffect() {
  const ready = useDataStore(/* 初期化後だけ監視を開始する。 */ (state) => state.ready)
  useEffect(/* 日付の監視と画面復帰時の更新を登録する。 */ () => {
    if (!ready) return
    let observedDay = todayStr()
    let running = false
    /** 同時更新を防いで月管理を再読込し、失敗時は次の機会に再試行する。 */
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
    /** ページが再表示されたときに今日の実績を読み直す。 */
    function onVisible() { if (document.visibilityState === 'visible') void refresh(true) }
    /** ウィンドウへ戻った際に他の画面で保存された変更も反映する。 */
    function onFocus() { void refresh(true) }
    const timer = window.setInterval(/* 起動したまま日付をまたぐ場合にも更新する。 */ () => void refresh(), 60_000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return /* 画面破棄後は監視とタイマーを残さない。 */ () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onFocus) }
  }, [ready])
}
