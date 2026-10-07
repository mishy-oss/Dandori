import { useEffect, useState } from 'react'

// 1分ごとに更新し、バックグラウンドから復帰したときにも再計算する
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const update = () => setNow(new Date())
    const timer = window.setInterval(update, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') update()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return now
}
