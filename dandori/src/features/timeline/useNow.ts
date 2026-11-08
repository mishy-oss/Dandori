import { useEffect, useState } from 'react'

// 1分ごとに更新し、バックグラウンドから復帰したときにも再計算する
export function useNow(): Date {
  /** 作成・更新・削除日時の保存に使う、現在のUNIX時刻をミリ秒単位で返す。 */
  const [now, setNow] = useState(() => new Date())

  useEffect(/* 1分周期の時刻更新と画面復帰の監視を開始し、画面から外れるときに両方を解除する。 */ () => {
    /** 現在日時を取り直してReactの状態に反映する。 */
    const update = () => setNow(new Date())
    const timer = window.setInterval(update, 60_000)
    /** ページが再び表示状態になった場合に、現在日時を更新する。 */
    const onVisible = () => {
      if (document.visibilityState === 'visible') update()
    }
    document.addEventListener('visibilitychange', onVisible)
    return /* 登録したイベント監視や待機中のタイマーを解除し、画面破棄後に処理が残らないようにする。 */ () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return now
}
